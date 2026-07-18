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
  const requestedBody =
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
      body: requestedBody,
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

const CODEX_REVIEWER_LOGIN = "chatgpt-codex-connector[bot]";
const CODEX_REVIEW_HEADING = "### 💡 Codex Review";
const CODEX_REVIEW_INTRO = "Here are some automated review suggestions for this pull request.";
const CODEX_ABOUT_DETAILS = [
  "<details> <summary>ℹ️ About Codex in GitHub</summary>",
  "<br/>",
  "[Your team has set up Codex to review pull requests in this repo](https://chatgpt.com/codex/cloud/settings/general). Reviews are triggered when you",
  "- Open a pull request for review",
  "- Mark a draft as ready",
  '- Comment "@codex review".',
  "If Codex has suggestions, it will comment; otherwise it will react with 👍.",
  'Codex can also answer questions or update the PR. Try commenting "@codex address that feedback".',
  "</details>",
].join(" ");
const CLEAN_CODEX_REVIEW_PREFIX = "Codex Review: Didn't find any major issues.";
const REVIEWED_COMMIT_PATTERN = /\*\*Reviewed commit:\*\*\s*`([0-9a-f]{10,40})`/;
const CODEX_REVIEWED_COMMIT_ONLY_PATTERN =
  /^\*\*Reviewed commit:\*\*\s*`[0-9a-f]{10,40}`$/;

export function codexReviewRequestMarker(headSha: string): string {
  return `<!-- nook-codex-review:${headSha} -->`;
}

export async function requestCodexReview(
  octokit: Octokit,
  { owner, repo }: RepoRef,
  prNumber: number,
): Promise<{ headSha: string; requested: boolean; settled: boolean }> {
  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });
  const [comments, reviews] = await Promise.all([
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
  const marker = codexReviewRequestMarker(pr.head.sha);
  const reviewRequests = comments.filter((comment) => comment.body?.includes(marker));
  const reviewSettled =
    reviews.some(
      (review) =>
        review.commit_id === pr.head.sha &&
        isSubmittedReviewState(review.state) &&
        isCodexReviewer(review.user?.login),
    ) ||
    comments.some((comment) =>
      isCleanCodexReviewComment(comment.body ?? "", comment.user?.login, pr.head.sha),
    );
  const requestReactions = reviewSettled
    ? []
    : (
        await Promise.all(
          reviewRequests.map((request) =>
            octokit.paginate(octokit.rest.reactions.listForIssueComment, {
              owner,
              repo,
              comment_id: request.id,
              per_page: 100,
            }),
          ),
        )
      ).flat();
  const approvalReaction = requestReactions.some(
    (reaction) => reaction.content === "+1" && isCodexReviewer(reaction.user?.login),
  );
  const settled = reviewSettled || approvalReaction;
  const lastRequestIndex = comments.reduce(
    (lastIndex, comment, index) => (comment.body?.includes(marker) ? index : lastIndex),
    -1,
  );
  const retryAfterUsageLimit =
    lastRequestIndex >= 0 &&
    comments
      .slice(lastRequestIndex + 1)
      .some((comment) =>
        isCodexUsageLimitComment(comment.body ?? "", comment.user?.login),
      );
  if (settled || (reviewRequests.length > 0 && !retryAfterUsageLimit)) {
    return { headSha: pr.head.sha, requested: false, settled };
  }

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body: `@codex review\n\n${marker}`,
  });
  return { headSha: pr.head.sha, requested: true, settled: false };
}

const MAIN_PR_CHECK = "Verify and preview";
const WEB_RESEARCH_PR_CHECK = "Build and deploy research catalog";

export type RequiredPrWorkflow = {
  checkName: string;
  workflowFile: string;
  workflowName: string;
};

const MAIN_PR_WORKFLOW: RequiredPrWorkflow = {
  checkName: MAIN_PR_CHECK,
  workflowFile: "pr.yml",
  workflowName: "PR",
};

const WEB_RESEARCH_PR_WORKFLOW: RequiredPrWorkflow = {
  checkName: WEB_RESEARCH_PR_CHECK,
  workflowFile: "web-research.yml",
  workflowName: "Web research",
};

export function requiredPrWorkflows(paths: string[]): RequiredPrWorkflow[] {
  const required: RequiredPrWorkflow[] = [];

  if (paths.some(isWebResearchPath)) {
    required.push(WEB_RESEARCH_PR_WORKFLOW);
  }
  if (paths.some((path) => !isMainPrIgnoredPath(path))) {
    required.push(MAIN_PR_WORKFLOW);
  }

  return required;
}

