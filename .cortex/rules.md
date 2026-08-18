# Nook Coding Rules & Golden Principles

## Overview

This document defines the core Golden Principles and hard repository invariants for the Nook monorepo.
It remains high-level and principle-focused.
For granular operational rules and deep domain walkthroughs, consult the specialized cards in `.cortex/dynamic-skills/`, `architecture/`, and `workflows/` as mapped in [`.cortex/knowledge-graph.md`](knowledge-graph.md).

---

## 1. Monorepo Architecture & Package Boundaries

Detailed specification: [architecture/packages.md](architecture/packages.md).

- **README synchronization:** Update the root [`README.md`](../README.md) in the same PR whenever boundaries, package layout, or public commands change.
- **Strict uni-directional flow:** Dependency flow is strictly `nook-app-common` → `nook-auth2` / `nook-replication` → `nook-event-log` → `nook-core` → `nook-wasm` → `nook-web`. Circular dependencies or reverse imports are prohibited.
- **Domain in Rust:** All business logic, cryptographic operations, state machines, password generation, search filtering, and validation belong in portable Rust crates.
- **`nook-app-common`:** Owns dependency-light primitives, locale catalogs, translation logic, and generated i18n key registries.
- **`nook-replication`:** Owns provider-neutral causal DAG, immutable replica-set, outbox, and repair mechanics.
- **`nook-event-log`:** Owns signed vault events, actor authorization over the causal graph, deterministic encrypted projection, and key-epoch metadata.
- **`nook-core`:** Pure domain logic with zero browser, Svelte, Bun, IndexedDB, HTTP, or session-state dependencies.
- **`nook-wasm`:** Adapts browser I/O (IndexedDB, network transports) and manages WASM session state; never duplicates core domain models.
- **Dynamic exploration:** Prohibit static directory trees and ASCII art; explore paths dynamically and use Mermaid for diagrams. See [dynamic-skills/cortex-writer.md](dynamic-skills/cortex-writer.md).

---

## 2. Rust & WASM Boundary Standards

Detailed references & skills:
- [references/rust-wasm.md](references/rust-wasm.md)
- [dynamic-skills/rust-wasm-name-coherence.md](dynamic-skills/rust-wasm-name-coherence.md)
- [dynamic-skills/rust-macro-minimization.md](dynamic-skills/rust-macro-minimization.md)

- **Explicit error propagation:** Fallible exported `#[wasm_bindgen]` functions must return `Result<T, wasm_bindgen::JsError>` so JavaScript catches real `Error` objects with stack traces.
- **No `JsValue` in authored Rust:** Authored `nook-wasm` must use strongly typed structs and narrow `web-sys`/`js-sys` types instead of raw `JsValue`.
- **Name coherence:** Exported Rust functions and methods keep their exact authored names in JavaScript without `js_name` callable renames.
- **Native async:** Use native Rust `async/await` syntax inside WASM; do not use raw JavaScript promises or `JsFuture`.
- **Domain enums over string tags:** Export core enums and DTOs through WASM directly rather than mirroring them as loose string unions in TypeScript.

---

## 3. Svelte 5 & TypeScript UI Standards

Detailed skills & UI design:
- [dynamic-skills/typescript-single-parameter.md](dynamic-skills/typescript-single-parameter.md)
- [dynamic-skills/typescript-no-unknown.md](dynamic-skills/typescript-no-unknown.md)
- [dynamic-skills/typescript-named-args.md](dynamic-skills/typescript-named-args.md)
- [dynamic-skills/ui-design-skills.md](dynamic-skills/ui-design-skills.md)

- **No authored `null`:** Authored TypeScript and Svelte code must not use `null` as a value, state sentinel, return type, or prop value.
- **Explicit absence sentinels:** Prohibit authored `undefined` value or type tokens; convert optional external input directly into named domain discriminated unions at the narrow transport boundary.
- **Single-parameter functions:** Every function or method takes at most one parameter; wrap multi-value inputs in a named semantic object type.
- **Named argument types:** Require named semantic object parameter contracts and ban raw object literals in function calls.
- **No authored `unknown` or `object`:** Banned in application and domain code; allowed only within dedicated boundary adapters that narrow immediately.
- **Svelte 5 runes & state encapsulation:** Components remain thin and bind directly to Svelte 5 state classes (`.svelte.ts`) using `$state` and `$derived`.
- **Separation of concerns:** Svelte components handle only layout and UI events; vault crypto, validation, and serialization belong strictly in Rust/core.

