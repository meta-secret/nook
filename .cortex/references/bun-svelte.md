# Reference: Svelte + Vite + Bun

## 1. Package Manager
- We use Bun for JavaScript/TypeScript tooling.
- Always run `bun install` or `bun run dev` instead of npm/yarn.
- Do not check in `package-lock.json` or `yarn.lock`.

## 2. Dev Server and Build
- Start Vite dev server: `bun run dev -- --host 0.0.0.0` (accessible via port 5173).
- Build the production assets: `bun run build` (outputs to `dist/`).
- The Svelte config is located in `svelte.config.js` and Vite config in `vite.config.ts`.