export function requiredPrCheckNames(paths: string[]): string[] {
  return requiredPrWorkflows(paths).map((workflow) => workflow.checkName);
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

export type PrFeedbackSummary = {
  codexReview: {
    approvalReaction: boolean;
    cleanComment: boolean;
    currentHeadReview: boolean;
    requested: boolean;
    settled: boolean;
  };
  substantiveComments: number;
  substantiveReviews: number;
  unresolvedThreads: number;
};

export async function inspectPrFeedback(
  octokit: Octokit,
  repoRef: RepoRef,
  prNumber: number,
): Promise<PrFeedbackSummary> {
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

  const marker = codexReviewRequestMarker(pr.head.sha);
  const reviewRequests = issueComments.filter((comment) => comment.body?.includes(marker));
  const currentHeadReview = reviews.some(
    (review) =>
      review.commit_id === pr.head.sha &&
      isSubmittedReviewState(review.state) &&
      isCodexReviewer(review.user?.login),
  );
  const requestReactions = (
    await Promise.all(
      reviewRequests.map((request) =>
        octokit.paginate(octokit.rest.reactions.listForIssueComment, {
          owner,
          repo,
          comment_id: request.id,
          per_page: 100,
        }),
      ),
    )
  ).flat();
  const approvalReaction = requestReactions.some(
    (reaction) => reaction.content === "+1" && isCodexReviewer(reaction.user?.login),
  );
  const cleanComment = issueComments.some((comment) =>
    isCleanCodexReviewComment(comment.body ?? "", comment.user?.login, pr.head.sha),
  );

  const substantiveComments = issueComments.filter(
    (comment) =>
      !isRepositoryStatusComment(comment.body ?? "") &&
      !isCodexCleanReviewStatusComment(comment.body ?? "", comment.user?.login),
  );
  const substantiveReviews = reviews.filter((review) => {
    if (review.commit_id !== pr.head.sha || review.state === "APPROVED") {
      return false;
    }
    if (review.state === "CHANGES_REQUESTED") {
      return true;
    }
    const body = review.body?.trim() ?? "";
    return body.length > 0 && !isCodexReviewStatusBody(body, review.user?.login);
  });

  return {
    codexReview: {
      approvalReaction,
      cleanComment,
      currentHeadReview,
      requested: reviewRequests.length > 0,
      settled: currentHeadReview || approvalReaction || cleanComment,
    },
    substantiveComments: substantiveComments.length,
    substantiveReviews: substantiveReviews.length,
    unresolvedThreads,
  };
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    (err as { status: number }).status === 404
  );
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
    trimmed.startsWith("<!-- nook-core-coverage -->") ||
    trimmed.includes("<!-- nook-codex-review:") ||
    // Codex posts this when it cannot review; it is status, not a finding.
    trimmed.includes("Codex usage limits for code reviews")
  );
}

function isCodexReviewer(login: string | undefined): boolean {
  return login === CODEX_REVIEWER_LOGIN;
}

function isCodexReviewStatusBody(body: string, login: string | undefined): boolean {
  if (!isCodexReviewer(login)) {
    return false;
  }
  const trimmed = body.trim();
  const detailsIndex = trimmed.indexOf("<details>");
  const summary = (detailsIndex === -1 ? trimmed : trimmed.slice(0, detailsIndex))
    .replace(/[ \t]+$/gm, "")
    .trim();
  if (detailsIndex !== -1) {
    const details = trimmed.slice(detailsIndex).trim();
    if (details.replace(/\s+/g, " ") !== CODEX_ABOUT_DETAILS) {
      return false;
    }
  }
  const expectedPrefix = `${CODEX_REVIEW_HEADING}\n\n${CODEX_REVIEW_INTRO}\n\n`;
  return (
    summary.startsWith(expectedPrefix) &&
    CODEX_REVIEWED_COMMIT_ONLY_PATTERN.test(summary.slice(expectedPrefix.length))
  );
}

function isCodexUsageLimitComment(body: string, login: string | undefined): boolean {
  return isCodexReviewer(login) && body.includes("Codex usage limits for code reviews");
}

function isCleanCodexReviewComment(
  body: string,
  login: string | undefined,
  headSha: string,
): boolean {
  if (!isCodexCleanReviewStatusComment(body, login)) {
    return false;
  }
  const reviewedCommit = body.match(REVIEWED_COMMIT_PATTERN)?.[1];
  return reviewedCommit !== undefined && headSha.startsWith(reviewedCommit);
}

function isCodexCleanReviewStatusComment(body: string, login: string | undefined): boolean {
  return (
    isCodexReviewer(login) &&
    body.trimStart().startsWith(CLEAN_CODEX_REVIEW_PREFIX) &&
    REVIEWED_COMMIT_PATTERN.test(body)
  );
}

function isSubmittedReviewState(state: string): boolean {
  return state === "APPROVED" || state === "CHANGES_REQUESTED" || state === "COMMENTED";
}
