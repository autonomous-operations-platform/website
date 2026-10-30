---
title: How to deploy
---

# How To Deploy A Satellite
You can deploy a satellite in multiple ways.
As the project evolves, they will be listed here from simplest to most complex.

## Manual Deployment
The only way to deploy currently. It gives you maximum flexibility and complete
control over maintenance of the satellite and the host system.

1. Build the satellite binary (see [this example for how](https://github.com/autonomous-operations-platform/hello-world-satellite))
    1. Install Go from [go.dev/dl](https://go.dev/dl)
    2. Install dependencies via `go mod tidy`
    3. Build via `go build .`
2. Copy the resulting binary to the target machine
3. Execute it, ideally in a fail-safe way

---

# Outlook
Coming soon, tooling and support will exist for the following delivery models:

1. Satellite packages as [Open Component Models](https://ocm.software/)
2. Satellite host bundles (a satellite and an operating system bundled for running in a VM)

Tooling and manuals will exist for building custom satellites next to using the
project-provided ones.
