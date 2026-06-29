import { Agent, CursorAgentError } from "@cursor/sdk";

import type { CiAgentConfig } from "./config.js";
import { finishInteractionLog, logInteractionUpdate } from "./log.js";

export async function runFixAgent(config: CiAgentConfig, prompt: string): Promise<void> {
  console.log(
    `==> Running Cursor SDK agent (run ${config.githubRunId}, branch ${config.fixBranch})`,
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
  } catch (err) {
    if (err instanceof CursorAgentError) {
      throw new Error(`Cursor agent startup failed: ${err.message}`);
    }
    throw err;
  }

  const result = await run.wait();
  if (result.status === "error") {
    throw new Error(`Cursor agent run failed (run id ${result.id})`);
  }
  if (result.status === "cancelled") {
    throw new Error(`Cursor agent run cancelled (run id ${result.id})`);
  }

  console.log(`\n==> Agent finished (${result.status})`);
  finishInteractionLog();
}
