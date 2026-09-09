import { Logger } from "./logger.js";
export class AgentWaitEnvironment {
  constructor(private readonly environment: NodeJS.ProcessEnv) {}
  loadAgentWaitOptions(): {
    timeoutMs: number;
    heartbeatMs: number;
  } {
    const [defaulted1 = DEFAULT_TIMEOUT_MS] = [
      this.environment.CI_AGENT_TIMEOUT_MS,
    ];
    const timeoutMs = Number(defaulted1);
    const [defaulted2 = DEFAULT_HEARTBEAT_MS] = [
      this.environment.CI_AGENT_HEARTBEAT_MS,
    ];
    const heartbeatMs = Number(defaulted2);
    return {
      timeoutMs:
        Number.isFinite(timeoutMs) && timeoutMs > 0
          ? timeoutMs
          : DEFAULT_TIMEOUT_MS,
      heartbeatMs:
        Number.isFinite(heartbeatMs) && heartbeatMs > 0
          ? heartbeatMs
          : DEFAULT_HEARTBEAT_MS,
    };
  }
}

export class ElapsedDuration {
  constructor(private readonly request: number) {}
  format(): string {
    const ms = this.request;

    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  }
}

export interface AgentWaitWaitWithHeartbeatRequest<T> {
  readonly label: string;
  readonly wait: () => Promise<T>;
  readonly options: { timeoutMs: number; heartbeatMs: number };
}

export class AgentWait<T> {
  constructor(private readonly request: AgentWaitWaitWithHeartbeatRequest<T>) {}
  async complete(): Promise<T> {
    const { label, wait, options } = this.request;

    const started = Date.now();
    const heartbeat = setInterval(() => {
      log.info(
        `${label} still running (${new ElapsedDuration(Date.now() - started).format()})`,
      );
    }, options.heartbeatMs);

    try {
      return await Promise.race([
        wait(),
        new Promise<T>((_, reject) => {
          setTimeout(() => {
            reject(
              new Error(
                `${label} timed out after ${new ElapsedDuration(options.timeoutMs).format()} (CI_AGENT_TIMEOUT_MS)`,
              ),
            );
          }, options.timeoutMs);
        }),
      ]);
    } finally {
      clearInterval(heartbeat);
    }
  }
}

const log = new Logger("agent-wait");

const DEFAULT_TIMEOUT_MS = 90 * 60 * 1000;
const DEFAULT_HEARTBEAT_MS = 60 * 1000;
