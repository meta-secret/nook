# Nook Agent Map (Table of Contents)

This is the system of record and entry point for all AI agents working in this repository. Follow the links below for deep context on Nook's architecture, design, and standards.

## ⛔ Non-negotiable: AI-debug mode exists to fix bugs

**The purpose of AI-debug mode is to turn developer annotations into verified
code fixes.** Collecting screenshots, reading logs, explaining a root cause, or
proposing a plan is not completion. Unless the developer explicitly requests a
diagnosis-only session, every submitted annotation is a request to investigate
and fix the reported behavior.

After annotation, the agent must map the evidence to the implementation,
inspect the relevant app logs, implement every in-scope fix, add behavior-focused
coverage, and carry the change through the normal commit, PR, and validation
workflow. Stop without a fix only for a concrete blocker that cannot be resolved
inside the authorized scope, and report that blocker precisely. Full contract:
[references/ai-debugging.md § Purpose and completion contract](references/ai-debugging.md#purpose-and-completion-contract).

## ⛔ Non-negotiable: squash merge every PR

**All pull requests merged into `main` MUST be squash-merged** (GitHub: **Squash and merge**; CLI: `gh pr merge --squash`). One PR = one commit on `main`. Merge commits and rebase merges are **forbidden**. Full policy: [rules.md §6](rules.md#6-git--pull-request-workflow).

## ⛔ Non-negotiable: implementation agents land their PRs

Every task-owning implementation agent with GitHub write access must create or
update a PR, monitor Nook's applicable repository-owned checks, fix failures,
address and resolve actionable comments, update conflicts with `origin/main`,
revalidate the exact head, and squash-merge when
`task pr:ready PR=<number>` succeeds. Do not stop at a ready-PR handoff or ask
for separate merge permission. Stop without a merge only for a concrete blocker
or an explicitly read-only request. The bounded `agent-implement.yml` worker is
not a continuing task owner: its harness owns git/push/PR creation and exits
after opening the PR, so a continuing agent must take ownership of that PR and
carry this lifecycle through merge. Full policy:
[workflows/coding-bro.md](workflows/coding-bro.md).

## ⛔ Non-negotiable: never kill the Docker daemon

**Killing the Docker daemon is strictly prohibited.** Only individual **Docker containers** may be stopped — never Docker Desktop, `dockerd`, or the Docker VM.

- **Forbidden:** `killall Docker`, `killall docker`, `pkill docker`, `pkill -f docker`, `osascript` quit Docker, `systemctl stop docker`, or any command aimed at the daemon or Desktop app.
- **Forbidden:** `lsof -ti :<port> | xargs kill` when that port is forwarded by Docker (e.g. `:5173` for `task web:dev`) — use `docker ps` → `docker stop <container>` instead.
- **Allowed:** `docker stop <container_id>`, `docker rm`, `docker compose down` for a specific stack.

Full policy: [rules.md §5](rules.md#docker-daemon--never-kill-it).

## ⛔ Non-negotiable: never wait for external reviews or checks

Applicable repository-owned PR test checks are the only remote checks agents
wait for: normally `PR / Verify and preview`, plus `Web research / Build and
deploy research catalog` when web-research paths change. **Codex reviews are not required.** Never request,
poll, monitor, or delay merge/handoff for Codex, Claude, Cursor, CodeRabbit, or
any other external review, check, deployment, or service. Do not add a grace
period for external feedback after Nook's applicable PR test checks pass.

External feedback is still useful when it already exists: before merge or
handoff, inspect the comments and review findings currently present and address
every active actionable item from humans or external services. Reply with the
fix, validation, or no-change rationale as documented below. Then proceed based
on Nook's own applicable PR test checks; never wait for another external response or review
cycle. Every external-service review comment already present must be inspected;
the service being optional is never a reason to skip its feedback. Full policy:
[rules.md §6](rules.md#6-git--pull-request-workflow).

## ⛔ Non-negotiable: push before final checks; run them in parallel

As soon as a change is coherent enough to validate, **commit it, push it to the
PR, and only then start the required local checks**. Never serialize the final
gate as `local checks → push → remote checks`; that wastes the entire local-check
duration. The required order is `commit → push/open or update PR → local checks
and repository-owned PR checks in parallel`.

Tiny focused commands used to develop or make the commit coherent may run before
the push. The minimum local gate, full suites, builds, e2e, and any repeated
post-fix validation must run after the completed change is pushed so remote work
starts immediately. Full policy: [workflows/coding-bro.md](workflows/coding-bro.md#testing-strategy--parallel-final-validation).

## 1. Rules & Architectural Layout
* [ARCHITECTURE.md](ARCHITECTURE.md) — Top-level package layout, dependencies, command surface, and quality gates.
* [rules.md](rules.md) — Golden Principles and hard coding/tooling constraints (**§6: squash merge every PR**).

## 2. Design Specs & Beliefs (`design-docs/`)
* [design-docs/index.md](design-docs/index.md) — Index of design specifications and status.
* [design-docs/core-beliefs.md](design-docs/core-beliefs.md) — Agent-first operating beliefs.
* [design-docs/unified-vault.md](design-docs/unified-vault.md) — **Local-first unified vault**, version sync, conflict resolution.
* [design-docs/vault-session-and-lock.md](design-docs/vault-session-and-lock.md) — **Lock**, in-memory session, vault vs sync provider model.

## 3. Product Specifications (`product-specs/`)
* [product-specs/index.md](product-specs/index.md) — Index of product specifications.
* [product-specs/monorepo-setup.md](product-specs/monorepo-setup.md) — Monorepo setup spec.
* [product-specs/password-manager.md](product-specs/password-manager.md) — Password Manager spec.

## 4. Execution Plans (`exec-plans/`)
* [exec-plans/tech-debt-tracker.md](exec-plans/tech-debt-tracker.md) — Tech debt and refactoring tasks.
* [exec-plans/unified-vault-ui-rollout.md](exec-plans/unified-vault-ui-rollout.md) — **Unified vault UI migration** (page-by-page rollout).
* [exec-plans/completed/cortex-restructure.md](exec-plans/completed/cortex-restructure.md) — Restructure execution plan and walkthrough notes.

## 5. Technology Cheat Sheets (`references/`)
* [references/rust-wasm.md](references/rust-wasm.md) — Rust-Wasm binding conventions.
* [references/bun-svelte.md](references/bun-svelte.md) — Bun, Svelte, and Vite development reference.
* [references/logging.md](references/logging.md) — **Application logging** (WASM logger + IndexedDB, `/logs` viewer, level gating, per-test e2e log attachments).
* [references/ai-debugging.md](references/ai-debugging.md) — **Playwright MCP annotation pilot** (trusted project config, Task-first setup, privacy guardrails, live annotation + app-log workflow, evaluation gate).

## 6. Workflows (`workflows/`)
* [workflows/coding-bro.md](workflows/coding-bro.md) — **Default PR-first agent workflow** (fetch → branch + prepare PR → implement → commit/push first → local and applicable PR checks in parallel → fix loop → address comments and conflicts → readiness audit → automatic agent-owned squash merge). Prefer cached local Docker over cold GH Actions.
* [`.cursor/skills/coding-bro/SKILL.md`](../.cursor/skills/coding-bro/SKILL.md) — Cursor skill mirror of coding-bro (auto-invoked).
* [workflows/code-review.md](workflows/code-review.md) — Non-blocking external-review policy and rules for handling feedback that already exists.
* [workflows/dynamic-skills.md](workflows/dynamic-skills.md) — Canonical project skill registry workflow. All durable repo-specific agent skills live as `.cortex/dynamic-skills/` cards; optional Cursor project skills only mirror them for invocation.
* [workflows/pull-requests.md](workflows/pull-requests.md) — **Squash merge policy**, detailed agent pipeline, and PR checklist.
* [workflows/issues.md](workflows/issues.md) — GitHub issue hierarchy management for scoped-down, risky, or deferred functionality.
* [workflows/ci-pipeline.md](workflows/ci-pipeline.md) — **GitHub Actions pipeline** (PR / main / nightly e2e split; local-provider vs sync-live).
* [workflows/monorepo.md](workflows/monorepo.md) — Cross-package changes.
* [workflows/quality.md](workflows/quality.md) — Quality gates, **testing pyramid** (Rust ~99% domain coverage), and release.

## 7. Agent duties beyond code

### Testing pyramid
* **Rust unit/integration tests** must cover ~99% of domain behavior — especially event sourcing, causal DAG sync, projection, epochs, and crypto. E2e is smoke only. See [rules.md §4](rules.md#4-testing-requirements) and [design-docs/core-beliefs.md §9](design-docs/core-beliefs.md#9-unit-tests-own-domain-correctness-e2e-is-smoke-only).
* **Line coverage threshold (90%):** `task rust:coverage:check` measures `nook-core + nook-auth2` and fails below `nook-app/nook-core/coverage-floor.json` (90% lines). When coverage is under 90%, add Rust tests in the same task. Above 90%, do not chase marginal coverage.

### Grow `.cortex` dynamically
* When prompts, dialogues, test runs, or PRs reveal **durable** facts (invariants, tooling behavior, architectural decisions, coverage gaps), **write them into `.cortex` in the same task** — do not leave knowledge only in chat history.
* Follow [design-docs/core-beliefs.md §10](design-docs/core-beliefs.md#10-grow-cortex-dynamically): update the most specific existing doc; keep entries concise and linked to code/tests.
* For recurring refactor, review, boundary, or code-organization feedback, use [workflows/dynamic-skills.md](workflows/dynamic-skills.md) and update [dynamic-skills/index.md](dynamic-skills/index.md).

### Keep the root README current
* The root [`README.md`](../README.md) is the **public, human-facing** entry point. Agents must **update it in the same PR** when an architectural or product-surface change would make it wrong or incomplete.
* **Triggers (non-exhaustive):** package layout or dependency flow changes; new/removed crates or web packages; sync/storage model changes (e.g. event log vs blob); vault unlock or enrollment model changes; public Task commands or local-dev prerequisites; user-visible item types or primary flows; links to `.cortex` docs that move or are superseded.
* **Do not** dump full design specs into the README — keep it accurate and concise, and point to [ARCHITECTURE.md](ARCHITECTURE.md) / design docs for depth. Stale README after an architecture PR is a process defect, same as leaving durable facts only in chat.

### Project skills
* [dynamic-skills/index.md](dynamic-skills/index.md) is the canonical registry of repo-specific skills agents must consult for matching work. The directory name means the skills were captured dynamically from durable project feedback; it does **not** mean they are optional or ad hoc.
* `.cursor/skills/` entries are executable mirrors for tools that support project skills. They must point back to `.cortex/dynamic-skills/`; do not treat `.cursor/skills/` as the source of truth.

### Debugging and CI verification — always check app logs
* Investigation order: **tests** → **static analysis** (`task check`) → **persisted app logs**.
  App logs are the most important source after the first two — vault session, sync,
  and WASM tracing do not appear in clippy or Playwright DOM assertions.
* When debugging Playwright/e2e, vault UI flows, or red CI, **always consult app logs**
  (`nook-app-logs.json` is attached to every Playwright result; `fetchAppLogs`
  and `/app-logs` are available for local repro) before changing code.
  See [references/logging.md § Debugging…](references/logging.md#debugging-troubleshooting-and-ci-verification).

### PR review comments
* When a PR has actionable review feedback from a human, Codex, or another automated reviewer, treat
  every active, non-outdated item as required work. An agent must leave its own GitHub reply explaining the
  fix, validation, or no-change rationale before resolving any PR comment or review conversation. Inspect
  both inline review threads and top-level review bodies for actionable findings. Replies must target the
  specific comment/item; a broad PR audit comment is not a substitute. Resolve a conversation only after
  the targeted reply is visible and the finding is fixed or explicitly invalidated, then re-query the PR.
  Inspect what is present before merge or handoff, but never wait for a reviewer or external service to
  comment, re-review, resolve, or finish a check. Nook's applicable repository-owned PR test checks are the
  only remote checks agents wait for.
  See [dynamic-skills/code-review-comments.md](dynamic-skills/code-review-comments.md).

### Deferred or out-of-scope functionality
* If an agent truly believes part of a requested feature is too large, too risky, blocked, or out of
  scope for the current PR, the agent must not silently drop it. First inspect existing GitHub issues,
  then update the existing aggregate issue or create one, and attach/create focused sub-issues for the
  missing work. See [workflows/issues.md](workflows/issues.md) and
  [dynamic-skills/issue-scope-management.md](dynamic-skills/issue-scope-management.md).
