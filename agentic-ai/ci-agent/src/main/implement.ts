import { chdir } from "node:process";

import { CiAgentConfigLoadKind, loadConfig } from "./config.js";
import {
  branchExistsOnOrigin,
  createFixPr,
  createOctokit,
  findOpenPr,
  type OpenPrLookup,
  OpenPrLookupKind,
  parseRepository,
} from "./github.js";
import {
  AuthoredChangeBudgetExceededError,
  assertAuthoredChangeBudget,
  configureGitForCi,
  hasWorkingTreeChanges,
  pushFixBranch,
  revParse,
} from "./git.js";
import { createLogger } from "./logger.js";
import { loadPrompt, resolveAgentTask } from "./prompt.js";
import { AgentIsolation, runFixAgent } from "./run-agent.js";

const log = createLogger("implement");

type PreserveImplementedBranchArgs = {
  agentBranch: string;
  assertBudget: () => Promise<void>;
  createPr: () => Promise<number>;
  findPr: () => Promise<OpenPrLookup>;
  pushBranch: () => Promise<void>;
  verifyBranch: () => Promise<boolean>;
  verifyPublishedHead?: () => Promise<void>;
};

export async function preserveImplementedBranchBeforePr(
  args: PreserveImplementedBranchArgs,
): Promise<number> {
  const budgetResult = await args.assertBudget().then(
    () => ({ kind: "accepted" as const }),
    (error: unknown) => {
      if (!(error instanceof AuthoredChangeBudgetExceededError)) throw error;
      return { kind: "rejected" as const, error };
    },
  );
  await args.pushBranch();
  if (!(await args.verifyBranch())) {
    throw new Error(
      `Agent branch ${args.agentBranch} was not found on origin after push`,
    );
  }
  await args.verifyPublishedHead?.();
  if (budgetResult.kind === "rejected") throw budgetResult.error;

  const openPr = await args.findPr();
  if (openPr.kind === OpenPrLookupKind.Found) {
    return openPr.number;
  }
  return args.createPr();
}

export enum ImplementPrTargetKind {
  Stacked = "stacked",
  Standalone = "standalone",
}

type ImplementPrTargetInput = {
  branch: string;
  baseBranch: string;
  baseSha?: string;
  kind: string;
  predecessorBranch?: string;
  prNumber?: string;
  startHeadSha?: string;
};

const FULL_SHA = /^[0-9a-f]{40}$/;

function isValidBranch(branch: string): boolean {
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
      (component) => !component.startsWith(".") && !component.endsWith(".lock"),
    );
}

export function resolveImplementPrTarget(input: ImplementPrTargetInput) {
  if (!isValidBranch(input.branch) || !isValidBranch(input.baseBranch)) {
    throw new Error("Implement PR branch metadata is malformed");
  }
  if (input.kind === ImplementPrTargetKind.Standalone) {
    if (input.baseBranch !== "main") {
      throw new Error("Standalone implement PRs must target main");
    }
    return {
      ...input,
      kind: ImplementPrTargetKind.Standalone,
      budgetBaseRef: "origin/main",
    };
  }
  if (input.kind !== ImplementPrTargetKind.Stacked) {
    throw new Error(`Unknown implement PR target kind: ${input.kind}`);
  }
  if (input.branch === input.baseBranch) {
    throw new Error(
      "Stacked implement PRs require a distinct live base branch",
    );
  }
  if (
    !input.baseSha ||
    !FULL_SHA.test(input.baseSha) ||
    !input.startHeadSha ||
    !FULL_SHA.test(input.startHeadSha) ||
    !input.predecessorBranch ||
    !isValidBranch(input.predecessorBranch) ||
    input.predecessorBranch === "main" ||
    input.predecessorBranch === input.branch ||
    !input.prNumber ||
    !/^[1-9]\d*$/.test(input.prNumber)
  ) {
    throw new Error(
      "Stacked implement PRs require frozen PR and base SHA metadata",
    );
  }
  return {
    ...input,
    kind: ImplementPrTargetKind.Stacked,
    budgetBaseRef: input.baseSha,
    prNumber: Number(input.prNumber),
  };
}

