# Core Beliefs: Agent-First Operating Principles

## Overview

These are the core engineering beliefs that guide the development of Nook. Because this codebase is primarily managed and developed by AI agents, we optimize our structures, documentation, and tooling for agentic clarity and mechanical enforcement.

---

## 1. Optimize for AI Legibility First

- **Context is scarce:** Large, monolithic documentation files crowd out active code and task context.
- Repository documentation should follow **progressive disclosure**.
- Use a small, stable entry point (`AGENTS.md`) that points to deeper, structured documents only when needed.
- **Locality & Discoverability:** Code structure should be self-revealing.
- If an architecture choice or decision is not captured in the repository, it does not exist for the agent.
- Hidden context includes chat transcripts, PR comments, and external docs.

## 2. Enforce Invariants Mechanically, Don't Micromanage Implementations

- **System of Checks:** We do not tell agents to "try harder" or rely on prose instructions to enforce rules.
- We write automated checks that fail early and loud.
- Checks include linters, formatting rules, unit tests, Svelte diagnostics, Knip unused-code detection, and jscpd clone detection.
- **Actionable Failures:** When a script or test fails, the output must be clear.
- It must offer actionable remediation instructions so the agent can self-correct immediately.
- **Fix the finding:** A failing Knip, jscpd, lint, test, coverage, or CI gate is a required fix in the same task.
- It is not a license to raise thresholds, add authored-code ignores, or defer.
- See [quality.md § Fix check findings](../../../teams/sre/workflows/quality.md#fix-check-findings--not-silence-them).

## 3. Strict boundaries & Parse at the Boundary

- **No YOLO Data Probing:** We avoid guessing data shapes or traversing weakly-typed objects.
- Data must be parsed and validated at the system boundary.
- Example: when passing data between Rust and JS/Svelte.
- **Predictable Structure:** Each package has a strict layer of responsibility.
- Shared dependency-light application primitives flow from `nook-app-common` into portable auth/domain crates.
- Then through `nook-core` (Rust logic) ➔ `nook-wasm` (bindgen) ➔ `nook-web` (UI).
- Any cross-layer leakage is disallowed.

## 4. Centralize Tooling behind a Single Command Surface

- **Task runner as the API:** We use Taskfile as the single interface for all development tasks.
- Root `Taskfile.yml` is the repo entrypoint.
- App tasks live in `nook-app/Taskfile.yml`.
- App-wide tasks live in `nook-app/Taskfile.yml`; CI tasks in `nook-app/ci/Taskfile.yml`.
- Docker tasks live in `nook-app/nook-platform/docker/Taskfile.yml` and `nook-app/nook-web/docker/Taskfile.yml`.
- Web-family tasks live in `nook-app/nook-web/Taskfile.yml` and `nook-web-extension/Taskfile.yml`.
- Agents do not run raw compiler, bundler, or environment commands.
- They use `task loom:pre-push` locally.
- They use `task remote TASK_NAME=<name>` for focused hosted execution.
- They use `task pr:validate` for the complete gate.
- They use local `task web:dev` only for interactive development state.
- Human local mirrors remain available.
- **Containerized Toolchain:** All compiles, tests, and package installs run inside Docker.
- This ensures environment parity between the host machine and GitHub Actions CI.

## 5. Pay Down Tech Debt Continuously

- **Technical Debt is High-Interest:** Stale dependencies, unpinned versions, and deprecated configurations are treated as bugs.
- We pay down minor technical debt continuously in small increments.
- We do not let it compound into large, disruptive refactoring jobs.

## 6. Maximize Reuse via Rust

- **Rust-First Domain Assets:** Domain rules live in their portable Rust owner (`nook-auth2` or `nook-core`).
- Cross-cutting assets such as i18n localization dictionaries and translation utilities live in the dependency-light `nook-app-common` crate.
- We plan to build CLI tools and mobile clients in the future.
- Implementing these features in Rust ensures they can be shared across platforms.
- Relying on TypeScript or other frontend-specific implementations for domain logic or localized resources makes sharing impossible.

## 7. Close Every Task with a Duration Report

- **Measure wall-clock time** from the start of the user's assignment until the final handoff message.
- **Always include elapsed time** when finishing implementation work (PR merged, feature delivered, or explicit done).
- See [pull request task completion](../../../gizmo/workflows/pull-requests.md#10-task-completion-report).

## 8. Default to the Coding Bro Pipeline

- **Every implementation mission** follows
  [mission delivery](../../../gizmo/workflows/mission-delivery.md).
- Responsible team agents own implementation and scoped fixes.
- Gizmo owns delivery planning, team-task admission authorization and contract
  submission, integration, review coordination, validation, readiness, and
  merge. The active harness creates and runs authorized attempts.
- The delivery pipeline has these ordered steps:
  1. Gizmo fetches the repository and plans from `origin/main`.
  2. Gizmo admission-authorizes the implementation task and submits its bounded
     contract to the active harness, which creates and runs the attempt.
  3. Gizmo integrates the verified implementation handoff.
  4. Gizmo runs Loom pre-push and updates the PR.
  5. Gizmo runs focused hosted execution and complete PR validation.
  6. Gizmo admission-authorizes each bounded correction task and submits its
     contract to the active harness, which creates and runs the attempt.
  7. Gizmo integrates verified fixes and repeats exact-head validation.
  8. Gizmo runs readiness and completes the squash merge.
- **Do not stop at push or readiness.** Gizmo owns the PR through squash merge
  unless concretely blocked.
- **Question-only turns** (no code changes) skip the pipeline.

## 9. Unit Tests Own Domain Correctness; E2e Is Smoke Only

- **~99% of functional coverage belongs in Rust unit and integration tests.**
- Crates: `nook-replication`, `nook-event-log`, `nook-core`, and `nook-auth2`.
- Causal DAG and replica mechanics belong in `nook-replication`.
- Event authorization, projection replay, and epoch-conflict metadata belong in `nook-event-log`.
- Encryption workflows remain `nook-core` domain tests.
- None of these may be inferred from Playwright.
- **E2e validates thin UI paths:** unlock, save, provider sync, conflict screens.
- Treat e2e failures as integration regressions.
- Treat missing Rust tests for new domain behavior as a coverage gap to fix immediately.
- **Line coverage threshold:** `task rust:coverage:check` enforces a **90%** line floor (`nook-app/nook-platform/nook-core/coverage-floor.json`).
- Below 90%, agents add Rust tests in the same task.
- Above 90%, prioritize behavioral tests over chasing every line.
- **Prefer type-safe domain APIs** (newtypes, type-state markers at boundaries) when they prevent invalid states without obscuring the code.
- Simplicity wins over pattern theatrics.

## 10. Grow Cortex Dynamically

- **`.cortex` is a living knowledge base**, not a frozen snapshot.
- Apply [agent self-improvement](../../../teams/ai/dynamic-skills/self-improvement.md) when
  substantial work produces reusable evidence.
- Apply [Cortex Writer](../../../teams/ai/dynamic-skills/cortex-writer.md) to persistent prose.
- Apply [Cortex consistency](../../../teams/ai/dynamic-skills/cortex-consistency.md) to every
  promoted claim.
- For user-facing requirements, item schemas, or UX flows, read and update the owning specification in `product-specs/` (see [`../dynamic-skills/product-spec-lifecycle.md`](../../../teams/ai/dynamic-skills/product-spec-lifecycle.md)).
- For recurring refactor or code-organization lessons, add or update the canonical project skill registry under [`../dynamic-skills/`](../dynamic-skills) and follow [dynamic-skills.md](../workflows/dynamic-skills.md).
- Add a new file only when the topic is substantial and has no natural home.
- Update [design-docs/index.md](index.md) or [AGENTS.md](../../../../AGENTS.md) links when adding docs.
- **Root README is part of the same hygiene:** when a change alters package layout, dependency flow, sync/storage model, unlock/enrollment UX, public Task commands, or other facts the root [`README.md`](../../../../README.md) advertises, **update the README in the same PR**.
- Keep the README a concise public summary.
- Put depth in `.cortex`.
- See [AGENTS.md — Keep the root README current](../../../../AGENTS.md#keep-the-root-readme-current).
