import { chdir } from "node:process";

import { loadConfig } from "./config.js";
import {
  branchExistsOnOrigin,
  commentOnIssue,
  createFixPr,
  createOctokit,
  findOpenPr,
  parseRepository,
  pullRequestUrl,
} from "./github.js";
import { configureGitForCi, hasWorkingTreeChanges, pushFixBranch } from "./git.js";
import { createLogger } from "./logger.js";
import { loadPrompt, resolveAgentTask } from "./prompt.js";
import { runFixAgent } from "./run-agent.js";

const log = createLogger("implement");

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
  const issueNumberRaw = process.env.AGENT_ISSUE_NUMBER?.trim();
  const issueNumber = issueNumberRaw ? Number(issueNumberRaw) : undefined;
  if (issueNumberRaw && (issueNumber === undefined || !Number.isInteger(issueNumber) || issueNumber <= 0)) {
    throw new Error(`Invalid AGENT_ISSUE_NUMBER: ${issueNumberRaw}`);
  }

  chdir(repoRoot);

  const octokit = createOctokit();
  await configureGitForCi(repoRoot, octokit);
  const repoRef = parseRepository(repository);

  let prNumber = await findOpenPr(octokit, repoRef, agentBranch);
  if (prNumber) {
    log.info(`Open PR already exists for ${agentBranch} (#${prNumber})`);
  } else {
    const cursorApiKey = process.env.CURSOR_API_KEY?.trim();
    if (!cursorApiKey) {
      console.log("::warning::CURSOR_API_KEY is not set — skipping agent implement job.");
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

    await pushFixBranch(repoRoot, agentBranch, runId);

    if (!(await branchExistsOnOrigin(octokit, repoRef, agentBranch))) {
      throw new Error(`Agent branch ${agentBranch} was not found on origin after push`);
    }

    prNumber = await findOpenPr(octokit, repoRef, agentBranch);
    if (!prNumber) {
      prNumber = await createFixPr(octokit, repoRef, agentBranch, runId, config.fixLabel);
    }
    log.info(`Opened implement PR #${prNumber}`);

    if (issueNumber) {
      const url = pullRequestUrl(repoRef, prNumber);
      await commentOnIssue(
        octokit,
        repoRef,
        issueNumber,
        `Opened PR ${url} for this issue. This bounded implementation job has exited; a continuing task-owning agent must monitor checks, fix failures/comments/conflicts, run the exact-head readiness audit, and squash-merge without separate merge authorization.`,
      );
    }
  }

  log.info(
    `PR #${prNumber} opened; this bounded worker hands it to a continuing task-owning agent`,
  );
  log.info(`Done — implement run ${runId} exits before the monitor-and-merge lifecycle`);
}
