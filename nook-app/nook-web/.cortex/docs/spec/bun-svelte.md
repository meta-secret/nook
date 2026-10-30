# Reference: Svelte + Vite + Bun

## 1. Package Manager

- Nook web and Loom use Bun for JavaScript/TypeScript tooling.
- Use their Task or Bun commands instead of npm/yarn.
- Do not check in `package-lock.json` or `yarn.lock` in Bun-owned packages.

### TypeScript 7

- TypeScript 7 is the compiler. Each package installs it as
  `@typescript/native` (`npm:typescript@7`), which owns `tsc`.
- The `typescript` package stays at 6 only as the JavaScript API that
  typescript-eslint, svelte-check, and Loom load; TypeScript 7 ships no stable
  JavaScript API. Nothing type-checks with it.
- `svelte-check --tsgo-experimental-api` hands Svelte type checking to
  TypeScript 7 through its API, in memory. Each surface keeps its own workspace
  and tsconfig, and parallel runs share no output folder; `--tsgo` instead
  writes one `.svelte-check` folder per workspace and checks only Svelte files
  under the tsconfig's folder, which misses the shared components.
- svelte-check's TypeScript 7 API client needs Node; under Bun alone it fails
  to start.

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
  - Knip 6 analyzes only files under its own root. The graph therefore runs
    from `nook-app/nook-web`, whose `package.json` and `knip.json` cover the
    shared code, Simple, Sentinel, and the extension.
- **Research graph:** Run its workspace-scoped Knip 6 graph through package
  `bun run check` and the research-only workflow with the correct `$lib` mapping.
- **Class members:** Knip 6 removed `classMembers` in both graphs.
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
  - See [quality.md § Fix check findings](../../../../../.cortex/teams/sre/workflows/quality.md#fix-check-findings--not-silence-them).

- **Single-spec debug:** `E2E_SPEC=e2e/connect.spec.ts task web:test:e2e:file`.
  Hosted remote execution is the default for agents. A local run follows the
  root [delivery and validation policy](../../../../../.cortex/AGENTS.md#delivery-and-validation)
  and is diagnostic only.
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
- A failed browser scenario follows the canonical
  [regression-before-fix procedure](../../../../../.cortex/shared/dynamic-skills/testing-pyramid-and-regression.md#mandatory-regression-coverage-for-bug-fixes)
  and uses the applicable
  [existing browser harness](../../../../../.cortex/shared/dynamic-skills/testing-pyramid-and-regression.md#existing-browser-harnesses).
- Before integration, the Web worker authors focused behavior tests, finishes
  the assigned worker branch, and reports focused evidence. Routine local
  feedback remains bounded to inexpensive diagnostics or formatting; local
  test/check/E2E runs follow the root policy. Required browser and behavior tests
  execute in the hosted feature PR validation stage against the published
  branch head, and local results do not replace them.
- The upstream integration agent integrates the worker branch and reports its
  feature branch, integration outcome, and checks to Gizmo.
- Gizmo routes feature-branch publication and required PR-check evidence through
  the Delivery Pipeline.
- Required tests and browser E2E execute in the feature PR validation stage.
  Local diagnostics do not replace those hosted checks.
- Web development owns browser acceptance requirements.
- The Feature Gizmo owns readiness; Delivery Pipeline owns authorized GitHub
  publication and squash-merge mechanics.
- Missing build-only tooling does not authorize feature tests.
