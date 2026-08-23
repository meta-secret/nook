# Architecture Specifications

## Overview

This directory contains the normative, permanent architectural specifications for the Nook codebase:

- [Package Responsibilities & Layers](packages.md): Modular package breakdown, crate internal responsibilities, application domain services, and presentation packages.
- [Module Expert Registry](module-experts.md): Read-only named expert routing, internal API ownership, exclusions, and deterministic validation.
- [Structural Refactoring Expert Registry](refactoring-experts.md): Read-only code and Cortex refactoring expertise with synthesis-only system coherence.
- [Agent, Skill, and Capability Architecture](agent-skill-capabilities.md): Many focused skills, few stable agent profiles, skill-owned TypeScript mechanics, and the generic Loom trust boundary.
- [The Engineering Harness](engineering-harness.md): Containerized Taskfile hierarchy, sealed Docker image lineages, BuildKit caching, Zot registry scopes, and SeaweedFS sccache compiler acceleration.

For the system-wide architecture overview and dependency DAG, see [ARCHITECTURE.md](../ARCHITECTURE.md).
