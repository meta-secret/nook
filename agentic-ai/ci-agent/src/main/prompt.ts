import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { CiAgentConfig } from "./config.js";

/** Build the task body from the explicit workflow prompt. */
export function resolveAgentTask(): string {
  const prompt = process.env.AGENT_PROMPT?.trim();
  if (prompt) {
    return prompt;
  }

  throw new Error("AGENT_PROMPT is required for implement");
}

export async function loadPrompt(config: CiAgentConfig): Promise<string> {
  const path = join(config.repoRoot, config.promptFile);
  let template: string;
  try {
    template = await readFile(path, "utf8");
  } catch {
    throw new Error(`Missing agent prompt: ${config.promptFile}`);
  }

  const agentBranch =
    process.env.AGENT_BRANCH?.trim() || config.fixBranch;
  const agentTask = template.includes("${AGENT_TASK}")
    ? resolveAgentTask()
    : "";

  return template
    .replaceAll("${GITHUB_REPOSITORY}", config.githubRepository)
    .replaceAll("${GITHUB_RUN_ID}", config.githubRunId)
    .replaceAll("${FIX_BRANCH}", config.fixBranch)
    .replaceAll("${AGENT_BRANCH}", agentBranch)
    .replaceAll("${AGENT_TASK}", agentTask);
}
