import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
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

/** Resolve user-controlled major-change authorization from workflow metadata. */
export function resolveMajorChangeAuthorization(): string {
  return process.env.MAJOR_CHANGE_AUTHORIZED === "true"
    ? "authorized"
    : "not-authorized";
}

export async function loadPrompt(config: CiAgentConfig): Promise<string> {
  const path = join(config.toolingRoot, config.promptFile);
  let template: string;
  try {
    template = await readFile(path, "utf8");
  } catch {
    throw new Error(`Missing agent prompt: ${config.promptFile}`);
  }

  const agentBranch = process.env.AGENT_BRANCH?.trim() || config.fixBranch;
  const agentTask = template.includes("${AGENT_TASK}")
    ? resolveAgentTask()
    : "";
  const majorChangeAuthorization = resolveMajorChangeAuthorization();
  let validatedPlan = "";
  if (template.includes("${VALIDATED_PLAN}")) {
    const expectedHash = process.env.VALIDATED_PLAN_SHA256?.trim() ?? "";
    const planName = process.env.WORKBENCH_PLAN_FILE?.trim();
    if (
      !/^[0-9a-f]{64}$/.test(expectedHash) ||
      planName !== ".nook-workbench-plan.md"
    ) {
      throw new Error("Validated implementation plan metadata is missing");
    }
    const planPath = join(config.repoRoot, planName);
    const artifact = await lstat(planPath);
    if (
      !artifact.isFile() ||
      artifact.isSymbolicLink() ||
      artifact.size > 65_536
    ) {
      throw new Error("Validated implementation plan artifact is unsafe");
    }
    validatedPlan = await readFile(planPath, "utf8");
    const actualHash = createHash("sha256").update(validatedPlan).digest("hex");
    if (actualHash !== expectedHash) {
      throw new Error(
        "Validated implementation plan hash changed before agent start",
      );
    }
  }

  return (
    template
      .replaceAll("${GITHUB_REPOSITORY}", config.githubRepository)
      .replaceAll("${GITHUB_RUN_ID}", config.githubRunId)
      .replaceAll("${FIX_BRANCH}", config.fixBranch)
      .replaceAll("${AGENT_BRANCH}", agentBranch)
      .replaceAll("${MAJOR_CHANGE_AUTHORIZATION}", majorChangeAuthorization)
      .replaceAll("${AGENT_TASK}", agentTask)
      // Inject the hash-bound artifact last so template-shaped text inside the
      // validated plan remains inert exact content.
      .replaceAll("${VALIDATED_PLAN}", validatedPlan)
  );
}
