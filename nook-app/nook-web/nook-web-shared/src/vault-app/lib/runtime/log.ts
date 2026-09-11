/**
 * Web-side console authority + shim over the WASM-owned logger
 * (`nook-wasm/src/logger.rs`).
 *
 * The logger core — level gating, IndexedDB persistence (rexie, `nook_logs`
 * ring buffer), `nook-core`/`nook-wasm` `tracing` events — lives in WASM. This
 * module makes the WASM logger the single console authority for the web app:
 * - captures the ORIGINAL `console.*` methods at load,
 * - patches `console.*` so every call still prints (via the originals) AND is
 *   persisted through the `log_record` binding,
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
 * {@link browserLogRuntime.initWasmLogging} (invoked once from `$lib/nook`).
 */

import {
  type LogEntry,
  classify_vault_recovery_error,
  VaultRecoveryErrorKind,
  log_record,
  log_clear,
  log_count,
  log_dump_page,
  log_flush,
  log_get_level,
  log_init,
  log_set_level,
  log_record_with_data,
} from "$app-wasm";

export enum LogLevel {
  Error = "error",
  Warn = "warn",
  Info = "info",
  Debug = "debug",
  Trace = "trace",
}

export type { LogEntry } from "$app-wasm";

type RuntimeFailureDetails = {
  readonly message: string;
  readonly stack?: string;
};

type BrowserLogFetchArguments = Parameters<typeof globalThis.fetch>;

export class RuntimeFailure {
  readonly message: string;
  readonly stack?: string;

  constructor(details: RuntimeFailureDetails) {
    this.message = details.message;
    if (details.stack) this.stack = details.stack;
  }

  vaultRecoveryKind(): VaultRecoveryErrorKind {
    return classify_vault_recovery_error(this.message);
  }
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

enum LogRuntimeReadinessKind {
  Pending = "pending",
  Ready = "ready",
}

type LogRuntimeReadiness =
  | {
      readonly kind: LogRuntimeReadinessKind.Pending;
      readonly completion: Promise<void>;
      readonly complete: () => void;
    }
  | { readonly kind: LogRuntimeReadinessKind.Ready };

/**
 * The original console methods, captured before we patch `console`. All echo
 * paths (`createLogger`, the `console.*` patch, Rust via `__nookConsole.echo`)
 * print through these so patching never causes recursion or double-persist.
 */
// eslint-disable-next-line @typescript-eslint/no-restricted-types -- Console owns this variadic ingress boundary.
type ConsoleArguments = unknown[];

type ConsoleMethod = (...args: ConsoleArguments) => void;

enum ConsoleMethodKind {
  Error = "error",
  Warn = "warn",
  Info = "info",
  Debug = "debug",
  Log = "log",
}

enum LogLevelParseKind {
  Invalid = "invalid",
  Valid = "valid",
}

type LogLevelParse =
  | { kind: LogLevelParseKind.Invalid }
  | { kind: LogLevelParseKind.Valid; level: LogLevel };

/**
 * Echo one line to the console via the ORIGINAL (unpatched) methods, prefixed
 * with a local date/time so console output is timestamped like the persisted
 * entries. Shared by `createLogger` and Rust `tracing` events
 * (`window.__nookConsole.echo`).
 */
type LogEchoEvent = {
  readonly level: LogLevel;
  readonly text: string;
};

/** Persist one entry (no console echo). Queues until WASM is ready. */
type LogMessagePersistence = {
  readonly level: LogLevel;
  readonly scope: string;
  readonly message: string;
};

/** Persist already-serialized adapter context without accepting a generic value bag. */
type StructuredLogPersistence = {
  readonly level: LogLevel;
  readonly scope: string;
  readonly message: string;
  readonly serializedContext: string;
};

/** `createLogger` path: gate, echo once via originals, then persist. */
type LogRecordRequest = {
  readonly level: LogLevel;
  readonly scope: string;
  readonly message: string;
};

/** Global `error` / `unhandledrejection` / non-OK `fetch` capture into app logs. */
type DiagnosticCapture = {
  readonly level: LogLevel;
  readonly scope: string;
  readonly message: string;
};

export type ScopedLogger = {
  error: (message: string) => void;
  warn: (message: string) => void;
  info: (message: string) => void;
  debug: (message: string) => void;
  trace: (message: string) => void;
  infoWithContext: (context: SerializedLogContext) => void;
  warnWithContext: (context: SerializedLogContext) => void;
};

/** Read persisted entries (oldest first), optionally filtered/paginated. */
type LogQuery = {
  minLevel: LogLevel;
  limit: number;
  offset: number;
};

declare global {
  interface Window {
    __nookLog?: {
      setLevel: typeof browserLogRuntime.setLogLevel;
      getLevel: typeof browserLogRuntime.getLogLevel;
      dump: typeof browserLogRuntime.dumpLogs;
      count: typeof browserLogRuntime.logCount;
      clear: typeof browserLogRuntime.clearLogs;
      flush: typeof browserLogRuntime.flushLogs;
    };
    /** Bridge for Rust `tracing` events to reach the original console. */
    __nookConsole?: {
      // eslint-disable-next-line max-params -- Host API owns this positional callback signature.
      echo: (level: LogLevel, text: string) => void;
    };
  }
}

/** Owns the browser runtime resources shared by these interactions. */
class BrowserLogRuntime {
  private wasmReady = false;
  private logRuntimeReadiness = BrowserLogRuntime.pendingReadiness();
  private logFlushSchedule: LogFlushSchedule = {
    kind: LogFlushScheduleKind.Stopped,
  };
  private flushing = false;
  private consolePatched = false;
  private diagnosticsInstalled = false;
  private preInitQueue: PendingRecord[] = [];
  private originalConsole: Record<ConsoleMethodKind, ConsoleMethod> =
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

