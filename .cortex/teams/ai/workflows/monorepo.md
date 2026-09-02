# Cross-Package Changes

## Overview

Use this workflow for feature work that touches more than one package.

0. Follow [mission delivery](../../../gizmo/workflows/mission-delivery.md).
   Fetch `origin/main`, branch, and never push to `main`. See
   [pull requests](../../../gizmo/workflows/pull-requests.md).
   0b. **Merge with squash only.** When a PR is merged, use **Squash and
   merge** (`gh pr merge --squash`). Never merge commit or rebase merge. See
   [pull requests](../../../gizmo/workflows/pull-requests.md#squash-merge-only---no-exceptions).
   0c. Estimate authored additions and map package ownership before editing.
   Do not create a PR whose planned authored diff exceeds 2,000 lines. Do not
   split, stack, or rebuild a PR to recover from size growth. If review fixes
   exceed 2,000 authored additions, stop and simplify the design.
   Follow
   [pull request size](../../../gizmo/workflows/pull-requests.md#pull-request-size-and-modularity).
1. Identify the lowest package that should own the behavior.
2. Put portable logic and domain models in `nook-core`; keep browser I/O and JS-friendly conversion in `nook-wasm`.
3. Expose typed core DTOs/enums through WASM when possible instead of recreating their tags in TypeScript.
4. Consume generated WASM APIs directly when they are already ergonomic; add wrappers under `nook-app/nook-web/nook-web-shared/src/vault-app/lib` only for UI/browser glue, localization, or reactive state.
5. Keep shadcn-svelte UI primitives and default styling in `nook-app/nook-web/nook-web-shared/src/vault-app/lib/components/ui` and `nook-app/nook-web/nook-web-shared/src/vault-app/app.css`.
6. Add or update tests in the owning package (`nook-core` Rust tests for domain logic; Playwright for UI flows).
7. Add new app routine commands to the nearest owning Taskfile: web-family tasks under `nook-app/nook-web/Taskfile.yml` , Docker tasks under `nook-app/nook-platform/docker/Taskfile.yml`, CI tasks under `nook-app/ci/Taskfile.yml`, and repo-level non-app commands under the root `Taskfile.yml` or root `.task/`.
8. Update `.cortex` docs when architecture or workflow changes.
9. Run required formatters and commit every resulting mutation in the allowed
   AI paths. Gizmo continues from that coherent commit and runs
   `task loom:pre-push`.
   - If hygiene mutates AI-owned source or Cortex content, the AI team returns
     a fresh formatted commit. Gizmo continues from it and reruns hygiene before
     pushing.
   - Do not run local builds, tests, checks, lint, typechecks, or e2e.
   - Do not run local package installation or compiler commands.
   - Do not run local container product gates.
   - Do not duplicate hosted-check mirrors before push.
   - If the pushed head is not validation-ready, Gizmo dispatches at least one
     relevant focused hosted task immediately.
   - When the head is validation-ready, Gizmo dispatches complete exact-head
     validation immediately. Focused tasks are optional on that path.
   - Gizmo obtains fresh exact-head remote evidence after every replacement
     push.

For a PR that changes multiple packages:

1. Introduce or stabilize the narrowest owning interface first.
2. Keep AI work inside the PR scope identified by its assigned Gizmo ID. The
   feature-slice Gizmo is a passive immutable Workbench record, not a process
   or controller. Team Agent count does not determine record or PR count.
3. Return the AI Team Agent's existing typed handoff directly to Gizmo Prime;
   bind it to the assigned Gizmo ID through existing plan/task context. Gizmo
   Prime aggregates scope, stable interfaces, estimate, exact direct commits,
   and evidence under that record. This introduces no new handoff transport.
   The AI worker does not create PRs, request readiness, or merge.
4. Gizmo Prime owns the complete PR lifecycle: same-repository branch and PR
   creation, full checks, exact-head readiness, and squash merge.
5. Keep unrelated package changes out of the PR.

Dependency direction must stay:

```
nook-core → nook-wasm → nook-web
```

- Do not make `nook-core` depend on `nook-wasm`, browser, Svelte, Bun,
  IndexedDB, HTTP, or session concepts.
  - `wasm-bindgen` annotations on simple core DTOs and enums are allowed when
    they preserve one typed domain model across Rust and web.
- Use Bun for Nook web and Loom JavaScript tooling.
- Run project commands through Taskfile and Docker.
- Do not introduce npm flows or lockfiles into Bun-owned packages.
  - `agentic-ai/ci-agent` is the maintained Node/npm exception and owns its
    `package-lock.json`.

## New vault item type checklist

Portable work belongs in `nook-core` first so web, mobile, and CLI can share it:

1. `nook-app/nook-platform/nook-core/src/secrets/secret_types.rs` — enum variant + payload struct + `SecretValue` parse/serialize.
2. `nook-app/nook-platform/nook-core/src/secrets/secret_view.rs` — list/search/build helpers (`display_title`, `group_key`, `build_secret_yaml`, …).
3. `nook-app/nook-platform/nook-wasm/src/secret_api/secret_record.rs` — expose fields on `NookSecretRecord`; extend `records_to_array` if needed.
4. `nook-app/nook-platform/nook-core` tests — payload round-trips and validation (no TS mirror tests).
5. `nook-app/nook-web` — form + detail UI only; use `build_secret_yaml` and
   wasm getters, not duplicated TS schemas.
6. Playwright — user flow coverage when the type is exposed in the vault UI.

See [references/rust-wasm.md](../../dev-core/references/rust-wasm.md) §4 for the boundary pattern.
