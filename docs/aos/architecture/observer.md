# Observers

Observers evaluate data in the Satellite Record Store to detect known issue signatures. Raw telemetry does not indicate whether a condition requires action. The Observer bridges collection and remediation by applying analytical logic to identify actionable patterns. It uses rule-based patterns and static ML models, never external inference. It writes analysis results back to the store and invokes Operators for remediation.

## Core type: Insight

An anomaly or pattern detected by an Observer.

```go
type Insight struct {
    ID              RecordID
    ObserverName    string
    Pattern         string
    Severity        Severity   // Info | Warning | Critical
    Summary         string
    WindowStart     time.Time
    WindowEnd       time.Time
    SourceRecordIDs []RecordID
    CreatedAt       time.Time
}
```

Example — unintended service deletion triggered by a VLAN operation on F5OS ([bug ID2162701](https://cdn.f5.com/product/bugtracker/ID2162701.html)):

```json
{
  "id": "019271b2-...",
  "observer_name": "f5os-unintended-vlan-service-deletion",
  "pattern": "f5os-unintended-vlan-service-deletion",
  "severity": "warning",
  "summary": "Unintended service deletion detected on F5OS: a VLAN delete operation removed a service for tenant-1, which will cause all VLANs on that service to become inaccessible.",
  "window_start": "2026-09-15T14:23:00Z",
  "window_end": "2026-09-15T14:23:01Z",
  "source_record_ids": ["019271a0-...", "019271a3-..."],
  "created_at": "2026-09-15T14:23:02Z"
}
```

## Filter type: TelemetryFilter

An Observer doesn't need to be notified about all TelemetryRecords.
That's why each Observer can specify a filter.
The corresponding observer runner passes this filter when subscribing to telemetry records.
Thus, only new telemetry records matching the filter will lead to `Observer.Detect()` being called.

The filter matches `TelemetryRecord` entries by signal type and attribute key-value pairs. All specified criteria must match. Zero value for `Signal` and empty `Attributes` map match all records.

```go
type TelemetryFilter struct {
    Signal     Signal            // zero value = all signals
    Attributes map[string]string // all pairs must match; empty = match all
}
```

## Observer interface

An `Observer` detects patterns in telemetry and writes `Insight` records to the store.
To process only a subset of relevant telemetry records, it can define a filter.

```go
type NewInsight struct {
    Pattern         string
    Severity        Severity
    Summary         string
    WindowStart     time.Time
    WindowEnd       time.Time
    SourceRecordIDs []RecordID
}

type ObserverStore interface {
    AddInsight(ctx context.Context, insight NewInsight) (RecordID, error)
    QueryTelemetryByTime(ctx context.Context, q TelemetryTimeRangeQuery) (QueryResult[TelemetryRecord], error)
    QueryTelemetryFromCursor(ctx context.Context, q TelemetryCursorQuery) (QueryResult[TelemetryRecord], error)
}

type Observer interface {
    Name() string
    Filter() TelemetryFilter
    Detect(ctx context.Context, logger *slog.Logger, trigger TelemetryRecord, s ObserverStore) error
}
```

`Filter` returns the attribute map the runner uses to subscribe. `Detect` is called on each matching `TelemetryRecord`. The runner passes a `*slog.Logger` pre-scoped with `component=observer` and `name=Name()`. If the observer finds a pattern, it calls `s.AddInsight` directly. It returns `error` to signal success or failure.

`NewInsight` contains only the fields the observer provides. `ID` is assigned by the store. `ObserverName` is injected by the observer runner — it wraps the store and sets it from `o.Name()` before forwarding to the real store. The observer never sets either field.

**Pattern 1 — reactive:** inspect the trigger record directly; no store query needed.

```go
type F5PoolMemberDownObserver struct{}

func (o *F5PoolMemberDownObserver) Name() string { return "f5-pool-member-down" }

func (o *F5PoolMemberDownObserver) Filter() TelemetryFilter {
    return TelemetryFilter{
        Signal:     SignalMetrics,
        Attributes: map[string]string{"service.name": "f5-ltm"},
    }
}

func (o *F5PoolMemberDownObserver) Detect(ctx context.Context, logger *slog.Logger, trigger TelemetryRecord, s ObserverStore) error {
    if trigger.Attributes["pool.member.state"] != "down" {
        return nil
    }
    t, _ := time.Parse(time.RFC3339, trigger.Attributes["event.timestamp"])
    _, err := s.AddInsight(ctx, NewInsight{
        Pattern:         "f5-pool-member-down",
        Severity:        SeverityWarning,
        Summary:         "Pool member " + trigger.Attributes["pool.member.address"] + " is down.",
        WindowStart:     t,
        WindowEnd:       t,
        SourceRecordIDs: []RecordID{trigger.ID},
    })
    return err
}

func init() { registry.RegisterObserver(&F5PoolMemberDownObserver{}) }
```

**Pattern 2 — time-window:** query the store for a window of records. The struct, `Name`, `Filter`, and `init` are identical to Pattern 1 — only `Detect` differs.

```go
func (o *F5PoolMemberDownObserver) Detect(ctx context.Context, logger *slog.Logger, trigger TelemetryRecord, s ObserverStore) error {
    end := trigger.ReceivedAt
    result, err := s.QueryTelemetryByTime(ctx, TelemetryTimeRangeQuery{
        Start:      end.Add(-10 * time.Second),
        End:        end,
        Attributes: map[string]string{"service.name": "f5-ltm"},
    })
    if err != nil {
        return err
    }
    // analyse result.Records — call s.AddInsight if a pattern is found
    return nil
}
```

To avoid flooding the store with repeated insights for the same condition, use a mutex-protected `lastEmitted` timestamp and suppress re-emission within a cooldown window.
