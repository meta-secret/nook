/**
 * Web-side console authority + shim over the WASM-owned logger
 * (`nook-wasm/src/logger.rs`).
 *
 * The logger core — level gating, IndexedDB persistence (rexie, `nook_logs`
 * ring buffer), `nook-core`/`nook-wasm` `tracing` events — lives in WASM. This
 * module makes the WASM logger the single console authority for the web app:
 * - captures the ORIGINAL `console.*` methods at load,
 * - patches `console.*` so every call still prints (via the originals) AND is
 *   persisted through the `nookLog` binding,
 * - exposes `window.__nookConsole.echo` so Rust `tracing` events (already
 *   persisted by the WASM layer) print through the same original methods,
 * - forwards `createLogger(scope).info(…)` calls: echo once via the originals,
 *   then persist,
 * - resolves the initial level from `localStorage.nook_log_level` /
 *   `VITE_LOG_LEVEL`, drives the periodic flush, and exposes `window.__nookLog`.
 *
 * Persistence is level-gated: only entries at or above the active level are
 * stored. For a deeper post-mortem, lower the level (`debug`/`trace`) and
 * reproduce — nothing below the threshold is kept.
 *
 * Calls made before WASM is initialised are queued and replayed by
 * {@link initWasmLogging} (invoked once from `$lib/nook`).
 */

import {
  nookLog,
  nookLogClear,
  nookLogCount,
  nookLogDumpPage,
  nookLogFlush,
  nookLogGetLevel,
  nookLogInit,
  nookLogSetLevel,
  nookLogWithData,
} from "$app-wasm";
export enum LogLevel {
  Error = "error",
  Warn = "warn",
  Info = "info",
  Debug = "debug",
  Trace = "trace",
}

export type LogEntry = {
  ts: string;
  level: LogLevel;
  scope: string;
  message: string;
  data?: string;
};

export type RuntimeFailure = {
  readonly message: string;
  readonly stack?: string;
};

/** Narrow an untrusted thrown value at the logging adapter boundary. */
// eslint-disable-next-line @typescript-eslint/no-restricted-types -- This exact thrown-value boundary narrows immediately.
export function runtimeFailure(cause: unknown): RuntimeFailure {
  return cause instanceof Error
    ? {
        message: cause.message,
        ...(cause.stack ? { stack: cause.stack } : {}),
      }
    : { message: String(cause) };
}

/** Normalize an untrusted thrown value before application code stores it. */
// eslint-disable-next-line @typescript-eslint/no-restricted-types -- This exact thrown-value boundary narrows immediately.
export function runtimeError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

const LOG_LEVELS: readonly LogLevel[] = [
  LogLevel.Error,
  LogLevel.Warn,
  LogLevel.Info,
  LogLevel.Debug,
  LogLevel.Trace,
];

/** How long to run the write-behind flush loop between IndexedDB writes. */
const FLUSH_INTERVAL_MS = 250;
/** Cap the pre-init replay queue so early crash loops can't grow unbounded. */
const PRE_INIT_QUEUE_MAX = 1000;

enum PendingRecordKind {
  Message = "message",
  Structured = "structured",
}

type PendingRecord =
  | {
      readonly kind: PendingRecordKind.Message;
      readonly level: LogLevel;
      readonly scope: string;
      readonly message: string;
    }
  | {
      readonly kind: PendingRecordKind.Structured;
      readonly level: LogLevel;
      readonly scope: string;
      readonly message: string;
      readonly serializedContext: string;
    };

export type SerializedLogContext = {
  readonly message: string;
  readonly serializedContext: string;
};

let wasmReady = false;
enum LogFlushScheduleKind {
  Stopped = "stopped",
  Scheduled = "scheduled",
}

type LogFlushSchedule =
  | { kind: LogFlushScheduleKind.Stopped }
  | {
      kind: LogFlushScheduleKind.Scheduled;
      timer: ReturnType<typeof setInterval>;
    };

let logFlushSchedule: LogFlushSchedule = { kind: LogFlushScheduleKind.Stopped };
let flushing = false;
let consolePatched = false;
let diagnosticsInstalled = false;
const preInitQueue: PendingRecord[] = [];

/**
 * The original console methods, captured before we patch `console`. All echo
 * paths (`createLogger`, the `console.*` patch, Rust via `__nookConsole.echo`)
 * print through these so patching never causes recursion or double-persist.
 */
// eslint-disable-next-line @typescript-eslint/no-restricted-types -- Console owns this variadic ingress boundary.
type ConsoleMethod = (...args: unknown[]) => void;
enum ConsoleMethodKind {
  Error = "error",
  Warn = "warn",
  Info = "info",
  Debug = "debug",
  Log = "log",
}

