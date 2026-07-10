import { chdir } from "node:process";

import { exitCiAgent } from "./exit.js";
import { runCiFix } from "./fix.js";
import { runIssueImplement } from "./issue.js";
import { loadConfig } from "./config.js";
import { loadPrompt } from "./prompt.js";
import { runFixAgent } from "./run-agent.js";

async function runAgentCommand(): Promise<void> {
  const config = loadConfig();
  if (!config) {
    console.log("::warning::CURSOR_API_KEY is not set — skipping agent run.");
    return;
  }

  chdir(config.repoRoot);
  const prompt = await loadPrompt(config);
  await runFixAgent(config, prompt);
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "fix";

  switch (command) {
    case "agent":
      await runAgentCommand();
      break;
    case "fix":
      await runCiFix();
      break;
    case "issue":
      await runIssueImplement();
      break;
    default:
      throw new Error(`Unknown command: ${command} (expected agent, fix, or issue)`);
  }
}

main()
  .then(() => {
    exitCiAgent(0);
  })
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`::error::${message}`);
    exitCiAgent(1);
  });
