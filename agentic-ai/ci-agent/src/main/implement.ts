import { appendFileSync } from "node:fs";
import { chdir } from "node:process";

import { CiAgentConfigLoadKind, CiAgentEnvironment } from "./config.js";
import {
  GitHubClient,
  GitHubEnvironment,
  type OpenPrLookup,
  OpenPrLookupKind,
  GitHubRepositoryName,
} from "./github.js";
import {
  AuthoredChangeBudget,
  AuthoredChangeBudgetExceededError,
  CiRepository,
} from "./git.js";
import { Logger } from "./logger.js";
import { AgentPrompt, AgentPromptEnvironment } from "./prompt.js";
import { AgentIsolation, ConfiguredAgentRuntime } from "./run-agent.js";
export class CiImplementationCommand {
  constructor(private readonly environment: NodeJS.ProcessEnv) {}
  resolveTargetFromEnvironment() {
    const [runId = ""] = [this.environment.GITHUB_RUN_ID?.trim()];
    const agentBranch =
      this.environment.AGENT_BRANCH?.trim() ||
      this.environment.FIX_BRANCH?.trim() ||
      `agent/prompt-${runId}`;
    return new AgentImplementationResolveImplementPrTarget({
      branch: agentBranch,
      baseBranch: this.environment.AGENT_PR_BASE_BRANCH?.trim() || "main",
      kind:
        this.environment.AGENT_PR_TARGET_KIND?.trim() ||
        ImplementPrTargetKind.Standalone,
    }).execute();
  }

  async legacyStandalonePrExists(): Promise<boolean> {
    const repository = this.environment.GITHUB_REPOSITORY?.trim();
    const runId = this.environment.GITHUB_RUN_ID?.trim();
    if (!repository || !runId) {
      throw new Error("GITHUB_REPOSITORY and GITHUB_RUN_ID are required");
    }
    const target = this.resolveTargetFromEnvironment();
    const existing = await new GitHubClient(
      new GitHubEnvironment(process.env).createOctokit(),
    ).findOpenPr({
      subject1: new GitHubRepositoryName(repository).parse(),
      headBranch: target.branch,
    });
    if (existing.kind === OpenPrLookupKind.NotFound) return false;
    if (existing.baseBranch !== target.baseBranch) {
      throw new Error(
        "Existing standalone implementation PR has a changed base",
      );
    }
    log.info(`PR #${existing.number} is already open; skipping legacy rerun`);
    return true;
  }

  async runCiEdit(): Promise<CiEditOutcome> {
    const repository = this.environment.GITHUB_REPOSITORY?.trim();
    const runId = this.environment.GITHUB_RUN_ID?.trim();
    if (!repository || !runId) {
      throw new Error("GITHUB_REPOSITORY and GITHUB_RUN_ID are required");
    }

    new AgentPromptEnvironment(process.env).resolveAgentTask();

    const repoRoot = this.environment.REPO_ROOT?.trim() || process.cwd();
    const target = this.resolveTargetFromEnvironment();
    chdir(repoRoot);
    await new CiRepository(repoRoot).configureGitForCi();
    const loadedConfig = new CiAgentEnvironment(process.env).loadConfig();
    if (loadedConfig.kind === CiAgentConfigLoadKind.MissingApiKey) {
      console.log(
        "::warning::CURSOR_API_KEY is not set — skipping agent implement job.",
      );
      return CiEditOutcome.Skipped;
    }
    const config = loadedConfig.config;
    await new ConfiguredAgentRuntime(config).runFixAgent({
      prompt: await new AgentPrompt(config).load(),
      isolation: AgentIsolation.Strict,
    });
    if (!(await new CiRepository(repoRoot).hasWorkingTreeChanges())) {
      console.log(
        "::warning::Agent finished but working tree is clean — nothing to push.",
      );
      return CiEditOutcome.Skipped;
    }
    return CiEditOutcome.Changed;
  }

  async runCiEditOnly(): Promise<void> {
    await new AgentImplementationRunCiImplementationPhases({
      deliver: runCiDeliver,
      edit: runCiEdit,
      legacyPrExists: () => Promise.resolve(false),
      mode: CiImplementationMode.EditOnly,
    }).execute();
  }

  async runCiImplement(): Promise<void> {
    await new AgentImplementationRunCiImplementationPhases({
      deliver: runCiDeliver,
      edit: runCiEdit,
      legacyPrExists: legacyStandalonePrExists,
      mode: CiImplementationMode.LegacyMonolithic,
    }).execute();
  }

