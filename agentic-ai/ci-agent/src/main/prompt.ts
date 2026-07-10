import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { CiAgentConfig } from "./config.js";

export async function loadPrompt(
  config: CiAgentConfig,
  extra: Record<string, string> = {},
): Promise<string> {
  const path = join(config.repoRoot, config.promptFile);
  let template: string;
  try {
    template = await readFile(path, "utf8");
  } catch {
    throw new Error(`Missing agent prompt: ${config.promptFile}`);
  }

  let prompt = template
    .replaceAll("${GITHUB_REPOSITORY}", config.githubRepository)
    .replaceAll("${GITHUB_RUN_ID}", config.githubRunId)
    .replaceAll("${FIX_BRANCH}", config.fixBranch);

  for (const [key, value] of Object.entries(extra)) {
    prompt = prompt.replaceAll(`\${${key}}`, value);
  }

  return prompt;
}
