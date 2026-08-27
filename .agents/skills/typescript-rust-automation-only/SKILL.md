---
name: typescript-rust-automation-only
description: >-
  Enforce Nook's P1 hard rule that repository code, scripts, tests, automation,
  dependency manifests, containers, and Taskfiles never use Python. Use Bun and
  TypeScript for scripting and controllers, Rust for compiled behavior, and
  Taskfiles for orchestration. Apply when adding or migrating automation,
  manifest checks, CI helpers, test harnesses, or container tooling.
---

# TypeScript and Rust Automation Only

Read and follow the canonical project rule at
[`.cortex/shared/dynamic-skills/typescript-rust-automation-only.md`](../../../.cortex/shared/dynamic-skills/typescript-rust-automation-only.md).

This is a P1 hard rule with no baseline or grandfathered exceptions. Remove
Python source files, inline programs, runtime invocations, image packages, and
explicit dependencies. Preserve behavior while migrating to Bun/TypeScript,
Rust, or Taskfile-owned orchestration.

Run the repository-language preflight and the focused behavior tests before
delivery.
