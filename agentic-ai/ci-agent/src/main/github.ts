import { Octokit } from "@octokit/rest";

import {
  codexReviewRequestMarker,
  cursorReviewRequestMarker,
  isCleanCodexReviewComment,
  isCodexCleanReviewStatusComment,
  isCodexReviewStatusBody,
  isCodexReviewer,
  isCursorReviewStatusBody,
  isCursorReviewer,
  isSubmittedReviewState,
  isTrustedCodexReviewRequestComment,
  isTrustedExactHeadReviewRequest,
} from "./github-review.js";
import { createLogger } from "./logger.js";

export {
  CODEX_AVAILABILITY_PROBE,
  DEFAULT_REVIEW_CLOCK,
  ExactHeadReviewFallback,
  ExactHeadReviewProvider,
  codexReviewRequestMarker,
  cursorReviewRequestMarker,
  isTrustedCodexReviewRequestComment,
  isTrustedExactHeadReviewRequest,
  requestExactHeadReview,
} from "./github-review.js";

const log = createLogger("github");

export type RepoRef = { owner: string; repo: string };

export type PullRequestRevision = {
  baseRef: string;
  baseSha: string;
  headSha: string;
};

export enum OpenPrLookupKind {
  Found = "found",
  NotFound = "not-found",
}

export type OpenPrLookup =
  | { kind: OpenPrLookupKind.Found; number: number; baseBranch: string }
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

export async function readPullRequestRevision(
  octokit: Octokit,
  repoRef: RepoRef,
  prNumber: number,
  signal?: AbortSignal,
): Promise<PullRequestRevision> {
  const { owner, repo } = repoRef;
  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
    ...(signal ? { request: { signal } } : {}),
  });
  return {
    baseRef: pr.base.ref,
    baseSha: pr.base.sha,
    headSha: pr.head.sha,
  };
}

export function samePullRequestRevision(
  left: PullRequestRevision,
  right: PullRequestRevision,
): boolean {
  return (
    left.baseRef === right.baseRef &&
    left.baseSha === right.baseSha &&
    left.headSha === right.headSha
  );
}

export function assertPullRequestRevision(
  expected: PullRequestRevision,
  actual: PullRequestRevision,
): void {
  if (samePullRequestRevision(expected, actual)) return;
  throw new Error(
    `Pull request revision changed from ${expected.headSha}/${expected.baseSha}/${expected.baseRef} to ${actual.headSha}/${actual.baseSha}/${actual.baseRef}; no review was requested`,
  );
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
    ? {
        kind: OpenPrLookupKind.Found,
        number: match.number,
        baseBranch: match.base.ref,
      }
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
  baseBranch = "main",
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
      base: baseBranch,
      body: requestedBody,
    });
    return data.number;
  } catch (err: unknown) {
    const existing = await findOpenPr(octokit, repoRef, headBranch);
    if (existing.kind === OpenPrLookupKind.Found) {
      if (existing.baseBranch !== baseBranch) {
        throw new Error(
          `Open PR for ${headBranch} targets ${existing.baseBranch}, expected ${baseBranch}`,
        );
      }
      return existing.number;
    }
    throw err;
  }
}

const MAIN_PR_CHECK = "Verify and preview";

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

export enum PullRequestFileStatus {
  Added = "added",
  Removed = "removed",
  Modified = "modified",
  Renamed = "renamed",
  Copied = "copied",
  Changed = "changed",
  Unchanged = "unchanged",
}

export type PullRequestChangedFile =
  | {
      filename: string;
      previousFilename: string;
      status: PullRequestFileStatus.Renamed;
    }
  | {
      filename: string;
      status: Exclude<PullRequestFileStatus, PullRequestFileStatus.Renamed>;
    };

const PULL_REQUEST_FILES_API_CAP = 3000;
const RENAMED_PATH_PRODUCT_SENTINEL = "__renamed_path_requires_product_validation__";

