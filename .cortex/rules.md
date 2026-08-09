# Nook Coding Rules & Golden Principles

This document defines the strict development standards, architectural boundaries, and validation requirements for the Nook monorepo. All changes must comply with these guidelines.

---

## 1. Monorepo Architecture & Package Boundaries

- **README stays in sync:** When this section's boundaries, package layout, sync model, or public Task surface change, update the root [`README.md`](../README.md) in the same PR. See [AGENTS.md — Keep the root README current](AGENTS.md#keep-the-root-readme-current).
- **Strict Uni-directional Flow:** `nook-app-common` is a dependency-light
  portable leaf consumed by `nook-auth2` and `nook-core`. `nook-auth2` and
  `nook-replication` are portable foundations consumed by `nook-event-log`;
  `nook-core` consumes that signed-history domain, followed by `nook-wasm` and
  `nook-web`. Circular dependencies or reverse imports are strictly forbidden.
- **`nook-app-common` Isolation:** Own only dependency-light primitives and
  assets genuinely shared across portable application crates, including locale
  catalogs, translation behavior, and the generated i18n key registry. It must
  not depend on `nook-auth2`, `nook-replication`, `nook-event-log`, `nook-core`,
  `nook-wasm`, browser APIs, or web code.
- **`nook-replication` Isolation:** Own only provider-neutral causal DAG,
  immutable replica-set, outbox, and repair mechanics. Vault operations,
  authorization, projection, key epochs, provider credentials, and provider
  transports stay outside this crate.
- **`nook-event-log` Isolation:** Own canonical signed vault events, actor
  authorization over the causal graph, deterministic encrypted projection,
  key-epoch metadata, and typed append/store orchestration. It may depend on
  `nook-auth2` and `nook-replication`, but never on plaintext secret models,
  provider transports, browser persistence, `nook-core`, `nook-wasm`, or web
  code.
- **`nook-core` Isolation:**
  - Must remain Rust domain code with no browser, Svelte, Bun, IndexedDB, HTTP, or session-state behavior.
  - May use `wasm-bindgen` annotations on simple domain DTOs/enums when that exposes the real core type through WASM and avoids a TypeScript/string mirror.
  - Must not depend on `js-sys`, `web-sys`, or any browser Web APIs.
  - Must be fully compilable and testable on native desktop/server targets.
  - **Rust-First for Reuse (including i18n):** Keep domain logic and validation
    rules in the owning portable Rust crate. Shared resources and behavior such
    as localization catalogs and translation live in `nook-app-common`; vault
    application behavior stays in `nook-core`. This guarantees that future
    platforms—like a CLI tool or mobile apps—can reuse them without TypeScript.
- **`nook-wasm` Bridge Responsibilities:**
  - Exposes Rust structs to JS via `#[wasm_bindgen]`.
  - Performs network/database input/output operations (e.g., IndexedDB, GitHub API).
  - Holds WASM session state (`Database`, vault metadata, `VaultCrypto`).
  - All complex business logic (crypto, formats, validation, password generation, search) must live in `nook-core` and be tested there.

---

## 2. Rust-Wasm Boundary Standards

- **Error Propagation:**
  - All fallible exported `#[wasm_bindgen]` functions must return `Result<T, wasm_bindgen::JsError>`.
  - Do not return string-based errors (e.g., `Result<T, JsValue>`). This allows the JS runtime to catch actual JavaScript `Error` objects with full stack traces.
- **Minimal raw JS Type Exposure:**
  - Authored `nook-wasm` Rust must not use `JsValue`. Data crossing the JS boundary uses strongly typed `#[wasm_bindgen]` structs, and browser integrations use the narrowest typed `web-sys` / `js-sys` API type.
  - The syntax-aware repository preflight inspects authored Rust before macro expansion and rejects every `JsValue` path under `nook-app/nook-platform/nook-wasm/src`. The built-in Clippy `disallowed_types` lint is not used because wasm-bindgen's procedural macros generate that ABI type internally and cause false positives on typed exports.
- **Typed Core Models:**
  - Prefer exporting simple `nook-core` enums/DTOs through WASM over recreating their tags as strings or parallel TypeScript unions.
  - `nook-wasm` should adapt browser I/O and JS-friendly constructors/getters; it should not own duplicate domain models.
- **Asynchronous Execution:**
  - Use native Rust `async/await` syntax for all asynchronous operations inside WASM.
  - Do not use `JsFuture` or raw JavaScript promises inside Rust.

---

## 3. Svelte 5 & TypeScript UI Standards

