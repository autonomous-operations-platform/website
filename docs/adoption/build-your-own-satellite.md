---
title: Build Your Own Satellite
---

# Build Your Own Satellite

This guide walks you through building an Autonomous Operations Satellite (AOS) from scratch.
At the end you will understand the concepts of Collector, Observer and Operator.
In addition to that, you will understand how they pass data to one another through the Satellite Record Store, and how to wire them together.

> In production, satellites are generated automatically by the Insight and Automation Platform (IAP), reviewed by a data center engineer, and deployed without manual coding. This guide builds one by hand for demonstration purposes only.

The guide builds the [`hello-world-satellite`](https://github.com/autonomous-operations/hello-world-satellite) example repository step by step.
Our sample satellite monitors a CPU temperature sensor and controls a fan.
It is small enough to read in one sitting and uses only the in-memory store, so you don't need any external services to run it.

> Don't know any satellite concepts? Read up on the [Autonomous Operations overview](../aos/overview.md) first.
> This guide links to the relevant specification pages as it goes, but it is written to stand on its own.

## Prerequisites

1. **Install Go 1.27.1** from [go.dev/dl](https://go.dev/dl/).

2. **Clone the repositories** side by side. The demo uses a Go workspace to
   build against a local copy of the framework:

   ```bash
   git clone https://github.com/autonomous-operations-platform/autonomous-operations-satellite
   git clone https://github.com/autonomous-operations-platform/hello-world-satellite
   ```

## The data model in one minute

Four record types travel through the store.
Records are addressed by **`RecordID`**, a monotonic UUIDv7 ID that is assigned automatically when writing to the store.
You only need these to follow the guide:

- **`TelemetryRecord`** — what a Collector writes. A log, trace, or metric, with an optional payload and any number of attributes.
- **`Insight`** — what an Observer writes. A detected pattern, along with its severity and human-readable messages.
- **`ActionLog`** — what an Operator writes for each step it takes.
- **`RecordedAction`** — what the framework writes when an operator has terminated.

Each component receives only the slice of the store it needs — a Collector can write telemetry but cannot read insights, and so on.
This is enforced by the `CollectorStore`, `ObserverStore`, and `OperatorStore` interfaces.

## Step 1: Write a Collector

A Collector implements two methods:

```go
type Collector interface {
	Name() string
	Setup(ctx context.Context, logger *slog.Logger, s store.CollectorStore)
}
```

`Setup` starts the collector's ingestion mechanism and **returns immediately**.
A pull-based collector starts a goroutine on a ticker; a push-based collector registers an HTTP handler.
The collector owns its lifecycle until `ctx` is cancelled.

Here is the temperature collector.
It reads a mocked sensor every five seconds and writes one metrics record per reading:

```go
package collectors

import (
	"context"
	"fmt"
	"time"

	"github.com/autonomous-operations-platform/autonomous-operations-satellite/pkg/framework/registry"
	"github.com/autonomous-operations-platform/autonomous-operations-satellite/pkg/framework/store"
)

func init() { registry.RegisterCollector(&TemperatureCollector{}) }

type TemperatureCollector struct{}

func (c *TemperatureCollector) Name() string { return "temperature-collector" }

func (c *TemperatureCollector) Setup(ctx context.Context, logger *slog.Logger, s store.CollectorStore) {
	go func() {
		t := time.NewTicker(5 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				c.collect(ctx, s)
			}
		}
	}()
}

func (c *TemperatureCollector) collect(ctx context.Context, s store.CollectorStore) {
	celsius := readTemperature() // stands in for a real sensor API call
	s.AddTelemetry(ctx, []store.NewTelemetryRecord{{
		Signal: store.SignalMetrics,
		Attributes: map[string]string{
			"source": "cpu-temp",
			"value":  fmt.Sprintf("%.1f", celsius),
			"unit":   "celsius",
		},
	}})
}
```

Three things to notice, because every component repeats them:

- **Self-registration.** The `init()` function calls `registry.RegisterCollector`. When `main` imports this package, the collector registers itself. You never build a list of components by hand.
- **The `source` attribute.** Tagging telemetry with `source: cpu-temp` is how the Observer will later select exactly these records. Attributes are your routing keys.
- **Lifecycle via `ctx`.** The goroutine stops when `ctx` is cancelled. The framework cancels `ctx` on shutdown, so the collector drains cleanly.

## Step 2: Write an Observer

An Observer implements three methods:

```go
type Observer interface {
	Name() string
	Filter() store.TelemetryFilter
	Detect(ctx context.Context, logger *slog.Logger, trigger store.TelemetryRecord, s store.ObserverStore) error
}
```

`Filter` declares which telemetry the Observer cares about.
The framework subscribes the Observer to the store with that filter and calls `Detect` once per matching record.
An empty filter matches everything; a filter with attributes matches only records carrying all of them.

The temperature observer selects `cpu-temp` telemetry and emits an insight when the reading leaves the accepted band:

```go
func init() { registry.RegisterObserver(&TemperatureThreshold{}) }

const (
	highThreshold = 75.0
	lowThreshold  = 60.0
)

type TemperatureThreshold struct{}

func (o *TemperatureThreshold) Name() string { return "temperature-threshold" }

func (o *TemperatureThreshold) Filter() store.TelemetryFilter {
	return store.TelemetryFilter{
		Attributes: map[string]string{"source": "cpu-temp"},
	}
}

func (o *TemperatureThreshold) Detect(ctx context.Context, logger *slog.Logger, trigger store.TelemetryRecord, s store.ObserverStore) error {
	celsius, err := strconv.ParseFloat(trigger.Attributes["value"], 64)
	if err != nil {
		return fmt.Errorf("invalid temperature value: %w", err)
	}

	switch {
	case celsius > highThreshold:
		_, err = s.AddInsight(ctx, store.NewInsight{
			Pattern:         "temperature-high",
			Severity:        store.SeverityWarning,
			Summary:         fmt.Sprintf("CPU temperature %.1f°C exceeds high threshold of %.0f°C.", celsius, highThreshold),
			WindowStart:     trigger.ReceivedAt,
			WindowEnd:       trigger.ReceivedAt,
			SourceRecordIDs: []store.RecordID{trigger.ID},
		})
	case celsius < lowThreshold:
		_, err = s.AddInsight(ctx, store.NewInsight{
			Pattern:         "temperature-low",
			Severity:        store.SeverityInfo,
			Summary:         fmt.Sprintf("CPU temperature %.1f°C dropped below low threshold of %.0f°C.", celsius, lowThreshold),
			WindowStart:     trigger.ReceivedAt,
			WindowEnd:       trigger.ReceivedAt,
			SourceRecordIDs: []store.RecordID{trigger.ID},
		})
	}
	return err
}
```

Points worth absorbing:

- **The Observer names a pattern.** `temperature-high` describes _what was detected_. It says nothing about fans. An Operator decides what to do. This keeps detection and remediation independent.
- **Two thresholds help reduce noise.** The Observer emits `temperature-high` above 75°C and `temperature-low` below 60°C. The 15-degree gap between them is deliberate: it stops the Satellite from flapping between states when a reading hovers near a single threshold.
- **`SourceRecordIDs` links the insight back to its evidence.** The telemetry that triggered the detection is recorded on the insight, which is what later analysis needs to explain _why_ the Satellite acted.

## Step 3: Write an Operator

An Operator implements three methods:

```go
type Operator interface {
	Name() string
	Filter() store.InsightFilter
	Execute(ctx context.Context, logger *slog.Logger, insight store.Insight, s store.OperatorStore) error
}
```

`Filter` declares which insight patterns the Operator reacts to.
The framework subscribes the Operator to the store and calls `Execute` once per matching insight.

The fan controller reacts to both temperature patterns:

```go
func init() { registry.RegisterOperator(&FanSpeedController{}) }

type FanSpeedController struct{}

func (o *FanSpeedController) Name() string { return "fan-speed-controller" }

func (o *FanSpeedController) Filter() store.InsightFilter {
	return store.InsightFilter{Patterns: []string{"temperature-high", "temperature-low"}}
}

func (o *FanSpeedController) Execute(ctx context.Context, logger *slog.Logger, insight store.Insight, s store.OperatorStore) error {
	var targetSpeed int
	switch insight.Pattern {
	case "temperature-high":
		targetSpeed = 80
	case "temperature-low":
		targetSpeed = 20
	}

	s.AddActionLog(ctx, store.NewActionLog{
		StepID:      "set-fan-speed",
		Description: fmt.Sprintf("Setting fan to %d%%: %s", targetSpeed, insight.Summary),
		State:       store.ActionLogStateAttempting,
	})

	// Simulate calling a fan control API
	s.AddActionLog(ctx, store.NewActionLog{
		StepID:      "set-fan-speed",
		Description: fmt.Sprintf("Fan speed set to %d%%.", targetSpeed),
		State:       store.ActionLogStateSuccess,
	})
	return nil
}
```

What matters here:

- **Log before you act, then log the outcome.** Write an `attempting` entry before the real work, then a `success` or `failed` entry after. If the Operator crashes mid-step, the unpaired `attempting` entry is the evidence of where it stopped.
- **Return an error to signal failure.** When `Execute` returns a non-nil error, the framework records the run as failed. Return `nil` only when the remediation succeeded.

> The `hello-world-satellite` Operator in this folder injects a simulated 30% failure to show the failure path.
> It is omitted above for clarity — see [`operators/fan-speed.go`](https://github.com/autonomous-operations-platform/hello-world-satellite/blob/main/operators/fan-speed.go) for the full version.

## Step 4: Wire it together

The `main` package does three things: blank-import the three component packages so their `init()` functions register them, construct a store, and call `satellite.Run`.

```go
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/autonomous-operations-platform/autonomous-operations-satellite/pkg/framework/satellite"
	"github.com/autonomous-operations-platform/autonomous-operations-satellite/pkg/store/memstore"

	_ "github.com/autonomous-operations-platform/hello-world-satellite/collectors"
	_ "github.com/autonomous-operations-platform/hello-world-satellite/observers"
	_ "github.com/autonomous-operations-platform/hello-world-satellite/operators"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	err := satellite.Run(ctx, satellite.Config{
		Store:  memstore.New(),
		Logger: slog.Default(),
	})
	if err != nil {
		slog.Error("satellite run failed", "err", err)
		os.Exit(1)
	}
}
```

The blank imports (`_ "…/collectors"`) are the key trick.
You import the packages only for their side effect — the `init()` registration — so you never name the component types in `main`.

`satellite.Run` then starts everything in **reverse pipeline order**, and this ordering is not optional:

1. **Operators first.** They subscribe to insights and the orchestrator waits until each is ready.
2. **Observers next.** They subscribe to telemetry; the orchestrator waits again.
3. **Collectors last.** Only once the readers are listening does the orchestrator call `Setup` on each collector.

Starting readers before writers guarantees no event is produced before someone is subscribed to receive it.
`satellite.Run` blocks until `ctx` is cancelled, then returns.

`satellite.Run` also validates the component set and returns an error if it is invalid — for example `ErrNoCollectors` (at least one collector is required) or `ErrOperatorsWithoutObservers` (an operator with no observer to feed it).
The validation only ensures that components exist.
It does not check for a valid link between components, i.e. whether an observer's filter can ever yield on a collector's output.

## Step 5: Build and run

From the Satellite directory, set up the workspace, vendor dependencies, and run:

```bash
cd hello-world-satellite

# Point the workspace at your local autonomous-operations-satellite checkout.
cp go.work.example go.work

# In workspace mode, use `go get` (not `go mod tidy`) to resolve the framework,
# then vendor.
go get github.com/autonomous-operations-platform/autonomous-operations-satellite@latest
go work vendor

go run .
```

You will see the collector emit a reading every five seconds.
As the mocked temperature climbs past 75°C the observer logs an insight and the operator sets the fan to 80%; as it falls below 60°C the fan drops to 20%:

```text
[collector] temperature reading celsius=74.3
[collector] temperature reading celsius=88.6
[observer] temperature above accepted range celsius=88.6 high_threshold=75
… processing insight pattern=temperature-high severity=warning
… execution succeeded
```

Press `Ctrl+C` to stop.
The context is cancelled, the collector goroutine returns, and `satellite.Run` shuts down.

Congratulations, you now have a complete collect-observe-act loop!

## Where to go next

- **All available library methods.** See the [satellite framework](https://github.com/autonomous-operations-platform/autonomous-operations-satellite) in `autonomous-operations-satellite` for the full store, filter, query, and record surface.
- **The concepts in depth.** The [Collector, Observer and Operator](../aos/overview.html#sub-components) specification pages define each component formally.
