import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { join } from "node:path";

import type { CiAgentConfig } from "./config.js";
export class AgentPromptEnvironment {
  constructor(private readonly environment: NodeJS.ProcessEnv) {}
  resolveAgentTask(): string {
    const prompt = this.environment.AGENT_PROMPT?.trim();
    if (prompt) {
      return prompt;
    }

    throw new Error("AGENT_PROMPT is required for implement");
  }

  resolveMajorChangeAuthorization(): string {
    return this.environment.MAJOR_CHANGE_AUTHORIZED === "true"
      ? "authorized"
      : "not-authorized";
  }
}

export class AgentPrompt {
  constructor(private readonly request: CiAgentConfig) {}
  async load(): Promise<string> {
    const config = this.request;

    const path = join(config.toolingRoot, config.promptFile);
    let template: string;
    try {
      template = await readFile(path, "utf8");
    } catch {
      throw new Error(`Missing agent prompt: ${config.promptFile}`);
    }

    const agentBranch = process.env.AGENT_BRANCH?.trim() || config.fixBranch;
    const agentTask = template.includes("${AGENT_TASK}")
      ? new AgentPromptEnvironment(process.env).resolveAgentTask()
      : "";
    const majorChangeAuthorization = new AgentPromptEnvironment(
      process.env,
    ).resolveMajorChangeAuthorization();
    let validatedPlan = "";
    if (template.includes("${VALIDATED_PLAN}")) {
      const [expectedHash = ""] = [process.env.VALIDATED_PLAN_SHA256?.trim()];
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
      const actualHash = createHash("sha256")
        .update(validatedPlan)
        .digest("hex");
      if (actualHash !== expectedHash) {
        throw new Error(
          "Validated implementation plan hash changed before agent start",
        );
      }
    }

    let outdatedReport = "";
    if (template.includes("${RUST_DEPS_OUTDATED_REPORT}")) {
      const [reportPath = ""] = [process.env.RUST_DEPS_OUTDATED_REPORT?.trim()];
      if (!reportPath.endsWith("rust-deps-outdated.txt"))
        throw new Error("RUST_DEPS_OUTDATED_REPORT path is invalid");
      outdatedReport = await readFile(reportPath, "utf8");
      if (!outdatedReport.trim())
        throw new Error("RUST_DEPS_OUTDATED_REPORT is empty");
    }

    return (
      template
        .replaceAll("${GITHUB_REPOSITORY}", config.githubRepository)
        .replaceAll("${GITHUB_RUN_ID}", config.githubRunId)
        .replaceAll("${FIX_BRANCH}", config.fixBranch)
        .replaceAll("${AGENT_BRANCH}", agentBranch)
        .replaceAll("${MAJOR_CHANGE_AUTHORIZATION}", majorChangeAuthorization)
        .replaceAll("${AGENT_TASK}", agentTask)
        .replaceAll("${RUST_DEPS_OUTDATED_REPORT}", outdatedReport)
        // Inject the hash-bound artifact last so template-shaped text inside the
        // validated plan remains inert exact content.
        .replaceAll("${VALIDATED_PLAN}", validatedPlan)
    );
  }
}

/** Build the task body from the explicit workflow prompt. */

/** Resolve user-controlled major-change authorization from workflow metadata. */
