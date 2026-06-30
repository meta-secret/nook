import { Agent, CursorAgentError } from "@cursor/sdk";

import { formatDuration, loadAgentWaitOptions, waitWithHeartbeat } from "./agent-wait.js";
import type { CiAgentConfig } from "./config.js";
import { finishInteractionLog, logInteractionUpdate } from "./log.js";
import { createLogger } from "./logger.js";

const log = createLogger("run-agent");

export async function runFixAgent(config: CiAgentConfig, prompt: string): Promise<void> {
  const waitOptions = loadAgentWaitOptions();
  log.info(
    `Running Cursor SDK agent (run ${config.githubRunId}, branch ${config.fixBranch}, timeout ${formatDuration(waitOptions.timeoutMs)})`,
  );

  await using agent = await Agent.create({
    apiKey: config.cursorApiKey,
    model: { id: config.modelId },
    local: {
      cwd: config.repoRoot,
      settingSources: [],
      sandboxOptions: { enabled: false },
    },
  });

  let run;
  try {
    run = await agent.send(prompt, {
      onDelta: ({ update }) => {
        logInteractionUpdate(update);
      },
    });
    log.info(`Agent run started (id ${run.id})`);
  } catch (err) {
    if (err instanceof CursorAgentError) {
      throw new Error(`Cursor agent startup failed: ${err.message}`);
    }
    throw err;
  }

  const result = await waitWithHeartbeat("Agent", () => run.wait(), waitOptions);
  if (result.status === "error") {
    throw new Error(`Cursor agent run failed (run id ${result.id})`);
  }
  if (result.status === "cancelled") {
    throw new Error(`Cursor agent run cancelled (run id ${result.id})`);
  }

  log.info(`Agent finished (${result.status})`);
  finishInteractionLog();

  // Release local executor resources before git push / PR polling.
  agent.close();
}
