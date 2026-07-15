# Reference: Svelte + Vite + Bun

## 1. Package Manager

- We use Bun for JavaScript/TypeScript tooling.
- Always run `bun install` or `bun run dev` instead of npm/yarn.
- Do not check in `package-lock.json` or `yarn.lock`.

## 2. Dev Server and Build

- Start Vite dev server: `task web:dev` (Docker; port 5173). It uses the default dev/no-opt WASM mode; `task web:dev:fast` is an explicit alias for the same local-iteration behavior and expects the `nook-web:local` image to already exist, so run `task setup` once first on a fresh machine.
- Build the production assets: `task web:build` (outputs to `nook-app/nook-web/dist/`).
- The Svelte config is located in `svelte.config.js` and Vite config in `vite.config.ts`.

### Blank page after WASM changes

If `#app` stays empty (main page and `/logs` both broken), check the browser
console first — a common error is `nook_wasm.js does not provide an export named
'…'`. That means TypeScript imports a binding that exists on disk but Vite is
still serving a **stale cached transform** from before `wasm-pack` ran.

```bash
WEB_DEV_PORT="${WEB_DEV_PORT:-5173}"
REPO_ROOT="$(git rev-parse --show-toplevel)"
for container in $(docker ps --filter publish="$WEB_DEV_PORT" -q); do
  mounted_root="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/meta-secret/nook"}}{{.Source}}{{end}}{{end}}' "$container")"
  if [ "$mounted_root" = "$REPO_ROOT" ]; then
    docker stop "$container"
  fi
done
rm -rf nook-app/nook-web/node_modules/.vite
WEB_DEV_PORT="$WEB_DEV_PORT" task web:dev
```

After `task wasm:build`, `task wasm:build:fast`, or any `nook-wasm` /
`nook-core` change, restart `task web:dev` / `task web:dev:fast` if the UI does
not recover on its own.

## 3. E2e tests

- **Debug one spec** (preferred during fix sessions): `E2E_SPEC=e2e/connect.spec.ts task web:test:e2e:file` — fast feedback without waiting for the full suite.
- Full stub Playwright: `task web:test:e2e` — runs the `stable` IndexedDB group at 6 workers, then the provider/sync `unstable` group at 4; runs on main CI and explicitly for PR validation.
- Stable subset Playwright (`stable` project): `task web:test:e2e:pr` — 6-worker manual/debug subset for vault CRUD, login, and legal pages (no sync HTTP).
- Mounted dev servers publish container port `5173` on `WEB_DEV_PORT` (default
  `5173`). In the multi-worktree repo, use an unused host port such as
  `WEB_DEV_PORT=5175 task web:dev:fast`; never stop another worktree's container
  to reclaim `5173`.
- Live sync Playwright (`sync-live` project): `task web:test:e2e:sync-live` — real GitHub API; nightly only. Requires `NOOK_GITHUB_PAT` in `nook-app/nook-web/.env.test.local`.
- Vite `import.meta.env` values used by e2e are build-time constants; Task targets that serve `dist` must rebuild the e2e dist with the e2e env before Playwright runs.
- Do not run `bun run test:e2e*` or `playwright test` directly on the host; use Taskfile so wasm is built and tooling matches CI.
- Prefer local Docker (cached images) over GitHub Actions for e2e iteration; when an iteration is ready for final validation, push/open/update the PR first, then run local gates while remote CI runs. See [workflows/coding-bro.md](../workflows/coding-bro.md).
