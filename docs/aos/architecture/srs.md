# Satellite Record Store - implementation design

This document describes the implementation of the Satellite Record Store (SRS) in the AOS framework. It covers the storage schema, async write path, pub/sub mechanism, and the interface contract between write delivery and query availability.

## Storage layers

The SRS uses Apache Doris as its persistent journal. All write methods store records in Doris. All query methods read from Doris.

An in-process pub/sub layer runs alongside the journal. When a record is written, the store delivers it to active subscribers via buffered Go channels before the Doris write completes. These two paths are independent.

| Layer        | Purpose                              |
| ------------ | ------------------------------------ |
| Apache Doris | Durable journal for all record types |
| Go channels  | Live delivery to active subscribers  |

The architectural specification defines a two-layer store with an in-memory ring buffer as the observation window and Doris as the secondary journal. The current implementation does not include the ring buffer. The Go channel mechanism covers the observation window role for active subscribers. Ring buffer implementation is deferred; the deferred requirements are listed at the end of this document.

## Schema

The SRS creates four tables in Doris at startup. All timestamps use `DATETIME(3)` (millisecond precision). All record identifiers are UUIDv7 strings stored as `VARCHAR(36)`.

### `telemetry`

Stores records written by Collectors via `AddTelemetry`.

```sql
CREATE TABLE IF NOT EXISTS telemetry (
    id           VARCHAR(36)  NOT NULL,
    signal       VARCHAR(50)  NOT NULL,
    payload      STRING       NOT NULL,
    attributes   VARIANT      NOT NULL,
    received_at  DATETIME(3)  NOT NULL
) DUPLICATE KEY(id)
DISTRIBUTED BY HASH(id) BUCKETS 3
PROPERTIES ("replication_num" = "1")
```

`attributes` is stored as a Doris `VARIANT` column. It holds the normalized key-value pairs extracted at collection time. Query predicates on attributes use `CAST(attributes['key'] AS STRING) = ?`. Keys that contain characters outside `[A-Za-z0-9_.:/-]` are not pushed down as SQL predicates; they are evaluated in Go after the scan.

### `insights`

Stores pattern detections written by Observers via `AddInsight`.

```sql
CREATE TABLE IF NOT EXISTS insights (
    id                VARCHAR(36)  NOT NULL,
    observer_name     VARCHAR(255) NOT NULL,
    pattern           VARCHAR(255) NOT NULL,
    severity          VARCHAR(50)  NOT NULL,
    summary           STRING       NOT NULL,
    window_start      DATETIME(3)  NOT NULL,
    window_end        DATETIME(3)  NOT NULL,
    created_at        DATETIME(3)  NOT NULL,
    source_record_ids STRING       NOT NULL DEFAULT '[]'
) DUPLICATE KEY(id)
DISTRIBUTED BY HASH(id) BUCKETS 3
PROPERTIES ("replication_num" = "1")
```

`source_record_ids` is stored as a JSON array of UUIDv7 strings.

### `recorded_actions`

Stores the start and the terminal outcome of each Operator execution. The OperatorRunner writes these records before calling `Execute` and after `Execute` returns. Components do not write to this table directly.

```sql
CREATE TABLE IF NOT EXISTS recorded_actions (
    id              VARCHAR(36)  NOT NULL,
    execution_id    VARCHAR(36)  NOT NULL,
    insight_id      VARCHAR(36)  NOT NULL,
    operator_name   VARCHAR(255) NOT NULL,
    state           VARCHAR(50)  NOT NULL,
    timestamp       DATETIME(3)  NOT NULL
) DUPLICATE KEY(id)
DISTRIBUTED BY HASH(id) BUCKETS 3
PROPERTIES ("replication_num" = "1")
```

### `action_logs`

Stores individual execution steps written by Operators via `AddActionLog`. No component reads from this table at runtime; Doris durability is the only requirement.

```sql
CREATE TABLE IF NOT EXISTS action_logs (
    id           VARCHAR(36)  NOT NULL,
    execution_id VARCHAR(36)  NOT NULL,
    step_id      VARCHAR(255) NOT NULL DEFAULT '',
    description  STRING       NOT NULL DEFAULT '',
    state        VARCHAR(50)  NOT NULL,
    timestamp    DATETIME(3)  NOT NULL
) DUPLICATE KEY(id)
DISTRIBUTED BY HASH(execution_id) BUCKETS 3
PROPERTIES ("replication_num" = "1")
```

## Write path

All write methods - `AddTelemetry`, `AddInsight`, `AddActionLog`, `AddRecordedAction` - follow the same sequence:

1. Check the `closed` flag under a read lock. Return `ErrStoreClosed` if set.
2. Fan out to active subscribers (non-blocking, under a read lock).
3. Start a goroutine to write the record to Doris.

Steps 2 and 3 are independent. The subscriber channel receives the record before the Doris write starts.

### Async Doris write

The Doris write runs in a detached goroutine with a 30-second timeout derived from a fresh background context, not the caller's context. The caller's context - typically an inbound HTTP request - is cancelled as soon as the handler returns a response. Using the caller's context would abort the in-flight `INSERT` immediately after the response, silently dropping the row.

Write errors are logged with `slog.Error`. There is no retry. A failed write is not surfaced to the caller.

