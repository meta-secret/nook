import { chdir } from "node:process";

import { loadConfig } from "./config.js";
import {
  branchExistsOnOrigin,
  createFixPr,
  createOctokit,
  findOpenPr,
  parseRepository,
  squashMergePr,
  waitForPrChecks,
} from "./github.js";
import { configureGitForCi, hasWorkingTreeChanges, pushFixBranch } from "./git.js";
import { createLogger } from "./logger.js";
import { loadPrompt } from "./prompt.js";
import { runFixAgent } from "./run-agent.js";

const log = createLogger("fix");

const DEFAULT_POLL_MS = 15_000;

export async function runCiFix(): Promise<void> {
  const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  if (!token) {
    throw new Error("GITHUB_TOKEN or GH_TOKEN is required");
  }

  const repository = process.env.GITHUB_REPOSITORY?.trim();
  const runId = process.env.GITHUB_RUN_ID?.trim();
  if (!repository || !runId) {
    throw new Error("GITHUB_REPOSITORY and GITHUB_RUN_ID are required");
  }

  const repoRoot = process.env.REPO_ROOT?.trim() || process.cwd();
  const fixBranch = process.env.FIX_BRANCH?.trim() || `fix/ci-${runId}`;
  const pollMs = Number(process.env.CI_FIX_POLL_MS ?? DEFAULT_POLL_MS);

  chdir(repoRoot);
  await configureGitForCi(repoRoot);

  const octokit = createOctokit();
  const repoRef = parseRepository(repository);

  let prNumber = await findOpenPr(octokit, repoRef, fixBranch);
  if (prNumber) {
    log.info(`Open PR already exists for ${fixBranch} (#${prNumber})`);
  } else {
    const cursorApiKey = process.env.CURSOR_API_KEY?.trim();
    if (!cursorApiKey) {
      console.log("::warning::CURSOR_API_KEY is not set — skipping AI CI fix job.");
      console.log(
        "Add repository secret CURSOR_API_KEY (Cursor Dashboard → Integrations → User API Keys).",
      );
      return;
    }

    const config = loadConfig();
    if (!config) {
      return;
    }

    const prompt = await loadPrompt(config);
    await runFixAgent(config, prompt);

    if (!(await hasWorkingTreeChanges(repoRoot))) {
      console.log("::warning::Agent finished but working tree is clean — nothing to push.");
      return;
    }

    await pushFixBranch(repoRoot, fixBranch, runId);

    if (!(await branchExistsOnOrigin(octokit, repoRef, fixBranch))) {
      throw new Error(`Fix branch ${fixBranch} was not found on origin after push`);
    }

    prNumber = await findOpenPr(octokit, repoRef, fixBranch);
    if (!prNumber) {
      prNumber = await createFixPr(
        octokit,
        repoRef,
        fixBranch,
        runId,
        config.fixLabel,
      );
    }
    log.info(`Opened fix PR #${prNumber}`);
  }

  const fixLabel = process.env.CI_FIX_LABEL?.trim() || "main CI";
  await waitForPrChecks(octokit, repoRef, prNumber, pollMs);
  await squashMergePr(octokit, repoRef, prNumber, fixBranch);
  log.info(`Done — merged PR #${prNumber} (fix for ${fixLabel} run ${runId})`);
}
