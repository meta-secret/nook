# Core Beliefs: Agent-First Operating Principles

These are the core engineering beliefs that guide the development of Nook. Because this codebase is primarily managed and developed by AI agents, we optimize our structures, documentation, and tooling for agentic clarity and mechanical enforcement.

---

## 1. Optimize for AI Legibility First
* **Context is scarce**: Large, monolithic documentation files crowd out active code and task context. Repository documentation should follow the principle of **progressive disclosure**—a small, stable entry point (`AGENTS.md`) pointing to deeper, structured documents only when needed.
* **Locality & Discoverability**: Code structure should be self-revealing. If an architecture choice or decision is not captured in the repository (e.g., hidden in chat transcripts, PR comments, or external docs), it does not exist for the agent.

## 2. Enforce Invariants Mechanically, Don't Micromanage Implementations
* **System of Checks**: We do not tell agents to "try harder" or rely on prose instructions to enforce rules. We write automated checks (linters, formatting rules, unit tests, Svelte diagnostics) that fail early and loud.
* **Actionable Failures**: When a script or test fails, the output must be clear and offer actionable remediation instructions so the agent can self-correct immediately.

## 3. Strict boundaries & Parse at the Boundary
* **No YOLO Data Probing**: We avoid guessing data shapes or traversing weakly-typed objects. Data must be parsed and validated at the system boundary (e.g., when passing data between Rust and JS/Svelte).
* **Predictable Structure**: Each package has a strict layer of responsibility. We enforce a one-way dependency flow: `nook-core` (Rust logic) ➔ `nook-wasm` (bindgen) ➔ `nook-web` (UI). Any cross-layer leakage is disallowed.

## 4. Centralize Tooling behind a Single Command Surface
* **Task runner as the API**: We use `Taskfile.yml` as the single interface for all development tasks. Agents do not run raw compiler, bundler, or environment commands. They call `task setup`, `task check`, `task build`, or `task web:dev`.
* **Containerized Toolchain**: All compiles, tests, and package installs run inside Docker to ensure environment parity between the host machine and GitHub Actions CI.

## 5. Pay Down Tech Debt Continuously
* **Technical Debt is High-Interest**: Stale dependencies, unpinned versions, and deprecated configurations are treated as bugs. We pay down minor technical debt continuously in small increments rather than letting it compound into large, disruptive refactoring jobs.

## 6. Maximize Reuse via Rust
* **Rust-First Domain Assets**: Any assets or domain rules (including validation error messages and i18n localization dictionaries) must live in Rust (`nook-core`). Because we plan to build CLI tools and mobile clients in the future, implementing these features in Rust ensures that they can be easily shared across all platforms. Relying on TypeScript or other frontend-specific implementations for domain logic or localized resources makes sharing impossible.

## 7. Close Every Task with a Duration Report
* **Measure wall-clock time** from the start of the user's assignment until the final handoff message.
* **Always include elapsed time** when finishing implementation work (PR merged, feature delivered, or explicit done). See [workflows/pull-requests.md § Task completion report](workflows/pull-requests.md#8-task-completion-report).

## 8. Default to the Coding Bro Pipeline
* **Every implementation task** follows [workflows/coding-bro.md](../workflows/coding-bro.md): fetch → branch from `origin/main` → implement → local checks → push → PR → monitor CI → fix until green → squash merge.
* **Do not stop at push.** The agent owns the PR through merge (when requested) or explicit handoff.
* **Question-only turns** (no code changes) skip the pipeline.

## 9. Unit Tests Own Domain Correctness; E2e Is Smoke Only
* **~99% of functional coverage belongs in Rust unit and integration tests** (`nook-core`). Event sourcing, decentralized set-union sync, causal DAG merge, projection replay, epoch conflicts, and crypto must be proven there — not inferred from Playwright.
* **E2e validates thin UI paths** (unlock, save, stub sync, conflict screens). Treat e2e failures as integration regressions; treat missing Rust tests for new domain behavior as a coverage gap to fix immediately.
* **Line coverage threshold:** `task rust:coverage:check` enforces a **90%** line floor (`nook-core/coverage-floor.json`). Below 90%, agents add Rust tests in the same task. Above 90%, prioritize behavioral tests over chasing every line.
* **Prefer type-safe domain APIs** (newtypes, type-state markers at boundaries) when they prevent invalid states without obscuring the code. Simplicity wins over pattern theatrics.

## 10. Grow Cortex Dynamically
* **`.cortex` is a living knowledge base**, not a frozen snapshot. Agents must **update it when durable knowledge is gained** — from user prompts, design dialogues, test discoveries, CI/PR postmortems, or code archaeology.
* **What to capture:** testing gaps and fixes, sync/event-sourcing invariants, tooling quirks, CI behavior, architectural decisions, and "we tried X, Y worked" lessons. Write concise, actionable prose; link to source files.
* **Where to put it:** extend the relevant existing doc (`rules.md`, `design-docs/`, `workflows/`, `references/`). For recurring refactor or code-organization lessons, add or update the canonical project skill registry under [`../dynamic-skills/`](../dynamic-skills/) and follow [dynamic-skills.md](../workflows/dynamic-skills.md). Add a new file only when the topic is substantial and has no natural home. Update [design-docs/index.md](index.md) or [AGENTS.md](../AGENTS.md) links when adding docs.
* **What not to capture:** chat fluff, one-off task status, or secrets. Do not duplicate large code blocks — point to modules and tests instead.
* **When:** as part of the same PR that learns the fact, or in a immediate follow-up before the task is marked done. If you fixed a bug because tests revealed a missing invariant, document that invariant in `.cortex`.
