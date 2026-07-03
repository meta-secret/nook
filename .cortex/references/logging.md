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
| JSON export | [`nook-web/src/lib/app-logs-api.ts`](../../nook-web/src/lib/app-logs-api.ts), [`AppLogsApiPage.svelte`](../../nook-web/src/lib/components/AppLogsApiPage.svelte) | `/app-logs` — machine-readable JSON export for agents and log pipelines |
| e2e | [`nook-web/e2e/fixtures.ts`](../../nook-web/e2e/fixtures.ts), [`e2e/helpers.ts`](../../nook-web/e2e/helpers.ts) | Auto-dump + attach logs on test failure; `fetchAppLogs()` via `/app-logs` |

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

- **`/logs` page** (human UI, works logged-out): filter by minimum level, paginate
  (Newer/Older, 100/page), **Copy** all as JSON, **Clear**. Good for users and
  manual inspection at [nokey.sh/logs](https://nokey.sh/logs).
- **`/app-logs` JSON export** (machine-readable, works logged-out): raw persisted
  logs in a stable envelope suitable for AI agents, Playwright helpers, and log
  aggregation. The page body is JSON only — no app chrome.

  Query parameters (all optional):

  | Param | Default | Description |
  |-------|---------|-------------|
  | `minLevel` | `trace` | Minimum severity to include (`error` … `trace`) |
  | `limit` | `500` | Max entries returned (cap `5000`) |
  | `offset` | `0` | Skip oldest N entries (pagination) |

  Example: `/app-logs?minLevel=debug&limit=1000`

  Response shape (`schema: nook.app-logs.v1`):

  ```json
  {
    "meta": {
      "schema": "nook.app-logs.v1",
      "generatedAt": "2026-07-02T20:00:00.000Z",
      "activeLevel": "debug",
      "minLevel": "debug",
      "limit": 500,
      "offset": 0,
      "returned": 42,
      "total": 120
    },
    "entries": [
      { "ts": "…", "level": "debug", "scope": "vault", "message": "…", "data": "…" }
    ]
  }
  ```

  Each `entries[]` item matches the IndexedDB store: `{ ts, level, scope, message, data? }`.
  `data` is an optional JSON string when structured context was logged.

- **Devtools:** `await window.__nookLog.dump({ minLevel: 'trace', limit: 500 })`,
  `window.__nookLog.count()`, `window.__nookLog.clear()`.

## Logging from code

- **Web:** `const log = createLogger('scope')` then `log.info(msg, data)` /
  `log.debug(...)` etc. `data` may be any JSON-serialisable value. Stray
  `console.*` calls are also captured (scope `console`), but a scoped logger is
  preferred.
- **Common web scopes:** `vault` (session lifecycle), `connect` (unlock/connect),
  `vault-sync`, `vault-local`, `vault-password`, `vault-devices`, `vault-providers`,
  `vault-session`, `vault-lifecycle`, `wasm` (status channel), `wasm-connect`,
  `wasm-sync`, `wasm-secrets` (Rust tracing scopes).
- **Prefer `info` for user-visible milestones** (unlock, lock, connect, secret
  CRUD, provider changes, sync conflicts). Use `debug` for background ticks,
  assess/re-assess details, and swallowed errors. At the default capture level
  (`info`), only `info`/`warn`/`error` are persisted — lower the level on `/logs`
  to see the full `debug` trail.
- **Rust (`nook-core`/`nook-wasm`):** use `tracing` macros with a `scope` field,
  e.g. `tracing::debug!(scope = "vault-sync", action = %label, "reconciled")`.
  Never log secrets/keys/passwords. Prefer instrumenting spots already covered by
  tests so the `nook-core` coverage floor holds.
- **Rust status channel:** the manager `status_tx` channel is still drained by
  `$lib/nook` into the `wasm` scope at `debug`.

## e2e integration (auto-dump on failure)

Specs import `test`/`expect` from [`e2e/fixtures.ts`](../../nook-web/e2e/fixtures.ts)
(not `@playwright/test`). On failure the fixture prints the persisted app logs to
the test output and attaches `nook-app-logs.json` (canonical `nook.app-logs.v1`
envelope) to the Playwright report.

### Agent rule: use app logs for Playwright debug and analysis

**AI agents MUST use persisted application logs** when debugging or analyzing
Playwright/e2e failures, flaky flows, or vault sync regressions. Do not guess
from DOM snapshots or screenshot diffs alone.

Preferred order:

1. **Failure attachments** — read `nook-app-logs.json` from the Playwright report
   (auto-attached by the fixtures on failure).
2. **`fetchAppLogs(page, { minLevel: 'trace' })`** — navigate to `/app-logs` and
   parse the JSON body (`data-testid="app-logs-json"`). Use in specs and local
   debug scripts.
3. **`dumpNookLogs(page, label)`** — print the last N entries to test output
   mid-flow without leaving the current page.
4. **`/logs` UI** — human inspection only; agents should prefer `/app-logs` or
   the helpers above for structured analysis.

When CI e2e fails, read app logs **before** changing production code. Lower the
capture level (`VITE_LOG_LEVEL=debug`, `localStorage.nook_log_level=trace`) when
the default trail is too thin.

- The **dev** web server sets `VITE_LOG_LEVEL=debug`, so local runs
  (`E2E_SPEC=… task web:test:e2e:file`) capture a useful trail automatically.
- The **CI preview** server serves a prebuilt `dist/` (level `info`). To capture
  more on CI, rebuild with `VITE_LOG_LEVEL=debug`, or in a spec:
  `await page.addInitScript(() => localStorage.setItem('nook_log_level', 'trace'))`.
- `dumpNookLogs(page, label)` in [`e2e/helpers.ts`](../../nook-web/e2e/helpers.ts)
  prints logs at any point during a flow.
- `fetchAppLogs(page, options)` in the same file loads `/app-logs` and returns
  the parsed `nook.app-logs.v1` payload.

See also: [rust-wasm.md](rust-wasm.md), [bun-svelte.md](bun-svelte.md),
[../workflows/ci-pipeline.md](../workflows/ci-pipeline.md).
