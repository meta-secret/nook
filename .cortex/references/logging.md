# Reference: Application Logging

Nook's application logger is **owned by WASM** and persisted in the browser's
IndexedDB. Use it for post-mortem debugging (e2e failures, user reports) without
re-instrumenting the code.

## Architecture

| Layer | File | Responsibility |
|-------|------|----------------|
| Logger core | [`nook-wasm/src/logger.rs`](../../nook-wasm/src/logger.rs) | Level gating, console echo, IndexedDB persistence (rexie), dump/flush/clear |
| Web shim | [`nook-web/src/lib/log.ts`](../../nook-web/src/lib/log.ts) | `createLogger(scope)`, initial level from env/`localStorage`, flush loop, `window.__nookLog` |
| Viewer | [`nook-web/src/lib/components/LogsPage.svelte`](../../nook-web/src/lib/components/LogsPage.svelte) | `/logs` page: filter, pagination, copy, clear |
| e2e | [`nook-web/e2e/fixtures.ts`](../../nook-web/e2e/fixtures.ts) | Auto-dump + attach logs on test failure |

- **Storage:** IndexedDB database `nook_logs`, store `logs` (auto-increment ring
  buffer, newest ~5000 entries kept). Separate from the vault DB (`nook_db`).
- **Entry shape:** `{ ts, level, scope, message, data? }`.
- **Bindings:** `nookLog`, `nookLogSetLevel`, `nookLogGetLevel`, `nookLogDump`,
  `nookLogCount`, `nookLogFlush`, `nookLogClear` (exported from
  `nook-wasm/src/logger.rs`). The web shim wraps these; do not call them directly
  from app code.

## Levels are persistence-gated

Levels (most → least severe): `error`, `warn`, `info`, `debug`, `trace`.

**Only entries at or above the active level are echoed and persisted.** The
default is `info`. Almost all app logs today are `debug` (`wasm` status drain,
`connect`/`vault` flows), so at the default level the store stays small.

> To capture more for a post-mortem, **lower the level and reproduce** — nothing
> below the threshold is stored, so there is no "everything" firehose.

### Setting the level

- **Runtime (persists across reloads):** `localStorage.nook_log_level = 'debug'`,
  or the **Capture** selector on `/logs`, or `window.__nookLog.setLevel('debug')`.
- **Build time (dev/CI default):** `VITE_LOG_LEVEL=debug`.

## Viewing logs

- **`/logs` page** (works logged-out): filter by minimum level, paginate
  (Newer/Older, 100/page), **Copy** all as JSON, **Clear**.
- **Devtools:** `await window.__nookLog.dump({ minLevel: 'trace', limit: 500 })`,
  `window.__nookLog.count()`, `window.__nookLog.clear()`.

## Logging from code

- **Web:** `const log = createLogger('scope')` then `log.info(msg, data)` /
  `log.debug(...)` etc. `data` may be any JSON-serialisable value.
- **Rust/WASM:** emit status via the manager `status_tx` channel; `$lib/nook`
  drains it into the `wasm` scope at `debug`. Direct Rust logging is not wired.

## e2e integration (auto-dump on failure)

Specs import `test`/`expect` from [`e2e/fixtures.ts`](../../nook-web/e2e/fixtures.ts)
(not `@playwright/test`). On failure the fixture prints the persisted app logs to
the test output and attaches `nook-app-logs.json` to the Playwright report.

- The **dev** web server sets `VITE_LOG_LEVEL=debug`, so local runs
  (`E2E_SPEC=… task web:test:e2e:file`) capture a useful trail automatically.
- The **CI preview** server serves a prebuilt `dist/` (level `info`). To capture
  more on CI, rebuild with `VITE_LOG_LEVEL=debug`, or in a spec:
  `await page.addInitScript(() => localStorage.setItem('nook_log_level', 'trace'))`.
- `dumpNookLogs(page, label)` in [`e2e/helpers.ts`](../../nook-web/e2e/helpers.ts)
  prints logs at any point during a flow.

See also: [rust-wasm.md](rust-wasm.md), [bun-svelte.md](bun-svelte.md),
[../workflows/ci-pipeline.md](../workflows/ci-pipeline.md).