const originalConsole: Record<ConsoleMethodKind, ConsoleMethod> =
  "console" in globalThis
    ? {
        error: console.error.bind(console),
        warn: console.warn.bind(console),
        info: console.info.bind(console),
        debug: console.debug.bind(console),
        log: console.log.bind(console),
      }
    : {
        error: () => {},
        warn: () => {},
        info: () => {},
        debug: () => {},
        log: () => {},
      };

enum LogLevelParseKind {
  Invalid = "invalid",
  Valid = "valid",
}

type LogLevelParse =
  | { kind: LogLevelParseKind.Invalid }
  | { kind: LogLevelParseKind.Valid; level: LogLevel };

function parseLevel(raw: string): LogLevelParse {
  if (typeof raw !== "string") return { kind: LogLevelParseKind.Invalid };
  const value = raw.trim().toLowerCase();
  return LOG_LEVELS.includes(value as LogLevel)
    ? { kind: LogLevelParseKind.Valid, level: value as LogLevel }
    : { kind: LogLevelParseKind.Invalid };
}

function initialLevel(): LogLevel {
  if ("localStorage" in globalThis) {
    const stored = parseLevel(localStorage.getItem("nook_log_level") ?? "");
    if (stored.kind === LogLevelParseKind.Valid) return stored.level;
  }
  const env = parseLevel(import.meta.env?.VITE_LOG_LEVEL ?? "");
  return env.kind === LogLevelParseKind.Valid ? env.level : LogLevel.Info;
}

/** Render arbitrary `console.*` arguments into a single persisted message. */
// eslint-disable-next-line @typescript-eslint/no-restricted-types -- Console arguments are stringified immediately at ingress.
function stringifyArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      if (arg instanceof Error)
        return arg.stack ?? `${arg.name}: ${arg.message}`;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

function levelRank(level: LogLevel): number {
  return LOG_LEVELS.indexOf(level);
}

/** Local `YYYY-MM-DD HH:MM:SS.mmm` timestamp for console echo lines. */
function formatTimestamp(date = new Date()): string {
  const pad = ({
    value,
    size,
  }: {
    readonly value: number;
    readonly size: number;
  }) => String(value).padStart(size, "0");
  const y = date.getFullYear();
  const padArgs: Parameters<typeof pad>[0] = {
    value: date.getMonth() + 1,
    size: 2,
  };
  const mo = pad(padArgs);
  const padArgs2: Parameters<typeof pad>[0] = {
    value: date.getDate(),
    size: 2,
  };
  const d = pad(padArgs2);
  const padArgs3: Parameters<typeof pad>[0] = {
    value: date.getHours(),
    size: 2,
  };
  const h = pad(padArgs3);
  const padArgs4: Parameters<typeof pad>[0] = {
    value: date.getMinutes(),
    size: 2,
  };
  const mi = pad(padArgs4);
  const padArgs5: Parameters<typeof pad>[0] = {
    value: date.getSeconds(),
    size: 2,
  };
  const s = pad(padArgs5);
  const padArgs6: Parameters<typeof pad>[0] = {
    value: date.getMilliseconds(),
    size: 3,
  };
  const ms = pad(padArgs6);
  return `${y}-${mo}-${d} ${h}:${mi}:${s}.${ms}`;
}

/** True when `level` should be echoed/persisted under the active level. */
function isEnabled(level: LogLevel): boolean {
  return levelRank(level) <= levelRank(getLogLevel());
}

/**
 * Echo one line to the console via the ORIGINAL (unpatched) methods, prefixed
 * with a local date/time so console output is timestamped like the persisted
 * entries. Shared by `createLogger` and Rust `tracing` events
 * (`window.__nookConsole.echo`).
 */
function echo({
  level,
  text,
}: {
  readonly level: LogLevel;
  readonly text: string;
}) {
  const line = `${formatTimestamp()} ${text}`;
  switch (level) {
    case LogLevel.Error:
      originalConsole.error(line);
      break;
    case LogLevel.Warn:
      originalConsole.warn(line);
      break;
    case LogLevel.Debug:
    case LogLevel.Trace:
      originalConsole.debug(line);
      break;
    case LogLevel.Info:
      originalConsole.info(line);
  }
}

// eslint-disable-next-line max-params -- Rust owns this browser bridge signature.
function hostEcho(level: LogLevel, text: string): void {
  const echoArgs: Parameters<typeof echo>[0] = { level, text };
  echo(echoArgs);
}

