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
import {
  AgentPrompt,
  AgentPromptEnvironment,
  type AgentBootstrapEvidence,
} from "./prompt.js";
import { AgentIsolation, ConfiguredAgentRuntime } from "./run-agent.js";
export class CiImplementationCommand {
  constructor(private readonly environment: NodeJS.ProcessEnv) {}
  resolveTargetFromEnvironment(): Result<ImplementDeliveryTarget, CiFailure> {
    const configuredBranch =
      this.environment.AGENT_BRANCH?.trim() ||
      this.environment.FIX_BRANCH?.trim();
    return new AgentImplementationResolveDeliveryTarget({
      branch: configuredBranch || "",
      originMainSha: this.environment.ORIGIN_MAIN_SHA?.trim() || "",
      pinnedLocalDevSha:
        this.environment.PINNED_LOCAL_DEV_SHA?.trim() || "",
      featureHeadSha: this.environment.FEATURE_HEAD_SHA?.trim() || "",
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
    const bootstrapped = await new AgentImplementationVerifyBootstrap({
      repoRoot,
      evidence: target.value,
    }).execute();
    if (bootstrapped.isErr()) return err(bootstrapped.error);
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
    const bootstrapped = await new AgentImplementationVerifyBootstrap({
      repoRoot,
      evidence: target.value,
    }).execute();
    if (bootstrapped.isErr()) return err(bootstrapped.error);
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
      repositoryInstance = new CiRepository(repoRoot);
    const preserved = await new AgentImplementationPublishBranch({
      agentBranch: selected.branch,
      featureHeadSha: selected.featureHeadSha,
      assertBudget: () =>
        new AuthoredChangeBudget({
          repoRoot,
          baseRef: selected.budgetBaseRef,
          maximumLines: 2_000,
        }).enforce(),
      pushBranch: () =>
        repositoryInstance.pushFixBranch({
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
      `Feature branch ${preserved.value.branch} advanced from ${preserved.value.featureHeadSha} to exact head ${preserved.value.publishedFeatureSha}; no pull request was created`,
    );
    return new AgentImplementationRecordPublication({
      outputPath: this.environment.GITHUB_OUTPUT?.trim() || "",
      evidence: preserved.value,
    }).execute();
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

export interface AgentImplementationRecordPublicationRequest {
  readonly outputPath: string;
  readonly evidence: AgentImplementationPublicationEvidence;
}

/** Writes exact publication identities for GitHub Actions consumers. */
export class AgentImplementationRecordPublication {
  constructor(
    private readonly request: AgentImplementationRecordPublicationRequest,
  ) {}
  execute(): Result<void, CiFailure> {
    const { outputPath, evidence } = this.request;
    if (!outputPath) return ok();
    try {
      const publicationJson = JSON.stringify(evidence);
      appendFileSync(
        outputPath,
        [
          `published_branch=${evidence.branch}`,
          `feature_head_sha=${evidence.featureHeadSha}`,
          `published_feature_sha=${evidence.publishedFeatureSha}`,
          // Keep the legacy workflow output while consumers migrate to the
          // explicit publication identity.
          `published_head_sha=${evidence.publishedFeatureSha}`,
          `publication_json=${publicationJson}`,
          "",
        ].join("\n"),
        "utf8",
      );
      return ok();
    } catch {
      return err({
        kind: CiFailureKind.Filesystem,
        message: "Unable to record the published feature branch",
      });
    }
  }
}

interface VerifyBootstrapRequest {
  readonly repoRoot: string;
  readonly evidence: AgentImplementationBootstrapEvidence & {
    readonly branch: string;
  };
}

export class AgentImplementationVerifyBootstrap {
  constructor(private readonly request: VerifyBootstrapRequest) {}

  async execute(): Promise<Result<void, CiFailure>> {
    const { repoRoot } = this.request;
    const validated = new AgentImplementationValidateBootstrapEvidence(
      this.request.evidence,
    ).execute();
    if (validated.isErr()) return err(validated.error);
    const evidence = validated.value;
    const branch = this.request.evidence.branch;
    const repository = new CiRepository(repoRoot);
    const head = await repository.revParseImmutable({ ref: "HEAD" });
    if (head.isErr()) return err(head.error as CiFailure);
    const featureBase = await repository.immutableGit({
      args: [
        "merge-base",
        "--is-ancestor",
        evidence.pinnedLocalDevSha,
        evidence.featureHeadSha,
      ],
    });
    if (featureBase.isErr()) {
      const error = featureBase.error as CiFailure;
      if (error.kind !== CiFailureKind.Combined && error.code === 1) {
        return err({
          kind: CiFailureKind.Baseline,
          message:
            "Implementation worktree is not based on the Prime-pinned local-dev SHA",
        });
      }
      return err(error);
    }

    const symbolicHead = await repository.immutableGit({
      args: ["symbolic-ref", "--quiet", "HEAD"],
    });
    if (symbolicHead.isOk()) {
      return err({
        kind: CiFailureKind.Baseline,
        message:
          "Implementation worktree HEAD must be detached at featureHeadSha",
      });
    }
    const symbolicHeadError = symbolicHead.error as CiFailure;
    if (
      symbolicHeadError.kind !== CiFailureKind.Combined &&
      symbolicHeadError.code !== 1
    )
      return err(symbolicHeadError);

    const remoteFeatureHead = await repository.revParseImmutable({
      ref: `refs/remotes/origin/${branch}`,
    });
    if (remoteFeatureHead.isErr())
      return err(remoteFeatureHead.error as CiFailure);
    if (remoteFeatureHead.value !== evidence.featureHeadSha) {
      return err({
        kind: CiFailureKind.Baseline,
        message:
          "Canonical remote feature ref does not match the recorded featureHeadSha",
      });
    }
    if (head.value !== evidence.featureHeadSha) {
      return err({
        kind: CiFailureKind.Baseline,
        message:
          "Implementation worktree HEAD does not match the recorded featureHeadSha",
      });
    }

    const originMain = await repository.revParseImmutable({
      ref: "refs/remotes/origin/main",
    });
    if (originMain.isErr()) return err(originMain.error as CiFailure);
    if (originMain.value !== evidence.originMainSha) {
      return err({
        kind: CiFailureKind.Baseline,
        message:
          "Fetched origin/main changed after bootstrap; recorded originMainSha is stale",
      });
    }

    const ancestry = await repository.immutableGit({
      args: [
        "merge-base",
        "--is-ancestor",
        evidence.originMainSha,
        evidence.pinnedLocalDevSha,
      ],
    });
    if (ancestry.isErr()) {
      const error = ancestry.error as CiFailure;
      if (error.kind !== CiFailureKind.Combined && error.code === 1) {
        return err({
          kind: CiFailureKind.Baseline,
          message:
            "Recorded pinnedLocalDevSha is not based on the fetched originMainSha",
        });
      }
      return err(error);
    }
    return ok();
  }
}

export class AgentImplementationPublishBranch {
  constructor(private readonly request: PublishBranchArgs) {}
  async execute(): Promise<
    Result<AgentImplementationPublicationEvidence, CiFailure>
  > {
    const args = this.request;

    if (!FULL_COMMIT_SHA.test(args.featureHeadSha)) {
      return err({
        kind: CiFailureKind.Configuration,
        message:
          "featureHeadSha must be an exact lowercase 40-hex commit SHA",
      });
    }
    const budget = await args.assertBudget();
    if (budget.isErr()) return err(budget.error);
    const remoteBefore = await args.readPublishedHead();
    if (remoteBefore.isErr()) return err(remoteBefore.error);
    if (!FULL_COMMIT_SHA.test(remoteBefore.value)) {
      return err({
        kind: CiFailureKind.Github,
        message:
          "Canonical remote feature ref returned a non-canonical featureHeadSha",
      });
    }
    if (remoteBefore.value !== args.featureHeadSha) {
      return err({
        kind: CiFailureKind.Github,
        message: `Canonical remote feature ref changed from featureHeadSha ${args.featureHeadSha} to ${remoteBefore.value} before publication`,
      });
    }
    const committed = await args.pushBranch();
    if (committed.isErr()) return err(committed.error);
    if (!FULL_COMMIT_SHA.test(committed.value)) {
      return err({
        kind: CiFailureKind.Git,
        message:
          "Implementation publication returned a non-canonical publishedFeatureSha",
      });
    }
    if (committed.value === args.featureHeadSha) {
      return err({
        kind: CiFailureKind.Baseline,
        message:
          "publishedFeatureSha must differ from the pinned featureHeadSha after an implementation commit",
      });
    }
    const published = await args.readPublishedHead();
    if (published.isErr()) return err(published.error);
    if (!FULL_COMMIT_SHA.test(published.value)) {
      return err({
        kind: CiFailureKind.Github,
        message:
          "Canonical remote feature ref returned a non-canonical publishedFeatureSha",
      });
    }
    if (published.value !== committed.value) {
      return err({
        kind: CiFailureKind.Github,
        message: `Feature branch ${args.agentBranch} published at ${published.value}, expected publishedFeatureSha ${committed.value}`,
      });
    }
    return ok({
      branch: args.agentBranch,
      featureHeadSha: args.featureHeadSha,
      publishedFeatureSha: committed.value,
    });
  }
}

class AgentImplementationIsValidBranch {
  constructor(private readonly request: string) {}
  execute(): boolean {
    const branch = this.request;

    if (
      !branch ||
      branch.length > 120 ||
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
    const components = branch.split("/");
    if (components[0] !== "codex") return false;
    if (components.length === 2) {
      return this.isFeatureSegment(components[1]);
    }
    if (components.length !== 5) return false;
    const [prefix, feature, team, role, work] = components;
    if (
      prefix !== "codex" ||
      !this.isFeatureSegment(feature) ||
      !this.isKebabSegment(team) ||
      !this.isKebabSegment(role) ||
      !this.isWorkSegment(work)
    ) {
      return false;
    }
    return this.isRegisteredRole(team, role);
  }

  private isFeatureSegment(segment: unknown): boolean {
    return (
      typeof segment === "string" &&
      segment.length >= 10 &&
      segment.length <= 20 &&
      this.isKebabSegment(segment)
    );
  }

  private isWorkSegment(segment: unknown): boolean {
    return (
      typeof segment === "string" &&
      segment.length >= 20 &&
      segment.length <= 50 &&
      this.isKebabSegment(segment)
    );
  }

  private isKebabSegment(segment: unknown): segment is string {
    return (
      typeof segment === "string" &&
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(segment)
    );
  }

  private isRegisteredRole(
    team: unknown,
    role: unknown,
  ): boolean {
    return (
      typeof team === "string" &&
      typeof role === "string" &&
      this.rolesForTeam(team).includes(role)
    );
  }

  private rolesForTeam(team: string): readonly string[] {
    const canonicalTeam = Object.keys(CANONICAL_TEAM_ROLES).find(
      (candidate): candidate is CanonicalTeam => candidate === team,
    );
    return canonicalTeam ? CANONICAL_TEAM_ROLES[canonicalTeam] : [];
  }
}

enum CanonicalTeam {
  Ai = "ai",
  DevCore = "dev-core",
  Security = "security",
  Sre = "sre",
  WebDev = "web-dev",
  DeliveryPipeline = "delivery-pipeline",
}

const CANONICAL_TEAM_ROLES: Readonly<Record<CanonicalTeam, readonly string[]>> =
  {
    [CanonicalTeam.Ai]: ["gizmo", "loom-specialist", "cortex-specialist"],
    [CanonicalTeam.DevCore]: ["gizmo", "rust-core-developer", "rust-auth2-developer"],
    [CanonicalTeam.Security]: [
      "gizmo",
      "cryptography-specialist",
      "security-review-specialist",
    ],
    [CanonicalTeam.Sre]: [
      "gizmo",
      "provisioning",
      "cloud-native",
      "docker-cache-specialist",
    ],
    [CanonicalTeam.WebDev]: ["gizmo", "typescript-specialist", "svelte-specialist"],
    [CanonicalTeam.DeliveryPipeline]: ["gizmo", "dev-manager", "pr-lifecycle"],
  };

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
    const evidence = new AgentImplementationValidateBootstrapEvidence({
      originMainSha: input.originMainSha,
      pinnedLocalDevSha: input.pinnedLocalDevSha,
      featureHeadSha: input.featureHeadSha,
    }).execute();
    if (evidence.isErr()) return err(evidence.error);
    const budgetBaseRef = new FeatureHeadShaParser(
      evidence.value.featureHeadSha,
    ).parse();
    if (budgetBaseRef.isErr()) return err(budgetBaseRef.error);
    return ok({
      branch: input.branch,
      originMainSha: evidence.value.originMainSha,
      pinnedLocalDevSha: evidence.value.pinnedLocalDevSha,
      featureHeadSha: evidence.value.featureHeadSha,
      budgetBaseRef: budgetBaseRef.value,
    });
  }
}

export type AgentImplementationBootstrapEvidence = AgentBootstrapEvidence;

export class AgentImplementationValidateBootstrapEvidence {
  constructor(private readonly request: AgentImplementationBootstrapEvidence) {}

  execute(): Result<AgentImplementationBootstrapEvidence, CiFailure> {
    const { originMainSha, pinnedLocalDevSha, featureHeadSha } = this.request;
    if (
      !FULL_COMMIT_SHA.test(originMainSha) ||
      !FULL_COMMIT_SHA.test(pinnedLocalDevSha) ||
      !FULL_COMMIT_SHA.test(featureHeadSha)
    ) {
      return err({
        kind: CiFailureKind.Configuration,
        message:
          "Recorded bootstrap evidence requires originMainSha, pinnedLocalDevSha, and featureHeadSha",
      });
    }
    return ok({ originMainSha, pinnedLocalDevSha, featureHeadSha });
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
  featureHeadSha: string;
  assertBudget: () => Promise<Result<void, CiFailure>>;
  pushBranch: () => Promise<Result<string, CiFailure>>;
  readPublishedHead: () => Promise<Result<string, CiFailure>>;
};

export interface AgentImplementationPublicationEvidence {
  readonly branch: string;
  /** The Prime-pinned pre-edit head and remote update lease. */
  readonly featureHeadSha: string;
  /** The exact post-edit commit published to the canonical feature branch. */
  readonly publishedFeatureSha: string;
}

export type PinnedLocalDevSha = string & {
  readonly [PINNED_LOCAL_DEV_SHA]: "pinned-local-dev-sha";
};

export interface ImplementDeliveryTarget {
  readonly branch: string;
  readonly originMainSha: string;
  readonly pinnedLocalDevSha: string;
  readonly featureHeadSha: string;
  readonly budgetBaseRef: PinnedLocalDevSha;
}

type ImplementDeliveryTargetInput = {
  branch: string;
  originMainSha: string;
  pinnedLocalDevSha: string;
  featureHeadSha: string;
};

declare const PINNED_LOCAL_DEV_SHA: unique symbol;

class FeatureHeadShaParser {
  constructor(private readonly value: string) {}
  parse(): Result<PinnedLocalDevSha, CiFailure> {
    if (!FeatureHeadShaParser.isValid(this.value)) {
      return err({
        kind: CiFailureKind.Configuration,
        message:
          "FEATURE_HEAD_SHA must be an exact lowercase 40-hex commit SHA",
      });
    }
    return ok(this.value);
  }

  private static isValid(value: string): value is PinnedLocalDevSha {
    return /^[0-9a-f]{40}$/u.test(value);
  }
}

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

const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/u;
