You are updating all outdated direct Rust dependencies for the Nook monorepo.

## Context

- Repository: ${GITHUB_REPOSITORY}
- Dependency-audit workflow run id: ${GITHUB_RUN_ID}
- Fix branch (use exactly): `${FIX_BRANCH}`

Read `.cortex/AGENTS.md`, `.cortex/rules.md`, and
`.cortex/workflows/coding-bro.md` before making changes.

## Required work

1. Inspect **every direct dependency** in these Rust roots:
   - `nook-app/nook-platform/`
   - `nook-app/nook-platform/fuzz/`
   - `agentic-ai/minds/`
   - `preflight/`

   Do not update a subset because one package was reported first.
   Update all outdated direct Rust dependencies.
   Include incompatible releases when the project can be migrated safely.
2. Preserve Nook's version policy.
   Use explicit standard version strings in `Cargo.toml`.
   Never use `=`, `^`, `~`, `>=`, or `*`.
   Update the lockfile owned by each changed Rust root.
3. Make the smallest required source, feature-flag, or test changes for the
   upgraded APIs. Maintain the Rust/WASM boundary and add behavior-focused Rust
   tests for changed domain behavior.
4. Once the change is coherent, run the **full deterministic suite**, not only
   a scoped test, before you finish so the harness can open a fully validated
   PR:
   ```bash
   WASM_BUILD_MODE=prod task ci:pr:e2e VITE_BASE=/ VITE_VAULT_SYNC_INTERVAL_MS=1000
   task docker:ecosystem:fuzz FUZZ_SECONDS=20
   task hive:verify
   ```
   This covers repository preflight, Rust coverage/unit tests, WASM checks, web
   checks/unit tests/builds, every local-provider Playwright e2e spec, and the
   extension e2e. The additional targets cover the separate fuzz workspace and
   compile, lint, and test both Hive and Lace in the Minds workspace. The
   credentialed real-provider suite remains an explicit manual
   check through the E2E (PR) workflow.
5. If the full suite finds a regression, diagnose it (including persisted app
   logs for any e2e failure), fix it, and repeat the applicable full validation.

## CI toolchain (Docker)

The job runs `task setup` before you start (sealed **nook-web:local**). You run
inside the **nook-ci-agent** container with the repo bind-mounted and the host
Docker socket mounted (`/var/run/docker.sock`). Use repository Task targets for
all project validation; do not replace them with hand-written Docker commands.

## Rules

- Do not run `git` commands; the harness commits and pushes `${FIX_BRANCH}`.
- Do not create or merge a PR; the harness handles the PR after validation.
- Do not commit secrets, `.env`, or credentials.
- Keep the diff focused on the dependency upgrade and its compatibility fixes.
- Never kill the Docker daemon; only stop individual containers if necessary.