/** Persist one entry (no console echo). Queues until WASM is ready. */
function persistMessage({
  level,
  scope,
  message,
}: {
  readonly level: LogLevel;
  readonly scope: string;
  readonly message: string;
}) {
  if (!wasmReady) {
    if (preInitQueue.length < PRE_INIT_QUEUE_MAX) {
      const pushArgs: Parameters<typeof preInitQueue.push>[0] = {
        kind: PendingRecordKind.Message,
        level,
        scope,
        message,
      };
      preInitQueue.push(pushArgs);
    }
    return;
  }
  try {
    nookLog(level, scope, message);
  } catch {
    // Logging must never break the app.
  }
}

/** Persist already-serialized adapter context without accepting a generic value bag. */
function persistStructured({
  level,
  scope,
  message,
  serializedContext,
}: {
  readonly level: LogLevel;
  readonly scope: string;
  readonly message: string;
  readonly serializedContext: string;
}): void {
  if (!wasmReady) {
    if (preInitQueue.length < PRE_INIT_QUEUE_MAX) {
      const queued: PendingRecord = {
        kind: PendingRecordKind.Structured,
        level,
        scope,
        message,
        serializedContext,
      };
      preInitQueue.push(queued);
    }
    return;
  }
  try {
    nookLogWithData(level, scope, message, serializedContext);
  } catch {
    // Logging must never break the app.
  }
}

/** `createLogger` path: gate, echo once via originals, then persist. */
function record({
  level,
  scope,
  message,
}: {
  readonly level: LogLevel;
  readonly scope: string;
  readonly message: string;
}) {
  if (!isEnabled(level)) return;
  const echoArgs2: Parameters<typeof echo>[0] = {
    level,
    text: `[${scope}] ${message}`,
  };
  echo(echoArgs2);
  const persistMessageArgs: Parameters<typeof persistMessage>[0] = {
    level,
    scope,
    message,
  };
  persistMessage(persistMessageArgs);
}

/** True for browser-extension scripts we should not persist as app errors. */
// eslint-disable-next-line @typescript-eslint/no-restricted-types -- Browser error sources are narrowed immediately at ingress.
export function isIgnoredErrorSource(source: unknown): boolean {
  if (typeof source !== "string") return false;
  const value = source.trim();
  if (!value) return false;
  return (
    /^(chrome|moz|safari-web|safari)-extension:/i.test(value) ||
    value.includes("bootstrap-autofill-overlay")
  );
}

/** Strip query strings from URLs before persisting (tokens may appear in params). */
export function sanitizeLogUrl(url: string): string {
  try {
    const parsed =
      "location" in globalThis ? new URL(url, location.href) : new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    const withoutQuery = url.split("?")[0] ?? url;
    return withoutQuery.split("#")[0] ?? withoutQuery;
  }
}

function resolveFetchUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Global `error` / `unhandledrejection` / non-OK `fetch` capture into app logs. */
function captureDiagnostic({
  level,
  scope,
  message,
}: {
  readonly level: LogLevel;
  readonly scope: string;
  readonly message: string;
}) {
  const recordArgs: Parameters<typeof record>[0] = {
    level,
    scope,
    message,
  };
  record(recordArgs);
}

function installGlobalErrorHandlers() {
  if (!("window" in globalThis)) return;

  window.addEventListener("error", (event) => {
    if (isIgnoredErrorSource(event.filename)) return;
    const captureDiagnosticArgs: Parameters<typeof captureDiagnostic>[0] = {
      level: LogLevel.Error,
      scope: "window",
      message: `${event.message || "Uncaught error"} source=${sanitizeLogUrl(event.filename)} line=${event.lineno} column=${event.colno}${event.error instanceof Error && event.error.stack ? ` stack=${event.error.stack}` : ""}`,
    };
    captureDiagnostic(captureDiagnosticArgs);
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    if (reason instanceof Error && isIgnoredErrorSource(reason.stack)) return;
    const message =
      reason instanceof Error
        ? `${reason.name}: ${reason.message}`
        : stringifyArgs([reason]);
    if (isIgnoredErrorSource(message)) return;
    const captureDiagnosticArgs2: Parameters<typeof captureDiagnostic>[0] = {
      level: LogLevel.Error,
      scope: "unhandledrejection",
      message: `${message}${reason instanceof Error && reason.stack ? ` stack=${reason.stack}` : " stack=unavailable"}`,
    };
    captureDiagnostic(captureDiagnosticArgs2);
  });
}

