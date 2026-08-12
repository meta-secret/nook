import {
  dumpLogs,
  getLogLevel,
  LogLevel,
  logCount,
  type LogEntry,
} from "$lib/runtime/log";
import { stripBasePath } from "$lib/runtime/routes";

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

const LOG_LEVELS: readonly LogLevel[] = [
  LogLevel.Error,
  LogLevel.Warn,
  LogLevel.Info,
  LogLevel.Debug,
  LogLevel.Trace,
];

type LogLevelParseRequest = {
  readonly params: URLSearchParams;
  readonly name: string;
  readonly fallback: LogLevel;
};

function parseLevel({
  params,
  name,
  fallback,
}: LogLevelParseRequest): LogLevel {
  const raw = params.get(name);
  const value = raw?.trim().toLowerCase();
  return LOG_LEVELS.includes(value as LogLevel)
    ? (value as LogLevel)
    : fallback;
}

type PositiveIntegerParseRequest = {
  readonly params: URLSearchParams;
  readonly name: string;
  readonly fallback: number;
  readonly max: number;
};

function parsePositiveInt({
  params,
  name,
  fallback,
  max,
}: PositiveIntegerParseRequest) {
  const raw = params.get(name);
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

/** True when the current location resolves to the `/app-logs` JSON export route. */
export function isAppLogsPath(pathname: string): boolean {
  const normalized = stripBasePath(pathname).replace(/\/$/, "") || "/";
  return normalized === APP_LOGS_PATH;
}

/** Parse `/app-logs?minLevel=debug&limit=500&offset=0` query parameters. */
export function parseAppLogsQuery(search: string): AppLogsQuery {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  return {
    minLevel: (() => {
      const parseLevelArgs: Parameters<typeof parseLevel>[0] = {
        params,
        name: "minLevel",
        fallback: LogLevel.Trace,
      };
      return parseLevel(parseLevelArgs);
    })(),
    limit: (() => {
      const parsePositiveIntArgs: Parameters<typeof parsePositiveInt>[0] = {
        params,
        name: "limit",
        fallback: 500,
        max: 5000,
      };
      return parsePositiveInt(parsePositiveIntArgs);
    })(),
    offset: (() => {
      const parsePositiveIntArgs2: Parameters<typeof parsePositiveInt>[0] = {
        params,
        name: "offset",
        fallback: 0,
        max: Number.MAX_SAFE_INTEGER,
      };
      return parsePositiveInt(parsePositiveIntArgs2);
    })(),
  };
}

type AppLogsUrlRequest = {
  readonly query: Partial<AppLogsQuery>;
  readonly basePath: string;
};

export function buildAppLogsUrl({
  query,
  basePath,
}: AppLogsUrlRequest): string {
  const params = new URLSearchParams();
  if (query.minLevel) params.set("minLevel", query.minLevel);
  if ("limit" in query) params.set("limit", String(query.limit));
  if ("offset" in query) params.set("offset", String(query.offset));
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/** Load persisted entries and wrap them in the canonical JSON export envelope. */
export async function loadAppLogsResponse(
  query: AppLogsQuery,
): Promise<AppLogsResponse> {
  const dumpLogsArgs: Parameters<typeof dumpLogs>[0] = {
    minLevel: query.minLevel,
    limit: query.limit,
    offset: query.offset,
  };
  const [total, entries] = await Promise.all([
    logCount(),
    dumpLogs(dumpLogsArgs),
  ]);

  return {
    meta: {
      schema: APP_LOGS_SCHEMA,
      generatedAt: new Date().toISOString(),
      activeLevel: getLogLevel(),
      minLevel: query.minLevel,
      limit: query.limit,
      offset: query.offset,
      returned: entries.length,
      total,
    },
    entries,
  };
}
