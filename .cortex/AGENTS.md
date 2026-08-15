# Nook Agent Map (Table of Contents)

## Relationships

- [Nook System Architecture Specification](ARCHITECTURE.md)
  - Defines system-wide package ownership, dependency flow, storage, and execution boundaries.
  - Read before changing a durable cross-component boundary.
- [Agent Workflow Orchestration](design-docs/agent-workflow-orchestration.md)
  - Defines the repository agent workflow and orchestration architecture.
  - Read before changing the related architecture or security boundary.
- [Auth Providers, Sync, and Login UX](design-docs/auth-providers.md)
  - Defines provider credential persistence, login UX, and provider transport boundaries.
  - Read before changing the related architecture or security boundary.
- [Core Beliefs: Agent-First Operating Principles](design-docs/core-beliefs.md)
  - Defines the Core Beliefs: Agent-First Operating Principles context used by this document.
  - Read before changing the related architecture or security boundary.
- [Hive Isolated Agent Platform](design-docs/hive-isolated-agent-platform.md)
  - Defines the isolated Hive agent platform and its execution boundaries.
  - Read before changing the related architecture or security boundary.
- [Identity, App Keys, Passkeys, and Vault DEKs](design-docs/identity-vault-architecture.md)
  - Separates identity, app-key, vault-key, onboarding, and grant responsibilities.
  - Read before changing the related architecture or security boundary.
- [Design Docs Index](design-docs/index.md)
  - Defines the Design Docs Index context used by this document.
  - Read before changing the related architecture or security boundary.
- [Unified Vault Architecture](design-docs/unified-vault.md)
  - Defines the local canonical vault and provider replication model.
  - Read before changing the related architecture or security boundary.
- [Vault Event Log](design-docs/vault-event-log.md)
  - Defines immutable vault events, ordering, concurrency, and provider synchronization.
  - Read before changing the related architecture or security boundary.
- [Vault Session, Lock, and Multi-Vault Model](design-docs/vault-session-and-lock.md)
  - Defines vault sessions, unlock, lock semantics, and multi-vault state.
  - Read before changing the related architecture or security boundary.
- [Agent Feature Ownership](dynamic-skills/agent-feature-ownership.md)
  - Defines the Agent Feature Ownership context used by this document.
  - Apply when implementation or delivery reaches this workflow boundary.
- [Code Review Comments](dynamic-skills/code-review-comments.md)
  - Defines the Code Review Comments context used by this document.
  - Apply when implementation or delivery reaches this workflow boundary.
- [Cortex Consistency — Garbage Collector](dynamic-skills/cortex-consistency.md)
  - Defines the Cortex Consistency — Garbage Collector context used by this document.
  - Apply when implementation or delivery reaches this workflow boundary.
- [Cortex Writer — Low Cognitive Complexity](dynamic-skills/cortex-writer.md)
  - Defines the Cortex Writer — Low Cognitive Complexity context used by this document.
  - Apply when implementation or delivery reaches this workflow boundary.
- [GitHub-Hosted Execution and Validation](dynamic-skills/github-actions-only-validation.md)
  - Defines the boundary between local formatting and hosted validation.
  - Apply when implementation or delivery reaches this workflow boundary.
- [Project Skill Registry](dynamic-skills/index.md)
  - Defines the Project Skill Registry context used by this document.
  - Apply when implementation or delivery reaches this workflow boundary.
- [Workbench Scope Management](dynamic-skills/issue-scope-management.md)
  - Defines the Workbench Scope Management context used by this document.
  - Apply when implementation or delivery reaches this workflow boundary.
- [Pre-Push Hygiene](dynamic-skills/pre-push-hygiene.md)
  - Defines formatting and UI-demo checks required before every push.
  - Apply when implementation or delivery reaches this workflow boundary.
- [Prefer Popular Libraries](dynamic-skills/prefer-popular-libraries.md)
  - Defines the Prefer Popular Libraries context used by this document.
  - Apply when implementation or delivery reaches this workflow boundary.
- [Rust Coding](dynamic-skills/rust-coding.md)
  - Defines the Rust Coding context used by this document.
  - Apply when implementation or delivery reaches this workflow boundary.
- [Rust Macro Minimization](dynamic-skills/rust-macro-minimization.md)
  - Defines the Rust Macro Minimization context used by this document.
  - Apply when implementation or delivery reaches this workflow boundary.
- [Rust-TypeScript Code Separation](dynamic-skills/rust-typescript-code-separation.md)
  - Defines the Rust-TypeScript Code Separation context used by this document.
  - Apply when implementation or delivery reaches this workflow boundary.
- [Rust WASM Name Coherence](dynamic-skills/rust-wasm-name-coherence.md)
  - Defines the Rust WASM Name Coherence context used by this document.
  - Apply when implementation or delivery reaches this workflow boundary.
- [Critical Source File Size and Architectural Decomposition](dynamic-skills/source-file-size.md)
  - Defines the Critical Source File Size and Architectural Decomposition context used by this document.
  - Apply when implementation or delivery reaches this workflow boundary.
- [TypeScript Explicit State](dynamic-skills/typescript-explicit-state.md)
  - Defines the TypeScript Explicit State context used by this document.
  - Apply when implementation or delivery reaches this workflow boundary.
- [TypeScript Named Call Arguments](dynamic-skills/typescript-named-args.md)
  - Defines the TypeScript Named Call Arguments context used by this document.
  - Apply when implementation or delivery reaches this workflow boundary.
- [TypeScript Concrete Values](dynamic-skills/typescript-no-unknown.md)
  - Defines the TypeScript Concrete Values context used by this document.
  - Apply when implementation or delivery reaches this workflow boundary.
- [TypeScript Single Parameter](dynamic-skills/typescript-single-parameter.md)
  - Defines the TypeScript Single Parameter context used by this document.
  - Apply when implementation or delivery reaches this workflow boundary.
- [UI Design Skill](dynamic-skills/ui-design-skills.md)
  - Defines the UI Design Skill context used by this document.
  - Apply when implementation or delivery reaches this workflow boundary.
- [Completed Plan: Cortex Restructure & Docker Toolchain Upgrades](exec-plans/completed/cortex-restructure.md)
  - Defines the Completed Plan: Cortex Restructure & Docker Toolchain Upgrades context used by this document.
  - Read when broader repository context is required.
- [Technical Debt Tracker](exec-plans/tech-debt-tracker.md)
  - Defines the Technical Debt Tracker context used by this document.
  - Read when broader repository context is required.
