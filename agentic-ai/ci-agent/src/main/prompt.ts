import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { CiAgentConfig } from "./config.js";

export async function loadPrompt(config: CiAgentConfig): Promise<string> {
  const path = join(config.repoRoot, config.promptFile);
  let template: string;
  try {
    template = await readFile(path, "utf8");
  } catch {
    throw new Error(`Missing agent prompt: ${config.promptFile}`);
  }

  return template
    .replaceAll("${GITHUB_REPOSITORY}", config.githubRepository)
    .replaceAll("${GITHUB_RUN_ID}", config.githubRunId)
    .replaceAll("${FIX_BRANCH}", config.fixBranch);
}