  async runCiDeliver(): Promise<void> {
    const repository = this.environment.GITHUB_REPOSITORY?.trim();
    const runId = this.environment.GITHUB_RUN_ID?.trim();
    if (!repository || !runId) {
      throw new Error("GITHUB_REPOSITORY and GITHUB_RUN_ID are required");
    }
    const repoRoot = this.environment.REPO_ROOT?.trim() || process.cwd();
    const target = this.resolveTargetFromEnvironment();
    chdir(repoRoot);
    const octokit = new GitHubEnvironment(process.env).createOctokit();
    await new CiRepository(repoRoot).configureGitForCi({ octokit: octokit });
    if (!(await new CiRepository(repoRoot).hasWorkingTreeChanges())) {
      throw new Error("Trusted delivery requires implementation changes");
    }

    const repoRef = new GitHubRepositoryName(repository).parse();
    let prNumber: number;
    try {
      prNumber = await new AgentImplementationPreserveImplementedBranchBeforePr(
        {
          agentBranch: target.branch,
          assertBudget: () =>
            new AuthoredChangeBudget({
              repoRoot,
              baseRef: target.budgetBaseRef,
              maximumLines: 2_000,
            }).enforce(),
          createPr: () =>
            new GitHubClient(octokit).createFixPr({
              repoRef: repoRef,
              headBranch: target.branch,
              runId: runId,
              fixLabel: "agent implementation",
              baseBranch: target.baseBranch,
            }),
          findPr: async () => {
            const found = await new GitHubClient(octokit).findOpenPr({
              subject1: repoRef,
              headBranch: target.branch,
            });
            if (
              found.kind === OpenPrLookupKind.Found &&
              found.baseBranch !== target.baseBranch
            ) {
              throw new Error(
                "Published implementation PR identity or base changed",
              );
            }
            return found;
          },
          pushBranch: () =>
            new CiRepository(repoRoot).pushFixBranch({
              fixBranch: target.branch,
              runId: runId,
            }),
          verifyBranch: () =>
            new GitHubClient(octokit).branchExistsOnOrigin({
              subject1: repoRef,
              branch: target.branch,
            }),
        },
      ).execute();
    } catch (error) {
      new AgentImplementationRecordTrustedBudgetBlocker({
        error: error,
        outputPath: this.environment.GITHUB_OUTPUT || "",
      }).execute();
      throw error;
    }
    log.info(
      `PR #${prNumber} opened; delivery verified and handed to the continuing owner`,
    );
  }
}

export interface AgentImplementationRecordTrustedBudgetBlockerRequest {
  readonly error: unknown;
  readonly outputPath: string;
}

export class AgentImplementationRecordTrustedBudgetBlocker {
  constructor(
    private readonly request: AgentImplementationRecordTrustedBudgetBlockerRequest,
  ) {}
  execute(): void {
    const { error, outputPath } = this.request;

    if (!(error instanceof AuthoredChangeBudgetExceededError) || !outputPath) {
      return;
    }
    const encoded = Buffer.from(error.message, "utf8").toString("base64");
    appendFileSync(outputPath, `budget_blocker_b64=${encoded}\n`, "utf8");
  }
}

export class AgentImplementationPreserveImplementedBranchBeforePr {
  constructor(private readonly request: PreserveImplementedBranchArgs) {}
  async execute(): Promise<number> {
    const args = this.request;

    await args.assertBudget();
    await args.pushBranch();
    if (!(await args.verifyBranch())) {
      throw new Error(
        `Agent branch ${args.agentBranch} was not found on origin after push`,
      );
    }
    await args.verifyPublishedHead?.();
    const openPr = await args.findPr();
    if (openPr.kind === OpenPrLookupKind.Found) {
      return openPr.number;
    }
    return args.createPr();
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

export class AgentImplementationResolveImplementPrTarget {
  constructor(private readonly request: ImplementPrTargetInput) {}
  execute() {
    const input = this.request;

    if (
      !new AgentImplementationIsValidBranch(input.branch).execute() ||
      !new AgentImplementationIsValidBranch(input.baseBranch).execute()
    ) {
      throw new Error("Implement PR branch metadata is malformed");
    }
    if (input.kind !== ImplementPrTargetKind.Standalone) {
      throw new Error("Only standalone implement PRs are supported");
    }
    if (input.baseBranch !== "main") {
      throw new Error("Standalone implement PRs must target main");
    }
    return {
      ...input,
      kind: ImplementPrTargetKind.Standalone,
      budgetBaseRef: "origin/main",
    };
  }
}

export class AgentImplementationRunCiImplementationPhases {
  constructor(private readonly request: CiImplementationPhases) {}
  async execute(): Promise<void> {
    const phases = this.request;

    if (
      phases.mode === CiImplementationMode.LegacyMonolithic &&
      (await phases.legacyPrExists())
    ) {
      return;
    }
    const outcome = await phases.edit();
    if (
      phases.mode === CiImplementationMode.LegacyMonolithic &&
      outcome === CiEditOutcome.Changed
    ) {
      await phases.deliver();
    }
  }
}

const log = new Logger("implement");

type PreserveImplementedBranchArgs = {
  agentBranch: string;
  assertBudget: () => Promise<void>;
  createPr: () => Promise<number>;
  findPr: () => Promise<OpenPrLookup>;
  pushBranch: () => Promise<void>;
  verifyBranch: () => Promise<boolean>;
  verifyPublishedHead?: () => Promise<void>;
};

export enum ImplementPrTargetKind {
  Standalone = "standalone",
}

type ImplementPrTargetInput = {
  branch: string;
  baseBranch: string;
  kind: string;
};

export enum CiEditOutcome {
  Changed = "changed",
  Skipped = "skipped",
}

export enum CiImplementationMode {
  EditOnly = "edit-only",
  LegacyMonolithic = "legacy-monolithic",
}

type CiImplementationPhases = {
  deliver: () => Promise<void>;
  edit: () => Promise<CiEditOutcome>;
  legacyPrExists: () => Promise<boolean>;
  mode: CiImplementationMode;
};
