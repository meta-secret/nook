import { chdir } from "node:process";

import { loadConfig } from "./config.js";
import {
  branchExistsOnOrigin,
  commentOnIssue,
  createIssuePr,
  createOctokit,
  findOpenPr,
  getIssue,
  parseRepository,
  shouldSkipIssueAgent,
} from "./github.js";
import { configureGitForCi, hasWorkingTreeChanges, pushIssueBranch } from "./git.js";
import { createLogger } from "./logger.js";
import { loadPrompt } from "./prompt.js";
import { runFixAgent } from "./run-agent.js";

const log = createLogger("issue");

/**
 * Implement a GitHub issue with the Cursor SDK agent, then open a PR.
 * Does not wait for checks or merge — that stays human/CI-driven.
 */
export async function runIssueImplement(): Promise<void> {
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  const runId = process.env.GITHUB_RUN_ID?.trim() || "local";
  const issueNumberRaw = process.env.ISSUE_NUMBER?.trim();
  if (!repository || !issueNumberRaw) {
    throw new Error("GITHUB_REPOSITORY and ISSUE_NUMBER are required");
  }

  const issueNumber = Number(issueNumberRaw);
  if (!Number.isInteger(issueNumber) || issueNumber < 1) {
    throw new Error(`Invalid ISSUE_NUMBER: ${issueNumberRaw}`);
  }

  const repoRoot = process.env.REPO_ROOT?.trim() || process.cwd();
  const branch =
    process.env.ISSUE_BRANCH?.trim() || `agent/issue-${issueNumber}-${runId}`;

  chdir(repoRoot);

  const octokit = createOctokit();
  await configureGitForCi(repoRoot, octokit);
  const repoRef = parseRepository(repository);

  const issue = await getIssue(octokit, repoRef, issueNumber);
  if (issue.state !== "open") {
    log.info(`Issue #${issueNumber} is ${issue.state} — skipping`);
    return;
  }

  if (shouldSkipIssueAgent(issue.labels)) {
    log.info(
      `Issue #${issueNumber} has a skip label (${issue.labels.join(", ")}) — skipping`,
    );
    return;
  }

  const existingPr = await findOpenPr(octokit, repoRef, branch);
  if (existingPr) {
    log.info(`Open PR already exists for ${branch} (#${existingPr})`);
    await commentOnIssue(
      octokit,
      repoRef,
      issueNumber,
      `Agent PR already open: #${existingPr}`,
    );
    return;
  }

  const cursorApiKey = process.env.CURSOR_API_KEY?.trim();
  if (!cursorApiKey) {
    console.log("::warning::CURSOR_API_KEY is not set — skipping issue agent job.");
    console.log(
      "Add repository secret CURSOR_API_KEY (Cursor Dashboard → Integrations → User API Keys).",
    );
    return;
  }

  const config = loadConfig();
  if (!config) {
    return;
  }

  // Issue mode uses its own prompt/branch defaults when env is unset.
  config.promptFile =
    process.env.CI_AGENT_PROMPT_FILE?.trim() || ".github/prompts/issue-agent.md";
  config.fixBranch = branch;

  await commentOnIssue(
    octokit,
    repoRef,
    issueNumber,
    [
      "Cursor agent started on this issue.",
      "",
      `- Workflow run: ${runId}`,
      `- Branch: \`${branch}\``,
    ].join("\n"),
  );

  const prompt = await loadPrompt(config, {
    ISSUE_NUMBER: String(issueNumber),
    ISSUE_TITLE: issue.title,
    ISSUE_BODY: issue.body || "(no description)",
    ISSUE_URL: issue.htmlUrl,
    ISSUE_BRANCH: branch,
  });

  await runFixAgent(config, prompt);

  if (!(await hasWorkingTreeChanges(repoRoot))) {
    console.log("::warning::Agent finished but working tree is clean — nothing to push.");
    await commentOnIssue(
      octokit,
      repoRef,
      issueNumber,
      "Cursor agent finished without code changes (working tree clean).",
    );
    return;
  }

  await pushIssueBranch(repoRoot, branch, issueNumber, issue.title);

  if (!(await branchExistsOnOrigin(octokit, repoRef, branch))) {
    throw new Error(`Issue branch ${branch} was not found on origin after push`);
  }

  let prNumber = await findOpenPr(octokit, repoRef, branch);
  if (!prNumber) {
    prNumber = await createIssuePr(
      octokit,
      repoRef,
      branch,
      issueNumber,
      issue.title,
    );
  }

  log.info(`Opened issue PR #${prNumber} for issue #${issueNumber}`);
  await commentOnIssue(
    octokit,
    repoRef,
    issueNumber,
    `Cursor agent opened pull request #${prNumber}.`,
  );
}