---

## 4. Testing & Regression Requirements

Detailed specifications & beliefs:
- [design-docs/core-beliefs.md §9](design-docs/core-beliefs.md#9-unit-tests-own-domain-correctness-e2e-is-smoke-only)
- [design-docs/vault-event-log.md](design-docs/vault-event-log.md)
- [references/logging.md](references/logging.md)
- [workflows/ci-pipeline.md](workflows/ci-pipeline.md)

- **Testing pyramid:** Unit and property tests in Rust carry ~99% of functional domain coverage; Playwright e2e is smoke coverage only.
- **Mandatory regression coverage:** Every bug fix must add a behavior-focused test that reproduces the failure before the fix.
- **Coverage floor (90%):** Combined portable Rust crates must maintain at least 90% line coverage measured via `task rust:coverage:check`.
- **Typed newtypes:** Use serde-transparent newtypes (`EventId`, `KeyEpoch`, `StoreId`, `DevicePublicKey`) in domain APIs rather than bare `String` or `u32`.
- **Consult app logs:** When debugging failing tests or CI, always inspect persisted application logs (`nook-app-logs.json`, `/logs`) before modifying code.

---

## 5. Tooling, Dependencies & Container Harness

Detailed skills & workflows:
- [dynamic-skills/prefer-popular-libraries.md](dynamic-skills/prefer-popular-libraries.md)
- [dynamic-skills/pre-push-hygiene.md](dynamic-skills/pre-push-hygiene.md)
- [dynamic-skills/github-actions-only-validation.md](dynamic-skills/github-actions-only-validation.md)
- [workflows/quality.md](workflows/quality.md)

- **Pinned dependencies:** Use exact version strings in `Cargo.toml` without ranges (`^`, `~`, `>=`) or `=` prefixes.
- **Bun for web tooling:** Manage web dependencies with Bun (`bun.lock`); `agentic-ai/ci-agent` is the only maintained Node/npm package.
- **Prefer popular libraries:** Choose mature, high-adoption crates and npm packages; reject obscure or low-download dependencies.
- **Containerized execution:** Run all builds, formatting, tests, and linting through Docker using Taskfile targets.
- **Pre-push hygiene:** Always run `task loom:pre-push` before pushing to apply host formatting and verify the UI demo contract.
- **Fix findings immediately:** Fix all static analysis, Knip, and jscpd findings in the same task; do not silence them or raise thresholds.
- **No Dockerfile cache mounts:** Prohibit `RUN --mount=type=cache` directives; let immutable Docker layers and lockfiles define the cache boundary.
- **Never kill Docker daemon:** Never stop, restart, or kill `dockerd` or the Docker Desktop VM; stop individual containers only.

---

## 6. Git, PR Delivery & Verification Workflow

Detailed workflows & skills:
- [workflows/coding-bro.md](workflows/coding-bro.md)
- [workflows/pull-requests.md](workflows/pull-requests.md)
- [workflows/remote-execution.md](workflows/remote-execution.md)
- [workflows/issues.md](workflows/issues.md)
- [workflows/agent-statistics.md](workflows/agent-statistics.md)
- [dynamic-skills/agent-feature-ownership.md](dynamic-skills/agent-feature-ownership.md)
- [dynamic-skills/code-review-comments.md](dynamic-skills/code-review-comments.md)

- **PR size limit (5,000 lines):** Keep implementation pull requests at or below 5,000 authored changed lines; sequence larger features across ordered PRs.
- **Squash merge only:** Every pull request merged to `main` must use `gh pr merge --squash` or GitHub **Squash and merge**.
- **Feature branches only:** Never push directly to `main`; always branch from `origin/main` and open a PR.
- **Remote product gates:** Heavy builds and tests run on GitHub Actions; ordinary pushes do not run complete validation until explicitly triggered.
- **Exact-head review & validation:** Trigger complete validation and exact-head Cloud review at the completion boundary via `task pr:validate`.
- **Address existing feedback:** Inspect and resolve all active human or automated review comments before merging or handoff.
- **Workbench integration:** Publish task plans before implementation, and publish completion worklogs and AI agent statistics (`stats/ai-agent/<pr>.yaml`) after merge.

