# Browser Validation

## Overview

This authority owns the Playwright project catalog used by Nook workflows.
Runner placement, provider policy, and pipeline topology remain in
[CI / GitHub Actions Pipeline](ci-pipeline.md).

## Playwright projects

The projects are defined in
`nook-app/nook-web/nook-web-app/playwright.config.ts`.

- **`stable`**
  - Specs: IndexedDB-only specs with three workers.
  - CI: `main.yml`, `ci:full-e2e` pull requests, and manual or debug
    `e2e-pr.yml` runs. Manual `e2e-windows.yml` also runs this group in Edge.
- **`unstable`**
  - Specs: Local-provider and sync specs with two workers.
  - CI: `main.yml`, `ci:full-e2e` pull requests, and manual `e2e-pr.yml`
    runs. Manual `e2e-windows.yml` also runs this group in Edge.
- **`sync-live`**
  - Specs: `e2e/live/**/*.spec.ts`.
  - CI: Manual `e2e-pr.yml` runs.
- **`ui-demo`**
  - Specs: `e2e/demos/**/*.demo.spec.ts` with one worker.
  - CI: Implemented but temporarily disabled in PR and Main workflows.
  - Contract: UI-changing pull requests still require focused demo specs.

The `test:e2e` script runs `stable` and then `unstable`.
`test:e2e:local` runs `stable`.
`test:e2e:sync-stub` runs both groups.

## Native Windows entry point

The manual lane reuses shared specs with Windows Playwright configurations
and serves matching Linux-built production artifacts through Vite preview.
Web contexts use installed Microsoft Edge with channel `msedge`.
Persistent extension contexts use the configured real Edge executable.
Windows configurations select line, HTML, and JSON reporters per suite.
It captures screenshots only on failure and retains traces on failure.

### Required actions

1. Use a native Windows checkout of the source SHA recorded by the producer.
   - Place the matching production artifact beneath `nook-app`.
   - Application `dist/index.html` must exist before its suite starts.
   - Include the producer's extension, research, isolation, and WASM artifacts.
   - Supply native Bun, Task, PowerShell, and installed Microsoft Edge.
2. Run the standalone Taskfile from the repository root in PowerShell.
   - Its install task uses `bun install --frozen-lockfile --ignore-scripts`.
   - It creates dependency junctions with native PowerShell.
   - Research dependencies are installed separately without package scripts.
   - Set `E2E_SUITE` to `all`, `stable`, `unstable`, `sync-live`, `isolation`,
     `extension`, or `research`.
   - Workflow `suite: all` creates seven native jobs for six automated surfaces.
   - `fail-fast: false` preserves each job's terminal result.
   - `unstable` selects both file and GitHub-stub provider jobs.
   - Their report labels are `unstable-file` and `unstable-github`.
   - The jobs share the producer's exact source SHA and immutable artifacts.
   - Demonstration videos remain excluded from `all`.
   - Optional `E2E_SPEC` is passed as a positional Playwright filter.
3. Record the actual terminal result with its source SHA and selected suite.
   - Source inspection or a Linux run does not establish native Windows success.
   - Only the `sync-live` job receives supported live credentials.
     Missing credentials remain
     an external blocker.
   - Edge extension support must be established by an actual native attempt.
     A Chromium result cannot replace it.
   - Hosted workflow ordering and artifacts remain owned by
     [CI operations](ci-operations.md#manual-windows-edge-lane).

For a matching stable spec, the native runner uses this command sequence.
The checkout and production artifact are prerequisites from step 1.
Agent local execution still follows the root diagnostic policy.

```powershell
$env:CI = 'true'
$env:NOOK_E2E_SKIP_GITHUB_CLEANUP = '1'
$env:E2E_SUITE = 'stable'
$env:E2E_SPEC = 'e2e/connect.spec.ts'
task --taskfile .task/e2e-windows.yml web:e2e:windows:install
task --taskfile .task/e2e-windows.yml web:e2e:windows
```

**Prohibited:** invoke the POSIX root Taskfile on Windows or select
an unsupported suite through the Windows task. Run with an absent artifact
or one built from a different source SHA. Claim Windows success from source
inspection or a Linux result.

**Required:** use the standalone commands above for matching stable specs.
Use the production artifact from the matching producer SHA, including
`dist/index.html`. Report that SHA and the actual native Windows terminal
outcome. Select workflow `suite: all` with no spec filter for seven independent
jobs covering six automated surfaces.
Report missing live credentials as blocked. Report extension success only from
the actual installed Edge run.
