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

The successful squash merge is the implementation task's delivery boundary.
Do not wait for, monitor, or verify the post-merge `main.yml` run or development
deployment unless the user explicitly requested deployment/live verification
or assigned a Main failure. Publish the required stats-only record immediately
after merge without making Main completion a prerequisite.

## ⛔ Non-negotiable: never kill the Docker daemon

**Killing the Docker daemon is strictly prohibited.** Only individual **Docker containers** may be stopped — never Docker Desktop, `dockerd`, or the Docker VM.

- **Forbidden:** `killall Docker`, `killall docker`, `pkill docker`, `pkill -f docker`, `osascript` quit Docker, `systemctl stop docker`, or any command aimed at the daemon or Desktop app.
- **Forbidden:** `lsof -ti :<port> | xargs kill` when that port is forwarded by Docker (e.g. `:5173` for `task web:dev`) — use `docker ps` → `docker stop <container>` instead.
- **Allowed:** `docker stop <container_id>`, `docker rm`, `docker compose down` for a specific stack.

Full policy: [rules.md §5](rules.md#docker-daemon--never-kill-it).

## ⛔ Non-negotiable: inspect existing feedback without waiting for reviewers

Before merge or handoff, inspect the comments and review findings currently
present and address every active actionable item from humans or external
services. Reply with the fix, validation, or no-change rationale and resolve
each actionable thread. Do not request or wait for Codex, Claude, Cursor,
CodeRabbit, or any other optional reviewer when no feedback is present. A PR is
ready when the applicable repository-owned checks are green, the branch is
current and mergeable, and all feedback already present is addressed.
`task pr:ready` enforces the machine-checkable parts. Full policy:
[rules.md §6](rules.md#6-git--pull-request-workflow).

## ⛔ Non-negotiable: format on the host before every push

**Always run `task format` before every commit that will be pushed** — not only
when you "think" formatting might be needed. Formatting is cheap; a failed
Prettier/rustfmt Verify cycle is not.

`task format` formats inside sealed Docker images **and applies the diff to the
host working tree**. Sealed images never write the host: `task extension:format`
and bare in-container format commands discard their edits when the container
exits. Do not treat a successful sealed format as a host-clean tree.

Pre-push hygiene (cheap, required) before the first push and every later fix
push:

```bash
task format
git add -u
# When UI / shared vault / extension `src` paths change vs origin/main:
git fetch origin main
.github/scripts/ui-demo-contract.sh "$(git rev-parse origin/main)"
```

Only after that commit → push → monitor GitHub Actions. Do **not** run
`task check`, `task ci:pr`, full suites, builds, or e2e as a required local gate.
Full policy: [workflows/coding-bro.md](workflows/coding-bro.md#pre-push-hygiene--always-format)
and [dynamic-skills/pre-push-hygiene.md](dynamic-skills/pre-push-hygiene.md).

## ⛔ Non-negotiable: GitHub Actions is the only product gate

**The only required local action is `task format`** (plus the light UI demo
contract when UI paths change). Every product check — lint, clippy, unit tests,
coverage, web build, Knip, jscpd, e2e, and the full PR mirror — runs on
**GitHub Actions**, not on the agent machine.

As soon as a change is coherent enough to validate: **pre-push hygiene → commit
→ push/open or update PR → monitor repository-owned PR workflows**. Never run
`task check`, `task ci:pr`, a full test suite, build, or e2e as a merge or
handoff requirement. Never serialize a local product gate before the push.

Optional local Task commands remain available for focused debugging when an
agent chooses them, but they must not delay the push and must not replace green
GitHub Actions. On a red remote run: read the failed job logs (and app logs for
web/e2e) → fix → `task format` → push → wait for the refreshed Actions run.
Full policy: [workflows/coding-bro.md](workflows/coding-bro.md#testing-strategy--github-actions-only)
and [dynamic-skills/github-actions-only-validation.md](dynamic-skills/github-actions-only-validation.md).

## ⛔ Non-negotiable: fix every failing check finding

**When Knip, jscpd, or any other quality/CI check reports issues, the agent must
fix the underlying problems in the same task.** A red gate is a completion
blocker, not a report to leave for later.

This includes, without exception:

- **Knip** (`bun run unused`) — unused/unreachable files, exports, and
  dependencies in the web packages.
- **jscpd** (`bun run duplicates`) — copy/paste clones above the checked-in
  threshold in authored `nook-app` / `preflight` sources.
- **Every other gate** in `task check` / `task ci:pr` / PR CI — fmt, clippy,
  svelte-check, eslint, TypeScript unused locals/parameters, prettier, vitest,
  vite build, coverage floor, preflight, e2e, and any future mechanical check.

**Required response:** delete or wire up dead code, extract shared helpers for
clones, correct types/lints/tests, and re-run until green.

**Forbidden responses:** raising Knip/jscpd thresholds to silence findings;
adding ignore/exclude entries for authored product code; leaving the failure as
tech debt, a comment-only note, or an issue without fixing it; marking the task
done while any applicable check is red.

Threshold or ignore changes are allowed only when the task explicitly changes
the gate itself (for example, widening an ignore for generated WASM output) and
the PR documents why. Full policy:
[workflows/quality.md § Fix check findings](workflows/quality.md#fix-check-findings--not-silence-them).

## ⛔ Non-negotiable: record and analyze AI-agent PR statistics

Task-owning AI agents must measure every normal PR's local check/test runs,
GitHub Actions runs and retriggers, merge attempts, elapsed time, and the
repository test inventory (counts by type plus absolute total) on the merged
head. After the implementation PR merges, write `.stats/ai-agent/<pr-number>.yaml`,
compare it with one or two recent comparable PR records, and assess
build/workflow waste.
Publish the record in a separate stats-only PR that triggers no product checks
and is squash-merged immediately; stats-only PRs do not recursively generate
statistics. Any actionable regression or waste must be fixed in a separate
normal build-performance PR. Full policy:
[workflows/agent-statistics.md](workflows/agent-statistics.md).

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
* [references/cloudflare-operations.md](references/cloudflare-operations.md) — **Privileged Cloudflare operations** through the OAuth-authenticated `cloudflare-api` MCP connection in the local AI-agent environment.

## 6. Workflows (`workflows/`)
* [workflows/coding-bro.md](workflows/coding-bro.md) — **Default PR-first agent workflow** (fetch → branch + prepare PR → implement → **always `task format`** → commit/push → **GitHub Actions only** for product checks → fix loop → address comments and conflicts → readiness audit → automatic agent-owned squash merge).
* [`.cursor/skills/coding-bro/SKILL.md`](../.cursor/skills/coding-bro/SKILL.md) — Cursor skill mirror of coding-bro (auto-invoked).
* [workflows/code-review.md](workflows/code-review.md) — Non-blocking external-review policy and rules for handling feedback that already exists.
* [workflows/dynamic-skills.md](workflows/dynamic-skills.md) — Canonical project skill registry workflow. All durable repo-specific agent skills live as `.cortex/dynamic-skills/` cards; optional Cursor project skills only mirror them for invocation.
* [dynamic-skills/pre-push-hygiene.md](dynamic-skills/pre-push-hygiene.md) — **Always host-apply `task format` + UI demo contract before push** (prevents Prettier/rustfmt/demo-contract Verify burns).
* [dynamic-skills/github-actions-only-validation.md](dynamic-skills/github-actions-only-validation.md) — **Format locally; every product gate runs on GitHub Actions**.
* [workflows/pull-requests.md](workflows/pull-requests.md) — **Squash merge policy**, detailed agent pipeline, and PR checklist.
* [workflows/issues.md](workflows/issues.md) — GitHub issue hierarchy management for scoped-down, risky, or deferred functionality.
* [workflows/ci-pipeline.md](workflows/ci-pipeline.md) — **GitHub Actions pipeline** (PR / main / nightly e2e split; local-provider vs sync-live).
* [workflows/monorepo.md](workflows/monorepo.md) — Cross-package changes.
* [workflows/quality.md](workflows/quality.md) — Quality gates (Knip, jscpd, lint, coverage), **fix findings not silence them**, testing pyramid, and release.
* [workflows/agent-statistics.md](workflows/agent-statistics.md) — Per-PR AI-agent timing/counter YAML, repository test inventory (by type + total), historical comparison, waste analysis, and the check-free stats-only PR exception.

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
* Investigation order: **GitHub Actions / test output** → **static analysis findings
  from CI** → **persisted app logs**. App logs are the most important source after
  the first two — vault session, sync, and WASM tracing do not appear in clippy or
  Playwright DOM assertions.
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
  Inspect again before merge or handoff. Every active actionable item must be
  handled; do not request or wait for external reviewers or services.
  See [dynamic-skills/code-review-comments.md](dynamic-skills/code-review-comments.md).

### Deferred or out-of-scope functionality
* If an agent truly believes part of a requested feature is too large, too risky, blocked, or out of
  scope for the current PR, the agent must not silently drop it. First inspect existing GitHub issues,
  then update the existing aggregate issue or create one, and attach/create focused sub-issues for the
  missing work. See [workflows/issues.md](workflows/issues.md) and
  [dynamic-skills/issue-scope-management.md](dynamic-skills/issue-scope-management.md).