function installFetchInstrumentation() {
  if (typeof globalThis.fetch !== "function") return;
  const marker = globalThis as typeof globalThis & {
    __nookFetchOuter?: typeof globalThis.fetch;
  };
  if (globalThis.fetch === marker.__nookFetchOuter) return;

  const originalFetch = globalThis.fetch.bind(globalThis);
  // eslint-disable-next-line max-params -- Fetch owns this positional callback signature.
  const wrapped: typeof globalThis.fetch = async (input, init) => {
    const response = await originalFetch(input, init);
    if (!response.ok) {
      const url = sanitizeLogUrl(resolveFetchUrl(input));
      if (!isIgnoredErrorSource(url)) {
        const captureDiagnosticArgs3: Parameters<typeof captureDiagnostic>[0] =
          {
            level: LogLevel.Warn,
            scope: "fetch",
            message: `HTTP ${response.status} ${response.statusText} url=${url} method=${init?.method ?? "GET"}`,
          };
        captureDiagnostic(captureDiagnosticArgs3);
      }
    }
    return response;
  };
  marker.__nookFetchOuter = wrapped;
  globalThis.fetch = wrapped;
}

function installDiagnosticsCapture() {
  if (!diagnosticsInstalled) {
    diagnosticsInstalled = true;
    installGlobalErrorHandlers();
  }
  // WASM init may replace `fetch` after the first module-load install.
  installFetchInstrumentation();
}

export type ScopedLogger = {
  error: (message: string) => void;
  warn: (message: string) => void;
  info: (message: string) => void;
  debug: (message: string) => void;
  trace: (message: string) => void;
  warnWithContext: (context: SerializedLogContext) => void;
};

export function createLogger(scope: string): ScopedLogger {
  return {
    error: (message) =>
      (() => {
        const recordArgs2: Parameters<typeof record>[0] = {
          level: LogLevel.Error,
          scope,
          message,
        };
        return record(recordArgs2);
      })(),
    warn: (message) =>
      (() => {
        const recordArgs3: Parameters<typeof record>[0] = {
          level: LogLevel.Warn,
          scope,
          message,
        };
        return record(recordArgs3);
      })(),
    info: (message) =>
      (() => {
        const recordArgs4: Parameters<typeof record>[0] = {
          level: LogLevel.Info,
          scope,
          message,
        };
        return record(recordArgs4);
      })(),
    debug: (message) =>
      (() => {
        const recordArgs5: Parameters<typeof record>[0] = {
          level: LogLevel.Debug,
          scope,
          message,
        };
        return record(recordArgs5);
      })(),
    trace: (message) =>
      (() => {
        const recordArgs6: Parameters<typeof record>[0] = {
          level: LogLevel.Trace,
          scope,
          message,
        };
        return record(recordArgs6);
      })(),
    warnWithContext: ({ message, serializedContext }) => {
      if (!isEnabled(LogLevel.Warn)) return;
      const echoArgs: Parameters<typeof echo>[0] = {
        level: LogLevel.Warn,
        text: `[${scope}] ${message} ${serializedContext}`,
      };
      echo(echoArgs);
      const persistArgs: Parameters<typeof persistStructured>[0] = {
        level: LogLevel.Warn,
        scope,
        message,
        serializedContext,
      };
      persistStructured(persistArgs);
    },
  };
}

export function setLogLevel(level: LogLevel) {
  try {
    localStorage.setItem("nook_log_level", level);
  } catch {
    // Storage may be unavailable (private mode); keep the WASM-side level.
  }
  if (wasmReady) {
    nookLogSetLevel(level);
  }
}

export function getLogLevel(): LogLevel {
  if (wasmReady) {
    const parsed = parseLevel(nookLogGetLevel());
    return parsed.kind === LogLevelParseKind.Valid
      ? parsed.level
      : LogLevel.Info;
  }
  return initialLevel();
}

/** Read persisted entries (oldest first), optionally filtered/paginated. */
export async function dumpLogs(options: {
  minLevel: LogLevel;
  limit: number;
  offset: number;
}): Promise<LogEntry[]> {
  if (!wasmReady) return [];
  const entries = await nookLogDumpPage(
    options.minLevel,
    options.limit,
    options.offset,
  );
  try {
    return entries.toArray() as LogEntry[];
  } finally {
    entries.free();
  }
}

/** Total number of persisted log entries. */
export async function logCount(): Promise<number> {
  if (!wasmReady) return 0;
  return nookLogCount();
}

export async function clearLogs(): Promise<void> {
  if (!wasmReady) return;
  await nookLogClear();
}

/** Force the write-behind queue into IndexedDB (for `/logs`, e2e, post-mortem). */
export async function flushLogs(): Promise<void> {
  if (!wasmReady) return;
  await nookLogFlush();
}

