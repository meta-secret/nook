# Nook System Architecture Specification

## Agent delivery applicability

Follow the [dev delivery contract](../../gizmo-prime/architecture/dev-delivery.md) for
feature compilation and the manually run Feature Gizmo's slow PR cycle.
Use the root [delivery and validation policy](../../AGENTS.md#delivery-and-validation)
to decide whether a bounded local test, check, or E2E diagnostic may run.
Runtime workflow details below do not independently grant that permission or
replace required hosted PR checks.

## Overview

This document describes repository-wide subsystem relationships, invariant
verification, and the engineering harness. Application architecture lives with
its code in [nook-app architecture](../../../nook-app/.cortex/docs/architecture/system.md).

## 1. Monorepo Structure

- **Subsystems at repository root:**
  - `infra`: infrastructure composition root, cluster definitions, persistent services, and deployment operations.
  - `nook-app`: application product code, Rust domain/platform workspace, WASM bridge, and web frontends.
  - `agentic-ai`: deterministic Cortex tooling and validation through Loom.
  - `preflight`: standalone repository invariant verification tests.
- **Dynamic exploration:** Detailed internal directory structures are dynamic.
  Agents must investigate directory trees directly using exploration tools rather
  than relying on static documentation trees.

Package dependencies, identity and vault flows, storage, and boundary errors
are owned by the [application architecture](../../../nook-app/.cortex/docs/architecture/system.md).

## 2. Repository Invariant Verification

- **`preflight`**
  - **Tests:** `task preflight`

`preflight` detail:

- Standalone Rust tests for whole-repository invariants.
- Covers Rust/WASM-to-TypeScript boundary mirrors.
- Covers authored TypeScript/Svelte absence semantics.
- Covers no-op forwarding wrappers, unchecked WASM type hints, and raw provider/auth `JsValue` DTO signatures.
- Runs before app setup in PR/main CI.

Application test surfaces and scenario coverage are documented in
[application testing](../../../nook-app/.cortex/docs/architecture/system.md#6-testing-strategy).

---

## 3. The Engineering Harness

All development tasks and builds in Nook run containerized via a unified `Taskfile` surface and reproducible Docker BuildKit images.

- **Unified Command Surface:** Root `Taskfile.yml` includes domain-specific task modules (`nook-app/Taskfile.yml`, `infra/Taskfile.yml`, etc.) under deterministic namespaces (`rust:*`, `web:*`, `docker:*`, `ci:*`).
- **Sealed Reproducible Images:** Runtimes are isolated into sealed images (`nook-rust:local`, `nook-web:local`, `nook-rust-browser:local`) to eliminate machine dependency drift.
- **Split Image Lineages:** Rust compilation and Web packaging run in independent BuildKit lineages; only small generated artifacts (WASM packages, coverage reports) cross the host handoff boundary.
- **Distributed BuildKit & Compiler Caching:** Builds leverage Zot OCI registry layer caches (`registry.dev.nokey.sh`) and SeaweedFS S3-backed `sccache` (`sccache.dev.nokey.sh`) for fast remote and local warm builds.
- **Ephemeral Remote Execution:** Trusted Main jobs and selected focused tasks
  execute in disposable ordinary ARC Pods. The Docker CLI connects to the
  persistent rootless BuildKit shard on the same node. Runner Pods receive no
  Docker daemon, Podman service, DinD process, host runtime socket, host path,
  or Kata runtime. Untrusted and unsupported lanes retain ephemeral
  GitHub-hosted fallback capacity.

See [architecture/engineering-harness.md](../../teams/sre/architecture/engineering-harness.md) for the complete Taskfile hierarchy, Docker cache topology, builder driver configurations, and solve pipelines.

---