- [Remaining TypeScript domain → Rust](exec-plans/ts-domain-to-rust-remaining.md)
  - Defines the Remaining TypeScript domain → Rust context used by this document.
  - Read when broader repository context is required.
- [Unified Vault — UI Rollout Plan](exec-plans/unified-vault-ui-rollout.md)
  - Defines the Unified Vault — UI Rollout Plan context used by this document.
  - Read when broader repository context is required.
- [Product Specifications Index](product-specs/index.md)
  - Catalogs the product specifications and their current status.
  - Read when this document touches the related product behavior or user flow.
- [Product Spec: Monorepo & Toolchain Setup](product-specs/monorepo-setup.md)
  - Defines the Product Spec: Monorepo & Toolchain Setup context used by this document.
  - Read when this document touches the related product behavior or user flow.
- [Nook Password Manager Specification](product-specs/password-manager.md)
  - Defines the core vault product, user flows, storage formats, cryptography, and UI boundaries.
  - Read when this document touches the related product behavior or user flow.
- [Playwright MCP Annotation Pilot](references/ai-debugging.md)
  - Defines the Playwright MCP Annotation Pilot context used by this document.
  - Consult when the task needs this operational reference.
- [Reference: Svelte + Vite + Bun](references/bun-svelte.md)
  - Defines the Reference: Svelte + Vite + Bun context used by this document.
  - Consult when the task needs this operational reference.
- [Cloudflare Operations](references/cloudflare-operations.md)
  - Defines the Cloudflare Operations context used by this document.
  - Consult when the task needs this operational reference.
- [Reference: Application Logging](references/logging.md)
  - Defines application, test, and CI logging and troubleshooting evidence.
  - Consult when the task needs this operational reference.
- [Reference: Loom tools and static agent workflows](references/loom-tools.md)
  - Defines the Reference: Loom tools and static agent workflows context used by this document.
  - Consult when the task needs this operational reference.
- [Reference: Rust + WebAssembly (wasm-bindgen)](references/rust-wasm.md)
  - Defines the Reference: Rust + WebAssembly (wasm-bindgen) context used by this document.
  - Consult when the task needs this operational reference.
- [Nook Coding Rules & Golden Principles](rules.md)
  - Defines the repository-wide implementation, testing, tooling, and delivery constraints.
  - Apply throughout implementation and review.
- [AI Agent PR Statistics](workflows/agent-statistics.md)
  - Defines the post-merge agent statistics record and publication workflow.
  - Apply when implementation or delivery reaches this workflow boundary.
- [CI / GitHub Actions Pipeline](workflows/ci-pipeline.md)
  - Defines CI entry points, validation ownership, and hosted execution behavior.
  - Apply when implementation or delivery reaches this workflow boundary.
- [Review Request Workflow](workflows/code-review.md)
  - Defines the Review Request Workflow context used by this document.
  - Apply when implementation or delivery reaches this workflow boundary.
- [Coding Bro — Default Agent Workflow](workflows/coding-bro.md)
  - Defines the default end-to-end implementation and delivery workflow.
  - Apply when implementation or delivery reaches this workflow boundary.
- [Dynamic Skills Workflow](workflows/dynamic-skills.md)
  - Defines the Dynamic Skills Workflow context used by this document.
  - Apply when implementation or delivery reaches this workflow boundary.
- [Workbench Issue Management](workflows/issues.md)
  - Defines focused issue ownership and durable Workbench scope records.
  - Apply when implementation or delivery reaches this workflow boundary.
- [Main Build Statistics](workflows/main-build-statistics.md)
  - Defines the Main Build Statistics context used by this document.
  - Apply when implementation or delivery reaches this workflow boundary.
- [Cross-Package Changes](workflows/monorepo.md)
  - Defines the Cross-Package Changes context used by this document.
  - Apply when implementation or delivery reaches this workflow boundary.
- [Pull Request Workflow](workflows/pull-requests.md)
  - Defines pull-request size, validation, readiness, review, and merge requirements.
  - Apply when implementation or delivery reaches this workflow boundary.
- [Quality and Release](workflows/quality.md)
  - Defines quality gates and the required response to check findings.
  - Apply when implementation or delivery reaches this workflow boundary.
- [GitHub-Hosted Remote Execution](workflows/remote-execution.md)
  - Defines GitHub-hosted focused validation and remote execution.
  - Apply when implementation or delivery reaches this workflow boundary.
- [Subagent Delegation](workflows/subagent-delegation.md)
  - Defines the Subagent Delegation context used by this document.
  - Apply when implementation or delivery reaches this workflow boundary.

## Document map