type NativeStackMember = {
  number: number;
  state?: string;
  merged_at?: unknown;
  head?: { ref?: string };
};

type NativeStack = {
  open?: boolean;
  base?: { ref?: string };
  pull_requests?: NativeStackMember[];
};

async function nativeStacks(
  octokit: ReturnType<typeof createOctokit>,
  repoRef: ReturnType<typeof parseRepository>,
) {
  try {
    return (await octokit.paginate(
      "GET /repos/{owner}/{repo}/stacks" as never,
      {
        ...repoRef,
        per_page: 100,
        headers: { accept: "application/vnd.github.nebula-preview+json" },
      } as never,
    )) as NativeStack[];
  } catch {
    throw new Error(
      "GitHub native stack membership is unavailable during delivery",
    );
  }
}

async function assertContains(
  octokit: ReturnType<typeof createOctokit>,
  repoRef: ReturnType<typeof parseRepository>,
  baseSha: string,
  headSha: string,
): Promise<void> {
  const { data } = await octokit.rest.repos.compareCommitsWithBasehead({
    ...repoRef,
    basehead: `${baseSha}...${headSha}`,
  });
  if (data.behind_by !== 0 || !["ahead", "identical"].includes(data.status)) {
    throw new Error(
      "Stacked successor no longer contains its frozen live base",
    );
  }
}

export async function validateStackDeliveryState(args: {
  octokit: ReturnType<typeof createOctokit>;
  repoRef: ReturnType<typeof parseRepository>;
  branch: string;
  baseBranch: string;
  baseSha: string;
  predecessorBranch: string;
  prNumber: number;
  startHeadSha: string;
}): Promise<void> {
  const { data: pull } = await args.octokit.rest.pulls.get({
    ...args.repoRef,
    pull_number: args.prNumber,
  });
  if (
    pull.state !== "open" ||
    pull.head.repo?.full_name !==
      `${args.repoRef.owner}/${args.repoRef.repo}` ||
    pull.head.ref !== args.branch ||
    pull.head.sha !== args.startHeadSha ||
    pull.base.ref !== args.baseBranch ||
    pull.base.sha !== args.baseSha
  ) {
    throw new Error(
      "Stacked PR head or frozen live base changed before delivery",
    );
  }

  const matches = (await nativeStacks(args.octokit, args.repoRef))
    .map((stack) => {
      const members = Array.isArray(stack.pull_requests)
        ? stack.pull_requests
        : [];
      return {
        stack,
        members,
        index: members.findIndex((member) => member.number === args.prNumber),
      };
    })
    .filter(({ index }) => index >= 0);
  if (
    matches.length !== 1 ||
    matches[0].stack.open !== true ||
    matches[0].stack.base?.ref !== "main"
  ) {
    throw new Error("Stacked PR lost its unique open GitHub native stack");
  }
  const { members, index } = matches[0];
  const predecessor = members[index - 1];
  if (
    index <= 0 ||
    members[index].head?.ref !== args.branch ||
    predecessor?.head?.ref !== args.predecessorBranch
  ) {
    throw new Error(
      "Stacked PR is no longer adjacent to its recorded predecessor",
    );
  }

  const { data: predecessorPull } = await args.octokit.rest.pulls.get({
    ...args.repoRef,
    pull_number: predecessor.number,
  });
  if (args.baseBranch === args.predecessorBranch) {
    if (
      predecessor.state !== "open" ||
      predecessor.merged_at ||
      predecessorPull.state !== "open" ||
      predecessorPull.merged ||
      predecessorPull.merged_at ||
      predecessorPull.head.ref !== args.predecessorBranch ||
      predecessorPull.head.repo?.full_name !==
        `${args.repoRef.owner}/${args.repoRef.repo}` ||
      predecessorPull.head.sha !== args.baseSha ||
      predecessorPull.base.ref !== "main"
    ) {
      throw new Error("Live stacked predecessor must remain open and unmerged");
    }
  } else if (args.baseBranch === "main") {
    const { data: main } = await args.octokit.rest.repos.getBranch({
      ...args.repoRef,
      branch: "main",
    });
    if (
      predecessor.state !== "closed" ||
      !predecessor.merged_at ||
      predecessorPull.merged !== true ||
      !predecessorPull.merged_at ||
      predecessorPull.base.ref !== "main" ||
      !predecessorPull.merge_commit_sha ||
      main.commit.sha !== args.baseSha
    ) {
      throw new Error(
        "Retargeted successor predecessor/main state changed before delivery",
      );
    }
    const [{ data: merge }, { data: predecessorHead }] = await Promise.all([
      args.octokit.rest.repos.getCommit({
        ...args.repoRef,
        ref: predecessorPull.merge_commit_sha,
      }),
      args.octokit.rest.repos.getCommit({
        ...args.repoRef,
        ref: predecessorPull.head.sha,
      }),
    ]);
    if (
      predecessorPull.merge_commit_sha === predecessorPull.head.sha ||
      merge.parents.length !== 1 ||
      merge.parents[0]?.sha !== predecessorPull.base.sha ||
      merge.commit.tree.sha !== predecessorHead.commit.tree.sha
    ) {
      throw new Error(
        "Retargeted predecessor is not an authenticated squash merge",
      );
    }
    await assertContains(
      args.octokit,
      args.repoRef,
      predecessorPull.merge_commit_sha,
      args.baseSha,
    );
  } else {
    throw new Error("Stacked successor has an invalid live base branch");
  }
  await assertContains(
    args.octokit,
    args.repoRef,
    args.baseSha,
    args.startHeadSha,
  );
}

