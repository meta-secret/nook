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
const MAIN_PR_CHECK = "Verify and preview";
const WEB_RESEARCH_PR_CHECK = "Build and deploy research catalog";

export function requiredPrCheckNames(paths: string[]): string[] {
  const required = new Set<string>();

  if (paths.some(isWebResearchPath)) {
    required.add(WEB_RESEARCH_PR_CHECK);
  }
  if (paths.some((path) => !isMainPrIgnoredPath(path))) {
    required.add(MAIN_PR_CHECK);
  }

  return [...required];
}

export async function waitForPrChecks(
  octokit: Octokit,
  repoRef: RepoRef,
  prNumber: number,
  pollMs: number,
  timeoutMs = Number(process.env.CI_FIX_CHECKS_TIMEOUT_MS ?? DEFAULT_CHECKS_TIMEOUT_MS),
): Promise<void> {
  log.info(`Waiting for PR #${prNumber} repository-owned checks`);
  const { owner, repo } = repoRef;
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });
  const requiredNames = requiredPrCheckNames(files.map((file) => file.filename));
  if (requiredNames.length === 0) {
    log.info(`PR #${prNumber} has no applicable repository-owned remote check`);
    return;
  }

  log.info(`PR #${prNumber} requires: ${requiredNames.join(", ")}`);
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

    const { data: checkRuns } = await octokit.rest.checks.listForRef({
      owner,
      repo,
      ref: sha,
      per_page: 100,
    });
    const repositoryRuns = checkRuns.check_runs.filter(
      (run) =>
        requiredNames.includes(run.name) && run.app?.slug === "github-actions",
    );
    const failedRuns = repositoryRuns.filter(
      (run) => run.status === "completed" && run.conclusion !== "success",
    );
    if (failedRuns.length > 0) {
      throw new Error(
        `PR #${prNumber} repository-owned checks failed: ${failedRuns.map((run) => run.name).join(", ")}`,
      );
    }

    const successfulNames = new Set(
      repositoryRuns
        .filter((run) => run.status === "completed" && run.conclusion === "success")
        .map((run) => run.name),
    );
    if (requiredNames.every((name) => successfulNames.has(name))) {
      log.info(`PR #${prNumber} repository-owned checks passed`);
      return;
    }

    await sleep(pollMs);
  }
}

type ReviewThreadPage = {
  repository: {
    pullRequest: {
      reviewThreads: {
        nodes: Array<{ isResolved: boolean }>;
        pageInfo: { hasNextPage: boolean; endCursor?: string };
      };
    };
  };
};

const REVIEW_THREADS_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100, after: $cursor) {
          nodes { isResolved }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`;

export async function assertNoPendingPrFeedback(
  octokit: Octokit,
  repoRef: RepoRef,
  prNumber: number,
): Promise<void> {
  const { owner, repo } = repoRef;
  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });

  let unresolvedThreads = 0;
  let cursor: string | undefined;
  do {
    const page = await octokit.graphql<ReviewThreadPage>(REVIEW_THREADS_QUERY, {
      owner,
      repo,
      number: prNumber,
      cursor,
    });
    const threads = page.repository.pullRequest.reviewThreads;
    unresolvedThreads += threads.nodes.filter((thread) => !thread.isResolved).length;
    cursor = threads.pageInfo.hasNextPage ? threads.pageInfo.endCursor : undefined;
  } while (cursor);

  const [issueComments, reviews] = await Promise.all([
    octokit.paginate(octokit.rest.issues.listComments, {
      owner,
      repo,
      issue_number: prNumber,
      per_page: 100,
    }),
    octokit.paginate(octokit.rest.pulls.listReviews, {
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
    }),
  ]);

  const substantiveComments = issueComments.filter(
    (comment) => !isRepositoryStatusComment(comment.body ?? ""),
  );
  const substantiveReviews = reviews.filter((review) => {
    if (review.commit_id !== pr.head.sha || review.state === "APPROVED") {
      return false;
    }
    if (review.state === "CHANGES_REQUESTED") {
      return true;
    }
    const body = review.body?.trim() ?? "";
    return body.length > 0 && !body.startsWith("### 💡 Codex Review");
  });

  if (
    unresolvedThreads > 0 ||
    substantiveComments.length > 0 ||
    substantiveReviews.length > 0
  ) {
    throw new Error(
      `PR #${prNumber} has feedback requiring manual handling before merge ` +
        `(threads=${unresolvedThreads}, comments=${substantiveComments.length}, reviews=${substantiveReviews.length})`,
    );
  }

  log.info(`PR #${prNumber} has no pending feedback at final inspection`);
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

function isWebResearchPath(path: string): boolean {
  return (
    path === ".github/workflows/web-research.yml" ||
    path.startsWith("nook-app/nook-web/nook-web-research/")
  );
}

function isMainPrIgnoredPath(path: string): boolean {
  return (
    path.startsWith(".cortex/") ||
    path.startsWith(".cursor/") ||
    path.startsWith("agentic-ai/") ||
    isWebResearchPath(path)
  );
}

function isRepositoryStatusComment(body: string): boolean {
  const trimmed = body.trimStart();
  return (
    trimmed.startsWith("### Preview deployed") ||
    trimmed.startsWith("### Web research preview") ||
    trimmed.startsWith("<!-- nook-core-coverage -->")
  );
}
