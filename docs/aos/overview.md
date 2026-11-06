---
title: Overview
---

# Autonomous Operations Satellite Overview

The Autonomous Operations Satellite (AOS) is the execution engine of the Autonomous Operations platform. It ensures data center automation continues even when central systems are unavailable. It runs as self-contained, redundant instances and stays operational under adverse conditions.

## Role in the platform

The AOS implements the React tier of the [React-Record-Reason architecture](../introduction/architecture). It executes pre-approved automation using fast, deterministic, rule-based logic. The Operational Context Graph (OCG) records data. The Insight and Automation Platform (IAP) reasons over it. Neither is required for the AOS to act.

## How it works

A signed AOS Runtime Bundle packages all logic, credentials, and configuration before deployment. The AOS never calls the OCG or IAP at runtime. It reads everything it needs either from local storage or from a direct connection to the original data source.

The only way to update a satellite's behavior is to deploy a new Runtime Bundle. This applies to logic changes, configuration changes, and credential rotation alike.

## Sub-components

The AOS contains the following sub-components that together handle the full collect-observe-act cycle.

| Sub-component                    | Role                                                                        |
| -------------------------------- | --------------------------------------------------------------------------- |
| **Collector**                    | Gathers event data from infrastructure sources and normalizes it            |
| **Observer**                     | Reads collected data and evaluates it against known patterns                |
| **Operator**                     | Executes remediation actions when the Observer identifies a known issue     |
| **Satellite Record Store (SRS)** | Local time-series database for telemetry, analysis results, and action logs |
| **Satellite Secret Vault**       | Local credential store for the Collector and Operator                       |
| **Satellite Dashboard**          | Per-node web interface for direct visibility without OCG connectivity       |

## High availability

Each AOS instance runs as a multi-node setup. One node holds the leader role at any time. Only the leader executes actions on infrastructure. This prevents duplicate actions when multiple nodes are active simultaneously.

All nodes collect data continuously, regardless of which node leads. If the leader fails, the remaining nodes elect a new one and automation resumes. Failover does not require DNS.

Production deployments require at least three nodes per cluster.

## Placement

AOS instances must be distributed to match the data center's failure topology. Each network segment that could become isolated during a failure needs at least one AOS instance. A data center with three availability zones needs at least one instance per zone.

Standard deployments require a minimum of three instances per partition. Three nodes can tolerate a single-node failure and still elect a new leader.

## Data ownership

Each AOS node owns its local Satellite Record Store. The OCG pulls data from each node via the Satellite Connector.
