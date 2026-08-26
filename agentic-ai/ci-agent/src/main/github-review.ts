import type { Octokit } from "@octokit/rest";

import type { RepoRef } from "./github.js";

const CODEX_REVIEWER_LOGIN = "chatgpt-codex-connector[bot]";
const CURSOR_REVIEWER_LOGIN = "cursor[bot]";
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

export const CODEX_AVAILABILITY_PROBE = {
  intervalMs: 2000,
  timeoutMs: 12000,
} as const;

export const DEFAULT_REVIEW_CLOCK: ReviewClock = {
  waitMs(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  },
};

export enum ExactHeadReviewProvider {
  Codex = "codex",
  Cursor = "cursor",
}

export enum ExactHeadReviewFallback {
  CodexUsageLimit = "codex-usage-limit",
  None = "none",
}

export type ReviewClock = {
  waitMs: (ms: number) => Promise<void>;
};

export type ReviewAvailabilityProbe = {
  intervalMs: number;
  timeoutMs: number;
};

export type ExactHeadReviewAvailability = {
  clock: ReviewClock;
  probe: ReviewAvailabilityProbe;
};

export type ExactHeadReviewRequestResult = {
  fallback: ExactHeadReviewFallback;
  headSha: string;
  provider: ExactHeadReviewProvider;
  requested: boolean;
  settled: boolean;
};

enum GitHubTextKind {
  Missing = "missing",
  Present = "present",
}

type GitHubText =
  | { kind: GitHubTextKind.Missing }
  | { kind: GitHubTextKind.Present; value: string };

type IssueComment = {
  body: GitHubText;
  id: number;
  user: unknown;
};

type PullReview = {
  body: GitHubText;
  commitId: GitHubText;
  state: GitHubText;
  user: unknown;
};

type CommentReaction = {
  content?: string;
  user?: unknown;
};

export function codexReviewRequestMarker(headSha: string): string {
  return `<!-- nook-codex-review:${headSha} -->`;
}

export function cursorReviewRequestMarker(headSha: string): string {
  return `<!-- nook-cursor-review:${headSha} -->`;
}

export function isExactHeadReviewRequestComment(body: string): boolean {
  return (
    body.includes("<!-- nook-codex-review:") ||
    body.includes("<!-- nook-cursor-review:")
  );
}

export async function requestExactHeadReview(
  octokit: Octokit,
  repoRef: RepoRef,
  prNumber: number,
  availability?: ExactHeadReviewAvailability,
): Promise<ExactHeadReviewRequestResult> {
  const { owner, repo } = repoRef;
  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });
  const headSha = pr.head.sha;
  const snapshot = await loadReviewSnapshot({
    headSha,
    octokit,
    owner,
    prNumber,
    repo,
  });
  if (snapshot.codex.settled) {
    return {
      fallback: ExactHeadReviewFallback.None,
      headSha,
      provider: ExactHeadReviewProvider.Codex,
      requested: false,
      settled: true,
    };
  }
  if (snapshot.codex.usageLimited) {
    return {
      fallback: ExactHeadReviewFallback.CodexUsageLimit,
      headSha,
      provider: ExactHeadReviewProvider.Codex,
      requested: false,
      settled: false,
    };
  }
  if (snapshot.codex.requested) {
    return {
      fallback: ExactHeadReviewFallback.None,
      headSha,
      provider: ExactHeadReviewProvider.Codex,
      requested: false,
      settled: false,
    };
  }

  const codexMarker = codexReviewRequestMarker(headSha);
  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body: `@codex review\n\n${codexMarker}`,
  });
  if (!availability || availability.probe.timeoutMs <= 0) {
    return {
      fallback: ExactHeadReviewFallback.None,
      headSha,
      provider: ExactHeadReviewProvider.Codex,
      requested: true,
      settled: false,
    };
  }

  const probed = await probeCodexAvailability({
    availability,
    headSha,
    octokit,
    owner,
    prNumber,
    repo,
  });
  if (probed.kind === CodexProbeKind.UsageLimited) {
    return {
      fallback: ExactHeadReviewFallback.CodexUsageLimit,
      headSha,
      provider: ExactHeadReviewProvider.Codex,
      requested: true,
      settled: false,
    };
  }
  return {
    fallback: ExactHeadReviewFallback.None,
    headSha,
    provider: ExactHeadReviewProvider.Codex,
    requested: true,
    settled: probed.kind === CodexProbeKind.Settled,
  };
}

