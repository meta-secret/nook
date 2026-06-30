# Cross-Package Changes

Use this workflow for feature work that touches more than one package.

0. Follow [coding-bro.md](coding-bro.md) — fetch `origin/main`, branch, never push to `main` (see [rules.md](../rules.md) §6).
0b. **Merge with squash only.** When a PR is merged, use **Squash and merge** (`gh pr merge --squash`). Never merge commit or rebase merge. See [rules.md](../rules.md) §6.
1. Identify the lowest package that should own the behavior.
2. Put portable logic in `nook-core`; keep wasm-specific conversion in `nook-wasm`.
3. Expose only small JavaScript-friendly functions from `nook-wasm`.
4. Consume wasm through `nook-web/src/lib` wrappers rather than importing generated files from Svelte components directly.
5. Keep shadcn-svelte UI primitives and default styling in `nook-web/src/lib/components/ui` and `nook-web/src/app.css`.
6. Add or update tests in the owning package (`nook-core` Rust tests for domain logic; Playwright for UI flows).
7. Add any new routine command to `Taskfile.yml`.
8. Update `.cortex` docs when architecture or workflow changes.
9. Verify with `task check`.

Dependency direction must stay:

```
nook-core → nook-wasm → nook-web
```

Do not make `nook-core` depend on wasm, browser, Svelte, or Bun concepts.

Use Bun for JavaScript tooling and run project commands through Taskfile/Docker. Do not introduce npm command flows or npm lockfiles.

## New vault item type checklist

Portable work belongs in `nook-core` first so web, mobile, and CLI can share it:

1. `nook-core/src/secret_types.rs` — enum variant + payload struct + `SecretValue` parse/serialize.
2. `nook-core/src/secret_view.rs` — list/search/build helpers (`display_title`, `group_key`, `build_secret_yaml`, …).
3. `nook-wasm` — expose fields on `NookSecretRecord`; extend `records_to_array` if needed.
4. `nook-core` tests — payload round-trips and validation (no TS mirror tests).
5. `nook-web` — form + detail UI only; use `buildSecretYaml` and wasm getters, not duplicated TS schemas.
6. Playwright — user flow coverage when the type is exposed in the vault UI.

See [references/rust-wasm.md](../references/rust-wasm.md) §4 for the boundary pattern.
