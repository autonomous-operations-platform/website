---
title: Design Principles
---

# Design Principles

Four principles drive every architectural decision in Autonomous Operations.

## Automate everything that can be automated

Routine operations - scheduled maintenance, configuration changes, health monitoring, capacity management, compliance reporting - run without human intervention. Known incident types are detected and resolved autonomously the same way. The system does not reserve automation for the exceptional case; it applies it by default.

## AI generates, humans approve, the AOS executes

The AOS critical path requires bounded latency, inspectable decisions, and air-gap independence. AI models - particularly large language models and online learners - cannot unconditionally satisfy these requirements. Autonomous Operations keeps AI in the offline development phase, where it generates and validates automation under human supervision, and executes only pre-validated, approved logic in production.

Static pre-trained ML artifacts that meet the same latency and auditability bounds are permitted in constrained roles within the AOS. Everything else is kept off the critical path.

## Improve continuously

Every resolved incident and completed routine task feeds back into the system. The AAP analyzes outcomes across the entire data center, generates recommendations, and converts them into new automation - so the system becomes more capable over time without manual curation.

## Turn every human intervention into permanent automation

Novel or complex situations that fall outside existing automation cannot be resolved automatically. This is an accepted tradeoff: the system does not attempt to handle what it does not yet know. However, when an operator resolves an incident manually, AO captures the solution, converts it into a reusable automation bundle, and deploys it so the same incident is handled automatically in future.

Operators solve a problem once. The system handles it forever.