  private static pendingReadiness(): LogRuntimeReadiness {
    let complete = () => {};
    const completion = new Promise<void>((resolve) => {
      complete = resolve;
    });
    return { kind: LogRuntimeReadinessKind.Pending, completion, complete };
  }

  async waitForWasmLogging(): Promise<void> {
    const readiness = this.logRuntimeReadiness;
    if (readiness.kind === LogRuntimeReadinessKind.Ready) return;
    await readiness.completion;
  }
  // eslint-disable-next-line @typescript-eslint/no-restricted-types -- Foreign host data is narrowed at this boundary.
  runtimeFailure(cause: unknown): RuntimeFailure {
    return new RuntimeFailure(
      cause instanceof Error
        ? // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
          {
            message: cause.message,
            ...(cause.stack ? { stack: cause.stack } : {}),
          }
        : // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
          { message: String(cause) },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-restricted-types -- Foreign host data is narrowed at this boundary.
  runtimeError(cause: unknown): Error {
    return cause instanceof Error ? cause : new Error(String(cause));
  }

  private parseLevel(raw: string): LogLevelParse {
    if (typeof raw !== "string") return { kind: LogLevelParseKind.Invalid };
    const value = raw.trim().toLowerCase();
    return LOG_LEVELS.includes(value as LogLevel)
      ? { kind: LogLevelParseKind.Valid, level: value as LogLevel }
      : { kind: LogLevelParseKind.Invalid };
  }

  private initialLevel(): LogLevel {
    if ("localStorage" in globalThis) {
      const stored = this.parseLevel(
        ((v) => (v ? v : ""))(localStorage.getItem("nook_log_level")),
      );
      if (stored.kind === LogLevelParseKind.Valid) return stored.level;
    }
    const env = this.parseLevel(
      ((v) => (v ? v : ""))(import.meta.env?.VITE_LOG_LEVEL),
    );
    return env.kind === LogLevelParseKind.Valid ? env.level : LogLevel.Info;
  }

  private stringifyArgs(args: ConsoleArguments): string {
    return args
      .map((arg) => {
        if (typeof arg === "string") return arg;
        if (arg instanceof Error)
          return ((...[v = `${arg.name}: ${arg.message}`]) => v)(arg.stack);
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      })
      .join(" ");
  }

  private levelRank(level: LogLevel): number {
    return LOG_LEVELS.indexOf(level);
  }

  private formatTimestamp(date: Date): string {
    type TimestampPadding = {
      readonly value: number;
      readonly size: number;
    };

    const pad = ({ value, size }: TimestampPadding) =>
      String(value).padStart(size, "0");
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

  private isEnabled(level: LogLevel): boolean {
    return this.levelRank(level) <= this.levelRank(this.getLogLevel());
  }

  private echo({ level, text }: LogEchoEvent) {
    const line = `${this.formatTimestamp(new Date())} ${text}`;
    switch (level) {
      case LogLevel.Error:
        this.originalConsole.error(line);
        break;
      case LogLevel.Warn:
        this.originalConsole.warn(line);
        break;
      case LogLevel.Debug:
      case LogLevel.Trace:
        this.originalConsole.debug(line);
        break;
      case LogLevel.Info:
        this.originalConsole.info(line);
    }
  }

  // eslint-disable-next-line max-params -- Existing integration signature is preserved for this lint-only fix.
  private hostEcho(level: LogLevel, text: string): void {
    const echoArgs: Parameters<typeof this.echo>[0] = { level, text };
    this.echo(echoArgs);
  }

  private persistMessage({ level, scope, message }: LogMessagePersistence) {
    if (!this.wasmReady) {
      if (this.preInitQueue.length < PRE_INIT_QUEUE_MAX) {
        const pushArgs: Parameters<typeof this.preInitQueue.push>[0] = {
          kind: PendingRecordKind.Message,
          level,
          scope,
          message,
        };
        this.preInitQueue.push(pushArgs);
      }
      return;
    }
    try {
      log_record(level, scope, message);
    } catch {
      // Logging must never break the app.
    }
  }

  private persistStructured({
    level,
    scope,
    message,
    serializedContext,
  }: StructuredLogPersistence): void {
    if (!this.wasmReady) {
      if (this.preInitQueue.length < PRE_INIT_QUEUE_MAX) {
        const queued: PendingRecord = {
          kind: PendingRecordKind.Structured,
          level,
          scope,
          message,
          serializedContext,
        };
        this.preInitQueue.push(queued);
      }
      return;
    }
    try {
      log_record_with_data(level, scope, message, serializedContext);
    } catch {
      // Logging must never break the app.
    }
  }

  private record({ level, scope, message }: LogRecordRequest) {
    if (!this.isEnabled(level)) return;
    const echoArgs2: Parameters<typeof this.echo>[0] = {
      level,
      text: `[${scope}] ${message}`,
    };
    this.echo(echoArgs2);
    const persistMessageArgs: Parameters<typeof this.persistMessage>[0] = {
      level,
      scope,
      message,
    };
    this.persistMessage(persistMessageArgs);
  }

  // eslint-disable-next-line @typescript-eslint/no-restricted-types -- Foreign host data is narrowed at this boundary.
  isIgnoredErrorSource(source: unknown): boolean {
    if (typeof source !== "string") return false;
    const value = source.trim();
    if (!value) return false;
    return (
      /^(chrome|moz|safari-web|safari)-extension:/i.test(value) ||
      value.includes("bootstrap-autofill-overlay")
    );
  }

  sanitizeLogUrl(url: string): string {
    try {
      const parsed =
        "location" in globalThis ? new URL(url, location.href) : new URL(url);
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return url.split("?")[0].split("#")[0];
    }
  }

  private resolveFetchUrl(input: RequestInfo | URL): string {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    return input.url;
  }

  private captureDiagnostic({ level, scope, message }: DiagnosticCapture) {
    const recordArgs: Parameters<typeof this.record>[0] = {
      level,
      scope,
      message,
    };
    this.record(recordArgs);
  }

  private installGlobalErrorHandlers() {
    if (!("window" in globalThis)) return;

    window.addEventListener("error", (event) => {
      if (this.isIgnoredErrorSource(event.filename)) return;
      const captureDiagnosticArgs: Parameters<
        typeof this.captureDiagnostic
      >[0] = {
        level: LogLevel.Error,
        scope: "window",
        message: `${event.message || "Uncaught error"} source=${this.sanitizeLogUrl(event.filename)} line=${event.lineno} column=${event.colno}${event.error instanceof Error && event.error.stack ? ` stack=${event.error.stack}` : ""}`,
      };
      this.captureDiagnostic(captureDiagnosticArgs);
    });

    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason;
      if (reason instanceof Error && this.isIgnoredErrorSource(reason.stack))
        return;
      const message =
        reason instanceof Error
          ? `${reason.name}: ${reason.message}`
          : this.stringifyArgs([reason]);
      if (this.isIgnoredErrorSource(message)) return;
      const captureDiagnosticArgs2: Parameters<
        typeof this.captureDiagnostic
      >[0] = {
        level: LogLevel.Error,
        scope: "unhandledrejection",
        message: `${message}${reason instanceof Error && reason.stack ? ` stack=${reason.stack}` : " stack=unavailable"}`,
      };
      this.captureDiagnostic(captureDiagnosticArgs2);
    });
  }

  private installFetchInstrumentation() {
    if (typeof globalThis.fetch !== "function") return;
    const marker = globalThis as typeof globalThis & {
      __nookFetchOuter?: typeof globalThis.fetch;
    };
    if (globalThis.fetch === marker.__nookFetchOuter) return;

    const originalFetch = globalThis.fetch.bind(globalThis);
    const fetchStatics: Pick<typeof globalThis.fetch, "preconnect"> = {
      preconnect: globalThis.fetch.preconnect,
    };
    const wrapped: typeof globalThis.fetch = Object.assign(
      async (...browserLogFetchArguments: BrowserLogFetchArguments) => {
        const [input, init] = browserLogFetchArguments;
        const response = await originalFetch(...browserLogFetchArguments);
        if (!response.ok) {
          const url = this.sanitizeLogUrl(this.resolveFetchUrl(input));
          if (!this.isIgnoredErrorSource(url)) {
            const captureDiagnosticArgs3: Parameters<
              typeof this.captureDiagnostic
            >[0] = {
              level: LogLevel.Warn,
              scope: "fetch",
              message: `HTTP ${response.status} ${response.statusText} url=${url} method=${((...[v = "GET"]) => v)(init?.method)}`,
            };
            this.captureDiagnostic(captureDiagnosticArgs3);
          }
        }
        return response;
      },
      fetchStatics,
    );
    marker.__nookFetchOuter = wrapped;
    globalThis.fetch = wrapped;
  }

  private installDiagnosticsCapture() {
    if (!this.diagnosticsInstalled) {
      this.diagnosticsInstalled = true;
      this.installGlobalErrorHandlers();
    }
    // WASM init may replace `fetch` after the first module-load install.
    this.installFetchInstrumentation();
  }

  createLogger(scope: string): ScopedLogger {
    return {
      error: (message) =>
        (() => {
          const recordArgs2: Parameters<typeof this.record>[0] = {
            level: LogLevel.Error,
            scope,
            message,
          };
          return this.record(recordArgs2);
        })(),
      warn: (message) =>
        (() => {
          const recordArgs3: Parameters<typeof this.record>[0] = {
            level: LogLevel.Warn,
            scope,
            message,
          };
          return this.record(recordArgs3);
        })(),
      info: (message) =>
        (() => {
          const recordArgs4: Parameters<typeof this.record>[0] = {
            level: LogLevel.Info,
            scope,
            message,
          };
          return this.record(recordArgs4);
        })(),
      debug: (message) =>
        (() => {
          const recordArgs5: Parameters<typeof this.record>[0] = {
            level: LogLevel.Debug,
            scope,
            message,
          };
          return this.record(recordArgs5);
        })(),
      trace: (message) =>
        (() => {
          const recordArgs6: Parameters<typeof this.record>[0] = {
            level: LogLevel.Trace,
            scope,
            message,
          };
          return this.record(recordArgs6);
        })(),
      infoWithContext: ({ message, serializedContext }) => {
        if (!this.isEnabled(LogLevel.Info)) return;
        const echoArgs: Parameters<typeof this.echo>[0] = {
          level: LogLevel.Info,
          text: `[${scope}] ${message} ${serializedContext}`,
        };
        this.echo(echoArgs);
        const persistArgs: Parameters<typeof this.persistStructured>[0] = {
          level: LogLevel.Info,
          scope,
          message,
          serializedContext,
        };
        this.persistStructured(persistArgs);
      },
      warnWithContext: ({ message, serializedContext }) => {
        if (!this.isEnabled(LogLevel.Warn)) return;
        const echoArgs: Parameters<typeof this.echo>[0] = {
          level: LogLevel.Warn,
          text: `[${scope}] ${message} ${serializedContext}`,
        };
        this.echo(echoArgs);
        const persistArgs: Parameters<typeof this.persistStructured>[0] = {
          level: LogLevel.Warn,
          scope,
          message,
          serializedContext,
        };
        this.persistStructured(persistArgs);
      },
    };
  }

  setLogLevel(level: LogLevel) {
    try {
      localStorage.setItem("nook_log_level", level);
    } catch {
      // Storage may be unavailable (private mode); keep the WASM-side level.
    }
    if (this.wasmReady) {
      log_set_level(level);
    }
  }

  getLogLevel(): LogLevel {
    if (this.wasmReady) {
      const parsed = this.parseLevel(log_get_level());
      return parsed.kind === LogLevelParseKind.Valid
        ? parsed.level
        : LogLevel.Info;
    }
    return this.initialLevel();
  }

  async dumpLogs(options: LogQuery): Promise<LogEntry[]> {
    if (!this.wasmReady) return [];
    const entries = await log_dump_page(
      options.minLevel,
      options.limit,
      options.offset,
    );
    try {
      return entries.to_array();
    } finally {
      entries.free();
    }
  }

  async logCount(): Promise<number> {
    if (!this.wasmReady) return 0;
    return log_count();
  }

  async clearLogs(): Promise<void> {
    if (!this.wasmReady) return;
    await log_clear();
  }

  async flushLogs(): Promise<void> {
    if (!this.wasmReady) return;
    await log_flush();
  }

  async suspendWasmLogging(): Promise<void> {
    if (this.logFlushSchedule.kind === LogFlushScheduleKind.Scheduled) {
      clearInterval(this.logFlushSchedule.timer);
      this.logFlushSchedule = { kind: LogFlushScheduleKind.Stopped };
    }
    while (this.flushing) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    this.wasmReady = false;
    if (this.logRuntimeReadiness.kind === LogRuntimeReadinessKind.Ready) {
      this.logRuntimeReadiness = BrowserLogRuntime.pendingReadiness();
    }
    this.preInitQueue.length = 0;
  }

  private patchConsole() {
    if (this.consolePatched || !("console" in globalThis)) return;
    this.consolePatched = true;

    type ConsoleMethodWrap = {
      readonly method: ConsoleMethodKind;
      readonly level: LogLevel;
    };

    const wrap = ({ method, level }: ConsoleMethodWrap) => {
      console[method] = (...args: ConsoleArguments) => {
        this.originalConsole[method](...args);
        if (this.isEnabled(level)) {
          const persistMessageArgs2: Parameters<typeof this.persistMessage>[0] =
            {
              level,
              scope: "console",
              message: this.stringifyArgs(args),
            };
          this.persistMessage(persistMessageArgs2);
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

  initWasmLogging() {
    if ("window" in globalThis) {
      window.__nookConsole = { echo: this.hostEcho.bind(this) };
    }
    this.installDiagnosticsCapture();
    this.patchConsole();

    log_init();
    log_set_level(this.initialLevel());
    this.wasmReady = true;
    if (this.logRuntimeReadiness.kind === LogRuntimeReadinessKind.Pending) {
      this.logRuntimeReadiness.complete();
      this.logRuntimeReadiness = { kind: LogRuntimeReadinessKind.Ready };
    }

    if (this.preInitQueue.length > 0) {
      const queued = this.preInitQueue.splice(0, this.preInitQueue.length);
      for (const entry of queued) {
        try {
          if (entry.kind === PendingRecordKind.Structured) {
            log_record_with_data(
              entry.level,
              entry.scope,
              entry.message,
              entry.serializedContext,
            );
          } else {
            log_record(entry.level, entry.scope, entry.message);
          }
        } catch {
          // Ignore — a broken early log must not block startup.
        }
      }
    }

    if (this.logFlushSchedule.kind === LogFlushScheduleKind.Stopped) {
      this.logFlushSchedule = {
        kind: LogFlushScheduleKind.Scheduled,
        timer: setInterval(() => {
          if (this.flushing) return;
          this.flushing = true;
          void log_flush()
            .catch(() => {
              // Drop the batch on storage errors; logging must never break the app.
            })
            .finally(() => {
              this.flushing = false;
            });
        }, FLUSH_INTERVAL_MS),
      };
    }
  }

  installBrowserConsole() {
    if ("window" in globalThis) {
      this.installDiagnosticsCapture();
      window.__nookLog = {
        setLevel: this.setLogLevel.bind(this),
        getLevel: this.getLogLevel.bind(this),
        dump: this.dumpLogs.bind(this),
        count: this.logCount.bind(this),
        clear: this.clearLogs.bind(this),
        flush: this.flushLogs.bind(this),
      };
    }
  }
}

export const browserLogRuntime = new BrowserLogRuntime();

browserLogRuntime.installBrowserConsole();
