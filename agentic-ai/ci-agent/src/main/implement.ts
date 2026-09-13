import { err, ok, type Result } from "neverthrow";
import { CiCleanupOutcome, CiFailureKind, type CiFailure } from "./failure.js";
import { CiWorkingDirectory } from "./process.js";
import { appendFileSync } from "node:fs";

import { CiAgentConfigLoadKind, CiAgentEnvironment } from "./config.js";
import {
  GitHubClient,
  GitHubEnvironment,
  GitHubRepositoryName,
} from "./github.js";
import { AuthoredChangeBudget, CiRepository } from "./git.js";
import { Logger } from "./logger.js";
import { AgentPrompt, AgentPromptEnvironment } from "./prompt.js";
import { AgentIsolation, ConfiguredAgentRuntime } from "./run-agent.js";
export class CiImplementationCommand {
  constructor(private readonly environment: NodeJS.ProcessEnv) {}
  resolveTargetFromEnvironment(): Result<ImplementDeliveryTarget, CiFailure> {
    const runId = this.environment.GITHUB_RUN_ID?.trim() || "";
    return new AgentImplementationResolveDeliveryTarget({
      branch:
        this.environment.AGENT_BRANCH?.trim() ||
        this.environment.FIX_BRANCH?.trim() ||
        `agent/prompt-${runId}`,
    }).execute();
  }
  async runCiEdit(): Promise<Result<CiEditOutcome, CiFailure>> {
    const repository = this.environment.GITHUB_REPOSITORY?.trim(),
      runId = this.environment.GITHUB_RUN_ID?.trim();
    if (!repository || !runId)
      return err({
        kind: CiFailureKind.Configuration,
        message: "GITHUB_REPOSITORY and GITHUB_RUN_ID are required",
      });
    const task = new AgentPromptEnvironment(process.env).resolveAgentTask();
    if (task.isErr()) return err(task.error);
    const repoRoot = this.environment.REPO_ROOT?.trim() || process.cwd();
    const target = this.resolveTargetFromEnvironment();
    if (target.isErr()) return err(target.error);
    const entered = new CiWorkingDirectory(repoRoot).enter();
    if (entered.isErr()) return err(entered.error);
    const configured = await new CiRepository(repoRoot).configureGitForCi();
    if (configured.isErr()) return err(configured.error);
    const loaded = new CiAgentEnvironment(process.env).loadConfig();
    if (loaded.kind === CiAgentConfigLoadKind.MissingApiKey) {
      console.log(
        "::warning::CURSOR_API_KEY is not set — skipping agent implement job.",
      );
      return ok(CiEditOutcome.Skipped);
    }
    const prompt = await new AgentPrompt(loaded.config).load();
    if (prompt.isErr()) return err(prompt.error);
    const run = await new ConfiguredAgentRuntime(loaded.config).runFixAgent({
      prompt: prompt.value,
      isolation: AgentIsolation.Strict,
    });
    if (run.isErr()) return err(run.error);
    const changed = await new CiRepository(repoRoot).hasWorkingTreeChanges();
    if (changed.isErr()) return err(changed.error);
    if (!changed.value) {
      console.log(
        "::warning::Agent finished but working tree is clean — nothing to push.",
      );
      return ok(CiEditOutcome.Skipped);
    }
    return ok(CiEditOutcome.Changed);
  }
  runCiEditOnly() {
    return new AgentImplementationRunCiImplementationPhases({
      edit: () => this.runCiEdit(),
      mode: CiImplementationMode.EditOnly,
    }).execute();
  }
  runCiImplement() {
    return new AgentImplementationRunCiImplementationPhases({
      deliver: () => this.runCiDeliver(),
      edit: () => this.runCiEdit(),
      mode: CiImplementationMode.PublishBranch,
    }).execute();
  }
  async runCiDeliver(): Promise<Result<void, CiFailure>> {
    const repository = this.environment.GITHUB_REPOSITORY?.trim(),
      runId = this.environment.GITHUB_RUN_ID?.trim();
    if (!repository || !runId)
      return err({
        kind: CiFailureKind.Configuration,
        message: "GITHUB_REPOSITORY and GITHUB_RUN_ID are required",
      });
    const repoRoot = this.environment.REPO_ROOT?.trim() || process.cwd();
    const target = this.resolveTargetFromEnvironment();
    if (target.isErr()) return err(target.error);
    const entered = new CiWorkingDirectory(repoRoot).enter();
    if (entered.isErr()) return err(entered.error);
    const client = new GitHubEnvironment(process.env).createOctokit();
    if (client.isErr()) return err(client.error);
    const octokit = client.value;
    const configured = await new CiRepository(repoRoot).configureGitForCi({
      octokit,
    });
    if (configured.isErr()) return err(configured.error);
    const changed = await new CiRepository(repoRoot).hasWorkingTreeChanges();
    if (changed.isErr()) return err(changed.error);
    if (!changed.value)
      return err({
        kind: CiFailureKind.Baseline,
        message: "Trusted delivery requires implementation changes",
      });
    const repositoryName = new GitHubRepositoryName(repository).parse();
    if (repositoryName.isErr()) return err(repositoryName.error);
    const repoRef = repositoryName.value,
      selected = target.value,
      head = await new CiRepository(repoRoot).revParse({ ref: "HEAD" });
    if (head.isErr()) return err(head.error);
    const preserved = await new AgentImplementationPublishBranch({
      agentBranch: selected.branch,
      expectedHead: head.value,
      assertBudget: () =>
        new AuthoredChangeBudget({
          repoRoot,
          baseRef: selected.budgetBaseRef,
          maximumLines: 2_000,
        }).enforce(),
        pushBranch: () =>
          new CiRepository(repoRoot).pushFixBranch({
            fixBranch: selected.branch,
            runId,
          }),
      readPublishedHead: () =>
        new GitHubClient(octokit).readBranchHeadOnOrigin({
          subject1: repoRef,
          branch: selected.branch,
        }),
    }).execute();
    if (preserved.isErr()) {
      const recorded = new AgentImplementationRecordTrustedBudgetBlocker({
        error: preserved.error,
        outputPath: this.environment.GITHUB_OUTPUT || "",
      }).execute();
      return new CiCleanupOutcome(recorded).finish(err(preserved.error));
    }
    log.info(
      `Agent branch ${selected.branch} exact head ${preserved.value} published; no pull request was created`,
    );
    const outputPath = this.environment.GITHUB_OUTPUT?.trim();
    if (outputPath) {
      try {
        appendFileSync(
          outputPath,
          `published_branch=${selected.branch}\npublished_head_sha=${preserved.value}\n`,
          "utf8",
        );
      } catch {
        return err({
          kind: CiFailureKind.Filesystem,
          message: "Unable to record the published agent branch",
        });
      }
    }
    return ok();
  }
}