export function isCodexReviewer(actor: unknown): boolean {
  const login = actorLogin(actor);
  return (
    login.state === ActorLoginState.Found &&
    login.value === CODEX_REVIEWER_LOGIN
  );
}

export function isCursorReviewer(actor: unknown): boolean {
  const login = actorLogin(actor);
  return (
    login.state === ActorLoginState.Found &&
    login.value === CURSOR_REVIEWER_LOGIN
  );
}

export function isSubmittedReviewState(state: string): boolean {
  return (
    state === "APPROVED" ||
    state === "CHANGES_REQUESTED" ||
    state === "COMMENTED"
  );
}

export function isCursorReviewStatusBody(body: string, actor: unknown): boolean {
  if (!isCursorReviewer(actor)) {
    return false;
  }
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    return true;
  }
  return trimmed.includes("<summary>Stale comment</summary>");
}

export function isCodexUsageLimitComment(body: string, actor: unknown): boolean {
  return (
    isCodexReviewer(actor) &&
    body.includes("Codex usage limits for code reviews")
  );
}

export function isCodexReviewStatusBody(body: string, actor: unknown): boolean {
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

export function isCodexCleanReviewStatusComment(
  body: string,
  actor: unknown,
): boolean {
  return (
    isCodexReviewer(actor) &&
    body.trimStart().startsWith(CLEAN_CODEX_REVIEW_PREFIX) &&
    REVIEWED_COMMIT_PATTERN.test(body)
  );
}

export function isCleanCodexReviewComment(
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

enum ActorLoginState {
  Missing = "missing",
  Found = "found",
}

type ActorLogin =
  | { state: ActorLoginState.Missing }
  | { state: ActorLoginState.Found; value: string };

function actorLogin(actor: unknown): ActorLogin {
  if (typeof actor !== "object" || !actor || !("login" in actor)) {
    return { state: ActorLoginState.Missing };
  }
  const login = actor.login;
  if (typeof login !== "string") {
    return { state: ActorLoginState.Missing };
  }
  return { state: ActorLoginState.Found, value: login };
}

type ReviewSnapshot = {
  codex: {
    requested: boolean;
    settled: boolean;
    usageLimited: boolean;
  };
  cursor: {
    requested: boolean;
    settled: boolean;
  };
};

async function loadReviewSnapshot(input: {
  headSha: string;
  octokit: Octokit;
  owner: string;
  prNumber: number;
  repo: string;
}): Promise<ReviewSnapshot> {
  const [comments, reviews] = await Promise.all([
    listIssueComments(input),
    listPullReviews(input),
  ]);
  return snapshotFrom(comments, reviews, input.headSha, input);
}

async function snapshotFrom(
  comments: IssueComment[],
  reviews: PullReview[],
  headSha: string,
  reactionSource: {
    octokit: Octokit;
    owner: string;
    repo: string;
  },
): Promise<ReviewSnapshot> {
  const codexMarker = codexReviewRequestMarker(headSha);
  const cursorMarker = cursorReviewRequestMarker(headSha);
  const codexRequests = comments.filter((comment) =>
    githubTextIncludes({ marker: codexMarker, text: comment.body }),
  );
  const cursorRequests = comments.filter((comment) =>
    githubTextIncludes({ marker: cursorMarker, text: comment.body }),
  );
  const codexReviewSettled = reviews.some((review) =>
    isExactHeadSubmittedReview({
      actorCheck: isCodexReviewer,
      headSha,
      review,
    }),
  );
  const cursorReviewSettled = reviews.some((review) =>
    isExactHeadSubmittedReview({
      actorCheck: isCursorReviewer,
      headSha,
      review,
    }),
  );
  const cleanComment = comments.some(
    (comment) =>
      comment.body.kind === GitHubTextKind.Present &&
      isCleanCodexReviewComment(comment.body.value, comment.user, headSha),
  );
  const lastCodexRequestIndex = comments.reduce(
    (lastIndex, comment, index) =>
      githubTextIncludes({ marker: codexMarker, text: comment.body })
        ? index
        : lastIndex,
    -1,
  );
  const usageLimited =
    lastCodexRequestIndex >= 0 &&
    comments
      .slice(lastCodexRequestIndex + 1)
      .some(
        (comment) =>
          comment.body.kind === GitHubTextKind.Present &&
          isCodexUsageLimitComment(comment.body.value, comment.user),
      );
  const requestReactions =
    codexReviewSettled || cleanComment || codexRequests.length === 0
      ? []
      : (
          await Promise.all(
            codexRequests.map((request) =>
              reactionSource.octokit.paginate(
                reactionSource.octokit.rest.reactions.listForIssueComment,
                {
                  owner: reactionSource.owner,
                  repo: reactionSource.repo,
                  comment_id: request.id,
                  per_page: 100,
                },
              ),
            ),
          )
        ).flat() as CommentReaction[];
  const approvalReaction = requestReactions.some(
    (reaction) =>
      reaction.content === "+1" && isCodexReviewer(reaction.user),
  );
  return {
    codex: {
      requested: codexRequests.length > 0,
      settled: codexReviewSettled || cleanComment || approvalReaction,
      usageLimited,
    },
    cursor: {
      requested: cursorRequests.length > 0,
      settled: cursorReviewSettled,
    },
  };
}

enum CodexProbeKind {
  Pending = "pending",
  Settled = "settled",
  UsageLimited = "usage-limited",
}

type CodexProbeResult =
  | { kind: CodexProbeKind.Pending }
  | { kind: CodexProbeKind.Settled }
  | { kind: CodexProbeKind.UsageLimited };

async function probeCodexAvailability(input: {
  availability: ExactHeadReviewAvailability;
  headSha: string;
  octokit: Octokit;
  owner: string;
  prNumber: number;
  repo: string;
}): Promise<CodexProbeResult> {
  const deadline = Date.now() + input.availability.probe.timeoutMs;
  while (Date.now() < deadline) {
    await input.availability.clock.waitMs(input.availability.probe.intervalMs);
    const snapshot = await loadReviewSnapshot(input);
    if (snapshot.codex.settled) {
      return { kind: CodexProbeKind.Settled };
    }
    if (snapshot.codex.usageLimited) {
      return { kind: CodexProbeKind.UsageLimited };
    }
  }
  return { kind: CodexProbeKind.Pending };
}

function githubTextFrom(value: unknown): GitHubText {
  if (typeof value === "string") {
    return { kind: GitHubTextKind.Present, value };
  }
  return { kind: GitHubTextKind.Missing };
}

type GitHubTextIncludesInput = {
  marker: string;
  text: GitHubText;
};

function githubTextIncludes(input: GitHubTextIncludesInput): boolean {
  return (
    input.text.kind === GitHubTextKind.Present &&
    input.text.value.includes(input.marker)
  );
}

type ExactHeadSubmittedReviewInput = {
  actorCheck: (actor: unknown) => boolean;
  headSha: string;
  review: PullReview;
};

function isExactHeadSubmittedReview(
  input: ExactHeadSubmittedReviewInput,
): boolean {
  return (
    input.review.commitId.kind === GitHubTextKind.Present &&
    input.review.commitId.value === input.headSha &&
    input.review.state.kind === GitHubTextKind.Present &&
    isSubmittedReviewState(input.review.state.value) &&
    input.actorCheck(input.review.user)
  );
}

async function listIssueComments(input: {
  octokit: Octokit;
  owner: string;
  prNumber: number;
  repo: string;
}): Promise<IssueComment[]> {
  const comments = await input.octokit.paginate(
    input.octokit.rest.issues.listComments,
    {
      owner: input.owner,
      repo: input.repo,
      issue_number: input.prNumber,
      per_page: 100,
    },
  );
  return comments.map((comment) => ({
    body: githubTextFrom(comment.body),
    id: comment.id,
    user: comment.user,
  }));
}

async function listPullReviews(input: {
  octokit: Octokit;
  owner: string;
  prNumber: number;
  repo: string;
}): Promise<PullReview[]> {
  const reviews = await input.octokit.paginate(
    input.octokit.rest.pulls.listReviews,
    {
      owner: input.owner,
      repo: input.repo,
      pull_number: input.prNumber,
      per_page: 100,
    },
  );
  return reviews.map((review) => ({
    body: githubTextFrom(review.body),
    commitId: githubTextFrom(review.commit_id),
    state: githubTextFrom(review.state),
    user: review.user,
  }));
}
