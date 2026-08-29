import { chdir } from "node:process";

import { exitCiAgent } from "./exit.js";
import { runCiFix } from "./fix.js";
import { runCiDeliver, runCiEditOnly, runCiImplement } from "./implement.js";
import { CiAgentConfigLoadKind, loadConfig } from "./config.js";
import { loadPrompt } from "./prompt.js";
import { AgentIsolation, runFixAgent } from "./run-agent.js";
import { runPrAudit } from "./pr-audit.js";
import { runPrReviewRequest, runPrReviewStabilization } from "./pr-review.js";

async function runAgentCommand(): Promise<void> {
  const loadedConfig = loadConfig();
  if (loadedConfig.kind === CiAgentConfigLoadKind.MissingApiKey) {
    console.log("::warning::CURSOR_API_KEY is not set — skipping agent run.");
    return;
  }
  const config = loadedConfig.config;

  chdir(config.repoRoot);
  const prompt = await loadPrompt(config);
  await runFixAgent(config, prompt);
}

async function runPlanningAgentCommand(): Promise<void> {
  const loadedConfig = loadConfig();
  if (loadedConfig.kind === CiAgentConfigLoadKind.MissingApiKey) {
    throw new Error(
      "CURSOR_API_KEY is required for the isolated planning agent",
    );
  }
  const config = loadedConfig.config;

  chdir(config.repoRoot);
  const prompt = await loadPrompt(config);
  await runFixAgent(config, prompt, AgentIsolation.Strict);
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
    case "implement":
      await runCiImplement();
      break;
    case "plan":
      await runPlanningAgentCommand();
      break;
    case "deliver":
      await runCiDeliver();
      break;
    case "edit":
      await runCiEditOnly();
      break;
    case "pr-preflight":
      await runPrAudit(false);
      break;
    case "pr-ready":
      await runPrAudit(true);
      break;
    case "pr-review":
      await runPrReviewRequest();
      break;
    case "pr-review-stabilize":
      await runPrReviewStabilization();
      break;
    default:
      throw new Error(
        `Unknown command: ${command} (expected agent, fix, implement, plan, edit, deliver, pr-preflight, pr-ready, pr-review, or pr-review-stabilize)`,
      );
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
