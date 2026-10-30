---
title: Design Principles
---

# AOS Design Principles

Four principles drive every architectural decision for the Autonomous Operations Satellite. They overlap and reinforce each other.

## Independence from external services

The AOS must not rely on any service outside its own node cluster. This includes DNS, cloud APIs, the OCG, and the IAP. A signed Runtime Bundle packages all required logic, credentials, and configuration before deployment. After activation, the AOS operates entirely from local storage.

To eliminate runtime dependencies at the infrastructure level, the AOS runs on bare metal only. Virtual machines and containers introduce dependencies on a hypervisor or container runtime that may themselves be faulty. Natively running on the operating system removes this additional source of error.

## Minimal attack surface

The AOS holds credentials that grant access to infrastructure across the data center. A compromised satellite could affect the entire site. As operating system, a hardened, minimal Linux installation is used. A reduced software stack means fewer components that can fail, be misconfigured, or be compromised.

Only signed Runtime Bundles can change the behavior of the AOS. This limits attacker reach. No additional external service calls except for the defined ones and no runtime updates are allowed.

## Resilience first

The AOS assumes only power and a limited network connection. It avoids specialized hardware, external service calls, and runtime model updates. This enables continued operation in the event of infrastructure failures, network partitions, or an outage of central systems.

Resilience also shapes the lifecycle model. There is no in-place patching of a running satellite. A corrected bundle replaces a defective one as a full atomic deployment.

## No AI on the critical path

We don't want to use non-deterministic AI models. They cannot guarantee bounded response times or an auditable decision trace. Neither property is acceptable on a mission-critical execution path.

The AOS uses only rule-based or static pattern-matching logic. Any machine learning model it uses runs locally as a pre-trained static artifact shipped in the Runtime Bundle. No model performs online learning or calls an external API. AI is used only in the offline development phase, where it generates automation under human review. The AOS executes only the pre-validated result.
