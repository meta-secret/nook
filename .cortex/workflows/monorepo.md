# Cross-Package Changes

Use this workflow for feature work that touches more than one package.

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