- **No `null` in authored TypeScript/Svelte:** Authored `nook-app/nook-web/src` code must
  not use `null` as a value, state sentinel, return type, parameter type, or
  default prop value. Convert truthful external absence directly into a
  domain-specific discriminated union at the boundary. Product, workflow,
  lifecycle, resource, and UI state use discriminated unions or Rust/WASM-owned
  enums. Browser APIs that return `null` must be classified at the call site;
  neither `null` nor `undefined` may flow through authored app code. Generated
  WASM bindings and ambient declarations may mention `null` because they mirror
  external contracts. Put unavoidable browser or third-party signatures behind
  generated declarations or a narrow untyped boundary and return a named state.
  Do not hand-edit generated files or spread nullable types into internal
  helpers.
- **Explicit JavaScript/TypeScript/Svelte absence:** Authored code contains no
  `undefined` value or type tokens, including tests, build scripts, `.agents`,
  and `.github`. Use optional syntax only for external input shape, `void` for
  callbacks with no result, and immediately normalize browser, lookup, parser,
  cache, and DOM absence into an explicit discriminated union. Mutable state
  always uses domain-specific variants with variant-owned data. Generated
  declarations and generated WASM bindings may mirror external contracts.
- **Svelte TypeScript enums:** Every Svelte build surface enables
  `vitePreprocess({ script: true })`. Presentation-only closed vocabularies use
  named TypeScript enums. Runtime enums consumed by a component instance live
  in a cohesive adjacent `.ts` module and are imported normally; do not bridge
  runtime values from a same-file `<script module>` into the instance script.
- **Reactive State Encapsulation:**
  - Keep components thin and stateless where possible.
  - Store application-wide reactive state and side-effect handlers (e.g. configuration loads, storage fetches, updates) in Svelte 5 state classes defined in `.svelte.ts` files.
  - Use `$state` and `$derived` runes for reactive fields.
- **Subcomponent Bindings:**
  - Bind state class instance fields directly in subcomponents using `bind:property={state.field}`.
- **Separation of Concerns:**
  - Svelte components should only bind data, render layouts, and trigger event calls on the state controller.
  - They must not contain vault serialization, encryption, validation, password generation, or secret filtering logic — those belong in `nook-core` with Rust tests.

---

## 4. Testing Requirements

### Unit tests carry ~99% of functional coverage

**E2e tests are smoke tests, not a substitute for domain coverage.**

Playwright flows exercise a thin slice of user paths.

They cover happy paths and a few conflict screens.

They do **not** prove correctness of event sourcing, causal DAG merge, projection replay, epoch rotation, crypto, or multi-device sync.

| Layer                         | Target                                                                            | Where                                                        |
| ----------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Unit / property tests**     | ~99% of domain behavior — edge cases, concurrency, replay invariance, error paths | `nook-app/nook-platform/nook-replication/src/**`, `nook-app/nook-platform/nook-event-log/src/**`, `nook-app/nook-platform/nook-core/src/**`, `nook-app/nook-platform/nook-core/tests/*.rs` |
| **Integration harness tests** | Multi-device decentralized sync, provider union, session orchestration            | `nook-app/nook-platform/nook-core/tests/event_log_*.rs`, `multi_device_workflow.rs` |
| **E2e (Playwright)**          | Critical UI smoke only — unlock, save, local-provider sync, conflict UX           | `nook-app/nook-web/nook-web-app/e2e/`                                  |

When adding or changing domain logic, **add Rust tests first** (or in the same PR). Do not rely on e2e to catch regressions in sync or projection.

### Every bug fix requires a regression test

Finding a root cause is not completion.

Every AI-authored bug fix must add behavior-focused regression coverage.

That coverage must fail on the broken behavior and pass with the fix:

- **`nook-app-common` / `nook-core` / `nook-auth2` / `nook-replication` / `nook-event-log`:** add one or more Rust unit, property, or
  integration tests at the owning domain boundary.
- **Typed Rust/WASM boundary:** When the failure is reproducible without a browser, add the narrow Rust/WASM test first.
- This supplements the owning domain tests.
- It does not replace browser coverage for a user-visible bug.
- **Website or web extension:** Add a Playwright e2e test that reproduces the exact user sequence and asserts the previously missed failure.
- Component, Vitest, or WASM coverage alone is insufficient because the existing e2e suite already missed the integration bug.
- **Cross-layer bugs:** Cover each owning layer when practical.
- Add narrow Rust/WASM tests for policy or boundary behavior.
- Add Playwright for the visible website/extension regression.

