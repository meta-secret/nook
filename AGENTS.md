# Nook Agent Entry Point

Read [`.cortex/AGENTS.md`](.cortex/AGENTS.md) before making changes in this
repository. It is the system of record for architecture, product context, rules,
and workflows.

## Review guidelines

- Treat violations of [`.cortex/AGENTS.md`](.cortex/AGENTS.md) or its linked
  architecture and workflow rules as P1 findings.
- Treat weakened cryptographic, authentication, authorization, device-identity,
  or vault-storage boundaries as P1 findings, including plaintext secret
  persistence or sensitive data in logs.
- Flag business or validation logic added to TypeScript/Svelte when it belongs
  in `nook-core` and should be exposed through the typed Rust/WASM boundary.
- Require behavior-focused Rust tests for changed domain logic and targeted web
  tests for changed user flows; do not accept e2e coverage as a substitute for
  domain tests.
- Flag authored TypeScript/Svelte `null`, visible inline English instead of the
  shared translation catalogs, and undocumented schema or storage migrations.

## Cursor Cloud specific instructions

This Cloud VM runs Nook **natively** (no Docker/Task). The repo's public `task …`
commands orchestrate Docker builds; on this VM run the underlying native commands
below instead. The snapshot already has: Rust 1.96 (`rustup default`, with the
`wasm32-unknown-unknown` target + clippy/rustfmt/llvm-tools), `wasm-pack` 0.15.0,
`cargo-nextest`, `cargo-llvm-cov`, the `mold` linker (required by
`nook-app/.cargo/config.toml` `-fuse-ld=mold`), Node 22, and Bun 1.3.14
(`~/.bun/bin`, added to PATH via `~/.bashrc`). Playwright Chromium is installed
under `~/.cache/ms-playwright`.

**Build the WASM package first.** The web app and web unit/e2e tests import the
generated, git-ignored `nook-wasm` package; it must exist before running them.
The build is incremental (skips when a source-hash stamp matches):

```sh
cd nook-app && wasm-pack build nook-wasm --target web \
  --out-dir ../nook-web/nook-web-shared/src/vault-app/lib/nook-wasm \
  --out-name nook_wasm --no-opt
```

**Run / test commands (native equivalents of the Docker `task` targets):**

- Dev server (native HTTP — no mkcert/HTTPS): `cd nook-app/nook-web/nook-web-app && bun run dev -- --host 0.0.0.0 --port 5173`. Landing = `http://localhost:5173/`, unified vault harness = `http://localhost:5173/app/`. (Docker `task web:dev` uses trusted-HTTPS + mkcert; not needed here.)
- Rust tests: `cd nook-app && cargo nextest run -p nook-core -p nook-auth2 --profile ci`.
- Rust coverage floor: `cd nook-app && cargo llvm-cov nextest --no-clean --profile ci -p nook-core -p nook-auth2 --summary-only --fail-under-lines "$(jq -r .lines_percent nook-core/coverage-floor.json)"`.
- Rust lint: `cd nook-app && cargo clippy -p nook-core -p nook-auth2 --all-targets -- -D warnings` then `cargo clippy --release --target wasm32-unknown-unknown -p nook-wasm -- -D warnings`.
- Web unit tests: `cd nook-app/nook-web/nook-web-app && bun run test` (vitest).
- Web lint: `cd nook-app/nook-web/nook-web-app && bun run lint` (eslint + prettier).
- E2e (Playwright) reuses an already-running dev server (`reuseExistingServer`, baseURL `http://127.0.0.1:5173`): `cd nook-app/nook-web/nook-web-app && bunx playwright test e2e/local-vault.spec.ts --project=stable`.

**Non-obvious gotchas:**

- E2e specs that reload the page (e.g. `local-vault.spec.ts` "persists secrets after reload", "deletes the complete local browser copy") can flake against the **Vite dev server** because the dev optimizer recompiles the large WASM bundle on reload and blows the 5s action timeout. CI runs e2e against the assembled **production preview (`dist`) server**, not the dev server — build `dist` and `bun run preview` for reliable reload-heavy specs; the non-reload core specs pass against the dev server.
- Interactive/manual vault creation in a plain browser needs a **WebAuthn PRF authenticator**; the UI intentionally does not offer the PIN fallback unless the browser reports PRF explicitly unavailable, so vault creation appears stuck without one. e2e injects a deterministic passkey mock (`e2e/passkey-mock.ts` via `e2e/fixtures.ts`). For manual browser testing, enable a virtual WebAuthn authenticator with PRF support.
