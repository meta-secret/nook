import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { CiAgentConfig } from "./config.js";

/** Build the task body from AGENT_PROMPT or issue env vars. */
export function resolveAgentTask(): string {
  const prompt = process.env.AGENT_PROMPT?.trim();
  if (prompt) {
    return prompt;
  }

  const number = process.env.AGENT_ISSUE_NUMBER?.trim();
  const title = process.env.AGENT_ISSUE_TITLE?.trim() ?? "";
  const body = process.env.AGENT_ISSUE_BODY?.trim() ?? "";
  const url = process.env.AGENT_ISSUE_URL?.trim() ?? "";

  if (!number && !title && !body) {
    throw new Error(
      "AGENT_PROMPT or AGENT_ISSUE_NUMBER/TITLE/BODY is required for implement",
    );
  }

  return [
    number ? `GitHub issue #${number}: ${title}` : title ? `Task: ${title}` : "GitHub issue",
    url ? `URL: ${url}` : null,
    "",
    body || "(no issue body)",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
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
