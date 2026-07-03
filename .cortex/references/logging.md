# Reference: Application Logging

Nook's application logger is **owned by WASM** and persisted in the browser's
IndexedDB. Use it for post-mortem debugging (e2e failures, user reports) without
re-instrumenting the code.

## Architecture

| Layer | File | Responsibility |
|-------|------|----------------|
| Logger core | [`nook-wasm/src/logger.rs`](../../nook-wasm/src/logger.rs) | `tracing` subscriber + reloadable level filter, `IndexedDbLayer` persistence (rexie), dump/flush/clear |
| Web shim / console authority | [`nook-web/src/lib/log.ts`](../../nook-web/src/lib/log.ts) | `createLogger(scope)`, `console.*` capture, `window.__nookConsole.echo`, initial level, flush loop, `window.__nookLog` |
| Viewer | [`nook-web/src/lib/components/LogsPage.svelte`](../../nook-web/src/lib/components/LogsPage.svelte) | `/logs` page: filter, pagination, copy, clear |
| e2e | [`nook-web/e2e/fixtures.ts`](../../nook-web/e2e/fixtures.ts) | Auto-dump + attach logs on test failure |

- **Built on `tracing`:** `nook-core` and `nook-wasm` emit structured events via
  `tracing::debug!/info!/warn!/error!` (use a `scope = "…"` field to set the log
  scope). In WASM a global subscriber routes them through a **reloadable level
  filter** into `IndexedDbLayer` (persist) plus the `tracing-web` performance
  timeline. On native (Rust tests) no subscriber is installed, so the macros are
  near-free no-ops.
- **Single console authority:** `log.ts` captures the original `console.*`
  methods, then patches `console.*` so every call still prints AND is persisted
  under the `console` scope. Rust events echo through `window.__nookConsole.echo`
  (the originals). This means **any** `console.log`/library output is captured —
  prefer `createLogger(scope)` in app code, but stray console calls are not lost.
- **Storage:** IndexedDB database `nook_logs`, store `logs` (auto-increment ring
  buffer, newest ~5000 entries kept). Separate from the vault DB (`nook_db`).
- **Entry shape:** `{ ts, level, scope, message, data? }`.
- **Bindings:** `nookLog` (persist-only), `nookLogInit`, `nookLogSetLevel`,
  `nookLogGetLevel`, `nookLogDump`, `nookLogCount`, `nookLogFlush`,
  `nookLogClear` (exported from `nook-wasm/src/logger.rs`). The web shim wraps
  these; do not call them directly from app code.

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
  `log.debug(...)` etc. `data` may be any JSON-serialisable value. Stray
  `console.*` calls are also captured (scope `console`), but a scoped logger is
  preferred.
- **Rust (`nook-core`/`nook-wasm`):** use `tracing` macros with a `scope` field,
  e.g. `tracing::debug!(scope = "vault-sync", action = %label, "reconciled")`.
  Never log secrets/keys/passwords. Prefer instrumenting spots already covered by
  tests so the `nook-core` coverage floor holds.
- **Rust status channel:** the manager `status_tx` channel is still drained by
  `$lib/nook` into the `wasm` scope at `debug`.

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
