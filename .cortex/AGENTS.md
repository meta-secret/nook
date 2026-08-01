# Nook Agent Map (Table of Contents)

This is the system of record and entry point for all AI agents working in this repository. Follow the links below for deep context on Nook's architecture, design, and standards.

## ⛔ P1 — most critical code-structure rule: oversized source is prohibited

Every authored source file, including Rust, MUST stay at or below **1,000
lines**. Crossing this uniform hard limit is a failed repository invariant and
a P1 architecture finding. A Rust module that needs more than 1,000 lines
signals an overcomplicated domain model or too many production
responsibilities; the model must be decomposed rather than accommodated by a
larger language-specific allowance.

For Rust, moving `#[cfg(test)]` code or unit tests into another file is **not**
an acceptable fix. Separate Rust unit-test files under `src` are prohibited:
unit tests MUST be colocated with the focused implementation module they test.
Rust integration tests under a crate's `tests/` directory remain valid. An
oversized production module proves that its production responsibilities need
review. Split it along a real domain, capability, ownership, lifecycle, or
dependency boundary; keep each resulting module cohesive, expose narrow
interfaces, and colocate each abstraction's unit tests in that module.

Mechanical line-count splitting is forbidden. Never cut a file in half or
create meaningless `part1`, `part2`, `continued`, or similarly numbered
modules. The refactor must improve the architecture, not merely satisfy the
counter. Moving unit tests to a separate file to satisfy the counter is itself
a failing invariant. Full critical contract:
[dynamic-skills/source-file-size.md](dynamic-skills/source-file-size.md).

## ⛔ Non-negotiable: load both design skills for every UI task

Before designing, implementing, or reviewing any user-visible website or browser
extension UI, agents MUST read and use both skills:

- [`design-taste-frontend`](../.agents/skills/design-taste-frontend/SKILL.md)
- `impeccable`, generated locally with `task impeccable:install`

The upstream Impeccable distribution is a pinned, generated dependency rather
than authored Nook source. It MUST NOT be committed. A fresh checkout or
isolated worker runs `task impeccable:install`, then restarts its agent harness
so Codex discovers `.agents/skills/impeccable/SKILL.md`. Run its executable
setup through `task impeccable:context -- <arguments>`; repository hooks use
the same pinned Docker runtime.

This applies to new screens, redesigns, component and style changes, responsive
behavior, interaction states, and visual polish.

These skills are complementary design-quality lenses, not permission to replace
Nook's stack or architecture. Nook remains Svelte-based, and this `.cortex`
guidance remains authoritative for typed Rust/WASM boundaries, translations,
accessibility, established components and tokens, tests, and dependency
choices. Use Impeccable's surface mode and task playbook to ground the work,
then apply the Nook-specific taste skill's Svelte implementation, anti-slop, and
visual pre-flight guidance.

Full repository-specific application contract:
[dynamic-skills/ui-design-skills.md](dynamic-skills/ui-design-skills.md).

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

## ⛔ Non-negotiable: every bug fix needs regression coverage