/** Stop all persistence before the destructive local-browser cleanup runs. */
export async function suspendWasmLogging(): Promise<void> {
  if (logFlushSchedule.kind === LogFlushScheduleKind.Scheduled) {
    clearInterval(logFlushSchedule.timer);
    logFlushSchedule = { kind: LogFlushScheduleKind.Stopped };
  }
  while (flushing) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  wasmReady = false;
  preInitQueue.length = 0;
}

/**
 * Patch `console.*` so every call still prints (via the captured originals) and
 * is persisted with the `console` scope. Idempotent; only the persist side is
 * level-gated (console output is never suppressed).
 */
function patchConsole() {
  if (consolePatched || !("console" in globalThis)) return;
  consolePatched = true;

  const wrap = ({
    method,
    level,
  }: {
    readonly method: ConsoleMethodKind;
    readonly level: LogLevel;
  }) => {
    // eslint-disable-next-line @typescript-eslint/no-restricted-types -- Console arguments are stringified immediately at ingress.
    console[method] = (...args: unknown[]) => {
      originalConsole[method](...args);
      if (isEnabled(level)) {
        const persistMessageArgs2: Parameters<typeof persistMessage>[0] = {
          level,
          scope: "console",
          message: stringifyArgs(args),
        };
        persistMessage(persistMessageArgs2);
      }
    };
  };

  const wrapArgs: Parameters<typeof wrap>[0] = {
    method: ConsoleMethodKind.Error,
    level: LogLevel.Error,
  };
  wrap(wrapArgs);
  const wrapArgs2: Parameters<typeof wrap>[0] = {
    method: ConsoleMethodKind.Warn,
    level: LogLevel.Warn,
  };
  wrap(wrapArgs2);
  const wrapArgs3: Parameters<typeof wrap>[0] = {
    method: ConsoleMethodKind.Info,
    level: LogLevel.Info,
  };
  wrap(wrapArgs3);
  const wrapArgs4: Parameters<typeof wrap>[0] = {
    method: ConsoleMethodKind.Debug,
    level: LogLevel.Debug,
  };
  wrap(wrapArgs4);
  const wrapArgs5: Parameters<typeof wrap>[0] = {
    method: ConsoleMethodKind.Log,
    level: LogLevel.Info,
  };
  wrap(wrapArgs5);
}

/**
 * Wire the WASM logger once the engine is initialised: install the console
 * bridge, start the Rust subscriber, push the resolved level, replay queued
 * entries, and start the write-behind flush loop.
 * Idempotent — safe to call on every `getVaultManager()`.
 */
export function initWasmLogging() {
  if ("window" in globalThis) {
    window.__nookConsole = { echo: hostEcho };
  }
  installDiagnosticsCapture();
  patchConsole();

  nookLogInit();
  nookLogSetLevel(initialLevel());
  wasmReady = true;

  if (preInitQueue.length > 0) {
    const queued = preInitQueue.splice(0, preInitQueue.length);
    for (const entry of queued) {
      try {
        if (entry.kind === PendingRecordKind.Structured) {
          nookLogWithData(
            entry.level,
            entry.scope,
            entry.message,
            entry.serializedContext,
          );
        } else {
          nookLog(entry.level, entry.scope, entry.message);
        }
      } catch {
        // Ignore — a broken early log must not block startup.
      }
    }
  }

  if (logFlushSchedule.kind === LogFlushScheduleKind.Stopped) {
    logFlushSchedule = {
      kind: LogFlushScheduleKind.Scheduled,
      timer: setInterval(() => {
        if (flushing) return;
        flushing = true;
        void nookLogFlush()
          .catch(() => {
            // Drop the batch on storage errors; logging must never break the app.
          })
          .finally(() => {
            flushing = false;
          });
      }, FLUSH_INTERVAL_MS),
    };
  }
}

declare global {
  interface Window {
    __nookLog?: {
      setLevel: typeof setLogLevel;
      getLevel: typeof getLogLevel;
      dump: typeof dumpLogs;
      count: typeof logCount;
      clear: typeof clearLogs;
      flush: typeof flushLogs;
    };
    /** Bridge for Rust `tracing` events to reach the original console. */
    __nookConsole?: {
      // eslint-disable-next-line max-params -- Host API owns this positional callback signature.
      echo: (level: LogLevel, text: string) => void;
    };
  }
}

if ("window" in globalThis) {
  installDiagnosticsCapture();
  window.__nookLog = {
    setLevel: setLogLevel,
    getLevel: getLogLevel,
    dump: dumpLogs,
    count: logCount,
    clear: clearLogs,
    flush: flushLogs,
  };
}