## Pub/sub mechanism

The SRS delivers records to subscribers via buffered Go channels. No external pub/sub library is used.

### Subscribing

`SubscribeTelemetry` and `SubscribeInsights` register a subscriber with an optional filter and return a read-only channel. The subscriber's context controls the lifetime: when the context is cancelled, the goroutine removes the subscriber and closes the channel.

### Fan-out

When `AddTelemetry` or `AddInsight` is called, the store holds a read lock, iterates over all registered subscribers, and sends each matching record to the subscriber's channel. The send is non-blocking. If the channel is full, the incoming record is dropped for that subscriber.

### Filtering

Filters are evaluated inside `AddTelemetry` and `AddInsight` before anything is placed on a channel. Unmatched records never enter the channel.

`TelemetryFilter` matches by signal type and by attribute key-value pairs. All specified pairs must match. An empty filter matches all records.

`InsightFilter` matches by pattern name and severity. An empty filter matches all insights.

### Back-pressure

Each subscriber channel holds up to 64 records. When a channel is full, the incoming record is dropped. Drop events are counted per subscriber. When the subscriber's context is cancelled, the total drop count is logged as a warning if non-zero. Subscribers can recover missed records via `QueryTelemetryFromCursor` using the last received record's ID as the cursor.

Dropping is preferred over blocking because a slow subscriber must not stall the write path or affect other subscribers. Doris is the source of truth; the channel is best-effort live notification, and recovery via cursor query is always available.

### Why Go channels

The pub/sub mechanism is single-process and single-node. A buffered channel send is one atomic queue operation (~100–300 ns). Doris is the durable delivery path; the channel layer provides best-effort live notification. No broker, serialization, or middleware is needed.

External frameworks such as Watermill become worth considering when:

- Subscribers start late and need replay beyond the journal.
- At-most-once delivery is not acceptable. A crash can lose up to 64 in-flight records per subscriber.
- The number of event types grows large enough that per-type fan-out loops become a maintenance burden.
- Cross-node delivery is required.

## Query types

To query telemetry records, there are two options:
Either by specifying a time window, or by specifying a record ID and then retrieving the next n records that match the provided attributes.

```go
type TelemetryTimeRangeQuery struct {
    Start      time.Time
    End        time.Time
    Attributes map[string]string // all pairs must match
}

type TelemetryCursorQuery struct {
    AfterID    RecordID          // zero value = from start of ring buffer
    Count      int               // must be > 0
    Attributes map[string]string // all pairs must match
}

type QueryResult[T any] struct {
    Records    []T      `json:"records"`
    NextCursor RecordID `json:"next_cursor,omitempty"`
}
```

## Operation routing

All `QueryTelemetryByTime` and `QueryTelemetryFromCursor` calls execute SQL queries against Doris. There is no in-memory query path. The table below shows the full routing for all store operations.

| Operation                  | Path                                   |
| -------------------------- | -------------------------------------- |
| `AddTelemetry`             | Channel fan-out then async Doris write |
| `AddInsight`               | Channel fan-out then async Doris write |
| `AddActionLog`             | Async Doris write only                 |
| `AddRecordedAction`        | Async Doris write only                 |
| `SubscribeTelemetry`       | Buffered Go channel                    |
| `SubscribeInsights`        | Buffered Go channel                    |
| `QueryTelemetryByTime`     | Doris SQL                              |
| `QueryTelemetryFromCursor` | Doris SQL                              |

## Query consistency contract

**A record delivered to a subscriber channel is not guaranteed to be retrievable via a query at the time of delivery.**

The subscriber channel receives the record synchronously inside `AddTelemetry` or `AddInsight`, before the goroutine that writes to Doris has been scheduled. A caller that queries immediately after receiving a record from its channel may get a result set that does not include that record. The record becomes queryable once the async Doris write completes, bounded by a 30-second timeout.

**This is expected behavior**, not a bug. An Observer's `Detect` method receives the triggering record directly as a parameter and does not need to query for it. Queries are for historical lookups over a time window, not for accessing the record that just triggered the call.

If a caller must confirm that a record is persisted before acting, it can poll `QueryTelemetryFromCursor` with the record's ID as the cursor and wait for it to appear. This pattern is not recommended for normal use.

## Apache Doris configuration

### Connection pool

| Setting           | Value                                      |
| ----------------- | ------------------------------------------ |
| `MaxOpenConns`    | 5 (configurable via `Params.MaxOpenConns`) |
| `MaxIdleConns`    | Equal to `MaxOpenConns`                    |
| `ConnMaxLifetime` | 5 minutes                                  |
| `ConnMaxIdleTime` | 2 minutes                                  |

Async writes and synchronous queries share the same connection pool.

### Schema initialization

`NewStore` drops and recreates all four tables on startup. This is safe for development because Docker volumes are ephemeral. A deployment that needs to preserve data across restarts must add a migration gate before this code path runs.

### Startup retry

`Connect` retries the initial `openDB` call up to 30 times with a 5-second delay. `NewStore` retries schema initialization up to 30 times with a 3-second delay. Both loops exit immediately if the context is cancelled. This allows the satellite binary to start alongside Doris in Docker Compose without an external health-check script.
