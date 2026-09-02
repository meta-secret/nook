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
    `e2e-pr.yml` runs.
- **`unstable`**
  - Specs: Local-provider and sync specs with two workers.
  - CI: `main.yml`, `ci:full-e2e` pull requests, and manual `e2e-pr.yml`
    runs.
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
