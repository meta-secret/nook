# Architecture Specifications

## Overview

This directory contains the normative, permanent architectural specifications for the Nook codebase:

- [Package Responsibilities & Layers](packages.md): Modular package breakdown, crate internal responsibilities, application domain services, and presentation packages.
- [Module Expert Registry](../../teams/ai/architecture/module-experts.md): Read-only named expert routing, internal API ownership, exclusions, and deterministic validation.
- [Structural Refactoring Expert Registry](../../teams/ai/architecture/refactoring-experts.md): Read-only code and Cortex refactoring expertise with synthesis-only system coherence.
- [The Engineering Harness](../../teams/sre/architecture/engineering-harness.md): Containerized Taskfile hierarchy, sealed Docker image lineages, BuildKit caching, Zot registry scopes, and SeaweedFS sccache compiler acceleration.

For repository-wide structure, see the [system overview](system.md).
Application architecture and its dependency DAG live in the
[nook-app architecture catalog](../../../nook-app/.cortex/docs/architecture/index.md).
