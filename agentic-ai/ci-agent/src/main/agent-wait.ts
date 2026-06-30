import { createLogger } from "./logger.js";

const log = createLogger("agent-wait");

const DEFAULT_TIMEOUT_MS = 90 * 60 * 1000;
const DEFAULT_HEARTBEAT_MS = 60 * 1000;

export function loadAgentWaitOptions(): { timeoutMs: number; heartbeatMs: number } {
  const timeoutMs = Number(process.env.CI_AGENT_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const heartbeatMs = Number(process.env.CI_AGENT_HEARTBEAT_MS ?? DEFAULT_HEARTBEAT_MS);
  return {
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
    heartbeatMs:
      Number.isFinite(heartbeatMs) && heartbeatMs > 0 ? heartbeatMs : DEFAULT_HEARTBEAT_MS,
  };
}

export function formatDuration(ms: number): string {
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

export async function waitWithHeartbeat<T>(
  label: string,
  wait: () => Promise<T>,
  options: { timeoutMs: number; heartbeatMs: number },
): Promise<T> {
  const started = Date.now();
  const heartbeat = setInterval(() => {
    log.info(`${label} still running (${formatDuration(Date.now() - started)})`);
  }, options.heartbeatMs);

  try {
    return await Promise.race([
      wait(),
      new Promise<T>((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              `${label} timed out after ${formatDuration(options.timeoutMs)} (CI_AGENT_TIMEOUT_MS)`,
            ),
          );
        }, options.timeoutMs);
      }),
    ]);
  } finally {
    clearInterval(heartbeat);
  }
}
