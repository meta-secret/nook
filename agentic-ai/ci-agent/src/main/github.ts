import { Octokit } from "@octokit/rest";

import { createLogger } from "./logger.js";

const log = createLogger("github");

export type RepoRef = { owner: string; repo: string };

export function parseRepository(fullName: string): RepoRef {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid GITHUB_REPOSITORY: ${fullName}`);
  }
  return { owner, repo };
}

/** PAT preferred — PRs from GITHUB_TOKEN do not trigger pull_request workflows. */
export function resolveGitHubToken(): string {
  const token =
    process.env.NOOK_GITHUB_PAT?.trim() ||
    process.env.GITHUB_TOKEN?.trim() ||
    process.env.GH_TOKEN?.trim();
  if (!token) {
    throw new Error("NOOK_GITHUB_PAT, GITHUB_TOKEN, or GH_TOKEN is required");
  }
  return token;
}

export function createOctokit(): Octokit {
  return new Octokit({ auth: resolveGitHubToken() });
}

export async function findOpenPr(
  octokit: Octokit,
  { owner, repo }: RepoRef,
  headBranch: string,
): Promise<number | null> {
  const { data } = await octokit.rest.pulls.list({
    owner,
    repo,
    state: "open",
    head: `${owner}:${headBranch}`,
    per_page: 1,
  });
  return data[0]?.number ?? null;
}

export async function branchExistsOnOrigin(
  octokit: Octokit,
  { owner, repo }: RepoRef,
  branch: string,
): Promise<boolean> {
  try {
    await octokit.rest.repos.getBranch({ owner, repo, branch });
    return true;
  } catch (err: unknown) {
    if (isNotFound(err)) {
      return false;
    }
    throw err;
  }
}

export function pullRequestUrl({ owner, repo }: RepoRef, prNumber: number): string {
  return `https://github.com/${owner}/${repo}/pull/${prNumber}`;
}

export async function createFixPr(
  octokit: Octokit,
  repoRef: RepoRef,
  headBranch: string,
  runId: string,
  fixLabel = "main CI",
): Promise<number> {
  const { owner, repo } = repoRef;
  const title =
    process.env.AGENT_PR_TITLE?.trim() || `Fix ${fixLabel} (run ${runId})`;
  const body =
    process.env.AGENT_PR_BODY?.trim() ||
    [
      "## Summary",
      `Auto-fix for failed ${fixLabel} run ${runId}.`,
      "",
      "## Test plan",
      "- [ ] CI green on this PR",
    ].join("\n");

  try {
    const { data } = await octokit.rest.pulls.create({
      owner,
      repo,
      title,
      head: headBranch,
      base: "main",
      body,
    });
    return data.number;
  } catch (err: unknown) {
    const existing = await findOpenPr(octokit, repoRef, headBranch);
    if (existing) {
      return existing;
    }
    throw err;
  }
}

export async function commentOnIssue(
  octokit: Octokit,
  { owner, repo }: RepoRef,
  issueNumber: number,
  body: string,
): Promise<void> {
  log.info(`Commenting on issue #${issueNumber}`);
  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body,
  });
}

const DEFAULT_CHECKS_TIMEOUT_MS = 45 * 60 * 1000;

export async function waitForPrChecks(
  octokit: Octokit,
  repoRef: RepoRef,
  prNumber: number,
  pollMs: number,
  timeoutMs = Number(process.env.CI_FIX_CHECKS_TIMEOUT_MS ?? DEFAULT_CHECKS_TIMEOUT_MS),
): Promise<void> {
  log.info(`Waiting for PR #${prNumber} checks`);
  const { owner, repo } = repoRef;
  const started = Date.now();
  const effectiveTimeout =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_CHECKS_TIMEOUT_MS;

  while (true) {
    if (Date.now() - started > effectiveTimeout) {
      throw new Error(
        `PR #${prNumber} checks timed out after ${Math.round(effectiveTimeout / 60000)}m (CI_FIX_CHECKS_TIMEOUT_MS)`,
      );
    }

    const { data: pr } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });
    const sha = pr.head.sha;

    const [{ data: checkRuns }, { data: combined }] = await Promise.all([
      octokit.rest.checks.listForRef({ owner, repo, ref: sha, per_page: 100 }),
      octokit.rest.repos.getCombinedStatusForRef({ owner, repo, ref: sha }),
    ]);

    const runs = checkRuns.check_runs;
    const pendingRun = runs.some((run) => run.status !== "completed");
    const failedRun = runs.some(
      (run) =>
        run.status === "completed" &&
        run.conclusion !== null &&
        run.conclusion !== "success" &&
        run.conclusion !== "skipped" &&
        run.conclusion !== "neutral",
    );

    const pendingStatus = combined.statuses.some(
      (status) => status.state === "pending" || status.state === "queued",
    );
    const failedStatus = combined.state === "failure";

    if (failedRun || failedStatus) {
      throw new Error(`PR #${prNumber} checks failed`);
    }

    const hasChecks = runs.length > 0 || combined.statuses.length > 0;
    if (hasChecks && !pendingRun && !pendingStatus) {
      log.info(`PR #${prNumber} checks passed`);
      return;
    }

    await sleep(pollMs);
  }
}

export async function squashMergePr(
  octokit: Octokit,
  repoRef: RepoRef,
  prNumber: number,
  headBranch: string,
): Promise<void> {
  const { owner, repo } = repoRef;
  log.info(`Squash merging PR #${prNumber}`);
  await octokit.rest.pulls.merge({
    owner,
    repo,
    pull_number: prNumber,
    merge_method: "squash",
  });

  try {
    await octokit.rest.git.deleteRef({
      owner,
      repo,
      ref: `heads/${headBranch}`,
    });
  } catch (err: unknown) {
    if (!isNotFound(err)) {
      throw err;
    }
  }
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    (err as { status: number }).status === 404
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