function decodePullRequestChangedFile(value: unknown): PullRequestChangedFile {
  if (!value || typeof value !== "object") {
    throw new Error("Pull-request file entry must be an object");
  }
  const file = value as Record<string, unknown>;
  if (typeof file.filename !== "string" || file.filename.length === 0) {
    throw new Error("Pull-request file entry lacks a filename");
  }
  switch (file.status) {
    case PullRequestFileStatus.Renamed:
      if (
        typeof file.previous_filename !== "string" ||
        file.previous_filename.length === 0
      ) {
        throw new Error(
          `Renamed pull-request file lacks source path: ${file.filename}`,
        );
      }
      return {
        filename: file.filename,
        previousFilename: file.previous_filename,
        status: PullRequestFileStatus.Renamed,
      };
    case PullRequestFileStatus.Added:
    case PullRequestFileStatus.Removed:
    case PullRequestFileStatus.Modified:
    case PullRequestFileStatus.Copied:
    case PullRequestFileStatus.Changed:
    case PullRequestFileStatus.Unchanged:
      return { filename: file.filename, status: file.status };
    default:
      throw new Error(
        `Unsupported pull-request file status for ${file.filename}: ${String(file.status)}`,
      );
  }
}

export function changedPathsForPullRequestFiles(
  files: readonly unknown[],
  authoritativeChangedFiles: number,
): string[] {
  if (
    !Number.isSafeInteger(authoritativeChangedFiles) ||
    authoritativeChangedFiles <= 0 ||
    files.length !== authoritativeChangedFiles ||
    files.length >= PULL_REQUEST_FILES_API_CAP
  ) {
    throw new Error(
      `Pull-request file inventory is incomplete: expected ${authoritativeChangedFiles}, received ${files.length}`,
    );
  }
  return files.flatMap((value) => {
    const file = decodePullRequestChangedFile(value);
    if (file.status !== PullRequestFileStatus.Renamed) {
      return [file.filename];
    }
    return [file.filename, RENAMED_PATH_PRODUCT_SENTINEL];
  });
}

const MAIN_PR_WORKFLOW: RequiredPrWorkflow = {
  checkName: MAIN_PR_CHECK,
  workflowFile: "pr.yml",
  workflowName: "PR",
  requiredJobs: REQUIRED_MAIN_PR_JOBS,
};

export function requiredPrWorkflows(paths: string[]): RequiredPrWorkflow[] {
  const required: RequiredPrWorkflow[] = [];

  if (paths.some((path) => !isCanonicalAiOnlyPath(path))) {
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
        nodes: Array<{
          isResolved: boolean;
        }>;
        pageInfo: { hasNextPage: boolean; endCursor?: string };
      };
    };
  };
};

type ReviewThreads =
  ReviewThreadPage["repository"]["pullRequest"]["reviewThreads"];

