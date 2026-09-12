import { LogLevel, type LogEntry, browserLogRuntime } from "$lib/runtime/log";
import { ApplicationPath } from "$lib/runtime/routes";

/** Machine-readable log export route (JSON body, not the human `/logs` viewer). */
export const APP_LOGS_PATH = "/app-logs";

export const APP_LOGS_SCHEMA = "nook.app-logs.v1" as const;

export type AppLogsQuery = {
  minLevel: LogLevel;
  limit: number;
  offset: number;
};

export type AppLogsResponse = {
  meta: {
    schema: typeof APP_LOGS_SCHEMA;
    generatedAt: string;
    activeLevel: LogLevel;
    minLevel: LogLevel;
    limit: number;
    offset: number;
    returned: number;
    total: number;
  };
  entries: LogEntry[];
};

type LogLevelParseRequest = {
  readonly params: URLSearchParams;
  readonly name: string;
  readonly fallback: LogLevel;
};

type PositiveIntegerParseRequest = {
  readonly params: URLSearchParams;
  readonly name: string;
  readonly fallback: number;
  readonly max: number;
};

/** True when the current location resolves to the `/app-logs` JSON export route. */

/** Parse `/app-logs?minLevel=debug&limit=500&offset=0` query parameters. */

type AppLogsUrlRequest = {
  readonly query: Partial<AppLogsQuery>;
  readonly basePath: string;
};

/** Load persisted entries and wrap them in the canonical JSON export envelope. */

export class AppLogsLocation {
  constructor(private readonly request: string) {}
  get matches(): boolean {
    const pathname = this.request;
    const normalized =
      new ApplicationPath(pathname).relative.replace(/\/$/, "") || "/";
    return normalized === APP_LOGS_PATH;
  }
}
export class AppLogsQueryString {
  constructor(private readonly request: string) {}
  get query(): AppLogsQuery {
    const search = this.request;
    const params = new URLSearchParams(
      search.startsWith("?") ? search.slice(1) : search,
    );
    return {
      minLevel: (() => {
        const parseLevelArgs: Parameters<
          typeof AppLogsQueryString.parseLevel
        >[0] = {
          params,
          name: "minLevel",
          fallback: LogLevel.Trace,
        };
        return AppLogsQueryString.parseLevel(parseLevelArgs);
      })(),
      limit: (() => {
        const parsePositiveIntArgs: Parameters<
          typeof AppLogsQueryString.parsePositiveInt
        >[0] = {
          params,
          name: "limit",
          fallback: 500,
          max: 5000,
        };
        return AppLogsQueryString.parsePositiveInt(parsePositiveIntArgs);
      })(),
      offset: (() => {
        const parsePositiveIntArgs2: Parameters<
          typeof AppLogsQueryString.parsePositiveInt
        >[0] = {
          params,
          name: "offset",
          fallback: 0,
          max: Number.MAX_SAFE_INTEGER,
        };
        return AppLogsQueryString.parsePositiveInt(parsePositiveIntArgs2);
      })(),
    };
  }
  static parseLevel({
    params,
    name,
    fallback,
  }: LogLevelParseRequest): LogLevel {
    const raw = params.get(name);
    const value = raw?.trim().toLowerCase();
    switch (value) {
      case LogLevel.Error:
      case LogLevel.Warn:
      case LogLevel.Info:
      case LogLevel.Debug:
      case LogLevel.Trace:
        return value;
      case undefined:
        return fallback;
      default:
        return fallback;
    }
  }
  static parsePositiveInt({
    params,
    name,
    fallback,
    max,
  }: PositiveIntegerParseRequest) {
    const raw = params.get(name);
    const parsed = Number.parseInt(((v) => (v ? v : ""))(raw), 10);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return Math.min(parsed, max);
  }
}
export class AppLogsLocationRequest {
  constructor(private readonly request: AppLogsUrlRequest) {}
  get url(): string {
    const { query, basePath } = this.request;
    const params = new URLSearchParams();
    if (query.minLevel) params.set("minLevel", query.minLevel);
    if ("limit" in query) params.set("limit", String(query.limit));
    if ("offset" in query) params.set("offset", String(query.offset));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }
}
export class AppLogsExport {
  constructor(private readonly request: AppLogsQuery) {}
  async execute(): Promise<AppLogsResponse> {
    const query = this.request;
    await browserLogRuntime.waitForWasmLogging();
    const dumpLogsArgs: Parameters<typeof browserLogRuntime.dumpLogs>[0] = {
      minLevel: query.minLevel,
      limit: query.limit,
      offset: query.offset,
    };
    const [total, entries] = await Promise.all([
      browserLogRuntime.logCount(),
      browserLogRuntime.dumpLogs(dumpLogsArgs),
    ]);

    return {
      meta: {
        schema: APP_LOGS_SCHEMA,
        generatedAt: new Date().toISOString(),
        activeLevel: browserLogRuntime.getLogLevel(),
        minLevel: query.minLevel,
        limit: query.limit,
        offset: query.offset,
        returned: entries.length,
        total,
      },
      entries,
    };
  }
}
