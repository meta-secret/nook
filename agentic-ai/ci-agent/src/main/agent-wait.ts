import { err, type Result } from "neverthrow";
import { CiFailureKind, type CiFailure } from "./failure.js";
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
  readonly wait: () => Promise<Result<T, CiFailure>>;
  readonly options: { timeoutMs: number; heartbeatMs: number };
}

export class AgentWait<T> {
  constructor(private readonly request: AgentWaitWaitWithHeartbeatRequest<T>) {}
  async complete(): Promise<Result<T, CiFailure>> {
    const { label, wait, options } = this.request;

    const started = Date.now();
    const heartbeat = setInterval(() => {
      log.info(
        `${label} still running (${new ElapsedDuration(Date.now() - started).format()})`,
      );
    }, options.heartbeatMs);

    const deadline = new AgentDeadline<T>(label, options.timeoutMs);
    const scheduled = deadline.schedule();
    const outcome = await Promise.race([wait(), scheduled.outcome]);
    scheduled.cancel();
    clearInterval(heartbeat);
    return outcome;
  }
}

const log = new Logger("agent-wait");

const DEFAULT_TIMEOUT_MS = 90 * 60 * 1000;
const DEFAULT_HEARTBEAT_MS = 60 * 1000;

class AgentDeadline<T> {
  constructor(
    private readonly label: string,
    private readonly timeoutMs: number,
  ) {}
  schedule() {
    const controller = new AbortController();
    const outcome = new Promise<Result<T, CiFailure>>((resolve) => {
      const timer = setTimeout(
        () =>
          resolve(
            err({
              kind: CiFailureKind.Timeout,
              message: `${this.label} timed out after ${new ElapsedDuration(this.timeoutMs).format()} (CI_AGENT_TIMEOUT_MS)`,
            }),
          ),
        this.timeoutMs,
      );
      controller.signal.addEventListener("abort", () => clearTimeout(timer), {
        once: true,
      });
    });
    return { outcome, cancel: () => controller.abort() };
  }
}
