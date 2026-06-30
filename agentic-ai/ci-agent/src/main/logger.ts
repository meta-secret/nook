/** log4j-style structured console logging for ci-agent. */

export type LogLevel = "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR";

const LEVEL_RANK: Record<LogLevel, number> = {
  TRACE: 10,
  DEBUG: 20,
  INFO: 30,
  WARN: 40,
  ERROR: 50,
};

const ROOT_COMPONENT = "ci-agent";

function readMinLevel(): LogLevel {
  const raw = process.env.CI_AGENT_LOG_LEVEL?.trim().toUpperCase();
  if (raw && raw in LEVEL_RANK) {
    return raw as LogLevel;
  }
  return "INFO";
}

const minLevel = readMinLevel();

/** Format timestamp like log4j: `yyyy-MM-dd HH:mm:ss,SSS` (UTC). */
export function formatLogTimestamp(date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  const millis = String(date.getUTCMilliseconds()).padStart(3, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds},${millis}`;
}

export function formatLogLine(
  level: LogLevel,
  component: string,
  message: string,
  timestamp = new Date(),
): string {
  const levelLabel = level.padEnd(5, " ");
  return `${formatLogTimestamp(timestamp)} ${levelLabel} [${component}] ${message}`;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[minLevel];
}

function writeLine(level: LogLevel, line: string): void {
  if (level === "ERROR") {
    console.error(line);
    return;
  }
  if (level === "WARN") {
    console.warn(line);
    return;
  }
  console.log(line);
}

export function log(level: LogLevel, component: string, message: string): void {
  if (!shouldLog(level)) {
    return;
  }
  writeLine(level, formatLogLine(level, component, message));
}

export type Logger = {
  trace: (message: string) => void;
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  child: (suffix: string) => Logger;
};

export function createLogger(component: string): Logger {
  const fullComponent = component.startsWith(ROOT_COMPONENT)
    ? component
    : `${ROOT_COMPONENT}/${component}`;

  return {
    trace: (message) => log("TRACE", fullComponent, message),
    debug: (message) => log("DEBUG", fullComponent, message),
    info: (message) => log("INFO", fullComponent, message),
    warn: (message) => log("WARN", fullComponent, message),
    error: (message) => log("ERROR", fullComponent, message),
    child: (suffix) => createLogger(`${fullComponent}/${suffix}`),
  };
}
