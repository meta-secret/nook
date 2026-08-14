import { Octokit } from "@octokit/rest";

import { createLogger } from "./logger.js";

const log = createLogger("github");

export type RepoRef = { owner: string; repo: string };

export enum OpenPrLookupKind {
  Found = "found",
  NotFound = "not-found",
}

export type OpenPrLookup =
  | { kind: OpenPrLookupKind.Found; number: number }
  | { kind: OpenPrLookupKind.NotFound };

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
): Promise<OpenPrLookup> {
  const { data } = await octokit.rest.pulls.list({
    owner,
    repo,
    state: "open",
    head: `${owner}:${headBranch}`,
    per_page: 1,
  });
  const match = data[0];
  return match
    ? { kind: OpenPrLookupKind.Found, number: match.number }
    : { kind: OpenPrLookupKind.NotFound };
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
    if (existing.kind === OpenPrLookupKind.Found) {
      return existing.number;
    }
    throw err;
  }
}

const CODEX_REVIEWER_LOGIN = "chatgpt-codex-connector[bot]";
const CODEX_REVIEW_HEADING = "### 💡 Codex Review";
const CODEX_REVIEW_INTRO =
  "Here are some automated review suggestions for this pull request.";
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
const REVIEWED_COMMIT_PATTERN =
  /\*\*Reviewed commit:\*\*\s*`([0-9a-f]{10,40})`/;
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
  const reviewRequests = comments.filter((comment) =>
    comment.body?.includes(marker),
  );
  const reviewSettled =
    reviews.some(
      (review) =>
        review.commit_id === pr.head.sha &&
        isSubmittedReviewState(review.state) &&
        isCodexReviewer(review.user),
    ) ||
    comments.some((comment) =>
      isCleanCodexReviewComment(comment.body ?? "", comment.user, pr.head.sha),
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
    (reaction) => reaction.content === "+1" && isCodexReviewer(reaction.user),
  );
  const settled = reviewSettled || approvalReaction;
  const lastRequestIndex = comments.reduce(
    (lastIndex, comment, index) =>
      comment.body?.includes(marker) ? index : lastIndex,
    -1,
  );
  const retryAfterUsageLimit =
    lastRequestIndex >= 0 &&
    comments
      .slice(lastRequestIndex + 1)
      .some((comment) =>
        isCodexUsageLimitComment(comment.body ?? "", comment.user),
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
const RUST_ECOSYSTEM_PR_CHECK = "Rust ecosystem checks";

/** Jobs that must succeed on the latest exact-head PR run before merge. */
export const REQUIRED_MAIN_PR_JOBS = [
  "Native Rust verification",
  "WASM build and artifact",
  "WASM Node tests",
  "Web verification",
  "Verify and preview",
] as const;

export type RequiredPrWorkflow = {
  checkName: string;
  workflowFile: string;
  workflowName: string;
  requiredJobs?: readonly string[];
};

const MAIN_PR_WORKFLOW: RequiredPrWorkflow = {
  checkName: MAIN_PR_CHECK,
  workflowFile: "pr.yml",
  workflowName: "PR",
  requiredJobs: REQUIRED_MAIN_PR_JOBS,
};

const WEB_RESEARCH_PR_WORKFLOW: RequiredPrWorkflow = {
  checkName: WEB_RESEARCH_PR_CHECK,
  workflowFile: "web-research.yml",
  workflowName: "Web research",
};

const RUST_ECOSYSTEM_PR_WORKFLOW: RequiredPrWorkflow = {
  checkName: RUST_ECOSYSTEM_PR_CHECK,
  workflowFile: "rust-ecosystem.yml",
  workflowName: "Rust ecosystem checks",
};

function isRustEcosystemPath(path: string): boolean {
  return (
    path === ".github/workflows/rust-ecosystem.yml" ||
    path === ".github/workflows/rust-ecosystem-checks.yml" ||
    path === "deny.toml" ||
    path === "nook-app/nook-platform/Cargo.lock" ||
    path === "nook-app/nook-platform/.insta.yaml" ||
    path.startsWith("nook-app/nook-platform/.cargo/") ||
    path.startsWith("nook-app/nook-platform/fuzz/") ||
    path.startsWith("preflight/") ||
    path.startsWith("agentic-ai/minds/") ||
    (path.startsWith("nook-app/") &&
      (path.endsWith(".rs") || path.endsWith("/Cargo.toml")))
  );
}

export function requiredPrWorkflows(paths: string[]): RequiredPrWorkflow[] {
  const required: RequiredPrWorkflow[] = [];

  if (paths.some(isWebResearchPath)) {
    required.push(WEB_RESEARCH_PR_WORKFLOW);
  }
  // Product PRs run ecosystem jobs inside pr.yml. Only minds-only PRs still
  // require the thin rust-ecosystem.yml entry point.
  if (
    paths.some(isRustEcosystemPath) &&
    paths.every(isMainPrIgnoredPath)
  ) {
    required.push(RUST_ECOSYSTEM_PR_WORKFLOW);
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

type ReviewThreads =
  ReviewThreadPage["repository"]["pullRequest"]["reviewThreads"];

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

export type PrFeedbackSnapshot = {
  feedback: PrFeedbackSummary;
  headSha: string;
  stable: boolean;
};

export async function inspectPrFeedback(
  octokit: Octokit,
  repoRef: RepoRef,
  prNumber: number,
): Promise<PrFeedbackSummary> {
  const snapshot = await inspectPrFeedbackSnapshot(octokit, repoRef, prNumber);
  return snapshot.feedback;
}

export async function inspectPrFeedbackSnapshot(
  octokit: Octokit,
  repoRef: RepoRef,
  prNumber: number,
): Promise<PrFeedbackSnapshot> {
  const { owner, repo } = repoRef;
  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });

  let unresolvedThreads = 0;
  enum PaginationKind {
    FirstPage = "first-page",
    NextPage = "next-page",
    Complete = "complete",
  }

  let pagination:
    | { kind: PaginationKind.FirstPage }
    | { kind: PaginationKind.NextPage; cursor: string }
    | { kind: PaginationKind.Complete } = { kind: PaginationKind.FirstPage };
  while (pagination.kind !== PaginationKind.Complete) {
    const page: ReviewThreadPage =
      await octokit.graphql<ReviewThreadPage>(REVIEW_THREADS_QUERY, {
        owner,
        repo,
        number: prNumber,
        ...(pagination.kind === PaginationKind.NextPage
          ? { cursor: pagination.cursor }
          : {}),
      });
    const threads: ReviewThreads = page.repository.pullRequest.reviewThreads;
    unresolvedThreads += threads.nodes.filter(
      (thread) => !thread.isResolved,
    ).length;
    pagination =
      threads.pageInfo.hasNextPage && threads.pageInfo.endCursor
        ? { kind: PaginationKind.NextPage, cursor: threads.pageInfo.endCursor }
        : { kind: PaginationKind.Complete };
  }

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
  const reviewRequests = issueComments.filter((comment) =>
    comment.body?.includes(marker),
  );
  const currentHeadReview = reviews.some(
    (review) =>
      review.commit_id === pr.head.sha &&
      isSubmittedReviewState(review.state) &&
      isCodexReviewer(review.user),
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
    (reaction) => reaction.content === "+1" && isCodexReviewer(reaction.user),
  );
  const cleanComment = issueComments.some((comment) =>
    isCleanCodexReviewComment(comment.body ?? "", comment.user, pr.head.sha),
  );

  const substantiveComments = issueComments.filter(
    (comment) =>
      !isRepositoryStatusComment(comment.body ?? "") &&
      !isCodexCleanReviewStatusComment(comment.body ?? "", comment.user),
  );
  const substantiveReviews = reviews.filter((review) => {
    if (review.commit_id !== pr.head.sha || review.state === "APPROVED") {
      return false;
    }
    if (review.state === "CHANGES_REQUESTED") {
      return true;
    }
    const body = review.body?.trim() ?? "";
    return body.length > 0 && !isCodexReviewStatusBody(body, review.user);
  });

  const feedback = {
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
  const { data: currentPr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });
  return {
    feedback,
    headSha: pr.head.sha,
    stable: currentPr.head.sha === pr.head.sha,
  };
}

function isNotFound(err: unknown): boolean {
  return (
    err instanceof Error &&
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
    trimmed.startsWith("<!-- nook-ui-demo -->") ||
    trimmed.startsWith("<!-- nook-core-coverage -->") ||
    trimmed.includes("<!-- nook-codex-review:") ||
    isAgentImplementationHandoffComment(trimmed) ||
    // Codex posts this when it cannot review; it is status, not a finding.
    trimmed.includes("Codex usage limits for code reviews")
  );
}

const AGENT_IMPLEMENTATION_HANDOFF_COMMENT =
  /^@[a-z0-9-]+ this workflow assigned you PR #\d+\. Continue only this PR's recorded scope through review, exact-head validation, and squash merge\.$/;

function isAgentImplementationHandoffComment(body: string): boolean {
  return AGENT_IMPLEMENTATION_HANDOFF_COMMENT.test(body.trim());
}

function isCodexReviewer(actor: unknown): boolean {
  if (typeof actor !== "object" || !actor) {
    return false;
  }
  return (
    "login" in actor &&
    (actor as { login?: unknown }).login === CODEX_REVIEWER_LOGIN
  );
}

enum ReviewedCommitState {
  Missing = "missing",
  Found = "found",
}

type ReviewedCommit =
  | { state: ReviewedCommitState.Missing }
  | { state: ReviewedCommitState.Found; value: string };

function reviewedCommitIn(body: string): ReviewedCommit {
  const match = body.match(REVIEWED_COMMIT_PATTERN);
  if (!match || typeof match[1] !== "string") {
    return { state: ReviewedCommitState.Missing };
  }
  return { state: ReviewedCommitState.Found, value: match[1] };
}

function isCodexReviewStatusBody(body: string, actor: unknown): boolean {
  if (!isCodexReviewer(actor)) {
    return false;
  }
  const trimmed = body.trim();
  const detailsIndex = trimmed.indexOf("<details>");
  const summary = (
    detailsIndex === -1 ? trimmed : trimmed.slice(0, detailsIndex)
  )
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
    CODEX_REVIEWED_COMMIT_ONLY_PATTERN.test(
      summary.slice(expectedPrefix.length),
    )
  );
}

function isCodexUsageLimitComment(body: string, actor: unknown): boolean {
  return (
    isCodexReviewer(actor) &&
    body.includes("Codex usage limits for code reviews")
  );
}

function isCleanCodexReviewComment(
  body: string,
  actor: unknown,
  headSha: string,
): boolean {
  if (!isCodexCleanReviewStatusComment(body, actor)) {
    return false;
  }
  const reviewedCommit = reviewedCommitIn(body);
  return (
    reviewedCommit.state === ReviewedCommitState.Found &&
    headSha.startsWith(reviewedCommit.value)
  );
}

function isCodexCleanReviewStatusComment(
  body: string,
  actor: unknown,
): boolean {
  return (
    isCodexReviewer(actor) &&
    body.trimStart().startsWith(CLEAN_CODEX_REVIEW_PREFIX) &&
    REVIEWED_COMMIT_PATTERN.test(body)
  );
}

function isSubmittedReviewState(state: string): boolean {
  return (
    state === "APPROVED" ||
    state === "CHANGES_REQUESTED" ||
    state === "COMMENTED"
  );
}