When an AI agent finds or fixes a bug, it must add a behavior-focused regression
test that reproduces the missed failure path. Rust/core bugs require Rust unit
or integration tests. User-visible website and web-extension bugs require
Playwright e2e coverage of the exact sequence that failed; unit, component, or
WASM tests may supplement but never replace that browser regression. Add WASM
tests first when the fault is reproducible at the typed boundary, then keep the
Playwright test for the user-visible flow. Full policy:
[rules.md §4](rules.md#4-testing-requirements).

## ⛔ Non-negotiable: Rust domain absence must be explicit

Before adding or preserving `Option<T>` in authored Rust, determine what
`None` means. Required persisted values stay required validated values. Named
product, lifecycle, authorization, or workflow states use enums with
variant-owned data instead of `Option<T>` field bags. `Option<T>` remains
appropriate only when absence is the truthful structural contract, including
iterator/lookup results, optional external inputs, and caches. When absence
violates an invariant, return `Result<T, DomainError>`, add a precise
`thiserror` variant, and propagate with `?`; do not model failure as either
`None` or a fake state enum.

Do not create one-variant wrapper enums merely to avoid the spelling
`Option<T>`. The objective is to make illegal domain states unrepresentable,
not to reject idiomatic Rust. Full contract and examples:
[dynamic-skills/rust-coding.md](dynamic-skills/rust-coding.md).

Rust-owned `Tsify`/WASM domain contracts must not override a field type with
TypeScript `undefined`, `null`, or `void`. In particular, an `Option<T>` field
plus `#[tsify(type = "... | undefined")]` is two representations of the same
unnamed absence and leaks it across the boundary. Replace that field with a
named Rust enum whose variants explain the state and derive the generated
boundary type from the enum. `void` remains valid only for TypeScript
unit/effect returns, never as a serialized field state. The syntax-aware
preflight rejects authored absence sentinels in `tsify(type = "...")`
overrides, `Option<T>` fields on `Tsify` exports, and `Option<T>` parameters or
returns on `wasm_bindgen` exports. `Option<T>` may remain inside Rust, but it
must be converted to a named boundary state before TypeScript generation.

Tests of known JSON contracts must deserialize into the concrete Rust wire or
domain type before asserting field values. Raw `serde_json::Value` indexing and
`Value::is_null()` are prohibited for those assertions because indexing treats
both an omitted property and explicit JSON `null` as `Value::Null`, hiding the
contract distinction and bypassing typed enums. Raw values remain appropriate
when malformed, unknown, or deliberately partial JSON is itself the test
subject, or for a narrow `.get()` assertion that an exact wire property was
omitted or renamed.

## ⛔ Non-negotiable: authored JavaScript/TypeScript state must be explicit

Authored JavaScript, TypeScript, and Svelte must not contain the `undefined`
value or type token. Model optional data and named product, workflow,
lifecycle, resource, and UI states with discriminated unions whose variants
own their data, or with generated Rust/WASM enums when the state is portable
domain policy. Do not spread optional-value unions, zero-argument `$state<T>()`
runes, parameterless `$bindable()` props, optional-field bags, and parallel
booleans across a controller and then reconstruct the real state through
condition chains. A parameterless `$bindable()` is still an implicit
`undefined` default and is forbidden; use a truthful concrete input value or
remove the unused binding surface.

Classify ownership before authoring an enum. Authentication, vault, recovery,
Sentinel, provider, sync, secret-schema, and other portable product
vocabularies are Rust enums in `nook-core`, exposed directly through
`nook-wasm`; TypeScript must not mirror or rename them. Browser protocol,
browser lifecycle, and presentation-only closed vocabularies use a meaningfully
named TypeScript enum. Union variants and protocol shapes reference enum
members instead of raw string literal types for `kind`, `type`, `status`,
`phase`, `stage`, `mode`, `action`, and `operation`. Serialized strings remain
stable through enum values where wire or persistence compatibility requires
them; unrelated state machines must not be collapsed into one generic enum.
Constructors, comparisons, switch branches, and fixtures use those same enum
members rather than repeating serialized strings. Any other authored closed
string-literal union is also an enum; a field name outside the common
discriminant list is not an escape hatch. Svelte components import runtime
enums from a cohesive adjacent TypeScript state module because the Svelte
compilation boundary does not preprocess runtime TypeScript enum syntax.

External and browser contracts may still produce JavaScript absence values at
runtime. Optional external input shape is normalized at its narrow boundary,
and lookup/parser/browser results become a domain-specific union immediately.
Authored code must not use `undefined` or `null` as values or types. Generated
declarations may mirror external contracts and are excluded. Tests, build
scripts, `.agents`, and `.github` code are authored code and are not excluded.
Do not evade the rule with quoted sentinel names, casts, fake defaults,
decorative wrappers, or sentinel strings.

`void` is not an absence value when used as TypeScript's unit/effect type. It
is permitted as the complete return of a function or callback, as
`Promise<void>`, in `void | Promise<void>` for a synchronous-or-asynchronous
effect, and in the unary `void` operator when a result is intentionally
discarded. This is equivalent to Rust `()`, not `Option<T>`. Any union of a
value with `void`, such as `T | void` or `Promise<T | void>`, is forbidden in
storage, parameters, callbacks, and return types because it represents unnamed
absence rather than effect completion. Tests assert semantic variants or
structural property contracts, never `toBeUndefined`, `toBeNull`,
`toBeDefined`, or equivalent absence matchers. Full contract:
[dynamic-skills/typescript-explicit-state.md](dynamic-skills/typescript-explicit-state.md).

Authored Rust must not call `.unwrap()` or `.expect(...)`. Production paths
propagate or classify failure. Rust tests that perform fallible setup or
verification return `Result<(), E>` and propagate with `?`; panic-based setup
and verification are forbidden even for locally constructed fixtures. Do not
erase test errors behind
`Box<dyn std::error::Error>`: use the concrete crate error when one error family
is involved, or `anyhow::Result` when a test composes unrelated fallible APIs.
Workspace Clippy configuration denies both `expect_used` and `unwrap_used`
across all targets.

Production Rust must not depend on, import, return, or invoke `anyhow`.
Libraries, binaries, examples, and build scripts expose concrete error enums
whose variants identify the failed operation and preserve typed sources.
`anyhow` is permitted only in `#[cfg(test)]` unit-test code and integration
tests under `tests/`, and it belongs in `[dev-dependencies]`. Repository
preflight parses authored Rust and Cargo manifests to enforce that boundary.

## ⛔ Non-negotiable: authored Rust macros are prohibited

Repository-defined declarative and procedural macros are forbidden in authored
Rust. A macro that generates ordinary structs, implementations, conversions,
or control flow hides the code agents and maintainers need to read, makes
navigation and diagnostics indirect, and is not justified by avoiding
boilerplate. Write the explicit Rust items and branches instead. Small,
repetitive, flat code is preferred when each type or operation remains locally
understandable and independently changeable.

This rule does not require mechanically expanding compiler- or
ecosystem-provided integration macros. Standard derives and attributes such as
`serde`, `thiserror`, `wasm_bindgen`, `Tsify`, and test attributes remain
allowed, as do ordinary standard formatting, logging, assertion, and
collection-construction macros. Generated sources and third-party dependencies
are excluded. Any proposed new exception must demonstrate that explicit Rust
cannot express the requirement clearly; convenience or fewer lines is not a
reason. The syntax-aware preflight rejects authored `macro_rules!` definitions
and procedural-macro entrypoints. Full contract:
[dynamic-skills/rust-macro-minimization.md](dynamic-skills/rust-macro-minimization.md).

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

The successful squash merge is the implementation task's product delivery
boundary.
Do not wait for, monitor, or verify the post-merge `main.yml` run or development
deployment unless the user explicitly requested deployment/live verification
or assigned a Main failure. Publish the required Workbench issue update,
worklog, and agent-statistics record immediately after merge without making Main
completion a prerequisite.

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

Only after that commit → push. Use `task remote TASK_NAME=<name>` for focused
build/test feedback, then explicitly trigger complete PR validation with
`task pr:validate PR=<number>` when the head is ready. Do **not** run
`task check`, `task ci:pr`, full suites, builds, or e2e on the agent machine.
Full policy: [workflows/coding-bro.md](workflows/coding-bro.md#pre-push-hygiene--always-format)
and [workflows/remote-execution.md](workflows/remote-execution.md).

## ⛔ Non-negotiable: heavy agent work runs remotely

**The only required local action is `task format`** (plus the light UI demo
contract when UI paths change). Every product check — lint, clippy, unit tests,
coverage, web build, Knip, jscpd, e2e, and the full PR mirror — runs on
**GitHub Actions**, not on the agent machine.

The normal loop is **pre-push hygiene → commit → push → focused
`task remote` runs as useful → explicit `task pr:validate` at the complete
validation boundary**. Ordinary PR pushes do not start the full PR workflow.
A later push makes prior checks stale, so the agent must explicitly validate
the new exact head before readiness can succeed.

Heavy focused debugging also runs through the allowlisted remote task catalog.
Local execution is reserved for formatting, the UI demo contract, repository
inspection, and interactive development sessions that require a persistent
local server/browser. On a red remote run: read the failed logs (and app logs
for web/e2e) → fix → `task format` → commit → push → dispatch focused remote
work or complete validation again. Full policy:
[workflows/remote-execution.md](workflows/remote-execution.md) and
[dynamic-skills/github-actions-only-validation.md](dynamic-skills/github-actions-only-validation.md).

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

## ⛔ Non-negotiable: preserve work context in Nook Workbench

Nook issues, agent work summaries, and delivery statistics live in
[`meta-secret/nook-workbench`](https://github.com/meta-secret/nook-workbench),
not in GitHub Issues or `.stats` inside this repository. Feature directories
contain Markdown issue files. Before implementation, every task-owning agent
publishes a concise task plan containing its own public-safe interpretation of
the user's requirements, constraints, intended steps, and completion evidence;
raw prompts and chat transcripts are forbidden. At completion or blockage, the
agent publishes a worklog linked to that plan with progress, problems,
decisions, validation, and remaining work. Only a Workbench issue explicitly
marked `status: ready` and `automation: agent` may trigger the scheduled
implementation worker. Full policy:
[workflows/issues.md](workflows/issues.md).

## ⛔ Non-negotiable: record and analyze AI-agent PR statistics

Task-owning AI agents must measure every normal PR's lightweight local runs,
focused/complete GitHub Actions runs and retriggers, merge attempts, elapsed time, and the
repository test inventory (counts by type plus absolute total) on the merged
head. After the implementation PR merges, write
`stats/ai-agent/<pr-number>.yaml` to Nook Workbench, compare it with one or two
recent comparable records, and assess build/workflow waste. Publish it directly
to Workbench `main`; do not create a bookkeeping branch or PR in Nook.
Any actionable regression or waste must be fixed in a separate normal
build-performance PR. Full policy:
[workflows/agent-statistics.md](workflows/agent-statistics.md).

## 1. Rules & Architectural Layout
* [ARCHITECTURE.md](ARCHITECTURE.md) — Top-level package layout, dependencies, command surface, and quality gates.
* [rules.md](rules.md) — Golden Principles and hard coding/tooling constraints (**§6: squash merge every PR**).

## 2. Design Specs & Beliefs (`design-docs/`)
* [design-docs/index.md](design-docs/index.md) — Index of design specifications and status.
* [design-docs/core-beliefs.md](design-docs/core-beliefs.md) — Agent-first operating beliefs.
* [design-docs/hive-isolated-agent-platform.md](design-docs/hive-isolated-agent-platform.md) — **Stateful isolated AI-agent platform**: trusted Codex operators, k0s/Kata topology, Neo4j task DAG, direct scoped credentials, disposable workers, complete Main-repair delivery, caching, and Taskfile operations.
* [design-docs/unified-vault.md](design-docs/unified-vault.md) — **Local-first unified vault** (scalar sync historical; see event-log).
* [design-docs/vault-session-and-lock.md](design-docs/vault-session-and-lock.md) — **Lock**, in-memory session, vault vs sync provider model.
* [design-docs/auth-providers.md](design-docs/auth-providers.md) — Login gate, `nook_auth` sync-provider credentials, OAuth origins.
* [design-docs/vault-event-log.md](design-docs/vault-event-log.md) — Immutable event log, causal DAG, projection (live provider sync).

## 3. Product Specifications (`product-specs/`)
* [product-specs/index.md](product-specs/index.md) — Index of product specifications.
* [product-specs/monorepo-setup.md](product-specs/monorepo-setup.md) — Monorepo setup spec.
* [product-specs/password-manager.md](product-specs/password-manager.md) — Password Manager spec.

## 4. Execution Plans (`exec-plans/`)
* [exec-plans/tech-debt-tracker.md](exec-plans/tech-debt-tracker.md) — Tech debt and refactoring tasks.
* [exec-plans/unified-vault-ui-rollout.md](exec-plans/unified-vault-ui-rollout.md) — **Unified vault UI migration** (page-by-page rollout).
* [exec-plans/ts-domain-to-rust-remaining.md](exec-plans/ts-domain-to-rust-remaining.md) — Remaining content-script / Node host-policy mirrors after core ownership.
* [exec-plans/completed/cortex-restructure.md](exec-plans/completed/cortex-restructure.md) — Restructure execution plan and walkthrough notes.

## 5. Technology Cheat Sheets (`references/`)
* [references/rust-wasm.md](references/rust-wasm.md) — Rust-Wasm binding conventions.
* [references/bun-svelte.md](references/bun-svelte.md) — Bun, Svelte, and Vite development reference.
* [references/logging.md](references/logging.md) — **Application logging** (WASM logger + IndexedDB, `/logs` viewer, level gating, per-test e2e log attachments).
* [references/ai-debugging.md](references/ai-debugging.md) — **Playwright MCP annotation pilot** (trusted project config, Task-first setup, privacy guardrails, live annotation + app-log workflow, evaluation gate).
* [references/cloudflare-operations.md](references/cloudflare-operations.md) — **Privileged Cloudflare operations** through the OAuth-authenticated `cloudflare-api` MCP connection in the local AI-agent environment.

## 6. Workflows (`workflows/`)

- [workflows/coding-bro.md](workflows/coding-bro.md) — **Default PR-first agent workflow** (fetch → branch + prepare PR → implement → **always `task format`** → commit/push → focused hosted tasks → explicit complete PR validation → fix loop → readiness audit → automatic agent-owned squash merge).
- [`.cursor/skills/coding-bro/SKILL.md`](../.cursor/skills/coding-bro/SKILL.md) — Cursor skill mirror of coding-bro (auto-invoked).
- [workflows/code-review.md](workflows/code-review.md) — Non-blocking external-review policy and rules for handling feedback that already exists.
- [workflows/dynamic-skills.md](workflows/dynamic-skills.md) — Canonical project skill registry workflow. All durable repo-specific agent skills live as `.cortex/dynamic-skills/` cards; optional Cursor project skills only mirror them for invocation.
- [dynamic-skills/pre-push-hygiene.md](dynamic-skills/pre-push-hygiene.md) — **Always host-apply `task format` + UI demo contract before push** (prevents Prettier/rustfmt/demo-contract Verify burns).
- [dynamic-skills/github-actions-only-validation.md](dynamic-skills/github-actions-only-validation.md) — **Format locally; run focused tasks and complete gates explicitly on GitHub-hosted workers**.
- [dynamic-skills/ui-design-skills.md](dynamic-skills/ui-design-skills.md) — **Always load both `impeccable` and `design-taste-frontend` for user-visible UI work and apply them through Nook's Svelte/product constraints**.
- [workflows/pull-requests.md](workflows/pull-requests.md) — **Squash merge policy**, detailed agent pipeline, and PR checklist.
- [workflows/issues.md](workflows/issues.md) — Workbench Markdown issue hierarchy, lifecycle, automation, required task-start plans, and completion worklogs.
- [workflows/remote-execution.md](workflows/remote-execution.md) — **Main agent execution path** (allowlisted focused hosted tasks, label-gated exact-head PR validation, and failure loops).
- [workflows/ci-pipeline.md](workflows/ci-pipeline.md) — **GitHub Actions pipeline** (remote task / label-gated PR / main / manual live-e2e split).
- [workflows/monorepo.md](workflows/monorepo.md) — Cross-package changes.
- [workflows/quality.md](workflows/quality.md) — Quality gates (Knip, jscpd, lint, coverage), **fix findings not silence them**, testing pyramid, and release.
- [workflows/agent-statistics.md](workflows/agent-statistics.md) — Per-PR AI-agent timing/counter YAML, repository test inventory, historical comparison, waste analysis, and direct Workbench publication.
- [workflows/main-build-statistics.md](workflows/main-build-statistics.md) — Post-completion Main run/job/step metrics and trusted automatic Workbench publication.

## 7. Agent duties beyond code

### Testing pyramid
* **Rust unit/integration tests** must cover ~99% of domain behavior — especially event sourcing, causal DAG sync, projection, epochs, and crypto. E2e is smoke only. See [rules.md §4](rules.md#4-testing-requirements) and [design-docs/core-beliefs.md §9](design-docs/core-beliefs.md#9-unit-tests-own-domain-correctness-e2e-is-smoke-only).
* **Line coverage threshold (90%):** `task rust:coverage:check` measures
  `nook-app-common + nook-core + nook-auth2 + nook-replication + nook-event-log` and fails below
  `nook-app/nook-core/coverage-floor.json` (90% lines). When coverage is under
  90%, add Rust tests in the same task. Above 90%, do not chase marginal
  coverage.

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
* `.agents/skills/` is the canonical open agent skills directory natively discovered by Antigravity and open agent standards. `.cursor/skills/` and `.claude/skills/` entries are executable symlinks/mirrors so Cursor, Claude, Codex, and Antigravity all share the exact same skills source. They must point back to `.cortex/dynamic-skills/` cards; do not treat the skill wrappers as the source of truth.

### Debugging and CI verification — always check app logs
* Investigation order: **GitHub Actions / test output** → **static analysis findings
  from CI** → **persisted app logs**. App logs are the most important source after
  the first two — vault session, sync, and WASM tracing do not appear in clippy or
  Playwright DOM assertions.
* When debugging Playwright/e2e, vault UI flows, or red CI, **always consult app logs**
  (`nook-app-logs.json` is attached to every Playwright result; `fetchAppLogs`
  and `/app-logs` are available during interactive browser sessions) before
  changing code.
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
  scope for the current PR, the agent must not silently drop it. First inspect
  Nook Workbench issues and worklogs, then update the existing feature/focused
  Markdown record or create the missing hierarchy and publish the task worklog.
  See [workflows/issues.md](workflows/issues.md) and
  [dynamic-skills/issue-scope-management.md](dynamic-skills/issue-scope-management.md).
