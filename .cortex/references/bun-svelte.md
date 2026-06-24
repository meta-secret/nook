# Reference: Svelte + Vite + Bun

## 1. Package Manager
- We use Bun for JavaScript/TypeScript tooling.
- Always run `bun install` or `bun run dev` instead of npm/yarn.
- Do not check in `package-lock.json` or `yarn.lock`.

## 2. Dev Server and Build
- Start Vite dev server: `task web:dev` (Docker; port 5173).
- Build the production assets: `task web:build` (outputs to `nook-web/dist/`).
- The Svelte config is located in `svelte.config.js` and Vite config in `vite.config.ts`.

## 3. E2e tests
- Local Playwright suite (no GitHub PAT): `task web:test:e2e:local` — includes connect, local vault, login unlock flow, and password envelope specs.
- Full suite (GitHub PAT required): `task web:test:e2e`.
- Do not run `bun run test:e2e*` or `playwright test` directly on the host; use Taskfile so wasm is built and tooling matches CI.
