import { err, ok, type Result } from "neverthrow";
import { CiCleanupOutcome, CiFailureKind, type CiFailure } from "./failure.js";
import { CiWorkingDirectory } from "./process.js";
import { appendFileSync } from "node:fs";

import { CiAgentConfigLoadKind, CiAgentEnvironment } from "./config.js";
import {
  GitHubClient,
  GitHubEnvironment,
  type OpenPrLookup,
  OpenPrLookupKind,
  GitHubRepositoryName,
} from "./github.js";
import { AuthoredChangeBudget, CiRepository } from "./git.js";
import { Logger } from "./logger.js";
import { AgentPrompt, AgentPromptEnvironment } from "./prompt.js";
import { AgentIsolation, ConfiguredAgentRuntime } from "./run-agent.js";
export class CiImplementationCommand {
  constructor(private readonly environment: NodeJS.ProcessEnv) {}
  resolveTargetFromEnvironment(): Result<ImplementPrTarget, CiFailure> {
    const runId = this.environment.GITHUB_RUN_ID?.trim() || "";
    return new AgentImplementationResolveImplementPrTarget({
      branch:
        this.environment.AGENT_BRANCH?.trim() ||
        this.environment.FIX_BRANCH?.trim() ||
        `agent/prompt-${runId}`,
      baseBranch: this.environment.AGENT_PR_BASE_BRANCH?.trim() || "main",
      kind:
        this.environment.AGENT_PR_TARGET_KIND?.trim() ||
        ImplementPrTargetKind.Standalone,
    }).execute();
  }
  async legacyStandalonePrExists(): Promise<Result<boolean, CiFailure>> {
    const repository = this.environment.GITHUB_REPOSITORY?.trim(),
      runId = this.environment.GITHUB_RUN_ID?.trim();
    if (!repository || !runId)
      return err({
        kind: CiFailureKind.Configuration,
        message: "GITHUB_REPOSITORY and GITHUB_RUN_ID are required",
      });
    const target = this.resolveTargetFromEnvironment();
    if (target.isErr()) return err(target.error);
    const client = new GitHubEnvironment(process.env).createOctokit();
    if (client.isErr()) return err(client.error);
    const repoRef = new GitHubRepositoryName(repository).parse();
    if (repoRef.isErr()) return err(repoRef.error);
    const existing = await new GitHubClient(client.value).findOpenPr({
      subject1: repoRef.value,
      headBranch: target.value.branch,
    });
    if (existing.isErr()) return err(existing.error);
    if (existing.value.kind === OpenPrLookupKind.NotFound) return ok(false);
    if (existing.value.baseBranch !== target.value.baseBranch)
      return err({
        kind: CiFailureKind.Github,
        message: "Existing standalone implementation PR has a changed base",
      });
    log.info(
      `PR #${existing.value.number} is already open; skipping legacy rerun`,
    );
    return ok(true);
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
      legacyPrExists: () => this.legacyStandalonePrExists(),
      mode: CiImplementationMode.LegacyMonolithic,
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
      selected = target.value;
    const preserved =
      await new AgentImplementationPreserveImplementedBranchBeforePr({
        agentBranch: selected.branch,
        assertBudget: () =>
          new AuthoredChangeBudget({
            repoRoot,
            baseRef: selected.budgetBaseRef,
            maximumLines: 2_000,
          }).enforce(),
        createPr: () =>
          new GitHubClient(octokit).createFixPr({
            repoRef,
            headBranch: selected.branch,
            runId,
            fixLabel: "agent implementation",
            baseBranch: selected.baseBranch,
          }),
        findPr: async () => {
          const found = await new GitHubClient(octokit).findOpenPr({
            subject1: repoRef,
            headBranch: selected.branch,
          });
          if (found.isErr()) return err(found.error);
          if (
            found.value.kind === OpenPrLookupKind.Found &&
            found.value.baseBranch !== selected.baseBranch
          )
            return err({
              kind: CiFailureKind.Github,
              message: "Published implementation PR identity or base changed",
            });
          return found;
        },
        pushBranch: () =>
          new CiRepository(repoRoot).pushFixBranch({
            fixBranch: selected.branch,
            runId,
          }),
        verifyBranch: () =>
          new GitHubClient(octokit).branchExistsOnOrigin({
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
      `PR #${preserved.value} opened; delivery verified and handed to the continuing owner`,
    );
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

export class AgentImplementationPreserveImplementedBranchBeforePr {
  constructor(private readonly request: PreserveImplementedBranchArgs) {}
  async execute(): Promise<Result<number, CiFailure>> {
    const args = this.request;

    const budget = await args.assertBudget();
    if (budget.isErr()) return err(budget.error);
    const pushed = await args.pushBranch();
    if (pushed.isErr()) return err(pushed.error);
    const verified = await args.verifyBranch();
    if (verified.isErr()) return err(verified.error);
    if (!verified.value) {
      return err({
        kind: CiFailureKind.Configuration,
        message: `Agent branch ${args.agentBranch} was not found on origin after push`,
      });
    }
    if (args.verifyPublishedHead) {
      const head = await args.verifyPublishedHead();
      if (head.isErr()) return err(head.error);
    }
    const openPr = await args.findPr();
    if (openPr.isErr()) return err(openPr.error);
    if (openPr.value.kind === OpenPrLookupKind.Found) {
      return ok(openPr.value.number);
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
  execute(): Result<ImplementPrTarget, CiFailure> {
    const input = this.request;

    if (
      !new AgentImplementationIsValidBranch(input.branch).execute() ||
      !new AgentImplementationIsValidBranch(input.baseBranch).execute()
    ) {
      return err({
        kind: CiFailureKind.Configuration,
        message: "Implement PR branch metadata is malformed",
      });
    }
    if (input.kind !== ImplementPrTargetKind.Standalone) {
      return err({
        kind: CiFailureKind.Configuration,
        message: "Only standalone implement PRs are supported",
      });
    }
    if (input.baseBranch !== "main") {
      return err({
        kind: CiFailureKind.Configuration,
        message: "Standalone implement PRs must target main",
      });
    }
    return ok({
      ...input,
      kind: ImplementPrTargetKind.Standalone,
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
      return edited.map(() => undefined);
    }
    const result = await new LegacyCiEdit(request).execute();
    if (result.isErr()) return err(result.error);
    return result.value.kind === CiChangeKind.Deliverable
      ? result.value.change.deliver()
      : ok();
  }
}
export enum CiChangeKind {
  Skipped = "skipped",
  Deliverable = "deliverable",
}
type CiChange =
  | { kind: CiChangeKind.Skipped }
  | { kind: CiChangeKind.Deliverable; change: ChangedCiImplementation };
enum ChangeDeliveryKind {
  Pending = "pending",
  Consumed = "consumed",
}
type ChangeDelivery =
  | {
      kind: ChangeDeliveryKind.Pending;
      deliver: () => Promise<Result<void, CiFailure>>;
    }
  | { kind: ChangeDeliveryKind.Consumed };
/** A delivery operation exists only after the editing effect reports a change. */
const changedDeliveryPermit: unique symbol = Symbol("changed-ci-delivery");
export class ChangedCiImplementation {
  #delivery: ChangeDelivery;
  constructor(
    deliver: () => Promise<Result<void, CiFailure>>,
    _permit: typeof changedDeliveryPermit,
  ) {
    this.#delivery = { kind: ChangeDeliveryKind.Pending, deliver };
  }
  async deliver(): Promise<Result<void, CiFailure>> {
    if (this.#delivery.kind === ChangeDeliveryKind.Consumed)
      return err({
        kind: CiFailureKind.Baseline,
        message: "CI implementation phase has already been consumed",
      });
    const { deliver } = this.#delivery;
    this.#delivery = { kind: ChangeDeliveryKind.Consumed };
    // The trusted delivery command still checks the live repository and published head.
    return deliver();
  }
}

const log = new Logger("implement");

type PreserveImplementedBranchArgs = {
  agentBranch: string;
  assertBudget: () => Promise<Result<void, CiFailure>>;
  createPr: () => Promise<Result<number, CiFailure>>;
  findPr: () => Promise<Result<OpenPrLookup, CiFailure>>;
  pushBranch: () => Promise<Result<void, CiFailure>>;
  verifyBranch: () => Promise<Result<boolean, CiFailure>>;
  verifyPublishedHead?: () => Promise<Result<void, CiFailure>>;
};

export enum ImplementPrTargetKind {
  Standalone = "standalone",
}

export interface ImplementPrTarget {
  readonly branch: string;
  readonly baseBranch: string;
  readonly kind: ImplementPrTargetKind.Standalone;
  readonly budgetBaseRef: string;
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

interface EditOnlyCiImplementation {
  mode: CiImplementationMode.EditOnly;
  edit: () => Promise<Result<CiEditOutcome, CiFailure>>;
}
interface LegacyCiImplementation {
  mode: CiImplementationMode.LegacyMonolithic;
  deliver: () => Promise<Result<void, CiFailure>>;
  edit: () => Promise<Result<CiEditOutcome, CiFailure>>;
  legacyPrExists: () => Promise<Result<boolean, CiFailure>>;
}
type CiImplementationPhases = EditOnlyCiImplementation | LegacyCiImplementation;

export class LegacyCiEdit {
  constructor(private readonly request: LegacyCiImplementation) {}
  async execute(): Promise<Result<CiChange, CiFailure>> {
    const { edit, deliver, legacyPrExists } = this.request;
    const exists = await legacyPrExists();
    if (exists.isErr()) return err(exists.error);
    if (exists.value) return ok({ kind: CiChangeKind.Skipped });
    const result = await edit();
    if (result.isErr()) return err(result.error);
    if (result.value === CiEditOutcome.Skipped)
      return ok({ kind: CiChangeKind.Skipped });
    return ok({
      kind: CiChangeKind.Deliverable,
      change: new ChangedCiImplementation(deliver, changedDeliveryPermit),
    });
  }
}
