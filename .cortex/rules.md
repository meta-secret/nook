# Nook Coding Rules & Golden Principles

This document defines the strict development standards, architectural boundaries, and validation requirements for the Nook monorepo. All changes must comply with these guidelines.

---

## 1. Monorepo Architecture & Package Boundaries

- **README stays in sync:** When this section's boundaries, package layout, sync model, or public Task surface change, update the root [`README.md`](../README.md) in the same PR. See [AGENTS.md — Keep the root README current](AGENTS.md#keep-the-root-readme-current).
- **Strict Uni-directional Flow:** The dependency path is strictly `nook-auth2` ➔ `nook-core` ➔ `nook-wasm` ➔ `nook-web`. Circular dependencies or reverse imports (e.g. importing a WASM type inside `nook-core`) are strictly forbidden.
- **`nook-core` Isolation:**
  - Must remain Rust domain code with no browser, Svelte, Bun, IndexedDB, HTTP, or session-state behavior.
  - May use `wasm-bindgen` annotations on simple domain DTOs/enums when that exposes the real core type through WASM and avoids a TypeScript/string mirror.
  - Must not depend on `js-sys`, `web-sys`, or any browser Web APIs.
  - Must be fully compilable and testable on native desktop/server targets.
  - **Rust-First for Reuse (including i18n):** Keep as much domain logic, validation rules, and resources (like localization catalogs) in Rust (`nook-core`). This guarantees that future platforms—like a CLI tool or mobile apps—can easily reuse this code, which would not be possible if implemented in TypeScript.
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
  - Avoid raw `JsValue` types unless required by external APIs (like `js_sys::Array::push`).
  - Use strongly-typed structures or system-supported types where possible.
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
  default prop value. Use `undefined` for absent values and model meaningful
  UI/domain states with discriminated unions or Rust/WASM-owned enums. Browser
  APIs that return `null` must be normalized at the boundary with
  `?? undefined`; do not let nullable values flow through app code. Generated
  WASM bindings may mention `null` because wasm-bindgen emits those types; do
  not hand-edit generated files.
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

**E2e tests are smoke tests, not a substitute for domain coverage.** Playwright flows exercise a thin slice of user paths (happy paths, a few conflict screens). They do **not** prove correctness of event sourcing, causal DAG merge, projection replay, epoch rotation, crypto, or multi-device sync.

| Layer                         | Target                                                                            | Where                                                        |
| ----------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Unit / property tests**     | ~99% of domain behavior — edge cases, concurrency, replay invariance, error paths | `nook-app/nook-core/src/**` `#[cfg(test)]`, `nook-app/nook-core/tests/*.rs`    |
| **Integration harness tests** | Multi-device decentralized sync, provider union, session orchestration            | `nook-app/nook-core/tests/event_log_*.rs`, `multi_device_workflow.rs` |
| **E2e (Playwright)**          | Critical UI smoke only — unlock, save, local-provider sync, conflict UX           | `nook-app/nook-web/e2e/`                                              |

When adding or changing domain logic, **add Rust tests first** (or in the same PR). Do not rely on e2e to catch regressions in sync or projection.

### Line coverage threshold (90%)

`nook-core + nook-auth2` line coverage is measured with **`cargo llvm-cov nextest`** and checked against a committed **90%** floor:

| Artifact                        | Purpose                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `nook-app/nook-core/coverage-floor.json` | Minimum **line** coverage % for `nook-core + nook-auth2` (currently **90**)                                                            |
| `task rust:coverage:check`      | CI/local gate — runs the warmed `cargo llvm-cov nextest` in-image and compares measured vs floor (part of `task check`, `task ci:pr`) |
| `task rust:coverage`            | Report only (no threshold check)                                                                                                      |
| `task rust:coverage:update`     | Optional — rewrite floor file to measured % (user approval only)                                                                      |

**Agent rules:**

1. Run `task rust:coverage:check` (or `task check`) on the latest pushed head before merge or handoff — coverage **below 90% fails the build**.
2. When measured coverage is **under 90%**, **add Rust tests** in the same task before finishing (prioritize new/changed domain code).
3. At or above 90%, do **not** chase marginal line coverage — focus tests on behavior and invariants instead.
4. Change `lines_percent` in `coverage-floor.json` only with explicit user approval.

Fast iteration without coverage instrumentation: `task rust:test` (nextest only).

