---
title: Core Components
---

# Core Components

## Autonomous Operations Satellite (AOS)

The AOS is the **React** component - a mission-critical, always-on execution engine that identifies and resolves known issues using deterministic, rule-based logic. It runs on bare metal with minimal external dependencies, allowing it to continue operating when the rest of the system is degraded or unavailable.

Inside each AOS instance:

- **Collectors** gather raw telemetry from infrastructure devices via Redfish, IPMI, SNMP, or vendor APIs and write it to the local Satellite Record Store.
- **Observers** apply pattern-matching rules to local data to detect anomalies.
- A matching condition triggers the corresponding **Operator** - a pre-validated automation unit that executes the remediation.

No AI inference occurs within this execution path. The AOS executes only pre-validated, approved logic.

## Operational Context Graph (OCG)

The OCG is the **Record** component - the single source of truth for all operational data in the data center. It holds infrastructure topology, configuration baselines, real-time telemetry, historical events, runbooks, and credentials.

The OCG applies no business logic and makes no operational decisions. Instead, it actively builds and maintains a **Semantic Network**: a live semantic model of the data center that correlates entities across all incoming data sources and versions their state over time. This _derivation-without-decision_ principle makes the OCG a shared, trustworthy foundation for all consuming systems.

The OCG organises its data across seven specialised components:

| Component                     | Contents                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------- |
| Telemetry Store               | Time-series metrics, logs, and traces                                            |
| Insights Repository           | Analytical outputs: anomaly detections and root-cause hypotheses                 |
| Recorded Actions Repository   | Immutable audit trail of all executed actions                                    |
| Semantic Network              | Property graph, vector embeddings, and temporal index for point-in-time topology |
| Infrastructure Knowledge Base | Inventory, topology graph, configuration baselines, and documentation            |
| Secrets Vault                 | Credential storage                                                               |
| Audit Log Service             | Audit event capture                                                              |

::: info Learn more
The Operational Context Graph is an independent open-source project. Full documentation is available at [operational-context-graph.dev](https://operational-context-graph.dev).
:::

## Insight and Automation Platform (IAP)

The IAP is the **Reason** component - an AI-driven analysis engine that reads telemetry exclusively from the OCG Telemetry Store and never connects to AOS instances directly.

The IAP performs:

- **Anomaly detection** across the full telemetry history
- **Root cause analysis** using graph-based techniques and large language models
- **Recommendation generation** for operators to review and approve
- **Automation generation** - converting approved recommendations into new Collectors, Observers, and Operators deployed back to the AOS

Because the IAP operates outside the critical execution path, its unavailability does not impair the AOS's ability to react to known incidents. The quality of its diagnostic output is entirely bounded by the quality and completeness of the telemetry it receives via the OCG.