If faithful automated reproduction is technically impossible, document the
specific constraint in the PR and add the closest deterministic lower-layer
test. Cost or inconvenience is not an exception.

### Line coverage threshold (90%)

The portable Rust crates (`nook-app-common`, `nook-core`, `nook-auth2`,
`nook-replication`, and `nook-event-log`)
are measured together with **`cargo llvm-cov nextest`** and checked against a
committed **90%** line floor:

| Artifact | Purpose |
| --- | --- |
| `nook-app/nook-platform/nook-core/coverage-floor.json` | Minimum combined line coverage % (currently **90**) |
| `task rust:coverage:check` | CI gate — compares measured vs floor |
| `task rust:coverage` | Report only (no threshold check) |
| `task rust:coverage:update` | Optional — rewrite floor file (user approval only) |

`task rust:coverage:check` runs warmed `cargo llvm-cov nextest` in-image.

It is part of `task check`, `task ci:pr`, and PR CI.

**Agent rules:**

1. Coverage **below 90% fails the GitHub Actions build** (`task rust:coverage:check` / PR Verify). Agents must not require a local coverage run for merge or handoff.
2. When measured coverage is **under 90%**, **add Rust tests** in the same task before finishing (prioritize new/changed domain code).
3. At or above 90%, do **not** chase marginal line coverage — focus tests on behavior and invariants instead.
4. Change `lines_percent` in `coverage-floor.json` only with explicit user approval.

Fast iteration without coverage instrumentation: `task rust:test` (nextest only).

- **Portable application and vault domain logic:** Add or update tests in
  `nook-app-common`, `nook-replication`, `nook-event-log`, `nook-core`, or `nook-auth2`, depending
  on the owning boundary (`task rust:test`). Prefer colocated module unit tests
  for pure mechanics; use `tests/event_log_workflow.rs` and siblings for
  multi-device/provider scenarios.
