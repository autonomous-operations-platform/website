# OCM Runtime Bundle for the Autonomous Operations Satellite

This document defines how the AOS Satellite Runtime Bundle is packaged using the [Open Component Model (OCM)](https://github.com/open-component-model/open-component-model). It covers the component model, build process, and distribution design for two deployment environments: connected (OCI registry) and air-gapped.

The current bundle is a single compiled Go binary with no configuration files. The design is written for that scope and extended in the [runtime dependencies](#runtime-dependencies) section to cover how Apache Doris and its JVM requirement fit in as the bundle evolves.

This document covers concepts and decisions. Makefile targets, scripts, and CI configuration implement them and are reviewed with the code, not here.

## Design overview

```text
 source checkout ──build──▶ bin/satellite-<os>-<arch>  (one per platform)
                                        │
                         ocm add component-version
                                        ▼
                              CTF archive (bin/ctf)   ◀── sign ── verify
                                        │
              ┌─────────────────────────┴─────────────────────────┐
              ▼                                                   ▼
     Route A: OCI registry                            Route B: air-gap archive
     ocm transfer --copy-resources                    tar of bin/ctf, moved offline
              │                                                   │
              ▼                                                   ▼
   consumer: verify ▶ download by platform identity ▶ install
```

The CTF archive is the unit of everything: signed, pushed to a registry, and carried across the air gap. There is no second artifact format. Neither distribution route accepts a bundle it has not verified.

Both routes ship the same signed CTF. Route A pushes it to an OCI registry using `ocm transfer component-version --copy-resources`; Route B archives it and moves it offline as-is, no transfer command needed, since the CTF is already self-contained. Publishing on either route never rebuilds: it takes the bundle from `bin/ctf`, re-verifies the signature, and ships. The consumer then runs `ocm verify component-version` before downloading any resource, pins the version, and requests each binary by explicit platform identity.

## Component model

### Constructor and descriptor

Two artifacts exist:

- The **component constructor** (`ocm/component-constructor.yaml`) is hand-authored. It declares what to package and where the build put the files. It is committed to the repository.
- The **component descriptor** is generated from the constructor by `ocm add component-version` and stored inside the CTF. It records resolved values and content-addressed blob references. The signature covers this generated descriptor, not the constructor.

### Identity

| Element          | Value                                                                       | Rationale                                                                                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Component name   | `github.com/autonomous-operations-platform/autonomous-operations-satellite` | A namespace the project controls. Component identity is permanent once versions are published.                                                                                                          |
| Provider         | `autonomous-operations-platform`                                            | The organisation that produces and signs the bundle.                                                                                                                                                    |
| Resource name    | `satellite`                                                                 | The single binary resource. All platform variants share this name.                                                                                                                                      |
| Resource type    | `executable`                                                                | The OCM standard type for runnable binaries. Media type is `application/octet-stream`.                                                                                                                  |
| Variant identity | `extraIdentity: { os, architecture }`                                       | Distinguishes platform variants of the same resource. Values follow Go's `GOOS`/`GOARCH` naming (e.g. `linux`, `amd64`). Consumers select with `--identity name=satellite,os=<os>,architecture=<arch>`. |

### Constructor

The constructor has one resource entry per supported platform. Entries differ only in `extraIdentity` and `input.path`; adding or removing a platform is one entry here plus the matching change to the build's platform list, with no schema impact.

```yaml
components:
  - name: github.com/autonomous-operations-platform/autonomous-operations-satellite
    version: ${VERSION}
    provider:
      name: autonomous-operations-platform
    resources:
      - name: satellite
        type: executable
        version: ${VERSION}
        extraIdentity:
          os: linux
          architecture: amd64
        input:
          type: File/v1
          path: ./bin/satellite-linux-amd64
          mediaType: application/octet-stream
      # …one entry for linux/arm64
```

A few decisions are encoded here:

- `${VERSION}` is expanded from an environment variable at build time, not hardcoded. The constructor cannot disagree with the build invocation.
- `File/v1` embeds the binary by value. Each variant appears in the generated descriptor as a `LocalBlob/v1` reference, making the CTF self-contained.
- Paths are relative to the repository root, not to `ocm/`, so the constructor can reference binaries in `bin/`.
- The production platform set is `linux/amd64` and `linux/arm64`. Both platforms are supported by Apache Doris and are the expected core bare-metal environments the satellite is deployed to.

### Versioning

The bundle version is the git release tag. The build reads `VERSION` from the nearest `vX.Y.Z` tag, strips the leading `v`, and rejects anything that is not valid `major.minor.patch` semver. An explicit override is allowed for local testing but cannot pass the publish checks.

Three constraints enforce that a published version always maps to an exact, clean tag:

- The working tree must be clean. Uncommitted or untracked files are rejected before signing.
- The current commit must carry the tag `v<VERSION>`. Any commit between two releases fails this check.
- A version is published once. Different content is never published under an existing version.

## Repository layout

OCM packaging adds two entries to the existing `autonomous-operations-satellite` git repository. The Go source tree is unchanged.

```text
autonomous-operations-satellite/      # the autonomous-operations-satellite git repository
├── cmd/satellite/                    # Go entry point
├── internal/, pkg/, proto/           # Go source
├── ocm/
│   ├── component-constructor.yaml    # hand-authored OCM input (see above)
│   └── satellite.pub.pem             # public verification key (safe to commit)
├── bin/                              # git-ignored — build output
│   ├── satellite-<os>-<arch>         # one binary per platform
│   ├── ctf/                          # the CTF archive (the shipped unit)
│   └── satellite-<version>.ctf.tgz   # Route B wrapper (plain tar of bin/ctf)
├── Makefile
└── …
```

## Build design

OCM packaging lives as a set of Makefile targets alongside existing build, lint, and coverage targets. The design is defined by its invariants:

- A single target produces the finished bundle. Its output is always a signed and verified CTF. No target produces a shippable bundle without signing.
- Cheap checks run before compiling: semver validity, platform-list consistency between the constructor and the build, presence of both key files, and a clean working tree.
- The CTF is deleted before each packaging run. The CLI's default conflict policy aborts on an existing version, and nothing from a previous run may carry over.
- Signing and verification use separate configurations. The signing configuration contains only the private key; the verification configuration contains only the public key. CI verifies its own output using the key consumers will use, and publishing never touches the signing configuration.

### Build stages

1. **Preflight**: the checks above.
2. **Compile**: one `go build` per platform (`GOOS`/`GOARCH`, `CGO_ENABLED=0`, `-trimpath`). Pure-Go static binaries cross-compile without a per-platform toolchain.
3. **Package**: one `ocm add component-version` invocation reads the constructor, collects all platform binaries, and writes the CTF.
4. **Inspect**: `ocm get component-version -o yaml` prints the generated descriptor. A missing binary already fails packaging; this step is a human-readable sanity check.
5. **Sign**: `ocm sign component-version` against the CTF, using the signature name `satellite-sig`. One signature covers all platform variants.
6. **Verify**: `ocm verify component-version` against the CTF, using the verification configuration.

Sign and verify pass their configuration with `--config`. CI writes the private key outside the repository checkout, for example `/tmp/satellite-sign.key`; a key file inside it counts as an untracked file and stops the preflight.

## Runtime dependencies

The Satellite Record Store uses [Apache Doris](https://github.com/apache/doris) as its persistent journal, and Doris requires a JVM. Downloading these at runtime breaks the air-gap requirement. The OCM bundle must include all binaries needed to run a satellite node.

### Contents

| Resource    | Description                                                         |
| ----------- | ------------------------------------------------------------------- |
| `satellite` | The AOS satellite binary. Already designed; see above.              |
| `doris`     | Apache Doris binary distribution for each supported Linux platform. |
| `jvm`       | A bundled JDK at the version Doris requires.                        |

Each resource uses the same `extraIdentity: { os, architecture }` pattern as the satellite binary.

The Autonomous Operations Platform only provides bundles for Apache Doris and its runtime dependencies (i.e. a JVM) targeting Linux-based platforms.

The `doris` and `jvm` binaries are fetched from their upstream release channels in CI and embedded via `File/v1` inputs, exactly as the satellite binary. Upstream release integrity (checksums, signatures) must be verified before embedding. The verified source and version are pinned in the build configuration.

### Host requirements

The bundle targets a bare-metal Linux server with no pre-installed runtime beyond the OS itself. No package manager, container runtime, or other tooling is required.

The concrete minimum kernel version and minimum `glibc` version depend on the specific Doris release and JDK chosen. These are not yet fixed. Once those are pinned, the minimum host requirements must be documented and published alongside the bundle so operators know what the server must provide.

### Multi-bundle layout

A single CTF that contains the satellite binary, Doris, and a JDK is convenient but makes every component update an all-or-nothing re-bundle and re-transport. An alternative is to split the components across separate OCM bundles:

| Bundle component          | Component name (example)                                                    |
| ------------------------- | --------------------------------------------------------------------------- |
| Satellite binary          | `github.com/autonomous-operations-platform/autonomous-operations-satellite` |
| Apache Doris distribution | `github.com/autonomous-operations-platform/doris`                           |
| JDK                       | `github.com/autonomous-operations-platform/jdk`                             |
| Product component         | `github.com/autonomous-operations-platform/autonomous-operations-node`      |

The **product component** references the other three by component reference. Consumers who need the full runtime fetch the product component and let OCM resolve its references. Consumers who only need the satellite binary, for example to run a standalone test or to update a single component, can fetch just that bundle. Air-gap transport can carry a single combined CTF for initial setup, while updates can carry only the changed sub-bundle.

This split is not yet the default. The single-bundle model is simpler for the initial POC. The decision to split should be revisited once all three components have pinned versions and the update frequency of each component is known.

## Signing and verification

### Trust model

Plain RSA signatures with a pinned public key. The team generates a 4096-bit RSA key pair once. Signatures use RSASSA-PSS (SHA-256, salt length equal to hash output length), the OCM CLI's defaults. The signature is stored in the descriptor, and verification requires the public key supplied separately via OCM configuration.

- The **private key** lives in the CI secrets manager, is never committed, and is written at build time to a file outside the checkout.
- The **public key** is committed at `ocm/satellite.pub.pem` and distributed to every environment where verification happens.

**Key rotation** requires generating a new RSA key pair, rotating the CI secret, committing the new public key, and distributing it to every verification environment through the same trusted channel used for initial provisioning. For air-gapped environments this means a coordinated update.

### What the signature covers

Signing hashes a normalised form of the descriptor, which records every resource's digest. All platform variants are covered by one signature. Replacing any one binary fails verification.

### Verification points

1. In CI, immediately after signing.
2. Before publishing, on both routes.
3. Against the registry copy, after pushing (Route A).
4. On the target, before any binary is used.

### Delivering the public key to the air-gapped side

The key arrives through a separate trusted channel, pre-provisioned with the environment, or delivered and checked independently. The specific mechanism (base image provisioning, out-of-band disk transfer with hash verified against a published fingerprint, environment bootstrap scripts) is defined per deployment context and is not prescribed here. The key must not travel inside the same archive as the bundle; the archive must not vouch for itself.

### Alternatives considered

- **Certificate chains.** The CLI can embed a leaf and intermediate certificate in the signature so verifiers pin a root CA instead of a single key. Rotation becomes issuing a new certificate. Revocation of a leaked key is not solved by the chain alone, and the OCM docs mark this encoding as early access.
- **Sigstore keyless signing.** Uses short-lived, OIDC-issued certificates instead of a long-lived RSA key pair. The signing identity is tied to the CI job's OIDC token, and the certificate issuance event is recorded in Rekor, Sigstore's transparency log. This means a verifier can confirm not just that the bundle was signed by someone who held the right key, but that the signature came from a specific CI pipeline run on a specific commit, provenance that RSA signatures do not carry. The Sigstore root certificate (embedded in `cosign`) has a 10-year validity, so the trust anchor rarely changes. Verification requires `cosign` and a Sigstore trust bundle on the verifying side; these are distributed the same way as the RSA public key. For components where provenance records must not appear in the public Rekor instance, a private instance or `--no-upload` removes that constraint. The reason it is not the default here is operational: the OCM CLI's Sigstore integration was marked early access at the time of writing, and `cosign` is an additional binary dependency on the verification side. The trust model is stronger than RSA, not weaker. Once the OCM CLI's Sigstore integration reaches a stable productive release, this decision should be re-evaluated.
