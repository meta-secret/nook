import { err, ok, type Result } from "neverthrow";
import { CiFailureKind, type CiFailure } from "./failure.js";
import { AgentFile } from "./agent-files.js";
import { createHash } from "node:crypto";
import { join } from "node:path";

import type { CiAgentConfig } from "./config.js";
export class AgentPromptEnvironment {
  constructor(private readonly environment: NodeJS.ProcessEnv) {}
  resolveAgentTask(): Result<string, CiFailure> {
    const prompt = this.environment.AGENT_PROMPT?.trim();
    if (prompt) {
      return ok(prompt);
    }

    return err({
      kind: CiFailureKind.Configuration,
      message: "AGENT_PROMPT is required for implement",
    });
  }

  resolveMajorChangeAuthorization(): string {
    return this.environment.MAJOR_CHANGE_AUTHORIZED === "true"
      ? "authorized"
      : "not-authorized";
  }
}

export class AgentPrompt {
  constructor(private readonly request: CiAgentConfig) {}
  async load(): Promise<Result<string, CiFailure>> {
    const config = this.request;

    const path = join(config.toolingRoot, config.promptFile);
    const loadedTemplate = await new AgentFile(path).read();
    if (loadedTemplate.isErr()) return err(loadedTemplate.error);
    const template = loadedTemplate.value;

    const agentBranch = process.env.AGENT_BRANCH?.trim() || config.fixBranch;
    const agentTask = template.includes("${AGENT_TASK}")
      ? new AgentPromptEnvironment(process.env).resolveAgentTask()
      : ok("");
    if (agentTask.isErr()) return err(agentTask.error);
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
        return err({
          kind: CiFailureKind.Configuration,
          message: "Validated implementation plan metadata is missing",
        });
      }
      const planPath = join(config.repoRoot, planName);
      const metadata = await new AgentFile(planPath).metadata();
      if (metadata.isErr()) return err(metadata.error);
      const artifact = metadata.value;
      if (
        !artifact.isFile() ||
        artifact.isSymbolicLink() ||
        artifact.size > 65_536
      ) {
        return err({
          kind: CiFailureKind.Configuration,
          message: "Validated implementation plan artifact is unsafe",
        });
      }
      const plan = await new AgentFile(planPath).read();
      if (plan.isErr()) return err(plan.error);
      validatedPlan = plan.value;
      const actualHash = createHash("sha256")
        .update(validatedPlan)
        .digest("hex");
      if (actualHash !== expectedHash) {
        return err({
          kind: CiFailureKind.Configuration,
          message:
            "Validated implementation plan hash changed before agent start",
        });
      }
    }

    let outdatedReport = "";
    if (template.includes("${RUST_DEPS_OUTDATED_REPORT}")) {
      const [reportPath = ""] = [process.env.RUST_DEPS_OUTDATED_REPORT?.trim()];
      if (!reportPath.endsWith("rust-deps-outdated.txt"))
        return err({
          kind: CiFailureKind.Configuration,
          message: "RUST_DEPS_OUTDATED_REPORT path is invalid",
        });
      const report = await new AgentFile(reportPath).read();
      if (report.isErr()) return err(report.error);
      outdatedReport = report.value;
      if (!outdatedReport.trim())
        return err({
          kind: CiFailureKind.Configuration,
          message: "RUST_DEPS_OUTDATED_REPORT is empty",
        });
    }

    return ok(
      template
        .replaceAll("${GITHUB_REPOSITORY}", config.githubRepository)
        .replaceAll("${GITHUB_RUN_ID}", config.githubRunId)
        .replaceAll("${FIX_BRANCH}", config.fixBranch)
        .replaceAll("${AGENT_BRANCH}", agentBranch)
        .replaceAll("${MAJOR_CHANGE_AUTHORIZATION}", majorChangeAuthorization)
        .replaceAll("${AGENT_TASK}", agentTask.value)
        .replaceAll("${RUST_DEPS_OUTDATED_REPORT}", outdatedReport)
        // Inject the hash-bound artifact last so template-shaped text inside the
        // validated plan remains inert exact content.
        .replaceAll("${VALIDATED_PLAN}", validatedPlan),
    );
  }
}

/** Build the task body from the explicit workflow prompt. */

/** Resolve user-controlled major-change authorization from workflow metadata. */
