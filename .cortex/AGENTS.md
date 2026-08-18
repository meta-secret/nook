# Nook Agent Map (Table of Contents)

## Overview

This is the system of record and entry point for all AI agents working in this repository. Consult [`.cortex/knowledge-graph.md`](knowledge-graph.md) for the central knowledge graph, hierarchical topic index, and exact section anchors across all specifications, architecture documents, rules, skills, and workflows.

## How to search and navigate the Knowledge Graph

All specifications, architectural contracts, domain models, testing policies, dynamic skills, workflows, references, and execution plans are mapped in [`.cortex/knowledge-graph.md`](knowledge-graph.md).

Agents must follow this navigation and search protocol:

1. **Perform keyword and topic searches against the Knowledge Graph:**
   - Use `grep_search` or targeted text search within `.cortex/knowledge-graph.md` for topics, keywords, domain terms (such as `DEK`, `Sentinel`, `cache-from`, `migration`, `coverage`, `Loom`).
   - The Knowledge Graph contains hierarchical category groupings, document titles, exact markdown section fragments (`#section-anchor`), and 1-line directional summaries for each section.

2. **Retrieve exact section anchors instead of reading full documents:**
   - Locate the owning document and exact section anchor from `knowledge-graph.md`.
   - Read only the relevant line range using `view_file` with `StartLine` and `EndLine`.
   - Avoid dumping 50k+ tokens of full design documents or specifications into context when only a single section or rule is needed.

3. **Verify anchor integrity when authoring:**
   - If an agent adds, renames, or restructures headings in any `.cortex/` document, update `knowledge-graph.md` in the same task.
   - Run `task loom:cortex-audit` to verify zero broken links, zero orphan rows, and complete heading coverage.

## ⛔ P1 — most critical `.cortex` navigation rule: always consult the Knowledge Graph first

Knowledge-graph navigation requirements are:

- Read [`.cortex/knowledge-graph.md`](knowledge-graph.md) before exploring files or starting implementation.
- Use the Knowledge Graph whenever an agent needs to know anything about the project:
  - architecture and package boundaries;
  - security-domain models and cryptographic specifications;
  - coding rules and language boundaries;
  - testing standards and coverage floors;
  - workflows, review policies, and delivery procedures.
- Retrieve the exact section anchors from `knowledge-graph.md` instead of loading entire documents into context or guessing file paths.
- Treat unmapped Cortex documents, broken index anchors, or bypassing the Knowledge Graph as P1 documentation findings.

Full contract:
[dynamic-skills/cortex-document-map.md](dynamic-skills/cortex-document-map.md).

## ⛔ P1 — Proactively enrich Cortex with critical discovered knowledge

During task and prompt execution, an AI agent must dynamically evaluate all newly gained or discovered knowledge:

- **Dynamic importance evaluation:**
  - When investigating bugs, implementing features, running tests, or reviewing code, determine whether discovered facts are critical or durable.
  - Critical knowledge includes:
    - architectural invariants and package boundaries;
    - security domain models, key handshakes, and cryptographic invariants;
    - unexpected tool, build, or runtime failure modes and exact fixes;
    - non-obvious testing contracts, flakiness patterns, and coverage floors;
    - reusable design patterns, coding rules, and language boundaries;
    - workflow procedures, CI interactions, and review policies.

- **Mandatory Cortex enrichment:**
  - If critical or durable knowledge is missing from Cortex or the Knowledge Graph, the agent **must update Cortex in the same task and PR**.
  - Do not leave critical discoveries isolated in ephemeral chat transcripts.
  - Place knowledge in the most specific existing Cortex document, or author a new dynamic skill in `.cortex/dynamic-skills/` if it represents a recurring rule or pattern.
  - Register all new documents and section anchors in [`.cortex/knowledge-graph.md`](knowledge-graph.md).
  - Run `task loom:cortex-audit` to confirm complete integration.

Full contract:
[dynamic-skills/cortex-consistency.md](dynamic-skills/cortex-consistency.md).

