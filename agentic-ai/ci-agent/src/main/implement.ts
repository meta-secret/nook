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
  configureGitForCi,
  hasWorkingTreeChanges,
  pushFixBranch,
} from "./git.js";
import { createLogger } from "./logger.js";
import { loadPrompt, resolveAgentTask } from "./prompt.js";
import { runFixAgent } from "./run-agent.js";

const log = createLogger("implement");

type PreserveImplementedBranchArgs = {
  agentBranch: string;
  assertBudget: () => Promise<void>;
  createPr: () => Promise<number>;
  findPr: () => Promise<OpenPrLookup>;
  pushBranch: () => Promise<void>;
  verifyBranch: () => Promise<boolean>;
};

export async function preserveImplementedBranchBeforePr(
  args: PreserveImplementedBranchArgs,
): Promise<number> {
  const budgetResult = await args.assertBudget().then(
    () => ({ kind: "accepted" as const }),
    (error: unknown) => ({ kind: "rejected" as const, error }),
  );
  await args.pushBranch();
  if (!(await args.verifyBranch())) {
    throw new Error(
      `Agent branch ${args.agentBranch} was not found on origin after push`,
    );
  }
  if (budgetResult.kind === "rejected") throw budgetResult.error;

  const openPr = await args.findPr();
  if (openPr.kind === OpenPrLookupKind.Found) {
    return openPr.number;
  }
  return args.createPr();
}

export async function runCiImplement(): Promise<void> {
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  const runId = process.env.GITHUB_RUN_ID?.trim();
  if (!repository || !runId) {
    throw new Error("GITHUB_REPOSITORY and GITHUB_RUN_ID are required");
  }

  // Ensure prompt/config see a concrete task before the agent starts.
  resolveAgentTask();

  const repoRoot = process.env.REPO_ROOT?.trim() || process.cwd();
  const agentBranch =
    process.env.AGENT_BRANCH?.trim() ||
    process.env.FIX_BRANCH?.trim() ||
    `agent/prompt-${runId}`;
  chdir(repoRoot);

  const octokit = createOctokit();
  await configureGitForCi(repoRoot, octokit);
  const repoRef = parseRepository(repository);

  const openPr = await findOpenPr(octokit, repoRef, agentBranch);
  let prNumber: number;
  if (openPr.kind === OpenPrLookupKind.Found) {
    prNumber = openPr.number;
    log.info(`Open PR already exists for ${agentBranch} (#${prNumber})`);
  } else {
    const cursorApiKey = process.env.CURSOR_API_KEY?.trim();
    if (!cursorApiKey) {
      console.log(
        "::warning::CURSOR_API_KEY is not set — skipping agent implement job.",
      );
      console.log(
        "Add repository secret CURSOR_API_KEY (Cursor Dashboard → Integrations → User API Keys).",
      );
      return;
    }

    const loadedConfig = loadConfig();
    if (loadedConfig.kind === CiAgentConfigLoadKind.MissingApiKey) {
      return;
    }
    const config = loadedConfig.config;

    const prompt = await loadPrompt(config);
    await runFixAgent(config, prompt);

    if (!(await hasWorkingTreeChanges(repoRoot))) {
      console.log(
        "::warning::Agent finished but working tree is clean — nothing to push.",
      );
      return;
    }

    prNumber = await preserveImplementedBranchBeforePr({
      agentBranch,
      assertBudget: () =>
        assertAuthoredChangeBudget({
          repoRoot,
          baseRef: "origin/main",
          maximumLines: 2_000,
        }),
      createPr: () =>
        createFixPr(octokit, repoRef, agentBranch, runId, config.fixLabel),
      findPr: () => findOpenPr(octokit, repoRef, agentBranch),
      pushBranch: () => pushFixBranch(repoRoot, agentBranch, runId),
      verifyBranch: () => branchExistsOnOrigin(octokit, repoRef, agentBranch),
    });
    log.info(`Opened implement PR #${prNumber}`);
  }

  log.info(
    `PR #${prNumber} opened; this bounded worker hands it to a continuing task-owning agent`,
  );
  log.info(
    `Done — implement run ${runId} exits before the monitor-and-merge lifecycle`,
  );
}