- **Vault domain logic:** Add or update tests in `nook-core` or `nook-auth2`, depending on the owning boundary (`task rust:test` / `cd nook-app && cargo nextest run -p nook-core -p nook-auth2 --profile ci`). Prefer colocated module unit tests for pure functions; use `tests/event_log_workflow.rs` and siblings for multi-device / provider scenarios.
- **Complex sync cases:** Event-sourcing merge (causal DAG, not scalar vector clocks), concurrent append, out-of-order delivery, join heads, replacement/security conflicts — must have dedicated Rust tests. See [design-docs/vault-event-log.md](design-docs/vault-event-log.md).
- **Type safety in tests and code:** Prefer newtypes (`EventId`, `KeyEpoch`, `StoreId`, `DevicePublicKey`, …) over raw `String` / `u32` in `nook-core` domain APIs. A bare `String` does not carry meaning; the compiler cannot catch swapped arguments. Use serde-transparent wrappers so wire JSON stays unchanged. Version fields (`VaultEventSchemaVersion`, …) must be newtypes — the app keeps multiple schema versions and each struct must declare which version it speaks. Full inventory: [design-docs/typed-newtypes.md](design-docs/typed-newtypes.md). WASM getters may still return `String`; parse before calling core. No type-state for its own sake.
- **UI / integration:** Playwright e2e in `nook-app/nook-web/e2e/` — `task web:test:e2e` on main CI and explicitly for PR validation (no PAT); live sync via `task web:test:e2e:sync-live` nightly. See [workflows/ci-pipeline.md](workflows/ci-pipeline.md).
- **Debugging / troubleshooting / CI verification — always check app logs:** After
  test output and static analysis, persisted application logs are the **most
  important** remaining signal. When a Playwright spec fails, CI goes red, or a web
  flow misbehaves, agents **must** consult app logs before changing code:
  Playwright attachment `nook-app-logs.json` (attached to every e2e result),
  `fetchAppLogs(page)` (`/app-logs`), or `dumpNookLogs(page)`. Human UI: `/logs`. See
  [references/logging.md § Debugging…](references/logging.md#debugging-troubleshooting-and-ci-verification).
- **Do not** re-implement vault rules in TypeScript for testing — if TS needs behavior, expose it from WASM/core first.

---

## 5. Pinned Dependencies & Tooling Constraints

- **Cargo Version Constraints:**
  - Pinned versions must be standard version strings (e.g., `age = "0.11.3"`, `hex = "0.4.3"`).
  - Do not prefix versions with `=` (e.g., `age = "=0.11.3"` is invalid).
  - Do not use semver ranges (`^`, `~`, `>=`, `*`) in dependencies.
- **Bun for Node/JS Tooling:**
  - Svelte project dependencies must be managed using Bun.
  - Do not commit `package-lock.json` or `yarn.lock`. Commit `bun.lock` (with `package.json`) for reproducible Docker web installs. Pin linux/amd64 native optional deps (`@rolldown/binding-linux-x64-gnu`, `@tailwindcss/oxide-linux-x64-gnu`, `lightningcss-linux-x64-gnu`) — regenerate via `docker run --platform linux/amd64 ... bun install` after web dep changes.
- **Harness Verification:**
  - All linting, formatting, testing, and building must run inside the Docker builder image using Taskfile targets. Local `task check` and PR CI use dev/no-opt WASM mode; main/release deployment validation passes `WASM_BUILD_MODE=prod` explicitly.
  - Before committing, developers must run:
    1. `task format` - Automatically formats all Rust and JS/TS/Svelte files.
    2. `task check` - Runs formatting checks, Rust Clippy warnings checks, vitest unit tests, Svelte type checks, and web builds.

### Dockerfile cache mounts — never use them

> ## ⛔ STRICTLY PROHIBITED: `RUN --mount=type=cache`
>
> **Never add a Dockerfile `RUN --mount=type=cache` directive anywhere in this repository.**
> Cache mounts introduce hidden BuildKit-daemon state, can serialize concurrent
> builds, and have caused immediate severe performance regressions on the shared
> runner. Install dependencies directly in ordinary Dockerfile `RUN` layers and
> let the immutable Docker layer plus the pinned lockfile be the cache boundary.
>
> This prohibition applies regardless of `sharing=shared`, `sharing=private`, or
> `sharing=locked`. Changing the sharing mode is not an acceptable workaround.
> PR and main CI enforce this rule through `_ci:dockerfile-cache-policy`.

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

> ## ⛔ NEVER WAIT FOR EXTERNAL REVIEWS OR CHECKS
>
> Applicable repository-owned PR test checks are the only remote checks agents
> wait for: normally `PR / Verify and preview`, plus `Web research / Build and
> deploy research catalog` when web-research paths change. Codex review is explicitly optional and is not a
> merge gate. Agents must never request, poll, monitor, or delay work for Codex,
> Claude, Cursor, CodeRabbit, or any other external review, check, deployment,
> or service. Once Nook's own applicable PR test checks pass, do not add a grace period for
> external feedback.
>
> Before merge or handoff, inspect comments and findings that already exist and
> address every active actionable item, regardless of whether it came from a
> human or an external service. Reply with the fix, validation, or no-change
> rationale, then proceed without waiting for another response, re-review, or
> external status transition. Every external-service review comment already
> present must be inspected; optional review never means optional handling of
> feedback that arrived.

> ## ⛔ PUSH BEFORE FINAL CHECKS — RUN LOCAL AND PR CHECKS IN PARALLEL
>
> Once a change or fix is coherent enough to check, the mandatory sequence is:
> **commit → push/open or update the PR → start local validation while the
> applicable repository-owned PR workflows run**. Never finish `task check`, a
> full test suite, build, e2e, or another final gate before pushing the checkable
> change; serializing local then remote validation wastes wall-clock time.
>
> Fast focused commands needed during implementation are allowed before the
> commit. Required final validation and post-fix validation run on the latest
> already-pushed head. A local failure still must be fixed, committed, and pushed
> before rerunning the required local gate in parallel with refreshed PR checks.

- **Never push directly to `main`.** All changes land on `main` only through merged pull requests.
- **Default workflow:** Follow [workflows/coding-bro.md](workflows/coding-bro.md) for every implementation task — fetch, branch from `origin/main`, implement, commit and push/open/update the PR before required final checks, run local validation while Nook's applicable PR test checks run, fix failures, address comments already present, and squash merge. Never wait for external services.
- **Always use a feature branch.** Branch from `main`, commit there, and push the branch — not `main`.
- **Always open a pull request.** After pushing a branch, create a PR with a summary and test plan; do not merge or push to `main` yourself unless the user explicitly asks.
- **Squash merge when closing a PR.** When merging (yourself or via `gh`), use **Squash and merge** only:
  ```bash
  gh pr merge <number> --squash
  ```
  Never use `gh pr merge --merge` or `gh pr merge --rebase`.
- **Verify without requesting review.** After opening or updating the PR at the final-validation boundary, run `task format` and `task check` on the latest pushed head before merge or handoff. Do not request an external review.
