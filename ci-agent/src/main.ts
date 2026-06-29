import { chdir } from "node:process";

import { loadConfig } from "./config.js";
import { loadPrompt } from "./prompt.js";
import { runFixAgent } from "./run-agent.js";

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config) {
    console.log("::warning::CURSOR_API_KEY is not set — skipping agent run.");
    return;
  }

  chdir(config.repoRoot);
  const prompt = await loadPrompt(config);
  await runFixAgent(config, prompt);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`::error::${message}`);
  process.exit(1);
});
