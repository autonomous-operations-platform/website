---
title: Build Your Own Satellite
---

# Build Your Own Satellite

This guide walks you through building an Autonomous Operations Satellite from scratch.
At the end you will understand the concepts of Collector, Observer and Operator.
In addition to that, you will understand how they pass data to one another through the Satellite Record Store, and how to wire them together.

The guide builds the [`hello-world-satellite`](https://github.com/autonomous-operations-platform/hello-world-satellite) example repository step by step.
If you prefer to play with the code alongside the how-to, please check out the [GETTING-STARTED](https://github.com/autonomous-operations-platform/hello-world-satellite/blob/main/GETTING-STARTED.md) in the repository.
Our sample satellite monitors a CPU temperature sensor and controls a fan.
It is small enough to read in one sitting and uses only the in-memory store, so you don't need any external services to run it.

> Don't know any satellite concepts? Read up on the [Autonomous Operations overview](../aos/overview.md)
> This guide links to the relevant specification pages as it goes, but it is written to stand on its own.

## What a Satellite is

A Satellite is the per-node service in the Autonomous Operations stack.
It runs close to the infrastructure it manages and follows one steady-state loop:

1. A **Collector** gathers data (metrics, logs, traces) from a source and writes it to the store as **telemetry**.
2. An **Observer** watches telemetry, detects a known pattern, and writes an **insight**.
3. An **Operator** reacts to an insight and performs a remediation **action**.

They form the **collect-observe-act** loop.
The three components never call each other directly and communicate only through the **Satellite Record Store (SRS)**.
This decoupling is what lets you add, remove, or replace one component without touching the others.

```text
 Collector ──telemetry──►  SRS  ──telemetry──►  Observer
                            ▲                        │
                            │                     insight
                        action log                   │
                            │                        ▼
                        Operator  ◄───insight───────SRS
```

The [`autonomous-operations-satellite`](https://github.com/autonomous-operations-platform/autonomous-operations-satellite) library gives you the interfaces for these three components, the store, a registry, and an orchestrator (`satellite.Run`) that starts everything in the right order.
You write the business logic; the framework handles subscription, ordering, and the audit trail.

## Step 1: Prerequisites

1. **Install Go 1.27.1** from [go.dev/dl](https://go.dev/dl/).

2. **Clone the repositories** side by side. The demo uses a Go workspace to
   build against a local copy of the framework:

   ```bash
   git clone https://github.com/autonomous-operations-platform/autonomous-operations-satellite
   git clone https://github.com/autonomous-operations-platform/hello-world-satellite
   ```

## Step 2: Build and run

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

- **All available library methods.** See the [satellite framework](https://github.com/autonomous-operations-platform/autonomous-operations-satellite#api-reference) in `autonomous-operations-satellite` for the full store, filter, query, and record surface.
- **The concepts in depth.** The [Collector, Observer and Operator](../aos/overview.html#sub-components) specification pages define each component formally.

## The future of satellites
Perspectively, satellites do not need to be hand-crafted in the future.
Instead, there will be components inside the Autonomous Operations Platform that generate a satellite
based on the latest knowledge garnered from operations.