export interface AgentImplementationRecordTrustedBudgetBlockerRequest {
  readonly error: CiFailure;
  readonly outputPath: string;
}

export class AgentImplementationRecordTrustedBudgetBlocker {
  constructor(
    private readonly request: AgentImplementationRecordTrustedBudgetBlockerRequest,
  ) {}
  execute(): Result<void, CiFailure> {
    const { error, outputPath } = this.request;

    if (error.kind !== CiFailureKind.Budget || !outputPath) {
      return ok();
    }
    const encoded = Buffer.from(error.message, "utf8").toString("base64");
    try {
      appendFileSync(outputPath, `budget_blocker_b64=${encoded}\n`, "utf8");
      return ok();
    } catch {
      return err({
        kind: CiFailureKind.Filesystem,
        message: "Unable to record trusted budget blocker",
      });
    }
  }
}

export class AgentImplementationPublishBranch {
  constructor(private readonly request: PublishBranchArgs) {}
  async execute(): Promise<Result<string, CiFailure>> {
    const args = this.request;

    const budget = await args.assertBudget();
    if (budget.isErr()) return err(budget.error);
    const pushed = await args.pushBranch();
    if (pushed.isErr()) return err(pushed.error);
    const published = await args.readPublishedHead();
    if (published.isErr()) return err(published.error);
    if (published.value !== args.expectedHead) {
      return err({
        kind: CiFailureKind.Github,
        message: `Agent branch ${args.agentBranch} published at ${published.value}, expected ${args.expectedHead}`,
      });
    }
    return ok(published.value);
  }
}

