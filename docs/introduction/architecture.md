---
title: Architecture
---

# Architecture

## React-Record-Reason

Autonomous Operations is structured according to a three-role architecture called **React-Record-Reason**. This separation of execution, knowledge, and analysis into three independent components is the central architectural decision of the system.

| Component | Role | Deployment |
|---|---|---|
| **Autonomous Operations Satellite (AOS)** | Detects and remediates known issues in real-time using deterministic rules - no AI on the critical path | Bare-metal (always on, resilient) |
| **Operational Context Graph (OCG)** | Central knowledge repository: telemetry, topology, runbooks, recorded actions, and a live semantic model of the data center | Kubernetes |
| **Analysis and Automation Platform (AAP)** | AI-driven root cause analysis; generates recommendations and builds new automation for the AOS | Kubernetes |

The AOS handles mission-critical operations. The AAP improves the AOS over time. The OCG connects them.

## How the components connect

Telemetry flows through the system as a continuous loop:

1. **AOS Collectors** gather raw telemetry from infrastructure devices and write it to the local Satellite Record Store.
2. **OCG** ingests the data, validates and normalises each record, and stores it in the central Telemetry Store.
3. **AAP** reads from the Telemetry Store, performs analysis, and writes findings to the Insights Repository.
4. Once a human operator approves a recommendation, newly generated automation is packaged and deployed back to the **AOS**.
5. Every executed action - automated or manual - is recorded immutably in the Recorded Actions Repository.

This loop means the system becomes more capable over time: each resolved incident feeds back into the automation the AOS uses for the next one.

## Separation of concerns

The React-Record-Reason split has a direct consequence for availability. The OCG and AAP run on Kubernetes and can be degraded or unavailable. The AOS runs on bare metal with minimal external dependencies and continues operating regardless of the state of the surrounding infrastructure. The system degrades gracefully: a degraded OCG or AAP does not impair the AOS's ability to react to incidents it already knows.
