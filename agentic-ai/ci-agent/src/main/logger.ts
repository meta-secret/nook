/** Structured console logging owned by each CI component. */
export enum LogLevel {
  Trace = "TRACE",
  Debug = "DEBUG",
  Info = "INFO",
  Warn = "WARN",
  Error = "ERROR",
}

const LEVEL_RANK: Record<LogLevel, number> = {
  TRACE: 10,
  DEBUG: 20,
  INFO: 30,
  WARN: 40,
  ERROR: 50,
};

export class LogTimestamp {
  constructor(private readonly date: Date = new Date()) {}

  format(): string {
    const date = this.date;
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    const hours = String(date.getUTCHours()).padStart(2, "0");
    const minutes = String(date.getUTCMinutes()).padStart(2, "0");
    const seconds = String(date.getUTCSeconds()).padStart(2, "0");
    const millis = String(date.getUTCMilliseconds()).padStart(3, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds},${millis}`;
  }
}

export interface LogRecordContent {
  readonly level: LogLevel;
  readonly component: string;
  readonly message: string;
  readonly timestamp?: Date;
}

export class LogRecord {
  constructor(private readonly content: LogRecordContent) {}

  format(): string {
    const { level, component, message, timestamp = new Date() } = this.content;
    return `${new LogTimestamp(timestamp).format()} ${level.padEnd(5, " ")} [${component}] ${message}`;
  }

  write(): void {
    if (!minimumLevel.includes(this.content.level)) return;
    const line = this.format();
    switch (this.content.level) {
      case LogLevel.Error:
        console.error(line);
        break;
      case LogLevel.Warn:
        console.warn(line);
        break;
      case LogLevel.Trace:
      case LogLevel.Debug:
      case LogLevel.Info:
        console.log(line);
        break;
    }
  }
}

class LogLevelFilter {
  private constructor(private readonly minimum: LogLevel) {}

  static fromEnvironment(environment: NodeJS.ProcessEnv): LogLevelFilter {
    const raw = environment.CI_AGENT_LOG_LEVEL?.trim().toUpperCase();
    const level = Object.values(LogLevel).find(
      (candidate) => candidate === raw,
    );
    return new LogLevelFilter(level || LogLevel.Info);
  }

  includes(level: LogLevel): boolean {
    return LEVEL_RANK[level] >= LEVEL_RANK[this.minimum];
  }
}

const minimumLevel = LogLevelFilter.fromEnvironment(process.env);

export class Logger {
  private readonly component: string;

  constructor(component: string) {
    this.component = component.startsWith("ci-agent")
      ? component
      : `ci-agent/${component}`;
  }

  trace(message: string): void {
    this.write({ level: LogLevel.Trace, message });
  }
  debug(message: string): void {
    this.write({ level: LogLevel.Debug, message });
  }
  info(message: string): void {
    this.write({ level: LogLevel.Info, message });
  }
  warn(message: string): void {
    this.write({ level: LogLevel.Warn, message });
  }
  error(message: string): void {
    this.write({ level: LogLevel.Error, message });
  }
  child(suffix: string): Logger {
    return new Logger(`${this.component}/${suffix}`);
  }

  private write(content: ComponentLogMessage): void {
    new LogRecord({ ...content, component: this.component }).write();
  }
}

interface ComponentLogMessage {
  readonly level: LogLevel;
  readonly message: string;
}
