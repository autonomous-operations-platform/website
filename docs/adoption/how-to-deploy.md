---
title: How to deploy
---

# How To Deploy A Satellite
You can deploy a satellite in multiple ways.
As the project evolves, they will be listed here from simplest to most complex.

## Manual Deployment
The only way to deploy currently. It gives you maximum flexibility and complete
control over maintenance of the satellite and the host system.

1. Build a satellite binary (see [this example for inspiration](https://github.com/autonomous-operations-platform/hello-world-satellite))
2. Copy the binary to the target machine
3. Execute it

---

# Outlook
Coming soon, tooling and support will exist for the following delivery models:

1. Satellite packages as [Open Component Models](https://ocm.software/)
2. Satellite host bundles (a satellite and an operating system bundled for running in a VM)

Tooling and manuals will exist for building custom satellites next to using the
project-provided ones.
