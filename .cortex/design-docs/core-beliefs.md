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
