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

The manual lane uses `playwright.windows.config.ts` to reuse the shared web
specs and serve Linux-built production `dist/` through Vite preview.
It runs installed Microsoft Edge with channel `msedge`.
The Windows configuration selects line, HTML, and JSON reporters.
It captures screenshots only on failure and retains traces on failure.

### Required actions

1. Use a native Windows checkout of the source SHA recorded by the producer.
   - Place the matching production artifact beneath `nook-app`.
   - `dist/index.html` must exist before Playwright starts.
   - Supply native Bun, Task, PowerShell, and installed Microsoft Edge.
2. Run the standalone Taskfile from the repository root in PowerShell.
   - Its install task uses `bun install --frozen-lockfile --ignore-scripts`.
   - It creates the parent dependency junction with native PowerShell.
   - Set `E2E_SUITE` to `all`, `stable`, or `unstable`.
   - Optional `E2E_SPEC` is passed as a positional Playwright filter.
3. Record the actual terminal result with its source SHA and selected suite.
   - Source inspection or a Linux run does not establish native Windows success.
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
`sync-live` through the deterministic Windows task. Run with an absent artifact
or one built from a different source SHA. Claim Windows success from source
inspection or a Linux result.

**Required:** use the standalone commands above for matching stable specs.
Use the production artifact from the matching producer SHA, including
`dist/index.html`. Report that SHA and the actual native Windows terminal
outcome. Use `E2E_SUITE=all` with no spec filter for both deterministic projects.