- **Complex sync cases:** Event-sourcing merge uses a causal DAG, not scalar vector clocks.
- Dedicated Rust tests are required for concurrent append, out-of-order delivery, join heads, and replacement/security conflicts.
- See [design-docs/vault-event-log.md](design-docs/vault-event-log.md).
- **Type safety in tests and code:** Prefer newtypes (`EventId`, `KeyEpoch`, `StoreId`, `DevicePublicKey`, …) over raw `String` / `u32` in `nook-core` domain APIs.
- A bare `String` does not carry meaning.
- The compiler cannot catch swapped arguments.
- Use serde-transparent wrappers so wire JSON stays unchanged.
- Version fields (`VaultEventSchemaVersion`, …) must be newtypes.
- The app keeps multiple schema versions and each struct must declare which version it speaks.
- Full inventory: [design-docs/typed-newtypes.md](design-docs/typed-newtypes.md).
- WASM getters may still return `String`; parse before calling core.
- No type-state for its own sake.
- **UI / integration:** Playwright e2e in `nook-app/nook-web/nook-web-app/e2e/` — `task web:test:e2e` on main CI and explicitly for PR validation (no PAT); credentialed live sync via the manual `e2e-pr.yml` workflow or `task web:test:e2e:sync-live`. See [workflows/ci-pipeline.md](workflows/ci-pipeline.md).
- **Debugging / troubleshooting / CI verification — always check app logs:**
  - After test output and static analysis, persisted application logs are the **most important** remaining signal.
  - When a Playwright spec fails, CI goes red, or a web flow misbehaves, agents **must** consult app logs before changing code.
  - Sources: Playwright attachment `nook-app-logs.json` (attached to every e2e result), `fetchAppLogs(page)` (`/app-logs`), or `dumpNookLogs(page)`.
  - Human UI: `/logs`.
  - See [references/logging.md § Debugging…](references/logging.md#debugging-troubleshooting-and-ci-verification).
- **Do not** re-implement vault rules in TypeScript for testing — if TS needs behavior, expose it from WASM/core first.

---

## 5. Pinned Dependencies & Tooling Constraints

- **Cargo Version Constraints:**
  - Pinned versions must be standard version strings (e.g., `age = "0.11.3"`, `hex = "0.4.3"`).
  - Do not prefix versions with `=` (e.g., `age = "=0.11.3"` is invalid).
  - Do not use semver ranges (`^`, `~`, `>=`, `*`) in dependencies.
- **Bun for Node/JS Tooling:**
  - Svelte project dependencies must be managed using Bun.
  - Do not commit `package-lock.json` or `yarn.lock`.
  - Commit `bun.lock` (with `package.json`) for reproducible Docker web installs.
  - Pin linux/amd64 native optional deps:
    `@rolldown/binding-linux-x64-gnu`,
    `@tailwindcss/oxide-linux-x64-gnu`,
    `lightningcss-linux-x64-gnu`.
  - Regenerate those pins via `docker run --platform linux/amd64 ... bun install`
    after web dependency changes.
- **Harness Verification:**
  - All linting, formatting, testing, and building must run inside the Docker builder image using Taskfile targets.
  - PR CI and local optional mirrors use dev/no-opt WASM mode.
  - Main/release deployment validation passes `WASM_BUILD_MODE=prod` explicitly.
  - Infrastructure automation must be defined in the `infra/Taskfile.yml` composition root or one of its flattened, domain-owned `infra/tasks/*.yml` Taskfiles.
  - Every domain file must be reachable from the composition root.
  - Do not add orphan Taskfiles or standalone shell scripts anywhere under `infra/`.
  - Repository preflight enforces this boundary.
  - Before every push, agents and developers must run **`task format` unconditionally**.
  - It formats Rust and JS/TS/Svelte inside sealed Docker images **and applies the diff to the host working tree**.
  - Sealed-only commands such as `task extension:format` do not write the host.
  - They must not be the sole format step.
  - **`task format` is the only required local product action.**
  - Product gates run on **GitHub Actions**.
  - Gates include format check, Clippy, vitest, svelte-check, web lint (Knip unused and jscpd clone detection), web build, coverage, and e2e.
  - See [dynamic-skills/pre-push-hygiene.md](dynamic-skills/pre-push-hygiene.md) and [dynamic-skills/github-actions-only-validation.md](dynamic-skills/github-actions-only-validation.md).
  - **Fix findings, do not silence them:** If Knip, jscpd, or any other check in CI / `task check` fails, agents must fix the underlying code in the same task.
  - Raising thresholds, ignoring authored product sources, or shipping with a red gate is forbidden unless the task explicitly maintains the gate.
  - See [workflows/quality.md § Fix check findings](workflows/quality.md#fix-check-findings--not-silence-them).

### Dockerfile cache mounts — never use them

> ## ⛔ STRICTLY PROHIBITED: `RUN --mount=type=cache`
>
> **Never add a Dockerfile `RUN --mount=type=cache` directive anywhere in this repository.**
> Cache mounts introduce hidden BuildKit-daemon state.
> They can serialize concurrent builds.
> They have caused immediate severe performance regressions on the shared runner.
> Install dependencies directly in ordinary Dockerfile `RUN` layers.
> Let the immutable Docker layer plus the pinned lockfile be the cache boundary.
>
> This prohibition applies regardless of `sharing=shared`, `sharing=private`, or
> `sharing=locked`, and regardless of the comma-separated mount-option order.
> Changing the sharing mode or placing `type=cache` later is not an acceptable workaround.
> The repository-root Rust suite at `preflight/` enforces this rule. Run it
> through `task preflight`; `task check`, PR CI, and main CI run it before the
> application Docker setup begins. Repository-wide invariant tests belong in
> this standalone crate, not in the `nook-app` Cargo workspace or shell snippets.

### Docker daemon — never kill it

> ## ⛔ STRICTLY PROHIBITED: killing the Docker daemon
>
> **Agents and humans must never stop, restart, or kill Docker Desktop, `dockerd`, or the Docker VM.**
> Only **individual containers** may be stopped. The daemon itself is off limits.
>
> - **Forbidden:** `killall Docker`, `killall docker`, `pkill docker`, `pkill -f docker`, `osascript` quit Docker, `systemctl stop docker`, or any command aimed at the daemon, VM, or Desktop app.
> - **Forbidden:** `lsof -ti :<port> | xargs kill` when that port is bound by Docker port-forwarding (e.g. `task web:dev` on `:5173`) — that can disrupt the daemon and break the user's environment.
> - **Allowed:** Stop **individual containers** only, e.g. `docker stop <container_id>` or `docker compose down` for a specific project stack.
> - **Allowed:** Free a dev port by stopping the container that owns it (`docker ps --filter publish=5173` → `docker stop <id>`), not by killing PIDs blindly.
>
> Local web dev: `task web:dev`. Install deps: `task web:install`. Do not bypass Taskfile with host `npm`/`vite` unless the user explicitly asks.

---

## 6. Git & Pull Request Workflow

> ## ⛔ SQUASH MERGE ONLY — NO EXCEPTIONS
>
> **Every pull request merged into `main` MUST use GitHub’s “Squash and merge”.**
>
> - **One PR → one commit on `main`.** Feature branches may have many commits; `main` must not.
> - **Forbidden:** “Create a merge commit”, “Rebase and merge”, fast-forward merges that preserve branch commits, or `gh pr merge` without `--squash`.
> - **Required:** `gh pr merge --squash` (or the GitHub UI button **Squash and merge**).
> - **Agents and humans:** If you merge a PR, confirm the merge method is squash before clicking merge. If a PR was merged any other way, that is a process violation — fix history or open a follow-up; do not repeat.
>
> Linear `main` history is a project requirement, not a preference.

> ## ⛔ INSPECT EXISTING FEEDBACK; DO NOT WAIT FOR REVIEWERS
>
> Before merge or handoff, inspect comments and findings that already exist and
> address every active actionable item, regardless of whether it came from a
> human or an external service. Reply with the fix, validation, or no-change
> rationale and resolve each actionable thread. Every external-service review
> comment already present must be inspected. Codex, Claude, Cursor, CodeRabbit,
> and all other external reviewers are optional: do not request or wait for them
> when no feedback is present. Optional review never means optional handling of
> feedback that already arrived.

> ## ⛔ FORMAT LOCALLY; PRODUCT GATES ON GITHUB ACTIONS ONLY
>
> Once a change or experiment is coherent enough to check, the mandatory sequence is:
>
> 1. **`task format`**
> 2. **commit**
> 3. **push**
> 4. **allowlisted `task remote TASK_NAME=<name>` as useful**
>
> Heavy builds/tests do not run on the agent machine.
> Ordinary pushes deliberately do not start the complete PR workflow.
>
> At the final validation boundary, run `task pr:validate PR=<number>` (or add `FULL_E2E=1` for a Main-fix PR).
> Monitor review feedback while repository-owned exact-head checks run.
> New actionable feedback takes priority over waiting for checks on a head that must change.
> Stop watching or cancel obsolete validation, address and resolve the feedback, push the replacement head, and restart validation.
> Let exact-head checks finish only while the actionable feedback queue is empty.
> A later push invalidates prior results and requires another explicit validation.
> After any red remote run: fix, `task format`, commit, push, and dispatch the useful focused or complete remote validation again.
> See [workflows/remote-execution.md](workflows/remote-execution.md).

- **Never push directly to `main`.** All changes land on `main` only through merged pull requests.
- **Default workflow:** Follow [workflows/coding-bro.md](workflows/coding-bro.md) for every implementation task.
- Steps: fetch, branch from `origin/main`, implement, **always `task format`**, commit and push/open/update the PR, use focused hosted tasks while iterating, explicitly trigger complete PR validation when ready, fix failures, address comments and conflicts, require `task pr:ready`, and squash-merge automatically.
- Do not stop at a ready-PR handoff or ask for separate merge permission.
- Do not run heavy product checks locally.
- **Finish at implementation PR merge.** A successful squash merge completes normal implementation delivery.
- Do not wait for or monitor the post-merge Main workflow, development deployment, or live origins unless the user explicitly requested deployment/live verification or assigned a Main failure.
- Main remains an independently observable repository signal, not a task completion gate.
- **Always use a feature branch.** Branch from `main`, commit there, and push the branch — not `main`.
- **Always open and land a pull request.** After pushing a branch, create a PR with a summary and test plan, own it through validation and conflict/comment resolution, then squash-merge it after the readiness audit succeeds. Never push directly to `main`.
- **Squash merge when closing a PR.** When merging (yourself or via `gh`), use **Squash and merge** only:
  ```bash
  gh pr merge <number> --squash
  ```
  Never use `gh pr merge --merge` or `gh pr merge --rebase`.
- **Inspect feedback without waiting.** After opening or updating the PR at the final-validation boundary, monitor applicable repository-owned checks (format must already have been host-applied before the push) and inspect feedback already present. Do not request or wait for external reviews. Do not require a local product gate.
- **Publish Workbench context after merge.** Follow
  [workflows/issues.md](workflows/issues.md) and
  [workflows/agent-statistics.md](workflows/agent-statistics.md): the task plan
  must already have been published before implementation; update the associated
  Markdown issue, add the linked completion worklog, and publish the completed
  `stats/ai-agent/<source-pr>.yaml` to `meta-secret/nook-workbench`, including
  repository test counts by type and absolute total. Compare recent comparable
  PRs and own a normal performance-fix PR for actionable regression or waste.
  Publish immediately after merge without waiting for post-merge Main workflows
  or deployments. Workbench content commits are not Nook PRs and do not run
  Nook product gates.
