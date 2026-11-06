---
title: Explicit store writes for AOS components
status: Accepted
date: 2026-09-15
---

# Explicit store writes for AOS components

## Context and Problem Statement

The AOS pipeline has three types of components that produce data: **Collectors**, **Observers**, and **Operators**. The current interface design uses return values to communicate what each component wants to write to the store. `Observer.Detect` returns `[]store.Insight` and `Operator.Execute` returns an `OperatorResult`. The runner receives these values and calls the corresponding store write methods on behalf of the component.

Collectors are not yet defined in the satellite design, but the pipeline requires them: a collector ingests or generates telemetry and feeds it into the store. Collectors may be **pull-based** (the runner calls a method on a schedule) or **push-based** (the collector receives data from an external source and must write it immediately). The return-value model does not fit push-based collectors — there is no method call to return from when data arrives asynchronously.

For operators, the return-value model batches all output until `Execute` returns. This means action logs — records of individual runbook steps — cannot be written incrementally. If an operator crashes mid-execution, no output is written at all. The partial execution is not observable.

The proposal is to change the interface so components call store write methods directly — for example, `store.AddInsight(...)` — instead of returning values for the runner to write.

## Entities involved

| Entity            | Written by                  | Description                                                                                                                                                                             |
| ----------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TelemetryRecord` | Collectors                  | An ingested telemetry payload with extracted attributes. Covers metrics, logs, and traces from any source (OTLP and others).                                                            |
| `Insight`         | Observers                   | A detected anomaly pattern with severity and evidence.                                                                                                                                  |
| `ActionLog`       | Operators                   | A single step in an operator execution — timestamp, description, and outcome.                                                                                                           |
| `RecordedAction`  | Runner (started + terminal) | Lifecycle record for one operator execution. References the triggering `InsightID` and all `ActionLog` entries for that execution. Written twice: once on start and once on completion. |

## Decision Drivers

- Push-based collectors must be able to write data at the moment it arrives, without waiting for a runner-initiated method call.
- Operators must be able to write action logs incrementally as steps complete, not only at the end of execution.
- Observers, operators, and collectors should follow a consistent write pattern.
- The core framework must still be able to perform validation on all writes.
- A component crash must not leave the store in a permanently inconsistent terminal state.

## Considered Options

### Option 1: Return-value-based writes (current)

The runner calls a component method (`Detect`, `Execute`), receives the return value, and writes it to the store. The component cannot write to the store directly. For operators, `ActionLog` entries are accumulated in memory during `Execute` and written together with the terminal `RecordedAction` when the method returns.

The current collector implementation is push-based: data arrives from an external source and the collector writes directly to the store. There is no runner-initiated method call and no return value — the return-value contract does not apply. A pull-based interface could be added later, but any such design must be consistent with how push-based collectors already work.

#### Evaluation

- ✅ The runner controls all writes — validation and error handling are centralized.
- ✅ A component crash produces no output — the runner handles the error and writes a clean failure state.
- ✅ The return type makes the component's contract explicit and compiler-enforced.
- ❌ Push-based collectors cannot use this model — they write directly to the store today, outside the return-value contract.
- ❌ Operators cannot write action logs incrementally — all output is lost if the operator crashes before returning.
- ❌ A future pull-based collector interface would need a different pattern to the existing push-based implementation.

### Option 2: Explicit store write calls

Components receive a write interface (the store, or a scoped subset of it) and call write methods directly — for example, `store.AddInsight(...)`. Components return `error` to signal success or failure. The runner uses this to write the terminal `RecordedAction` with the correct state — it does not need to read data from the return value.

Before calling `Execute`, the runner generates an `ExecutionID` and writes a `RecordedAction` with `StateStarted`. The runner binds the `ExecutionID` to the scoped `OperatorStore` it passes to `Execute`, so every `AddActionLog` call automatically carries the correct execution context. The operator never sees the `ExecutionID`. The runner uses the same `ExecutionID` for the terminal `RecordedAction`, tying all incremental logs to both records.

**Risk — crash between writes:** If a component crashes after writing some action logs but before the runner writes the terminal record, the store contains a `Started` record and partial action logs with no terminal state. This window is small, but the risk is non-zero. Consumers of `SubscribeRecordedAction` must tolerate action logs that arrive without a terminal record in edge cases.

**Why having the runner write the terminal `RecordedAction` if all other writes are in the components' responsibility?**:
Having the operator runner write the `RecordedAction` is inconsistent with all other writes being the responsibility of the Collector, Observer, and Operator explicitly.
This is accepted since that way we can enforce that the `RecordedAction` is written (it cannot be forgotten when writing the Observer code), it's less code / less verbose in the Operator implementation, and we anyway have all information available in the operator runner needed to write this `RecordedAction`.
Also, we don't risk that the operator is doing it incorrectly (or having to review the correctness of it).

**Note on observers:** Neither option changes observable behavior for observers. `Detect` is synchronous and does not benefit from incremental writes. Option 2 is applied to observers for interface consistency with operators and collectors.

#### Evaluation

- ✅ Operators can write action logs as each step completes — partial progress is observable even after a crash.
- ✅ Consistent write pattern across all three component types.
- ✅ Validation stays in the store's write methods — the framework retains control.
- ✅ `ExecutionID` links incremental `ActionLog` entries to both `RecordedAction` records without the operator constructing either record.
- 🟡 The runner retains responsibility for terminal state, so the boundary of responsibility between component and runner must be documented clearly.
- ❌ The write contract is no longer enforced by the return type — components must call write methods correctly by convention.
- ❌ A narrow crash window exists where a `Started` record and partial action logs are in the store without a terminal `RecordedAction`.

## Decision

We adopt Option 2: explicit store write calls.

All three component types — collectors, observers, and operators — call store write methods directly. Each method returns `error` to signal success or failure. The runner uses the returned error to write a terminal `RecordedAction` with the correct state; it does not read data from the return value.

For operators, the runner generates an `ExecutionID` before calling `Execute`. It writes a `RecordedAction` with `StateStarted` and binds the `ExecutionID` to the scoped `OperatorStore` passed to `Execute`. The operator never sees the `ExecutionID` — the store injects it automatically into each `AddActionLog` call. The runner uses the same `ExecutionID` for the terminal `RecordedAction`.

The change to observers is for consistency only. Both options are essentially equivalent for observers.