## ⛔ P1 — most critical `.cortex` writing rule: keep cognitive complexity low

Writing requirements are:

- Use simple sentence structure in every new or edited `.cortex` Markdown file.
- Do not pack many facts into one sentence or table cell.
- Split complex ideas into:

  - short sentences;
  - bullet points;
  - lists.

- Keep one idea in each sentence.
- Put actors, credentials, commands, and failure modes in separate bullets or
  sentences.
- Prohibit static project directory trees and nested file hierarchies.
  - Project structure is dynamic; agents must explore it directly using discovery tools (`list_dir`, `find_by_name`, `grep_search`).
  - Limit structural overviews to flat lists of top-level subsystem directories (such as `infra`, `nook-app`, `agentic-ai`, `preflight`).
- Prohibit ASCII graphics and box drawings; use Mermaid (` ```mermaid `) or structured lists instead.
- Treat dense multi-clause prose, static directory trees, and ASCII graphics as P1 documentation findings.

Full contract:
[dynamic-skills/cortex-writer.md](dynamic-skills/cortex-writer.md).

## ⛔ P1 — Cortex articles must expose their semantic structure

Every Cortex article must make its real hierarchy visible.

- Use prose for rationale and connected explanation.
- Use bullets for parallel rules, facts, choices, and failure conditions.
- Use ordered lists for actions whose sequence matters.
- Use nested lists only for owned substeps or conditional branches.
- Use headings for substantial navigable subarticles, not cosmetic labels.

Detailed explanations do not need to be short. They must live inside a clear
article shape and keep one idea per sentence.

Full contract:
[dynamic-skills/cortex-article-structure.md](dynamic-skills/cortex-article-structure.md).

## ⛔ P1 — most critical `.cortex` integrity rule: keep docs consistent

`.cortex` maintenance follows this sequence:

1. Treat Cortex as maintained knowledge, not write-only output.
2. Garbage-collect obsolete facts in the same task.
3. Verify every document that owns the touched topic.

Those docs must:

- stay current;
- agree with each other;
- agree with the current code and Task entrypoints.

- Treat stale claims, cross-document conflicts, and code mismatches as P1
  documentation findings.
- Fix them in the same PR.
- Label historical context as historical.
- Do not leave conflicting guidance presented as active policy.

Full contract:
[dynamic-skills/cortex-consistency.md](dynamic-skills/cortex-consistency.md).

## ⛔ Non-negotiable: plan small, module-focused pull requests

Pull-request planning is ordered:

1. Estimate authored changed lines before implementation.
2. Keep each implementation PR at or below **5,000 authored changed lines**.
3. If the feature is larger, define an ordered PR series before editing.

If an in-progress pull request reaches the limit, the agent must:

1. Stop implementation and publish a semantic split plan to Workbench.
2. Branch a linked draft successor from the last full-work commit before
   changing the first PR.
3. Assign complete capabilities, modules, tests, and documentation to each PR.
4. Prove all work exists in the ordered PR sequence.
5. Complete the first PR, then continue and complete its successor.

Preservation rules:

- Reducing scope without that linked preservation PR is a P1 delivery failure.
- Shrinking a diff is not a semantic split.
- Do not compress documentation, remove tests, delete completed behavior, or
  perform cosmetic churn to make a PR fit the limit.

Each pull request must:

- own one cohesive module, package, layer, or architectural responsibility;
- remain independently testable and mergeable;
- expose narrow interfaces to later slices;
- avoid unrelated cleanup and cross-module churn.

- **Feature ownership:** The agent still owns the complete requested feature.
  - Land each slice.
  - Start the next slice from current `origin/main`.
  - Continue until every planned Workbench issue is complete.
- **Prohibition:** Do not use the limit for mechanical file splitting or
  incomplete handoffs.

Full contract:
[workflows/pull-requests.md](workflows/pull-requests.md#pull-request-size-and-modularity).

## ⛔ P1 — most critical code-structure rule: oversized source is prohibited

- **Hard limit:** Every authored source file, including Rust, stays at or below
  **1,000 lines**.
- **Severity:** Crossing the limit is a failed repository invariant and P1
  architecture finding.
- **Rust signal:** An oversized Rust module indicates an overcomplicated domain
  model or too many production responsibilities.
  - Decompose the model instead of adding a Rust-specific allowance.

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

- **Mechanical splitting is forbidden:**
  - Never cut a file in half.
  - Never create meaningless `part1`, `part2`, `continued`, or similarly
    numbered modules.
  - Improve the architecture instead of merely satisfying the counter.
  - Moving unit tests to another file to satisfy the counter is itself a failed
    invariant.

Full critical contract: [dynamic-skills/source-file-size.md](dynamic-skills/source-file-size.md).

## ⛔ Non-negotiable: load Nook's design skill for every UI task

Before designing, implementing, or reviewing user-visible website or extension
UI:

1. Read and use
   [`design-taste-frontend`](../.agents/skills/design-taste-frontend/SKILL.md).
2. Keep Nook's established stack and architecture authoritative.

- **Impeccable:** It is not part of the default workflow.
  - Do not install, load, run, hook, or delegate it unless the user explicitly
    requests it.
  - An installed generated copy may remain, but its presence does not activate
    it.
- **Applies to:** New screens, redesigns, components, styles, responsive
  behavior, interaction states, and visual polish.
- **Architecture boundary:** The skill does not permit replacing Nook's stack.
  - Nook remains Svelte-based.
  - Cortex remains authoritative for Rust/WASM boundaries, translations,
    accessibility, established components and tokens, tests, and dependencies.

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

- **Prohibition:** Empty Bake `cache-from=` and `cache-to=` overrides are
  forbidden.
- **`cache-from`:** Clearing it after a remote hit forces cold rebuilds from apt
  upward.
- **`cache-to`:** Clearing it to stop a linked parent from writing is the wrong
  fix.

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

- If a short parent index orphans a leaf RUN, redesign the Bake graph.
- Never wipe cache to hide a graph mistake.

Full policy: [workflows/quality.md](workflows/quality.md) § BuildKit cache (Zot).

## ⛔ Non-negotiable: Rust domain absence must be explicit

- **Domain absence:** Before adding or keeping `Option<T>`, define what `None`
  means.
  - Keep required persisted values required and validated.
  - Use enums with variant-owned data for named product, lifecycle,
    authorization, and workflow states.
  - Use `Option<T>` only when absence is the truthful structural contract, such
    as lookup results, optional external inputs, and caches.
  - When absence violates an invariant, return `Result<T, DomainError>`, add a
    precise `thiserror` variant, and propagate with `?`.
  - Do not model failure as `None` or a fake state enum.
  - Do not create one-variant wrappers merely to avoid `Option<T>`.
  - See [Rust coding](dynamic-skills/rust-coding.md).
- **WASM callable names:** Keep authored Rust names in generated JavaScript.
  - Do not use callable `wasm_bindgen(js_name = ...)` renames.
  - TypeScript, JavaScript, and Svelte call the same generated name.
  - Do not restore aliases through imports, re-exports, or local facades.
  - Property accessors, generated types, and imported JavaScript APIs are
    outside this rule.
  - See [name coherence](dynamic-skills/rust-wasm-name-coherence.md).
- **Generated boundary absence:** Rust-owned `Tsify`/WASM contracts must not
  override fields with TypeScript `undefined`, `null`, or `void`.
  - Replace `Option<T>` plus a sentinel override with a named Rust enum.
  - Use `void` only for TypeScript unit/effect returns, never serialized state.
  - Preflight rejects absence sentinels in `tsify(type = "...")`, `Option<T>`
    fields on `Tsify` exports, and `Option<T>` parameters or returns on
    `wasm_bindgen` exports.
  - Convert internal Rust `Option<T>` into a named boundary state before type
    generation.
- **Known JSON tests:** Deserialize into the concrete Rust wire or domain type
  before asserting fields.
  - Do not index raw `serde_json::Value` or use `Value::is_null()` for known
    contracts; both omitted and explicit null become `Value::Null`.
  - Raw values remain valid when malformed, unknown, or partial JSON is the test
    subject, or for narrow `.get()` checks of omitted or renamed properties.

## ⛔ Non-negotiable: authored JavaScript/TypeScript state must be explicit

- **No authored absence sentinel:** JavaScript, TypeScript, and Svelte must not
  contain the `undefined` value or type token.
  - Model optional and named states with data-owning discriminated unions, or
    Rust/WASM enums for portable domain policy.
  - Do not reconstruct state from optional unions, zero-argument `$state<T>()`,
    parameterless `$bindable()`, optional bags, or parallel booleans.
  - A parameterless `$bindable()` is an implicit `undefined` default; provide a
    truthful value or remove the binding.
- **Enum ownership:** Classify the vocabulary before authoring it.
  - Portable auth, vault, recovery, Sentinel, provider, sync, and secret-schema
    vocabularies are Rust enums in `nook-core`, exposed through `nook-wasm`.
  - Browser protocol, lifecycle, and presentation-only vocabularies use named
    TypeScript enums.
  - Union variants and protocols reference enum members instead of raw strings.
  - Preserve stable serialized strings through enum values where required.
  - Do not collapse unrelated state machines into a generic enum.
  - Constructors, comparisons, switches, and fixtures use the same members.
  - Any authored closed string-literal union is an enum regardless of field name.
  - Put runtime enums used by Svelte in an adjacent imported TypeScript module,
    beside the union they discriminate; never declare them in component script.
- **External absence:** Normalize optional external inputs at the narrow
  boundary and convert lookup/parser/browser results into a domain union
  immediately.
  - Authored code never uses `undefined` or `null` as values or types.
  - Generated declarations may mirror external contracts.
  - Tests, build scripts, `.agents`, and `.github` remain authored code.
  - Do not evade the rule with quoted sentinels, casts, fake defaults,
    decorative wrappers, or sentinel strings.
- **`void` as effect:** Permit it only as a complete unit/effect return,
  `Promise<void>`, `void | Promise<void>`, or unary discard.
  - Treat it as Rust `()`, not `Option<T>`.
  - Forbid value unions such as `T | void` and `Promise<T | void>`.
  - Tests assert semantic variants or structural contracts, never absence
    matchers.
  - See [explicit state](dynamic-skills/typescript-explicit-state.md).

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

- **Owned scope:** Every agent stays inside its assigned feature and focused
  issue set.
- **Foreign scope:** Another active agent's work is read-only.

Without an explicit handoff, an agent must not:

- edit or push to another task's branch;
- change another task's Workbench records;
- reply to or resolve another task's review threads;
- change another task's PR labels, checks, open state, or merge state;
- close, reopen, or merge another task's pull request.

- Related subject matter does not confer ownership.
- Before each remote mutation, verify that the target belongs to the current
  feature and issue set.
- If ownership is absent or ambiguous:
  1. Stop mutating the target.
  2. Report the overlap.
  3. Stop and wait for an explicit user, owner, or orchestrator handoff.

Full policy:
[dynamic-skills/agent-feature-ownership.md](dynamic-skills/agent-feature-ownership.md).

## ⛔ Non-negotiable: delegate independent semantic work

- **Trigger:** A capable agent environment uses child workers when a task has at
  least two bounded semantic units that can run independently.

Each work unit must have:

- the same immutable baseline;
- a read-only or disjoint write scope;
- explicit inputs and outputs;
- independent acceptance evidence;
- a parent-owned join.

- **Deterministic work:** Put simple steps in Loom, Task, or another tool; they
  do not need an AI worker.
- **Delivery owner:** One owner retains Workbench, branch, PR, review,
  validation, and merge authority.
- **Child output:** Workers return evidence or isolated patches and do not
  mutate shared lifecycle state.
- **Repeated workflows:** Use reviewed static TypeScript graphs in Loom.
  - Never derive topology from YAML, prompts, or Markdown.
  - The first catalog entry is read-only `cortex-full-garbage-collection`.

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

- **Normal completion:** Do not stop at a ready-PR handoff or ask for separate
  merge permission.
  - Stop without merge only for a concrete blocker or explicit read-only request.
- **Bounded worker:** `agent-implement.yml` is not a continuing task owner.
  - Its harness owns git, push, and PR creation, then exits.
- **Continuing ownership:** A continuing agent accepts that PR only when named
  in its `## Ownership` section.
  - Issue-backed runs use the Workbench issue owner.
  - Prompt-backed runs use `continuing_owner` dispatch input.
  - The owner must be a Nook GitHub collaborator with write access.
  - Before exit, the worker assigns the PR and posts a direct mention as the
    explicit handoff.
  - The continuing owner carries the PR through merge.

Full policy: [workflows/coding-bro.md](workflows/coding-bro.md).

- **Delivery boundary:** Successful squash merge completes product delivery.
- **Post-merge scope:** Do not wait for `main.yml` or development deployment
  unless the user requested live verification or assigned a Main failure.
- **Records:** Publish the Workbench issue update, worklog, and agent statistics
  immediately after merge.
- **Prohibition:** Do not make Main completion a prerequisite.

## ⛔ Non-negotiable: never kill the Docker daemon

**Killing the Docker daemon is strictly prohibited.** Only individual **Docker containers** may be stopped — never Docker Desktop, `dockerd`, or the Docker VM.

- **Forbidden:** `killall Docker`, `killall docker`, `pkill docker`, `pkill -f docker`, `osascript` quit Docker, `systemctl stop docker`, or any command aimed at the daemon or Desktop app.
- **Forbidden:** `lsof -ti :<port> | xargs kill` when that port is forwarded by Docker (e.g. `:5173` for `task web:dev`) — use `docker ps` → `docker stop <container>` instead.
- **Allowed:** `docker stop <container_id>`, `docker rm`, `docker compose down` for a specific stack.

Full policy: [rules.md §5](rules.md#docker-daemon--never-kill-it).

## ⛔ Non-negotiable: request exact-head review without delaying validation

Run advisory local Codex review before the first owner-authored push. The
bounded implementation harness is the exception. It commits and pushes after
the worker exits. Its continuing owner runs local review immediately after
handoff.

When a coherent head is ready for complete validation, request one idempotent
exact-head Cloud review alongside that validation. Prefer Codex. If Codex
reports a usage limit, request Cursor Bugbot for the same head. The GitHub
Actions runtime is the review window. If no review feedback exists when checks
finish, continue to readiness without waiting. Use focused hosted tasks while
iterating.

Before merge or handoff, inspect the comments and review findings currently
present and address every active actionable item from humans or external
services. Reply with the fix, validation, or no-change rationale and resolve
each actionable thread. Do not request Claude, CodeRabbit, or other optional
reviewers. A PR is ready when the applicable repository-owned checks are green,
the branch is current and mergeable, and all feedback already present is
addressed. `task pr:ready` enforces the machine-checkable parts. Full policy:
[rules.md §6](rules.md#6-git--pull-request-workflow).

## ⛔ Non-negotiable: format on the host before every push

- **Trigger:** Run pre-push hygiene before every commit that will be pushed.
- **Reason:** Avoid wasting a Verify cycle on Prettier or rustfmt.

Mechanical entrypoint:

```bash
task loom:pre-push
```

- **Loom action:** Host-apply `task format`, evaluate the UI demo contract
  against `origin/main`, and stage tracked updates with `git add -u`.
- **Before push:**
  1. Run `task loom:pre-push`.
  2. Commit.
  3. Push.
- **Prohibitions:**
  - Do not use `task extension:format` as the only format step.
  - Do not run `task check`, `task ci:pr`, full suites, builds, or e2e locally.
- **Hosted validation:**
  - Use `task remote` only for faster focused diagnostics.
  - Do not require focused tasks before complete validation.
  - Prefer parallel complete validation over a slower sequential focused batch.
  - Use `task pr:validate` for the complete exact-head gate.

Full policy: [dynamic-skills/pre-push-hygiene.md](dynamic-skills/pre-push-hygiene.md)
and [workflows/remote-execution.md](workflows/remote-execution.md).

## Loom — mechanical cortex rites

[`agentic-ai/loom`](../agentic-ai/loom/README.md) runs mechanical agent
procedures through a strict YAML tool protocol.

- **Single parameter:** Loom and migrated Nook web functions take at most one
  parameter.
  - Use a typed object for multiple values.
  - Expand shared ESLint scope one migrated package slice at a time.
  - See [single parameter](dynamic-skills/typescript-single-parameter.md).
- **No generic value bags:** Loom and migrated Nook web do not author `unknown`
  or `object`.
  - `object` has no exception.
  - Use `unknown` only in a dedicated unavoidable transport adapter that narrows
    immediately.
  - Treat existing generic APIs as migration debt, not examples or exceptions.
  - ESLint bans `object` everywhere and `unknown` outside allowlisted adapters.
  - See [no unknown](dynamic-skills/typescript-no-unknown.md).
- **Named semantic arguments:** Loom and authored Nook web production code do
  not use inline object-shaped parameter types or raw object-literal calls.
  - Object-shaped includes mapped types, arrays, tuples, maps, sets, and records.
  - Use a named semantic type, interface, or Rust-generated boundary type.
  - Do not use generic names such as `Args`, `CallbackArgs`, or `PutArgs`.
  - A function-valued parameter may return an inline object; that return is not
    the parameter contract.
  - Callers first assign a named typed argument value.
  - Loom uses `loom/no-raw-object-arguments`; Nook web uses
    `nook-typed-api/no-raw-object-arguments`.
  - See [named arguments](dynamic-skills/typescript-named-args.md).
- **Rust/extension ownership:** Browser-extension TypeScript owns observation
  and lifecycle glue.
  - Portable classification, validation, policy, and workflow belong in Rust.
  - Size-sensitive content policy uses `nook-companion-core` through
    `nook-companion-wasm`.
  - Shared authenticator values and vocabularies belong in
    `nook-authenticator-domain`, consumed by both Rust domain crates.
  - See [code separation](dynamic-skills/rust-typescript-code-separation.md).

Bun must be installed. Stop and ask for Bun if `bun --version` fails.

Leaf-tool invoke forms:

- Defaultable tools use a Task alias with an in-code example.
  - `task loom:pre-push`
  - `task loom:tools-list`
  - `task loom:cortex-audit`
  - `task loom:dependency-popularity`
- Parameterized tools still take an agent-owned YAML file.

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

- **Policy owner:** Policy and judgment stay in `.cortex`.
- **Leaf owner:** Loom runs deterministic leaf tools.
- **Workflow owner:** Loom owns an isolated static agent-workflow module.
  - It contains reviewed TypeScript graphs.
  - A separate CLI selects one compiled workflow.
  - It never accepts or generates topology from YAML, prompts, or Markdown.

First static workflow:

```bash
task loom:agent-workflow:cortex-audit BASELINE=<40-character-commit-sha>
```

- **Current runs:** Use an append-only local journal.
- **Future runs:** Hive-backed execution uses Neo4j as durable lifecycle
  authority.

See
[agent-workflow-orchestration.md](design-docs/agent-workflow-orchestration.md).

## ⛔ Non-negotiable: heavy agent work runs remotely

- **Required local product action:** Run `task loom:pre-push`.
  - It host-applies formatting and checks the UI demo contract for UI changes.
- **Advisory local action:** Codex review is part of delivery but not a product
  gate. Cloud review falls back to Cursor Bugbot when Codex is usage-limited.
- **Hosted product gates:** Run lint, Clippy, unit tests, coverage, web build,
  Knip, jscpd, e2e, and the PR mirror on GitHub Actions.

The normal loop:

1. Pre-push hygiene
2. Commit
3. Advisory `task pr:review-local` before the first owner-authored push
4. Push
5. Optional focused `task remote` runs for isolated diagnostics
6. Explicit `task pr:validate` when the head is ready for the final gate

- **Harness-created PR:** The continuing owner runs local review after handoff.
- **Validation trigger:** Ordinary pushes do not start the complete PR workflow.
  - A later push makes prior checks stale.
  - Explicitly validate the replacement exact head before readiness.
- **Focused debugging:** Use the allowlisted remote task catalog.
- **Critical path:** Do not run broad gates sequentially when complete PR
  validation executes them in parallel faster.

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
decisions, validation, and remaining work. A Workbench issue may be dispatched
to the bounded implementation worker only when it has `status: ready`,
`automation: agent`, and an assignable Nook GitHub collaborator as its owner.
The dispatch must name its exact `issue_path`. Full policy:
[workflows/issues.md](workflows/issues.md).

## ⛔ Non-negotiable: record and analyze AI-agent PR statistics

For every normal PR, the task owner measures:

- lightweight local runs;
- focused and complete GitHub Actions runs and retriggers;
- merge attempts;
- elapsed time; and
- repository test inventory on the merged head.

After merge:

1. Assemble `stats/ai-agent/<pr-number>.yaml` with Loom.
2. Validate the record.
3. Publish it directly to Workbench `main`.

Write a request YAML, then run it:

```yaml
agentStats:
  assemble:
    prNumber: 123
    scratchPath: "{agentTempDir}/pr-123-scratch.json"
    outputPath: "{agentTempDir}/123.yaml"
    includeTestInventory: true
```

```bash
task loom:agent-stats CONFIG=path/to/agent-owned/assemble-request.yaml
# then an agentStats.publish request using the same {agentTempDir} statsFile
task loom:agent-stats CONFIG=path/to/agent-owned/publish-request.yaml
```

- See [Loom tools](references/loom-tools.md).
- `{agentTempDir}` isolates paths by task-anchor Git commit and worktree.
- Compare with one or two recent comparable records.
- Assess build/workflow waste in the scratch log before assembly.
- Do not create a bookkeeping branch or Nook PR.
- Fix actionable waste in a separate normal build-performance PR.

Full policy: [workflows/agent-statistics.md](workflows/agent-statistics.md).

## Document Catalog of Record

All specifications, architectural contracts, domain models, product specifications, dynamic skills, workflows, cheat sheets, and execution plans are mapped and indexed in [`.cortex/knowledge-graph.md`](knowledge-graph.md). Consult the Knowledge Graph for the single source of truth for all repository documents.

## Agent duties beyond code

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
* Follow [dynamic-skills/cortex-article-structure.md](dynamic-skills/cortex-article-structure.md): expose the real explanation, rule, procedure, and reference hierarchy.
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

Handle review feedback in this order:

1. Treat every active, non-outdated actionable human or automated item as
   required work.
2. Inspect inline threads and top-level review bodies.
3. Fix the finding or establish a precise no-change rationale.
4. Leave a targeted GitHub reply with the fix and validation or rationale.
5. Resolve only after that reply is visible and the finding is fixed or
   invalidated.
6. Re-query the PR and inspect it again before merge or handoff.

Additional boundaries:

- A broad PR audit comment does not replace targeted replies.
- Every active actionable item must be handled.
- Do not wait for Codex or Cursor after repository-owned checks finish.
- Do not request Claude, CodeRabbit, or other optional reviewers.
- `task pr:review` may request Cursor Bugbot when Codex reports a usage limit.

See [dynamic-skills/code-review-comments.md](dynamic-skills/code-review-comments.md).

### Deferred or out-of-scope functionality

For oversized requested work:

1. Create an ordered Workbench issue sequence before implementation.
2. Land each required slice.
3. Continue until the feature is complete.

For risky, externally blocked, or unauthorized work:

1. Do not silently drop it.
2. Inspect Workbench issues and worklogs.
3. Update the owning feature and focused issue, or create the missing hierarchy.
4. Publish the task worklog.

See [workflows/issues.md](workflows/issues.md) and
[dynamic-skills/issue-scope-management.md](dynamic-skills/issue-scope-management.md).

