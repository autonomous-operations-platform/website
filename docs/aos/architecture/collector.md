# Collectors

Collectors gather telemetry data and logs from managed infrastructure. A collector collects data in one of four ways: pull-based streaming, pull-based batch, push-based ingestion via an OpenTelemetry Protocol (OTLP) endpoint, and active probing and monitoring.

It normalizes and tags each event, then writes it to the Satellite Record Store. It adapts collection volume and type based on time or events. It buffers data locally in two cases: when a data source is unreachable, and when pushed data arrives faster than it can write. This buffering ensures no data is lost before it reaches the Satellite Record Store.

## Core type: TelemetryRecord

A normalized data point written by a Collector. Covers any source — OTLP, Redfish, SNMP, REST API, active probing, or custom.

```go
type TelemetryRecord struct {
    ID         RecordID
    Signal     Signal            // Metrics | Logs | Traces
    ReceivedAt time.Time         // when this was stored in the SRS
    Payload    []byte            // raw source payload
    Attributes map[string]string // normalized key-value pairs for filtering and queries
}
```

**Payload** is the raw bytes exactly as received from the source.

**Attributes** are a flat `map[string]string` extracted from the payload at collection time. They are the indexed, queryable surface used for subscription filtering and store queries.

Example — an F5OS service instance log record:

```json
{
  "id": "019271a3-...",
  "signal": "logs",
  "received_at": "2026-09-15T14:23:00Z",
  "payload": "datapath-cp-proxy[11]: priority=\"Info\" msgid=0x5901000000000034 msg=\"Service Instance Update Success.\" TENANTNAME=\"tenant-1\" DOSGRP=\"[2]\" SVCGRP=\"[7]\" SVCID=22 ...",
  "attributes": {
    "service.name": "f5os",
    "log.level": "info",
    "process.name": "datapath-cp-proxy",
    "f5.tenant.name": "tenant-1",
    "f5.service.id": "22"
  }
}
```

## Collector interface

A `Collector` gathers data from one source and writes `TelemetryRecord` entries to the store. The framework calls `Setup` on each registered collector at startup.

```go
type NewTelemetryRecord struct {
    Signal     Signal
    Payload    []byte
    Attributes map[string]string
}

type CollectorStore interface {
    AddTelemetry(ctx context.Context, records []NewTelemetryRecord) ([]RecordID, error)
}

type Collector interface {
    Name() string
    Setup(ctx context.Context, logger *slog.Logger, s CollectorStore)
}
```

`Setup` is the entry point for each collector. The runner calls it once at startup and passes a `*slog.Logger` pre-scoped with `component=collector` and `name=Name()`. A push-based collector registers HTTP handlers inside `Setup`. A pull-based collector starts a scheduled task. The framework does not distinguish between the two — it calls `Setup` once and the collector decides its own ingestion mode.

Scheduling and HTTP listening are utility functions, not core framework interfaces. Push-based collectors register handlers on `Mux`, the HTTP multiplexer the framework creates and serves at startup.

#### Push-based pattern

For sources that send data to the satellite, `ListenOTLP` registers OTLP ingest routes on `Mux` and parses each incoming request into a `[]NewTelemetryRecord` slice. The `Signal` field is set from the endpoint (`/metrics`, `/logs`, `/traces`). The collector receives the parsed records in a `Handler` callback, enriches them as needed, and calls `s.AddTelemetry` directly.

```go
type F5TelemetryStreamingCollector struct{}

func (c *F5TelemetryStreamingCollector) Name() string { return "f5-telemetry-streaming" }

func (c *F5TelemetryStreamingCollector) Setup(ctx context.Context, logger *slog.Logger, s CollectorStore) {
    ListenOTLP(Mux, OTLPOptions{
        BasePath: "/ingest/f5",
        Handler: func(ctx context.Context, records []NewTelemetryRecord) error {
            // optional processing of received records
            for i := range records {
                records[i].Attributes["source.type"] = "f5-telemetry-streaming"
            }
            _, err := s.AddTelemetry(ctx, records)
            return err
        },
    })
}

func init() { registry.RegisterCollector(&F5TelemetryStreamingCollector{}) }
```

#### Pull-based pattern

For sources the collector must query on a schedule, a library function like `ScheduleInterval` runs the given function at the configured interval and stops when `ctx` is cancelled.

```go
type F5PoolHealthCollector struct{}

func (c *F5PoolHealthCollector) Name() string { return "f5-pool-health" }

func (c *F5PoolHealthCollector) Setup(ctx context.Context, logger *slog.Logger, s CollectorStore) {
    ScheduleInterval(ctx, 30*time.Second, func(ctx context.Context) error {
        return c.poll(ctx, s)
    })
}

func (c *F5PoolHealthCollector) poll(ctx context.Context, s CollectorStore) error {
    resp, err := HTTP.Get(ctx, "f5-mgmt", "/mgmt/tm/ltm/pool/~Common~web_pool/members")
    if err != nil {
        return err
    }
    for _, member := range resp.Body().Values("members") {
        if _, err := s.AddTelemetry(ctx, []NewTelemetryRecord{{
            Signal: SignalMetrics,
            Attributes: map[string]string{
                "service.name":        "f5-ltm",
                "pool.name":           "web_pool",
                "pool.member.address": member.String("address"),
                "pool.member.state":   member.String("state"),
            },
        }}); err != nil {
            return err
        }
    }
    return nil
}

func init() { registry.RegisterCollector(&F5PoolHealthCollector{}) }
```