class AgentImplementationIsValidBranch {
  constructor(private readonly request: string) {}
  execute(): boolean {
    const branch = this.request;

    if (
      !branch ||
      branch.length > 255 ||
      branch === "@" ||
      branch.startsWith("-") ||
      branch.startsWith("/") ||
      branch.endsWith("/") ||
      branch.endsWith(".") ||
      branch.includes("..") ||
      branch.includes("//") ||
      branch.includes("@{") ||
      /[\u0000-\u0020\u007f~^:?*\[\\]/u.test(branch)
    ) {
      return false;
    }
    return branch
      .split("/")
      .every(
        (component) =>
          !component.startsWith(".") && !component.endsWith(".lock"),
      );
  }
}

export class AgentImplementationResolveDeliveryTarget {
  constructor(private readonly request: ImplementDeliveryTargetInput) {}
  execute(): Result<ImplementDeliveryTarget, CiFailure> {
    const input = this.request;

    if (!new AgentImplementationIsValidBranch(input.branch).execute()) {
      return err({
        kind: CiFailureKind.Configuration,
        message: "Implement delivery branch metadata is malformed",
      });
    }
    return ok({
      branch: input.branch,
      budgetBaseRef: "origin/main",
    });
  }
}

export enum CiImplementationPhaseFailureKind {
  Consumed = "consumed",
}
enum EditingPhaseKind {
  Pending = "pending",
  Consumed = "consumed",
}
type EditingPhase =
  | { kind: EditingPhaseKind.Pending; request: CiImplementationPhases }
  | { kind: EditingPhaseKind.Consumed };
export class AgentImplementationRunCiImplementationPhases {
  #phase: EditingPhase;
  constructor(request: CiImplementationPhases) {
    this.#phase = { kind: EditingPhaseKind.Pending, request: { ...request } };
  }
  async execute(): Promise<Result<void, CiFailure>> {
    if (this.#phase.kind === EditingPhaseKind.Consumed)
      return err({
        kind: CiFailureKind.Baseline,
        message: "CI implementation phase has already been consumed",
      });
    const { request } = this.#phase;
    this.#phase = { kind: EditingPhaseKind.Consumed };
    if (request.mode === CiImplementationMode.EditOnly) {
      const edited = await request.edit();
      return edited.map(() => {});
    }
    const edited = await request.edit();
    if (edited.isErr()) return err(edited.error);
    return edited.value === CiEditOutcome.Changed ? request.deliver() : ok();
  }
}

const log = new Logger("implement");

type PublishBranchArgs = {
  agentBranch: string;
  expectedHead: string;
  assertBudget: () => Promise<Result<void, CiFailure>>;
  pushBranch: () => Promise<Result<void, CiFailure>>;
  readPublishedHead: () => Promise<Result<string, CiFailure>>;
};

export interface ImplementDeliveryTarget {
  readonly branch: string;
  readonly budgetBaseRef: string;
}

type ImplementDeliveryTargetInput = {
  branch: string;
};

export enum CiEditOutcome {
  Changed = "changed",
  Skipped = "skipped",
}

export enum CiImplementationMode {
  EditOnly = "edit-only",
  PublishBranch = "publish-branch",
}

interface EditOnlyCiImplementation {
  mode: CiImplementationMode.EditOnly;
  edit: () => Promise<Result<CiEditOutcome, CiFailure>>;
}
interface PublishBranchCiImplementation {
  mode: CiImplementationMode.PublishBranch;
  deliver: () => Promise<Result<void, CiFailure>>;
  edit: () => Promise<Result<CiEditOutcome, CiFailure>>;
}
type CiImplementationPhases =
  | EditOnlyCiImplementation
  | PublishBranchCiImplementation;