function resolveTargetFromEnvironment() {
  const runId = process.env.GITHUB_RUN_ID?.trim() ?? "";
  const agentBranch =
    process.env.AGENT_BRANCH?.trim() ||
    process.env.FIX_BRANCH?.trim() ||
    `agent/prompt-${runId}`;
  return resolveImplementPrTarget({
    branch: agentBranch,
    baseBranch: process.env.AGENT_PR_BASE_BRANCH?.trim() || "main",
    baseSha: process.env.AGENT_PR_BASE_SHA?.trim(),
    kind:
      process.env.AGENT_PR_TARGET_KIND?.trim() ||
      ImplementPrTargetKind.Standalone,
    predecessorBranch: process.env.AGENT_PR_PREDECESSOR_BRANCH?.trim(),
    prNumber: process.env.AGENT_PR_NUMBER?.trim(),
    startHeadSha: process.env.AGENT_PR_START_HEAD_SHA?.trim(),
  });
}

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

export async function runCiImplementationPhases(
  phases: CiImplementationPhases,
): Promise<void> {
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

async function legacyStandalonePrExists(): Promise<boolean> {
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  const runId = process.env.GITHUB_RUN_ID?.trim();
  if (!repository || !runId) {
    throw new Error("GITHUB_REPOSITORY and GITHUB_RUN_ID are required");
  }
  const target = resolveTargetFromEnvironment();
  if (target.kind === ImplementPrTargetKind.Stacked) return false;
  const existing = await findOpenPr(
    createOctokit(),
    parseRepository(repository),
    target.branch,
  );
  if (existing.kind === OpenPrLookupKind.NotFound) return false;
  if (existing.baseBranch !== target.baseBranch) {
    throw new Error("Existing standalone implementation PR has a changed base");
  }
  log.info(`PR #${existing.number} is already open; skipping legacy rerun`);
  return true;
}

export async function runCiEdit(): Promise<CiEditOutcome> {
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  const runId = process.env.GITHUB_RUN_ID?.trim();
  if (!repository || !runId) {
    throw new Error("GITHUB_REPOSITORY and GITHUB_RUN_ID are required");
  }

  resolveAgentTask();

  const repoRoot = process.env.REPO_ROOT?.trim() || process.cwd();
  const target = resolveTargetFromEnvironment();
  chdir(repoRoot);
  await configureGitForCi(repoRoot);
  const loadedConfig = loadConfig();
  if (loadedConfig.kind === CiAgentConfigLoadKind.MissingApiKey) {
    if (target.kind === ImplementPrTargetKind.Stacked) {
      throw new Error("Stacked continuation requires CURSOR_API_KEY");
    }
    console.log(
      "::warning::CURSOR_API_KEY is not set — skipping agent implement job.",
    );
    return CiEditOutcome.Skipped;
  }
  const config = loadedConfig.config;
  await runFixAgent(config, await loadPrompt(config), AgentIsolation.Strict);
  if (!(await hasWorkingTreeChanges(repoRoot))) {
    if (target.kind === ImplementPrTargetKind.Stacked) {
      throw new Error("Stacked continuation produced a clean working tree");
    }
    console.log(
      "::warning::Agent finished but working tree is clean — nothing to push.",
    );
    return CiEditOutcome.Skipped;
  }
  return CiEditOutcome.Changed;
}

export async function runCiEditOnly(): Promise<void> {
  await runCiImplementationPhases({
    deliver: runCiDeliver,
    edit: runCiEdit,
    legacyPrExists: () => Promise.resolve(false),
    mode: CiImplementationMode.EditOnly,
  });
}

export async function runCiImplement(): Promise<void> {
  await runCiImplementationPhases({
    deliver: runCiDeliver,
    edit: runCiEdit,
    legacyPrExists: legacyStandalonePrExists,
    mode: CiImplementationMode.LegacyMonolithic,
  });
}

export async function runCiDeliver(): Promise<void> {
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  const runId = process.env.GITHUB_RUN_ID?.trim();
  if (!repository || !runId) {
    throw new Error("GITHUB_REPOSITORY and GITHUB_RUN_ID are required");
  }
  const repoRoot = process.env.REPO_ROOT?.trim() || process.cwd();
  const target = resolveTargetFromEnvironment();
  chdir(repoRoot);
  const octokit = createOctokit();
  await configureGitForCi(repoRoot, octokit);
  if (!(await hasWorkingTreeChanges(repoRoot))) {
    throw new Error("Trusted delivery requires implementation changes");
  }

  const repoRef = parseRepository(repository);
  if (target.kind === ImplementPrTargetKind.Stacked) {
    await validateStackDeliveryState({
      octokit,
      repoRef,
      branch: target.branch,
      baseBranch: target.baseBranch,
      baseSha: target.baseSha!,
      predecessorBranch: target.predecessorBranch!,
      prNumber: Number(target.prNumber),
      startHeadSha: target.startHeadSha!,
    });
  }

  const prNumber = await preserveImplementedBranchBeforePr({
    agentBranch: target.branch,
    assertBudget: () =>
      assertAuthoredChangeBudget({
        repoRoot,
        baseRef: target.budgetBaseRef,
        maximumLines: 2_000,
      }),
    createPr: () => {
      if (target.kind === ImplementPrTargetKind.Stacked) {
        throw new Error("Stacked delivery cannot create a replacement PR");
      }
      return createFixPr(
        octokit,
        repoRef,
        target.branch,
        runId,
        "agent implementation",
        target.baseBranch,
      );
    },
    findPr: async () => {
      const found = await findOpenPr(octokit, repoRef, target.branch);
      if (
        found.kind === OpenPrLookupKind.Found &&
        (found.baseBranch !== target.baseBranch ||
          (target.kind === ImplementPrTargetKind.Stacked &&
            found.number !== Number(target.prNumber)))
      ) {
        throw new Error("Published implementation PR identity or base changed");
      }
      return found;
    },
    pushBranch: () => pushFixBranch(repoRoot, target.branch, runId),
    verifyBranch: () => branchExistsOnOrigin(octokit, repoRef, target.branch),
    ...(target.kind === ImplementPrTargetKind.Stacked
      ? {
          verifyPublishedHead: async () => {
            const localHead = await revParse(repoRoot, "HEAD");
            const { data: pull } = await octokit.rest.pulls.get({
              ...repoRef,
              pull_number: Number(target.prNumber),
            });
            if (
              localHead === target.startHeadSha ||
              pull.head.sha !== localHead ||
              pull.base.ref !== target.baseBranch ||
              pull.base.sha !== target.baseSha
            ) {
              throw new Error(
                "Stacked publication did not advance the exact frozen PR head",
              );
            }
          },
        }
      : {}),
  });
  log.info(
    `PR #${prNumber} opened; delivery verified and handed to the continuing owner`,
  );
}