- [Overview](#overview)
  - Establishes this document as the repository agent entry point.
  - Read before every repository task.
- [⛔ P1 — most critical `.cortex` writing rule: keep cognitive complexity low](#-p1--most-critical-cortex-writing-rule-keep-cognitive-complexity-low)
  - Requires short, low-complexity prose in every `.cortex` document.
  - Apply whenever `.cortex` Markdown changes.
- [⛔ P1 — most critical `.cortex` integrity rule: keep docs consistent](#-p1--most-critical-cortex-integrity-rule-keep-docs-consistent)
  - Requires `.cortex`, code, and related guidance to remain consistent.
  - Apply to durable architecture, product, and workflow changes.
- [⛔ Non-negotiable: plan small, module-focused pull requests](#-non-negotiable-plan-small-module-focused-pull-requests)
  - Caps authored pull-request changes at 5,000 lines.
  - Read before planning or expanding implementation scope.
- [⛔ P1 — most critical code-structure rule: oversized source is prohibited](#-p1--most-critical-code-structure-rule-oversized-source-is-prohibited)
  - Caps every authored source file at 1,000 lines.
  - Read before adding to a large file or planning its decomposition.
- [⛔ Non-negotiable: load Nook's design skill for every UI task](#-non-negotiable-load-nooks-design-skill-for-every-ui-task)
  - Requires Nook's frontend design skill for user-visible UI work.
  - Read before designing, implementing, or reviewing UI.
- [⛔ Non-negotiable: AI-debug mode exists to fix bugs](#-non-negotiable-ai-debug-mode-exists-to-fix-bugs)
  - Defines AI-debug annotations as requests for verified fixes.
  - Apply whenever AI-debug mode reports a defect.
- [⛔ Non-negotiable: every bug fix needs regression coverage](#-non-negotiable-every-bug-fix-needs-regression-coverage)
  - Requires behavior-focused regression coverage for every bug fix.
  - Apply before completing any defect correction.
- [⛔ Non-negotiable: never clear Bake cache-from or cache-to](#-non-negotiable-never-clear-bake-cache-from-or-cache-to)
  - Protects configured BuildKit cache imports and exports.
  - Read before changing Docker Bake or CI cache settings.
- [⛔ Non-negotiable: Rust domain absence must be explicit](#-non-negotiable-rust-domain-absence-must-be-explicit)
  - Requires explicit domain meaning for Rust absence states.
  - Read before adding or preserving `Option<T>`.
- [⛔ Non-negotiable: authored JavaScript/TypeScript state must be explicit](#-non-negotiable-authored-javascripttypescript-state-must-be-explicit)
  - Defines explicit state and API rules for JavaScript, TypeScript, and Svelte.
  - Read before authoring web state, parameters, or object arguments.
- [⛔ Non-negotiable: prefer popular libraries over boilerplate](#-non-negotiable-prefer-popular-libraries-over-boilerplate)
  - Requires mature dependencies before commodity helper code.
  - Read before implementing parsers, diffs, transport glue, or utilities.
- [⛔ Non-negotiable: authored Rust macros are prohibited](#-non-negotiable-authored-rust-macros-are-prohibited)
  - Forbids repository-defined declarative and procedural Rust macros.
  - Read before generating or abstracting Rust code.
- [⛔ Non-negotiable: squash merge every PR](#-non-negotiable-squash-merge-every-pr)
  - Requires every pull request to land as one squash commit.
  - Apply at merge time.
- [⛔ Non-negotiable: agents mutate only their owned feature](#-non-negotiable-agents-mutate-only-their-owned-feature)
  - Restricts mutations to the agent's owned feature and issue set.
  - Read before touching shared branches, records, reviews, or PR state.
- [⛔ Non-negotiable: delegate independent semantic work](#-non-negotiable-delegate-independent-semantic-work)
  - Requires independent semantic work to use child workers when available.
  - Read when a task contains parallel, bounded work units.
- [⛔ Non-negotiable: implementation agents land their PRs](#-non-negotiable-implementation-agents-land-their-prs)
  - Makes the implementation owner responsible for delivery through merge.
  - Read before implementing, validating, or handing off a pull request.
- [⛔ Non-negotiable: never kill the Docker daemon](#-non-negotiable-never-kill-the-docker-daemon)
  - Protects shared Docker work by prohibiting daemon termination.
  - Read before diagnosing Docker failures or cleaning resources.
- [⛔ Non-negotiable: request Codex review without delaying validation](#-non-negotiable-request-codex-review-without-delaying-validation)
  - Sequences advisory and exact-head review without blocking validation.
  - Read before the first push and while monitoring a pull request.
- [⛔ Non-negotiable: format on the host before every push](#-non-negotiable-format-on-the-host-before-every-push)
  - Requires host-side formatting and UI-demo checks before every push.
  - Apply before committing any pushable revision.
- [Loom — mechanical cortex rites](#loom--mechanical-cortex-rites)
  - Defines Loom's mechanical Cortex, review, and landing procedures.
  - Read before invoking or changing Loom agent rites.
- [⛔ Non-negotiable: heavy agent work runs remotely](#-non-negotiable-heavy-agent-work-runs-remotely)
  - Routes builds, tests, and other heavy validation to hosted workers.
  - Read before choosing local or remote validation.
- [⛔ Non-negotiable: fix every failing check finding](#-non-negotiable-fix-every-failing-check-finding)
  - Requires every reported quality or CI defect to be resolved.
  - Apply after any check reports a finding.
- [⛔ Non-negotiable: preserve work context in Nook Workbench](#-non-negotiable-preserve-work-context-in-nook-workbench)
  - Assigns issues, plans, worklogs, and statistics to Nook Workbench.
  - Read before publishing or updating delivery context.
- [⛔ Non-negotiable: record and analyze AI-agent PR statistics](#-non-negotiable-record-and-analyze-ai-agent-pr-statistics)
  - Requires a reproducible delivery-statistics record for each normal PR.
  - Read when tracking validation runs, merge attempts, and elapsed time.
- [1. Rules & Architectural Layout](#1-rules--architectural-layout)
  - Routes agents to repository-wide rules and architecture.
  - Read when a task crosses packages or changes durable boundaries.
- [2. Design Specs & Beliefs (design-docs/)](#2-design-specs--beliefs-design-docs)
  - Routes agents to design decisions, beliefs, and status.
  - Read before changing architecture or implementation ownership.
- [3. Product Specifications (product-specs/)](#3-product-specifications-product-specs)
  - Routes agents to user-facing behavior and product constraints.
  - Read before changing a product flow or requirement.
- [4. Execution Plans (exec-plans/)](#4-execution-plans-exec-plans)
  - Routes agents to active execution and debt plans.
  - Read when sequencing planned or deferred implementation work.
- [5. Technology Cheat Sheets (references/)](#5-technology-cheat-sheets-references)
  - Routes agents to technology-specific conventions.
  - Read before working across Rust, WASM, Svelte, or testing boundaries.
- [6. Workflows (workflows/)](#6-workflows-workflows)
  - Routes agents to implementation, validation, review, and issue workflows.
  - Read before starting or delivering repository work.
- [7. Agent duties beyond code](#7-agent-duties-beyond-code)
  - Collects testing, documentation, debugging, and follow-up duties.
  - Read before declaring a task complete.
  - [Testing pyramid](#testing-pyramid)
    - Defines the required domain, web, and end-to-end testing layers.
    - Read when selecting or reviewing test coverage.
  - [Grow `.cortex` dynamically](#grow-cortex-dynamically)
    - Requires durable discoveries to update `.cortex` in the same PR.
    - Apply when work reveals reusable project knowledge.
  - [Keep the root README current](#keep-the-root-readme-current)
    - Keeps public architecture and command guidance synchronized.
    - Read when changing structure, workflows, or developer commands.
  - [Project skills](#project-skills)
    - Defines discovery and maintenance of repository-specific skills.
    - Read when a task matches or creates a durable skill.
  - [Debugging and CI verification — always check app logs](#debugging-and-ci-verification--always-check-app-logs)
    - Defines the evidence order for debugging and CI investigation.
    - Read when diagnosing a failed check or runtime defect.
  - [PR review comments](#pr-review-comments)
    - Requires every active review finding to be fixed or explained.
    - Read when a pull request has human or automated feedback.
  - [Deferred or out-of-scope functionality](#deferred-or-out-of-scope-functionality)
    - Preserves blocked, deferred, and oversized work in Workbench.
    - Read before excluding required work from the current slice.

## Overview

This is the system of record and entry point for all AI agents working in this repository. Follow the links below for deep context on Nook's architecture, design, and standards.

## ⛔ P1 — most critical `.cortex` writing rule: keep cognitive complexity low

Every new or edited `.cortex` Markdown file must use simple sentence structure.

Do not pack many facts into one long sentence or table cell.

Split complex ideas into:

- short sentences;
- bullet points;
- lists.

One sentence should carry one idea.

Actors, credentials, commands, and failure modes belong in separate bullets or
sentences.

Dense multi-clause prose is a P1 documentation finding.

Full contract:
[dynamic-skills/cortex-writer.md](dynamic-skills/cortex-writer.md).

## ⛔ P1 — most critical `.cortex` integrity rule: keep docs consistent

`.cortex` is not write-only.

Agents must garbage-collect obsolete cortex facts in the same task.

Verify the docs that own the touched topic.

Those docs must:

- stay current;
- agree with each other;
- agree with the current code and Task entrypoints.

Stale claims, cross-doc conflicts, and code mismatches are P1 documentation
findings.

Fix them in the same PR.

Label historical context as historical.

Do not leave conflicting guidance as if it were active policy.

Full contract:
[dynamic-skills/cortex-consistency.md](dynamic-skills/cortex-consistency.md).

## ⛔ Non-negotiable: plan small, module-focused pull requests

An implementation pull request must target no more than **5,000 authored
changed lines**.

Agents must estimate the change before implementation.

If the complete feature is larger, split it into an ordered series of pull
requests before editing.

Each pull request must:

- own one cohesive module, package, layer, or architectural responsibility;
- remain independently testable and mergeable;
- expose narrow interfaces to later slices;
- avoid unrelated cleanup and cross-module churn.

The agent still owns the complete requested feature.

It must land the first slice, start the next slice from current `origin/main`,
and continue until every planned Workbench issue is complete.

Do not use the limit for mechanical file splitting or incomplete handoffs.

Full contract:
[workflows/pull-requests.md](workflows/pull-requests.md#pull-request-size-and-modularity).

## ⛔ P1 — most critical code-structure rule: oversized source is prohibited

Every authored source file, including Rust, MUST stay at or below **1,000 lines**.

Crossing this uniform hard limit is a failed repository invariant and a P1 architecture finding.

A Rust module that needs more than 1,000 lines signals an overcomplicated domain model or too many production responsibilities.

The model must be decomposed rather than accommodated by a larger language-specific allowance.

For Rust:

- Moving `#[cfg(test)]` code or unit tests into another file is **not** an acceptable fix.
- Separate Rust unit-test files under `src` are prohibited.
- Unit tests MUST be colocated with the focused implementation module they test.
- Rust integration tests under a crate's `tests/` directory remain valid.
- An oversized production module proves that its production responsibilities need review.

Split guidance:

- Split along a real domain, capability, ownership, lifecycle, or dependency boundary.
- Keep each resulting module cohesive.
- Expose narrow interfaces.
- Colocate each abstraction's unit tests in that module.

Mechanical line-count splitting is forbidden.

Never cut a file in half or create meaningless `part1`, `part2`, `continued`, or similarly numbered modules.

The refactor must improve the architecture, not merely satisfy the counter.

Moving unit tests to a separate file to satisfy the counter is itself a failing invariant.

Full critical contract: [dynamic-skills/source-file-size.md](dynamic-skills/source-file-size.md).

## ⛔ Non-negotiable: load Nook's design skill for every UI task

Before designing, implementing, or reviewing any user-visible website or browser
extension UI, agents MUST read and use:

- [`design-taste-frontend`](../.agents/skills/design-taste-frontend/SKILL.md)

Impeccable is not part of Nook's default UI workflow. Do not install it, load
its skill, run its context/playbook/detector commands, enable its hooks, or
delegate its review workflow unless the user explicitly asks to use
Impeccable. An already installed generated copy may remain in the workspace;
its presence does not make it active.

This applies to new screens, redesigns, component and style changes, responsive
behavior, interaction states, and visual polish.

The design skill is not permission to replace Nook's stack or architecture.
Nook remains Svelte-based, and this `.cortex` guidance remains authoritative
for typed Rust/WASM boundaries, translations, accessibility, established
components and tokens, tests, and dependency choices.

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

## ⛔ Non-negotiable: never clear Bake `cache-from` or `cache-to`

Empty Bake `cache-from=` and `cache-to=` overrides are prohibited.

Clearing `cache-from` after a remote hit forces cold rebuilds from apt upward.

Clearing `cache-to` to stop a linked parent from writing is the wrong fix.

Use scoped architecture instead:

- product dependency and source stages share one Dockerfile lineage;
- linked context parents declare no `cache-from` or `cache-to`;
- dedicated `*-restore` targets read standalone dependency scopes;
- dedicated `*-publish` targets write `mode=max` refs;
- Main writes `nook/buildcache/<scope>`;
- PR/Remote/local writes use
  `nook/remote-buildcache/<scope>-git-<40-char-sha>`;
- local formatting writes only unique, source-free dependency candidates;
- a Main-defined hosted workflow downloads every candidate blob twice;
- only that workflow assigns a PR-visible content-fingerprint tag;
- dirty cache recipes disable local publication.

If a short parent index orphans a leaf RUN, redesign the Bake graph.

Do not wipe cache to hide a graph mistake.

Full policy: [workflows/quality.md](workflows/quality.md) § BuildKit cache (Zot).

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

Exported Rust WASM functions and methods keep their authored Rust names in the
generated JavaScript API. Do not use callable `wasm_bindgen(js_name = ...)`
renames. TypeScript, JavaScript, and Svelte must import and call generated WASM
functions by that same authored name. Do not restore a second name with an
import or re-export alias. This includes imports through local facade modules.
Direct Rust-to-TypeScript navigation is more important than TypeScript naming
conventions. Property accessors, generated types, and imported JavaScript APIs
are outside this callable-name rule. The syntax-aware preflight enforces it. See
[dynamic-skills/rust-wasm-name-coherence.md](dynamic-skills/rust-wasm-name-coherence.md).

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
discriminant list is not an escape hatch. A runtime enum a Svelte component
uses must live in a cohesive adjacent TypeScript module and be imported, never
declared inside that component's `<script>`: the script preprocessor transpiles
the script in isolation, inlines its member reads, and drops the enum object,
so template references to it throw at runtime while every static check stays
green. Keep the enum beside the union it discriminates within that module.

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

## ⛔ Non-negotiable: prefer popular libraries over boilerplate

Before writing commodity helpers (diffs, parsers, HTTP glue, small utilities),
search for a mature library with clear adoption. Prefer high weekly npm
downloads or crates.io downloads, and substantial GitHub stars when a GitHub
repo is available. Avoid obscure packages with near-zero downloads or tiny
star counts unless the user explicitly requires that package. Domain policy,
cryptography, auth, and vault rules stay in Nook-owned code. Validate
candidates with Loom `dependencyPopularity`
(`task loom:dependency-popularity`). Full contract:
[dynamic-skills/prefer-popular-libraries.md](dynamic-skills/prefer-popular-libraries.md).

Authored Rust must not call `.unwrap()` or `.expect(...)`. Production paths
propagate or classify failure. Rust tests that perform fallible setup or
verification return `Result<(), E>` and propagate with `?`; panic-based setup
and verification are forbidden even for locally constructed fixtures. Do not
erase test errors behind
`Box<dyn std::error::Error>`: use the concrete crate error when one error family
is involved, or `anyhow::Result` when a test composes unrelated fallible APIs.
Workspace Clippy configuration denies both `expect_used` and `unwrap_used`
across all targets. Each Rust workspace `clippy.toml` sets
`allow-expect-in-tests = false` and `allow-unwrap-in-tests = false`, so tests
must use `Result` + `?` as well. Preflight only contracts that those Clippy
settings remain configured; it does not re-scan for `.expect` calls.

Production Rust must not depend on, import, return, or invoke `anyhow`.
Libraries, binaries, examples, and build scripts expose concrete error enums
whose variants identify the failed operation and preserve typed sources.
`anyhow` is permitted only in `#[cfg(test)]` unit-test code and integration
tests under `tests/`, and it belongs in `[dev-dependencies]`. Repository
preflight parses authored Rust and Cargo manifests to enforce that boundary.
Authored `JsValue` paths, repository-defined macros, and untyped JSON
assertions in known-contract tests stay in preflight because Clippy
`disallowed_types` cannot distinguish wasm-bindgen-generated ABI code and the
macro/JSON rules need whole-repository source AST walks.

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

## ⛔ Non-negotiable: agents mutate only their owned feature

Every agent must stay inside its assigned feature and focused issue set.

Another active agent's work is read-only.

Without an explicit handoff, an agent must not:

- edit or push to another task's branch;
- change another task's Workbench records;
- reply to or resolve another task's review threads;
- change another task's PR labels, checks, open state, or merge state;
- close, reopen, or merge another task's pull request.

Related subject matter is not ownership.

Before every remote mutation, verify that the target belongs to the current
task's feature and issue set.

If ownership is missing or ambiguous, stop mutating that target. Report the
overlap and wait for an explicit user, owner, or orchestrator handoff.

Full policy:
[dynamic-skills/agent-feature-ownership.md](dynamic-skills/agent-feature-ownership.md).

## ⛔ Non-negotiable: delegate independent semantic work

A capable agent environment MUST use child workers when a task contains at
least two bounded semantic work units that can run independently.

Each work unit must have:

- the same immutable baseline;
- a read-only or disjoint write scope;
- explicit inputs and outputs;
- independent acceptance evidence;
- a parent-owned join.

Simple deterministic steps belong in Loom, Task, or another tool.

They do not need an AI worker.

One delivery owner retains Workbench, branch, PR, review, validation, and merge
authority.

Child workers return evidence or isolated patches.

They do not mutate shared lifecycle state.

Repeated agent workflows use reviewed static TypeScript graphs in Loom.

Workflow topology must not come from YAML, prompts, or Markdown parsing.

The first catalog entry is the read-only
`cortex-full-garbage-collection` workflow.

Full policy:
[workflows/subagent-delegation.md](workflows/subagent-delegation.md).

## ⛔ Non-negotiable: implementation agents land their PRs

Every task-owning implementation agent with GitHub write access must:

- Create or update a PR.
- Monitor Nook's applicable repository-owned checks.
- Fix failures.
- Address and resolve actionable comments.
- Update conflicts with `origin/main`.
- Revalidate the exact head.
- Squash-merge when `task pr:ready PR=<number>` succeeds.

After every push:

- monitor review feedback while repository checks run;
- prioritize new actionable feedback over checks for a head that must change;
- let exact-head checks finish only while the actionable queue is empty.

When actionable feedback arrives:

1. Stop watching or cancel obsolete validation.
2. Fix the feedback.
3. Reply to and resolve the thread.
4. Run pre-push hygiene.
5. Push the replacement head.
6. Restart validation.

Immediately before merge, prove both conditions:

- zero unresolved threads;
- green checks for the current head.

Do not stop at a ready-PR handoff or ask for separate merge permission.

Stop without a merge only for a concrete blocker or an explicitly read-only request.

The bounded `agent-implement.yml` worker is not a continuing task owner.

Its harness owns git/push/PR creation and exits after opening the PR.

A continuing agent may accept that PR only when the workflow names it in the
PR's `## Ownership` section.

Issue-backed runs use the Workbench issue owner.

Prompt-backed runs require the `continuing_owner` dispatch input.

The owner must be a Nook GitHub collaborator with write access.

Before the worker exits, it assigns the PR to that collaborator and posts a
direct mention. That notification is the explicit handoff.

The continuing owner must carry the PR through merge.

Full policy: [workflows/coding-bro.md](workflows/coding-bro.md).

The successful squash merge is the implementation task's product delivery boundary.

Do not wait for, monitor, or verify the post-merge `main.yml` run or development deployment unless the user explicitly requested deployment/live verification or assigned a Main failure.

Publish the required Workbench issue update, worklog, and agent-statistics record immediately after merge.

Do not make Main completion a prerequisite.

## ⛔ Non-negotiable: never kill the Docker daemon

**Killing the Docker daemon is strictly prohibited.** Only individual **Docker containers** may be stopped — never Docker Desktop, `dockerd`, or the Docker VM.

- **Forbidden:** `killall Docker`, `killall docker`, `pkill docker`, `pkill -f docker`, `osascript` quit Docker, `systemctl stop docker`, or any command aimed at the daemon or Desktop app.
- **Forbidden:** `lsof -ti :<port> | xargs kill` when that port is forwarded by Docker (e.g. `:5173` for `task web:dev`) — use `docker ps` → `docker stop <container>` instead.
- **Allowed:** `docker stop <container_id>`, `docker rm`, `docker compose down` for a specific stack.

Full policy: [rules.md §5](rules.md#docker-daemon--never-kill-it).

## ⛔ Non-negotiable: request Codex review without delaying validation

Run advisory local Codex review before the first owner-authored push. The
bounded implementation harness is the exception. It commits and pushes after
the worker exits. Its continuing owner runs local review immediately after
handoff.

When a coherent head is ready for complete validation, request one idempotent
exact-head Codex Cloud review alongside that validation. The GitHub Actions
runtime is the review window. If no review feedback exists when checks finish,
continue to readiness without waiting. Use focused hosted tasks while iterating.

Before merge or handoff, inspect the comments and review findings currently
present and address every active actionable item from humans or external
services. Reply with the fix, validation, or no-change rationale and resolve
each actionable thread. Do not request or wait for other optional reviewers.
A PR is ready when the applicable repository-owned checks are green, the branch
is current and mergeable, and all feedback already present is addressed.
`task pr:ready` enforces the machine-checkable parts. Full policy:
[rules.md §6](rules.md#6-git--pull-request-workflow).

## ⛔ Non-negotiable: format on the host before every push

**Always run pre-push hygiene before every commit that will be pushed.**

Formatting is cheap. A failed Prettier/rustfmt Verify cycle is not.

Mechanical entrypoint:

```bash
task loom:pre-push
```

Loom runs host-applied `task format`, the UI demo contract vs `origin/main`,
and `git add -u`.

Never use `task extension:format` as the only format step before push.

Only after that commit → push.

Use `task remote` only when a focused gate gives faster diagnostic feedback.

Do not run focused tasks as a prerequisite for complete validation.

Prefer complete validation when its parallel jobs are faster than a sequential
focused batch.

Use `task pr:validate` for complete exact-head validation.

Do **not** run `task check`, `task ci:pr`, full suites, builds, or e2e on the
agent machine.

Full policy: [dynamic-skills/pre-push-hygiene.md](dynamic-skills/pre-push-hygiene.md)
and [workflows/remote-execution.md](workflows/remote-execution.md).

## Loom — mechanical cortex rites

[`agentic-ai/loom`](../agentic-ai/loom/README.md) runs mechanical agent
procedures through a strict YAML tool protocol.

Loom and migrated Nook web TypeScript functions and methods take at most one
parameter. Multi-value inputs use a typed object argument. Nook web expands
the shared ESLint scope one migrated package slice at a time. Full contract:
[dynamic-skills/typescript-single-parameter.md](dynamic-skills/typescript-single-parameter.md).

Loom and migrated Nook web TypeScript must not author the `unknown` or `object`
type. New or changed domain and application APIs must not use generic value
bags. The `object` type has no exception. An unavoidable untyped transport may
use `unknown` only inside a dedicated adapter that narrows immediately.
Existing generic APIs are staged migration debt. They are not compliant
examples or exceptions. Do not expand or copy them. ESLint mechanically bans
`object` everywhere and `unknown` outside allowlisted transport adapters.
Review enforces generic-value containment until the existing debt is migrated.
Full contract:
[dynamic-skills/typescript-no-unknown.md](dynamic-skills/typescript-no-unknown.md).

Loom and all authored Nook web production TypeScript must not declare inline
object-shaped parameter types or pass raw object literals into calls.
Object-shaped includes
object literals, mapped types such as `Pick<T, K>` and `Omit<T, K>`, arrays,
tuples, `Array<T>`, `ReadonlyArray<T>`, maps, sets, and records. Parameters use
a named semantic `type`, `interface`, or Rust-generated boundary type. Generic
and operation-only names such as
`Args`, `CallbackArgs`, `PutArgs`, and line-number-derived names are
prohibited. Imported generic contract names are also prohibited. A
function-valued parameter may return an inline object type. That return value
is not the parameter contract.
Callers assign a named typed argument value first. Loom uses ESLint
`loom/no-raw-object-arguments`. Nook web uses
`nook-typed-api/no-raw-object-arguments`. Full contract:
[dynamic-skills/typescript-named-args.md](dynamic-skills/typescript-named-args.md).

Nook browser-extension TypeScript owns browser observation and lifecycle glue.
Portable classification, validation, policy, and workflow decisions belong in
Rust. Size-sensitive content-script policy uses `nook-companion-core` through
`nook-companion-wasm`. Shared authenticator numbers, modes, and closed
vocabularies belong in `nook-authenticator-domain`. Both `nook-core` and
`nook-companion-core` consume that leaf crate. Full contract:
[dynamic-skills/rust-typescript-code-separation.md](dynamic-skills/rust-typescript-code-separation.md).

Bun must be installed. Stop and ask for Bun if `bun --version` fails.

Single invoke form:

```bash
task loom:run CONFIG=<request.yaml>
```

Domain request example:

```yaml
prePush:
  stageHostUpdates: true
  fetchOriginMain: true
```

Stdout is YAML. On errors, read `errors[].path`, then run `task loom:tools-list`.

Protocol reference: [references/loom-tools.md](references/loom-tools.md).

Preferred Task aliases:

| Command | Role |
|---|---|
| `task loom:pre-push` | Default pre-push request |
| `task loom:tools-list` | Discover tools and schemas |
| `task loom:verify` | Prettier check + ESLint + `tsc` + unit tests |
| `task loom:cortex-audit` | Default cortex-audit request |
| `task loom:skill-scaffold CONFIG=…` | Skill card request YAML |
| `task loom:agent-stats CONFIG=…` | Stats assemble/validate/publish request |
| `task loom:pr-land CONFIG=…` | PR land request YAML |
| `task loom:agent-workflow:cortex-audit BASELINE=…` | Compiled read-only Cortex full-GC workflow |

Policy and judgment stay in `.cortex`.

Loom runs deterministic leaf tools.

Loom also owns the isolated static agent-workflow module.

That module contains reviewed TypeScript graph definitions.

Its separate CLI selects a compiled workflow.

It never accepts or generates graph topology from YAML, prompts, or Markdown.

First static workflow:

```bash
task loom:agent-workflow:cortex-audit BASELINE=<40-character-commit-sha>
```

Local workflow runs use an append-only journal.

The current implementation runs locally.

Future Hive-backed runs will use Neo4j as their durable lifecycle authority.

See
[agent-workflow-orchestration.md](design-docs/agent-workflow-orchestration.md).

## ⛔ Non-negotiable: heavy agent work runs remotely

**The only required local product action is `task loom:pre-push`.**

It host-applies formatting and checks the UI demo contract when UI paths change.

Advisory local Codex review is part of delivery, but it is not a product gate.

Every product check runs on **GitHub Actions**, not on the agent machine.

Product checks include lint, clippy, unit tests, coverage, web build, Knip, jscpd, e2e, and the full PR mirror.

The normal loop:

1. Pre-push hygiene
2. Commit
3. Advisory `task pr:review-local` before the first owner-authored push
4. Push
5. Optional focused `task remote` runs for isolated diagnostics
6. Explicit `task pr:validate` when the head is ready for the final gate

For a harness-created PR, the continuing owner runs local review after handoff.

Ordinary PR pushes do not start the full PR workflow.

A later push makes prior checks stale.

The agent must explicitly validate the new exact head before readiness can succeed.

Heavy focused debugging runs through the allowlisted remote task catalog.

Do not batch broad gates sequentially when complete PR validation runs them in
parallel with a shorter critical path.

Permitted local execution is limited to:

- formatting;
- the UI demo contract;
- advisory local Codex review;
- repository inspection; and
- interactive development that requires a persistent local server or browser.

On a red remote run:

1. Read the failed logs (and app logs for web/e2e)
2. Fix
3. `task loom:pre-push`
4. Commit
5. Run local review when this is the first owner-authored push
6. Push
7. Dispatch focused remote work, or repeat complete validation when replacing a
   failed complete-gate head

Full policy: [workflows/remote-execution.md](workflows/remote-execution.md) and [dynamic-skills/github-actions-only-validation.md](dynamic-skills/github-actions-only-validation.md).

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
decisions, validation, and remaining work. A Workbench issue may trigger the
scheduled implementation worker only when it has `status: ready`, `automation:
agent`, and an assignable Nook GitHub collaborator as its owner. Full policy:
[workflows/issues.md](workflows/issues.md).

## ⛔ Non-negotiable: record and analyze AI-agent PR statistics

Task-owning AI agents must measure every normal PR's lightweight local runs,
focused/complete GitHub Actions runs and retriggers, merge attempts, elapsed
time, and the repository test inventory on the merged head.

After merge, assemble and publish `stats/ai-agent/<pr-number>.yaml` with Loom.

Write a request YAML, then run it:

```yaml
agentStats:
  assemble:
    prNumber: 123
    scratchPath: /tmp/pr-123-events.json
    outputPath: /tmp/123.yaml
    includeTestInventory: true
```

```bash
task loom:agent-stats CONFIG=/tmp/assemble-request.yaml
# then an agentStats.publish request with statsFile: /tmp/123.yaml
task loom:agent-stats CONFIG=/tmp/publish-request.yaml
```

See [references/loom-tools.md](references/loom-tools.md).

Compare with one or two recent comparable records.

Assess build/workflow waste in the scratch log before assemble.

Publish directly to Workbench `main`.

Do not create a bookkeeping branch or PR in Nook.

Fix actionable waste in a separate normal build-performance PR.

Full policy: [workflows/agent-statistics.md](workflows/agent-statistics.md).

## 1. Rules & Architectural Layout
* [ARCHITECTURE.md](ARCHITECTURE.md) — Top-level package layout, dependencies, command surface, and quality gates.
* [rules.md](rules.md) — Golden Principles and hard coding/tooling constraints (**§6: squash merge every PR**).

## 2. Design Specs & Beliefs (`design-docs/`)
* [design-docs/index.md](design-docs/index.md) — Index of design specifications and status.
* [design-docs/core-beliefs.md](design-docs/core-beliefs.md) — Agent-first operating beliefs.
* [design-docs/hive-isolated-agent-platform.md](design-docs/hive-isolated-agent-platform.md) — **Stateful isolated AI-agent platform**: trusted Codex operators, k0s/Kata topology, Neo4j task DAG, direct scoped credentials, disposable workers, complete Main-repair delivery, caching, and Taskfile operations.
* [design-docs/identity-vault-architecture.md](design-docs/identity-vault-architecture.md) — **Identity and vault separation**: multiple virtual identities per person, physical-device versus device-key boundaries, synced versus device-bound passkeys, identity provider mounts, encrypted DEK grants, and independent vault event logs.
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

- [workflows/coding-bro.md](workflows/coding-bro.md) — **Default PR-first agent workflow** (fetch → branch + prepare PR → implement → **always `task loom:pre-push`** → commit/push → Loom/Task validate → optional focused diagnosis → fix loop → readiness audit → automatic agent-owned squash merge).
- [workflows/subagent-delegation.md](workflows/subagent-delegation.md) — **Mandatory bounded delegation rule**, child-worker contract, safe fan-out patterns, and parent-owned integration.
- [`.cursor/skills/coding-bro/SKILL.md`](../.cursor/skills/coding-bro/SKILL.md) — Cursor skill mirror of coding-bro (auto-invoked).
- [`agentic-ai/loom/README.md`](../agentic-ai/loom/README.md) — **Loom**: YAML tool protocol for mechanical cortex rites.
- [references/loom-tools.md](references/loom-tools.md) — Loom request/response contracts and examples.
- [workflows/code-review.md](workflows/code-review.md) — Non-blocking external-review policy and rules for handling feedback that already exists.
- [workflows/dynamic-skills.md](workflows/dynamic-skills.md) — Canonical project skill registry workflow. All durable repo-specific agent skills live as `.cortex/dynamic-skills/` cards; optional Cursor project skills only mirror them for invocation.
- [dynamic-skills/cortex-writer.md](dynamic-skills/cortex-writer.md) — **P1 `.cortex` writing rule:** short sentences, bullets, and lists over dense multi-clause prose.
- [dynamic-skills/cortex-consistency.md](dynamic-skills/cortex-consistency.md) — **P1 `.cortex` GC rule:** docs must stay current, mutually consistent, and aligned with code.
- [dynamic-skills/pre-push-hygiene.md](dynamic-skills/pre-push-hygiene.md) — **Always host-apply `task format` + UI demo contract before push** (prevents Prettier/rustfmt/demo-contract Verify burns).
- [dynamic-skills/github-actions-only-validation.md](dynamic-skills/github-actions-only-validation.md) — **Format locally; run focused tasks and complete gates explicitly on GitHub-hosted workers**.
- [dynamic-skills/ui-design-skills.md](dynamic-skills/ui-design-skills.md) — **Load `design-taste-frontend` for user-visible UI work; Impeccable is explicit opt-in only**.
- [dynamic-skills/prefer-popular-libraries.md](dynamic-skills/prefer-popular-libraries.md) — **Prefer mature high-adoption libraries over hand-rolled boilerplate; reject obscure deps**.
- [dynamic-skills/typescript-single-parameter.md](dynamic-skills/typescript-single-parameter.md) — **Loom and migrated Nook web: max one function parameter**.
- [dynamic-skills/typescript-no-unknown.md](dynamic-skills/typescript-no-unknown.md) — **Loom and migrated Nook web: require domain values; generic transport values are boundary-only exceptions**.
- [dynamic-skills/typescript-named-args.md](dynamic-skills/typescript-named-args.md) —
  **Loom and all Nook web production TypeScript/Svelte: require named semantic
  object parameter contracts and name object call arguments**.
- [workflows/pull-requests.md](workflows/pull-requests.md) — **Squash merge policy**, detailed agent pipeline, and PR checklist.
- [workflows/issues.md](workflows/issues.md) — Workbench Markdown issue hierarchy, lifecycle, automation, required task-start plans, and completion worklogs.
- [workflows/remote-execution.md](workflows/remote-execution.md) — **Main agent execution path** (allowlisted focused hosted tasks, label-gated exact-head PR validation, and failure loops).
- [workflows/ci-pipeline.md](workflows/ci-pipeline.md) — **GitHub Actions pipeline** (remote task / label-gated PR / main / manual live-e2e split).
- [workflows/monorepo.md](workflows/monorepo.md) — Cross-package changes.
- [workflows/quality.md](workflows/quality.md) — Quality gates (Knip, jscpd, lint, coverage), **fix findings not silence them**, testing pyramid, and release.
- [workflows/agent-statistics.md](workflows/agent-statistics.md) — Per-PR AI-agent timing/counter YAML, repository test inventory, historical comparison, waste analysis, and direct Workbench publication.
- [workflows/main-build-statistics.md](workflows/main-build-statistics.md) — Post-completion Main run/job/step metrics and trusted automatic Workbench publication.
- [design-docs/agent-workflow-orchestration.md](design-docs/agent-workflow-orchestration.md) — Cortex, Loom, Hive, and delivery-owner responsibility boundary.

## 7. Agent duties beyond code

### Testing pyramid
* **Rust unit/integration tests** must cover ~99% of domain behavior — especially event sourcing, causal DAG sync, projection, epochs, and crypto. E2e is smoke only. See [rules.md §4](rules.md#4-testing-requirements) and [design-docs/core-beliefs.md §9](design-docs/core-beliefs.md#9-unit-tests-own-domain-correctness-e2e-is-smoke-only).
* **Line coverage threshold (90%):** `task rust:coverage:check` measures
  `nook-app-common + nook-core + nook-auth2 + nook-replication + nook-event-log` and fails below
  `nook-app/nook-platform/nook-core/coverage-floor.json` (90% lines). When coverage is under
  90%, add Rust tests in the same task. Above 90%, do not chase marginal
  coverage.

### Grow `.cortex` dynamically
* When prompts, dialogues, test runs, or PRs reveal **durable** facts (invariants, tooling behavior, architectural decisions, coverage gaps), **write them into `.cortex` in the same task** — do not leave knowledge only in chat history.
* Follow [design-docs/core-beliefs.md §10](design-docs/core-beliefs.md#10-grow-cortex-dynamically): update the most specific existing doc; keep entries concise and linked to code/tests.
* Follow [dynamic-skills/cortex-writer.md](dynamic-skills/cortex-writer.md) for every `.cortex` edit: short sentences, bullets, and lists over dense multi-clause prose.
* Follow [dynamic-skills/cortex-consistency.md](dynamic-skills/cortex-consistency.md): garbage-collect obsolete facts, resolve cross-doc conflicts, and fix docs that disagree with code.
* For recurring refactor, review, boundary, or code-organization feedback, use [workflows/dynamic-skills.md](workflows/dynamic-skills.md) and update [dynamic-skills/index.md](dynamic-skills/index.md).

### Keep the root README current

- The root [`README.md`](../README.md) is the **public, human-facing** entry point.
- Agents must **update it in the same PR** when an architectural or product-surface change would make it wrong or incomplete.
- **Triggers (non-exhaustive):** package layout or dependency flow changes; new/removed crates or web packages; sync/storage model changes; vault unlock or enrollment model changes; public Task commands or local-dev prerequisites; user-visible item types or primary flows; links to `.cortex` docs that move or are superseded.
- **Do not** dump full design specs into the README.
- Keep it accurate and concise.
- Point to [ARCHITECTURE.md](ARCHITECTURE.md) / design docs for depth.
- Stale README after an architecture PR is a process defect, same as leaving durable facts only in chat.

### Project skills

- [dynamic-skills/index.md](dynamic-skills/index.md) is the canonical registry of repo-specific skills agents must consult for matching work.
- The directory name means the skills were captured dynamically from durable project feedback.
- It does **not** mean they are optional or ad hoc.
- `.agents/skills/` is the canonical open agent skills directory natively discovered by Antigravity and open agent standards.
- `.cursor/skills/` and `.claude/skills/` entries are executable symlinks/mirrors so Cursor, Claude, Codex, and Antigravity all share the exact same skills source.
- They must point back to `.cortex/dynamic-skills/` cards.
- Do not treat the skill wrappers as the source of truth.

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

When a PR has actionable review feedback from a human, Codex, or another automated reviewer, treat every active, non-outdated item as required work.

An agent must leave its own GitHub reply explaining the fix, validation, or no-change rationale before resolving any PR comment or review conversation.

Inspect both inline review threads and top-level review bodies for actionable findings.

Replies must target the specific comment/item.

A broad PR audit comment is not a substitute.

Resolve a conversation only after the targeted reply is visible and the finding is fixed or explicitly invalidated.

Re-query the PR and inspect again before merge or handoff.

Every active actionable item must be handled.

Do not wait for a Codex result after repository-owned checks finish. Do not
request or wait for other external reviewers or services.

See [dynamic-skills/code-review-comments.md](dynamic-skills/code-review-comments.md).

### Deferred or out-of-scope functionality

If a requested feature is too large for one pull request, create an ordered
Workbench issue sequence before implementation.

Land each required slice and continue until the feature is complete.

If work is risky, externally blocked, or outside the authorized task, do not
silently drop it.

Inspect Workbench issues and worklogs first.

Update the owning feature and focused issue, or create the missing hierarchy.

Publish the task worklog.

See [workflows/issues.md](workflows/issues.md) and
[dynamic-skills/issue-scope-management.md](dynamic-skills/issue-scope-management.md).