type IssueCommentStatePage = {
  repository: {
    pullRequest: {
      comments: {
        nodes: Array<{
          databaseId: unknown;
          isMinimized: boolean;
          minimizedReason: unknown;
        }>;
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
          nodes {
            isResolved
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`;

const ISSUE_COMMENT_STATES_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        comments(first: 100, after: $cursor) {
          nodes { databaseId isMinimized minimizedReason }
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
  cursorReview: {
    currentHeadReview: boolean;
    requested: boolean;
    settled: boolean;
  };
  findingBatches: number;
  substantiveComments: number;
  substantiveReviews: number;
  unhandledComments: number;
  unthreadedReviewFindings: number;
  unresolvedThreads: number;
};

export type InspectPrFeedbackOptions = {
  expectedRevision?: PullRequestRevision;
  signal?: AbortSignal;
};

type RepositoryStatusCommentInput = {
  authorAssociation: string;
  body: string;
  cursorMarker: string;
  marker: string;
  user: unknown;
};

export async function inspectPrFeedback(
  octokit: Octokit,
  repoRef: RepoRef,
  prNumber: number,
  options: InspectPrFeedbackOptions = {},
): Promise<PrFeedbackSummary> {
  const { owner, repo } = repoRef;
  const { expectedRevision, signal } = options;
  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
    ...(signal ? { request: { signal } } : {}),
  });
  if (expectedRevision) {
    assertPullRequestRevision(expectedRevision, {
      baseRef: pr.base.ref,
      baseSha: pr.base.sha,
      headSha: pr.head.sha,
    });
  }
  const [issueComments, reviews, reviewComments] = await Promise.all([
    octokit.paginate(octokit.rest.issues.listComments, {
      owner,
      repo,
      issue_number: prNumber,
      per_page: 100,
      ...(signal ? { request: { signal } } : {}),
    }),
    octokit.paginate(octokit.rest.pulls.listReviews, {
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
      ...(signal ? { request: { signal } } : {}),
    }),
    octokit.paginate(octokit.rest.pulls.listReviewComments, {
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
      ...(signal ? { request: { signal } } : {}),
    }),
  ]);
  const retiredAutomationComments = issueComments.filter((comment) =>
    isRetiredHeadTransitionAutomationComment({
      body: comment.body ?? "",
      user: comment.user,
    }),
  );
  await Promise.all(
    retiredAutomationComments.map((comment) =>
      octokit.rest.issues.deleteComment({
        owner,
        repo,
        comment_id: comment.id,
        ...(signal ? { request: { signal } } : {}),
      }),
    ),
  );
  const activeIssueComments = issueComments.filter(
    (comment) =>
      !retiredAutomationComments.some((retired) => retired.id === comment.id),
  );
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
    const page: ReviewThreadPage = await octokit.graphql<ReviewThreadPage>(
      REVIEW_THREADS_QUERY,
      {
        owner,
        repo,
        number: prNumber,
        ...(signal ? { request: { signal } } : {}),
        ...(pagination.kind === PaginationKind.NextPage
          ? { cursor: pagination.cursor }
          : {}),
      },
    );
    const threads: ReviewThreads = page.repository.pullRequest.reviewThreads;
    unresolvedThreads += threads.nodes.filter(
      (thread) => !thread.isResolved,
    ).length;
    pagination =
      threads.pageInfo.hasNextPage && threads.pageInfo.endCursor
        ? { kind: PaginationKind.NextPage, cursor: threads.pageInfo.endCursor }
        : { kind: PaginationKind.Complete };
  }

  const handledIssueCommentIds = new Set<number>();
  pagination = { kind: PaginationKind.FirstPage };
  while (pagination.kind !== PaginationKind.Complete) {
    const page: IssueCommentStatePage =
      await octokit.graphql<IssueCommentStatePage>(
        ISSUE_COMMENT_STATES_QUERY,
        {
          owner,
          repo,
          number: prNumber,
          ...(signal ? { request: { signal } } : {}),
          ...(pagination.kind === PaginationKind.NextPage
            ? { cursor: pagination.cursor }
            : {}),
        },
      );
    const comments = page.repository.pullRequest.comments;
    for (const comment of comments.nodes) {
      if (
        comment.isMinimized &&
        comment.minimizedReason === "resolved" &&
        typeof comment.databaseId === "number"
      ) {
        handledIssueCommentIds.add(comment.databaseId);
      }
    }
    pagination =
      comments.pageInfo.hasNextPage && comments.pageInfo.endCursor
        ? { kind: PaginationKind.NextPage, cursor: comments.pageInfo.endCursor }
        : { kind: PaginationKind.Complete };
  }

  const marker = codexReviewRequestMarker(pr.head.sha, pr.base.sha);
  const cursorMarker = cursorReviewRequestMarker(pr.head.sha);
  const reviewRequests = activeIssueComments.filter((comment) =>
    isTrustedExactHeadReviewRequest({
      authorAssociation: comment.author_association,
      body: comment.body ?? "",
      marker,
      user: comment.user,
    }),
  );
  const cursorReviewRequests = activeIssueComments.filter((comment) =>
    comment.body?.includes(cursorMarker),
  );
  const currentHeadReview = reviews.some(
    (review) =>
      review.commit_id === pr.head.sha &&
      isSubmittedReviewState(review.state) &&
      isCodexReviewer(review.user),
  );
  const currentHeadCursorReview = reviews.some(
    (review) =>
      review.commit_id === pr.head.sha &&
      isSubmittedReviewState(review.state) &&
      isCursorReviewer(review.user),
  );
  const requestReactions = (
    await Promise.all(
      reviewRequests.map((request) =>
        octokit.paginate(octokit.rest.reactions.listForIssueComment, {
          owner,
          repo,
          comment_id: request.id,
          per_page: 100,
          ...(signal ? { request: { signal } } : {}),
        }),
      ),
    )
  ).flat();
  const approvalReaction = requestReactions.some(
    (reaction) => reaction.content === "+1" && isCodexReviewer(reaction.user),
  );
  const cleanComment = activeIssueComments.some(
    (comment) =>
      isCleanCodexReviewComment(comment.body ?? "", comment.user, pr.head.sha),
  );

  const substantiveComments = activeIssueComments.filter(
    (comment) =>
      !isRepositoryStatusComment({
        authorAssociation: comment.author_association,
        body: comment.body ?? "",
        cursorMarker,
        marker,
        user: comment.user,
      }) &&
      !isCodexCleanReviewStatusComment(comment.body ?? "", comment.user) &&
      !isNonActionableReviewBody(comment.body ?? ""),
  );
  const unhandledComments = substantiveComments.filter(
    (comment) => !handledIssueCommentIds.has(comment.id),
  );
  const substantiveReviews = reviews.filter((review) => {
    if (
      !isSubmittedReviewState(review.state) ||
      review.state === "APPROVED"
    ) {
      return false;
    }
    if (review.state === "CHANGES_REQUESTED") {
      return true;
    }
    const body = review.body?.trim() ?? "";
    return (
      body.length > 0 &&
      !isCodexReviewStatusBody(body, review.user) &&
      !isCursorReviewStatusBody(body, review.user) &&
      !isNonActionableReviewBody(body)
    );
  });
  const reviewIdsWithInlineComments = new Set(
    reviewComments
      .map((comment) => comment.pull_request_review_id)
      .filter((reviewId): reviewId is number => typeof reviewId === "number"),
  );
  const unthreadedReviewFindings = substantiveReviews.filter(
    (review) => !reviewIdsWithInlineComments.has(review.id),
  );

  const normalizedReviewComments: ReviewFindingComment[] = reviewComments.map(
    (comment) => {
      const reviewerLogin = comment.user?.login;
      return {
        isReply: typeof comment.in_reply_to_id === "number",
        reviewerLogin: typeof reviewerLogin === "string" ? reviewerLogin : "",
        reviewId:
          typeof comment.pull_request_review_id === "number"
            ? comment.pull_request_review_id
            : 0,
      };
    },
  );
  const normalizedReviews: ReviewFindingReview[] = reviews.map((review) => ({
    active: isSubmittedReviewState(review.state),
    actionable: isActionableReviewBody({
      body: review.body?.trim() ?? "",
      state: review.state,
      user: review.user,
    }),
    reviewId: review.id,
    reviewerLogin: review.user?.login ?? "",
  }));
  const findingBatchRequest: AutomatedFindingBatchRequest = {
    comments: normalizedReviewComments,
    reviews: normalizedReviews,
  };

  return {
    codexReview: {
      approvalReaction,
      cleanComment,
      currentHeadReview,
      requested: reviewRequests.length > 0,
      settled: currentHeadReview || approvalReaction || cleanComment,
    },
    cursorReview: {
      currentHeadReview: currentHeadCursorReview,
      requested: cursorReviewRequests.length > 0,
      settled: currentHeadCursorReview,
    },
    findingBatches: countAutomatedFindingBatches(findingBatchRequest),
    substantiveComments: substantiveComments.length,
    substantiveReviews: substantiveReviews.length,
    unhandledComments: unhandledComments.length,
    unthreadedReviewFindings: unthreadedReviewFindings.length,
    unresolvedThreads,
  };
}

type ReviewFindingComment = {
  readonly isReply: boolean;
  readonly reviewerLogin: string;
  readonly reviewId: number;
};

type ReviewFindingReview = {
  readonly active: boolean;
  readonly actionable: boolean;
  readonly reviewerLogin: string;
  readonly reviewId: number;
};

type AutomatedFindingBatchRequest = {
  readonly comments: readonly ReviewFindingComment[];
  readonly reviews: readonly ReviewFindingReview[];
};

export function countAutomatedFindingBatches(
  request: AutomatedFindingBatchRequest,
): number {
  const reviewIds = new Set<number>();
  const activeAutomatedReviewIds = new Set(
    request.reviews
      .filter((review) => {
        const reviewer = { login: review.reviewerLogin };
        return (
          review.active &&
          (isCodexReviewer(reviewer) || isCursorReviewer(reviewer))
        );
      })
      .map((review) => review.reviewId),
  );
  for (const comment of request.comments) {
    if (comment.isReply) continue;
    if (activeAutomatedReviewIds.has(comment.reviewId)) {
      reviewIds.add(comment.reviewId);
    }
  }
  for (const review of request.reviews) {
    if (!review.actionable) continue;
    const reviewer = { login: review.reviewerLogin };
    if (!isCodexReviewer(reviewer) && !isCursorReviewer(reviewer)) continue;
    if (review.reviewId > 0) reviewIds.add(review.reviewId);
  }
  return reviewIds.size;
}

function isNotFound(err: unknown): boolean {
  return (
    err instanceof Error &&
    "status" in err &&
    (err as { status: number }).status === 404
  );
}

function isCanonicalAiOnlyPath(path: string): boolean {
  return path.startsWith(".cortex/") && path.endsWith(".md");
}

export function isRepositoryStatusComment(
  input: RepositoryStatusCommentInput,
): boolean {
  const trimmed = input.body.trimStart();
  return (
    (isGitHubActionsBot(input.user) &&
      (trimmed.startsWith("### Preview deployed") ||
        trimmed.startsWith("### Web research preview") ||
        trimmed.startsWith("<!-- nook-ui-demo -->") ||
        trimmed.startsWith("<!-- nook-core-coverage -->"))) ||
    isTrustedCodexReviewRequestComment({
      authorAssociation: input.authorAssociation,
      body: input.body,
      user: input.user,
    }) ||
    (["OWNER", "MEMBER", "COLLABORATOR"].includes(input.authorAssociation) &&
      /^cursor review\n\n<!-- nook-cursor-review:[^\s<>]+ -->$/.test(
        input.body.trim(),
      )) ||
    isAgentImplementationHandoffComment(trimmed) ||
    (isCodexReviewer(input.user) &&
      trimmed.startsWith(
        "You have reached your Codex usage limits for code reviews.",
      )) ||
    (isCodexReviewer(input.user) &&
      trimmed.startsWith("<!-- codex-pull-request-review-summary -->")) ||
    (isCursorReviewer(input.user) &&
      trimmed.startsWith("<!-- BUGBOT_FREE_TIER_DISABLED_UPSELL -->"))
  );
}

function isGitHubActionsBot(
  user: RepositoryStatusCommentInput["user"],
): boolean {
  return (
    typeof user === "object" &&
    !!user &&
    "login" in user &&
    user.login === "github-actions[bot]"
  );
}

function isRetiredHeadTransitionAutomationComment(input: {
  readonly body: string;
  readonly user: unknown;
}): boolean {
  return (
    isGitHubActionsBot(input.user) &&
    input.body
      .trim()
      .endsWith("\nExact-head delivery boundary (automated).")
  );
}

export function isNonActionableReviewBody(body: string): boolean {
  const normalized = body
    .trim()
    .toLowerCase()
    .replace(/[.!\s]+$/g, "");
  return [
    "lgtm",
    "looks good",
    "looks good to me",
    "nice work",
    "no issues",
    "no issues found",
    "thank you",
    "thanks",
  ].includes(normalized);
}

function isActionableReviewBody(input: {
  readonly body: string;
  readonly state: string;
  readonly user: unknown;
}): boolean {
  if (!isCodexReviewer(input.user) && !isCursorReviewer(input.user)) {
    return false;
  }
  if (!isSubmittedReviewState(input.state)) return false;
  if (input.state === "APPROVED") return false;
  if (input.state === "CHANGES_REQUESTED") return true;
  return (
    input.body.length > 0 &&
    !isCodexReviewStatusBody(input.body, input.user) &&
    !isCursorReviewStatusBody(input.body, input.user) &&
    !isNonActionableReviewBody(input.body)
  );
}

const AGENT_IMPLEMENTATION_HANDOFF_COMMENT =
  /^@[a-z0-9-]+ this workflow assigned you PR #\d+\. Continue only this PR's recorded scope through review, exact-head validation, and squash merge\.$/;

function isAgentImplementationHandoffComment(body: string): boolean {
  return AGENT_IMPLEMENTATION_HANDOFF_COMMENT.test(body.trim());
}
