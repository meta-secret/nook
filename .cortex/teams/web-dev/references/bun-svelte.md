# Reference: Svelte + Vite + Bun

## 1. Package Manager

- Nook web and Loom use Bun for JavaScript/TypeScript tooling.
- Use their Task or Bun commands instead of npm/yarn.
- Do not check in `package-lock.json` or `yarn.lock` in Bun-owned packages.
- `agentic-ai/ci-agent` is the maintained Node/npm exception.
- It owns its checked-in `package-lock.json` and runs through Task wrappers.

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

Unused TypeScript and Svelte code is enforced by `bun run unused` (Knip) in both
`nook-web-app` and `nook-web-research`. Copy/paste clones are enforced by
`bun run duplicates` (jscpd) from the app lint path across authored `nook-app`
and `preflight` sources. Unused-code ownership is split as follows:

- **Vault app graph:** Run under `bun run lint` / `task check`.
  - Reject unreachable files and exports.
  - Keep the production graph pinned to Knip 5.88 until sibling vault and
    extension packages become a real root workspace.
  - Enable `classMembers`.
- **Research graph:** Run its workspace-scoped Knip 6 graph through package
  `bun run check` and the research-only workflow with the correct `$lib` mapping.
  - Knip 6 removed `classMembers`.
  - Use TypeScript and ESLint for unused declarations plus manual caller audit
    for exported class members.
- **TypeScript and ESLint:** Reject unused locals and parameters in `.ts`,
  `.svelte.ts`, and `.svelte`.
  - The extension `check` script also lints build scripts, Playwright config,
    and E2E specs.
  - Treat each finding as a call-graph result and delete confirmed dead members.
- **Agent duty:** Knip unused and jscpd clone findings are hard failures.
  - Delete or wire unused code.
  - Extract shared helpers for clones.
  - Do not raise thresholds, add authored-code ignores, or mark the task done
    while either gate is red.
  - See [quality.md § Fix check findings](../../sre/workflows/quality.md#fix-check-findings--not-silence-them).

- **Human interactive single-spec debug:** `E2E_SPEC=e2e/connect.spec.ts task web:test:e2e:file`. Agents use the hosted remote catalog.
- Full stub Playwright: `task web:test:e2e` runs the `stable` IndexedDB group at
  3 workers. It then runs the provider/sync `unstable` group at 2 workers.
- Stable subset Playwright (`stable` project): `task web:test:e2e:pr` uses 3
  workers for the manual/debug subset.
- Mounted dev servers publish container port `5173` on `WEB_DEV_PORT` (default
  `5173`). In the multi-worktree repo, use an unused host port such as
  `WEB_DEV_PORT=5175 task web:dev:fast`; never stop another worktree's container
  to reclaim `5173`.
- Live sync Playwright (`sync-live` project): `task web:test:e2e:sync-live` — real GitHub API; explicit manual runs only. Requires `NOOK_GITHUB_PAT` in `nook-app/nook-web/.env.test.local`.
- Vite `import.meta.env` values used by e2e are build-time constants; Task targets that serve `dist` must rebuild the e2e dist with the e2e env before Playwright runs.
- Do not run `bun run test:e2e*` or `playwright test` directly on the host; use Taskfile so wasm is built and tooling matches CI.
- Before integration, the Web worker runs the applicable focused proof for the
  behavior it changes, deterministically formats every allowed web or web-owned
  Cortex file, and commits one coherent exact handoff. The worker promptly
  returns that commit and focused evidence without pushing or taking PR
  lifecycle ownership. Required agent browser E2E is not pre-integration
  handoff evidence: it runs on the configured GitHub Actions worker against a
  published SHA. Humans may use local single-spec Docker e2e for interactive
  debugging.
- Gizmo integrates accepted formatted handoffs and runs `task loom:pre-push`
  on the combined head. If that gate formats web-owned content, Gizmo returns
  the exact diff to web development for a fresh formatted commit instead of
  committing it. After the owner commit and a clean gate, Gizmo pushes and
  immediately obtains exact-published-head remote evidence: at least one
  relevant focused remote task, including any required Web-owned browser E2E
  through `task remote`, while the head is not validation-ready; or complete
  exact-head validation immediately when it is ready. Gizmo must collect every
  required browser E2E result against that published head before readiness.
  Web development owns the browser acceptance requirement; Gizmo owns
  publication, remote dispatch and collection, readiness, and merge.
  See [workflows/remote-execution.md](../../sre/workflows/remote-execution.md).
