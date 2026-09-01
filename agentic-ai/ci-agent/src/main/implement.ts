import { appendFileSync } from "node:fs";
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
  assertAuthoredChangeBudget,
  AuthoredChangeBudgetExceededError,
  configureGitForCi,
  hasWorkingTreeChanges,
  pushFixBranch,
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

export function recordTrustedBudgetBlocker(
  error: unknown,
  outputPath: string | undefined,
): void {
  if (!(error instanceof AuthoredChangeBudgetExceededError) || !outputPath) {
    return;
  }
  const encoded = Buffer.from(error.message, "utf8").toString("base64");
  appendFileSync(outputPath, `budget_blocker_b64=${encoded}\n`, "utf8");
}

export async function preserveImplementedBranchBeforePr(
  args: PreserveImplementedBranchArgs,
): Promise<number> {
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

export enum ImplementPrTargetKind {
  Standalone = "standalone",
}

type ImplementPrTargetInput = {
  branch: string;
  baseBranch: string;
  kind: string;
};

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
function resolveTargetFromEnvironment() {
  const runId = process.env.GITHUB_RUN_ID?.trim() ?? "";
  const agentBranch =
    process.env.AGENT_BRANCH?.trim() ||
    process.env.FIX_BRANCH?.trim() ||
    `agent/prompt-${runId}`;
  return resolveImplementPrTarget({
    branch: agentBranch,
    baseBranch: process.env.AGENT_PR_BASE_BRANCH?.trim() || "main",
    kind:
      process.env.AGENT_PR_TARGET_KIND?.trim() ||
      ImplementPrTargetKind.Standalone,
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
    console.log(
      "::warning::CURSOR_API_KEY is not set — skipping agent implement job.",
    );
    return CiEditOutcome.Skipped;
  }
  const config = loadedConfig.config;
  await runFixAgent(config, await loadPrompt(config), AgentIsolation.Strict);
  if (!(await hasWorkingTreeChanges(repoRoot))) {
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
  let prNumber: number;
  try {
    prNumber = await preserveImplementedBranchBeforePr({
      agentBranch: target.branch,
      assertBudget: () =>
        assertAuthoredChangeBudget({
          repoRoot,
          baseRef: target.budgetBaseRef,
          maximumLines: 2_000,
        }),
      createPr: () =>
        createFixPr(
          octokit,
          repoRef,
          target.branch,
          runId,
          "agent implementation",
          target.baseBranch,
        ),
      findPr: async () => {
        const found = await findOpenPr(octokit, repoRef, target.branch);
        if (
          found.kind === OpenPrLookupKind.Found &&
          found.baseBranch !== target.baseBranch
        ) {
          throw new Error("Published implementation PR identity or base changed");
        }
        return found;
      },
      pushBranch: () => pushFixBranch(repoRoot, target.branch, runId),
      verifyBranch: () => branchExistsOnOrigin(octokit, repoRef, target.branch),
    });
  } catch (error) {
    recordTrustedBudgetBlocker(error, process.env.GITHUB_OUTPUT);
    throw error;
  }
  log.info(
    `PR #${prNumber} opened; delivery verified and handed to the continuing owner`,
  );
}
