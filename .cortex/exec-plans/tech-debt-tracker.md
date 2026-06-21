# Technical Debt Tracker

We track known technical debt, version updates, and cleanup tasks to resolve them incrementally.

| Debt Item | Package | Context | Status |
|---|---|---|---|
| Upgrade Svelte & ESLint dependencies to latest | nook-web | Upgraded Lucide-Svelte, ESLint, globals, Prettier plugin. Added explicit `@eslint/js` dependency to resolve CI resolution issues. | Resolved |
| Relocate Dockerfile & Optimize Caching | repo | Relocated `.docker/build.Dockerfile` to `Dockerfile` at root and restructured layers. | Resolved |
| Fix `table.grow` WebAssembly error | nook-wasm | Upgraded `wasm-pack` and manually installed `binaryen` version 122. | Resolved |
