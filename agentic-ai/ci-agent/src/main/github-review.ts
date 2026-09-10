import { err, ok, ResultAsync, type Result } from "neverthrow";
import { CiFailureKind, type CiFailure } from "./failure.js";
import { GithubRequestFailure } from "./github-failure.js";
import type { Octokit } from "@octokit/rest";

import type { PullRequestRevision, RepoRef } from "./github.js";

export class ReviewActor {
  constructor(private readonly value: unknown) {}
  isCodexReviewer(): boolean {
    const actor = this.value;

    const login = new ReviewActor(actor).actorLogin();
    return (
      login.state === ActorLoginState.Found &&
      login.value === CODEX_REVIEWER_LOGIN
    );
  }

  isCursorReviewer(): boolean {
    const actor = this.value;

    const login = new ReviewActor(actor).actorLogin();
    return (
      login.state === ActorLoginState.Found &&
      login.value === CURSOR_REVIEWER_LOGIN
    );
  }

  actorLogin(): ActorLogin {
    const actor = this.value;

    if (typeof actor !== "object" || !actor || !("login" in actor)) {
      return { state: ActorLoginState.Missing };
    }
    const login = actor.login;
    if (typeof login !== "string") {
      return { state: ActorLoginState.Missing };
    }
    return { state: ActorLoginState.Found, value: login };
  }
}

export interface ReviewCommentBodyIsCursorReviewStatusBodyRequest {
  readonly actor: unknown;
}

export interface ReviewCommentBodyIsCodexUsageLimitCommentRequest {
  readonly actor: unknown;
}

export interface ReviewCommentBodyIsCodexReviewStatusBodyRequest {
  readonly actor: unknown;
}

export interface ReviewCommentBodyIsCodexCleanReviewStatusCommentRequest {
  readonly actor: unknown;
}

export interface ReviewCommentBodyIsCleanCodexReviewCommentRequest {
  readonly actor: unknown;
  readonly headSha: string;
}

export class ReviewCommentBody {
  constructor(private readonly value: string) {}
  isExactHeadReviewRequestComment(): boolean {
    const body = this.value;

    return (
      body.includes("<!-- nook-codex-review:") ||
      body.includes("<!-- nook-cursor-review:")
    );
  }

  isCursorReviewStatusBody(
    request: ReviewCommentBodyIsCursorReviewStatusBodyRequest,
  ): boolean {
    const body = this.value;
    const { actor } = request;

    if (!new ReviewActor(actor).isCursorReviewer()) {
      return false;
    }
    const trimmed = body.trim();
    if (trimmed.length === 0) {
      return true;
    }
    return trimmed.includes("<summary>Stale comment</summary>");
  }

  isCodexUsageLimitComment(
    request: ReviewCommentBodyIsCodexUsageLimitCommentRequest,
  ): boolean {
    const body = this.value;
    const { actor } = request;

    return (
      new ReviewActor(actor).isCodexReviewer() &&
      body.includes("Codex usage limits for code reviews")
    );
  }

  isCodexReviewStatusBody(
    request: ReviewCommentBodyIsCodexReviewStatusBodyRequest,
  ): boolean {
    const body = this.value;
    const { actor } = request;

    if (!new ReviewActor(actor).isCodexReviewer()) {
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

  isCodexCleanReviewStatusComment(
    request: ReviewCommentBodyIsCodexCleanReviewStatusCommentRequest,
  ): boolean {
    const body = this.value;
    const { actor } = request;

    return (
      new ReviewActor(actor).isCodexReviewer() &&
      body.trimStart().startsWith(CLEAN_CODEX_REVIEW_PREFIX) &&
      REVIEWED_COMMIT_PATTERN.test(body)
    );
  }

  isCleanCodexReviewComment(
    request: ReviewCommentBodyIsCleanCodexReviewCommentRequest,
  ): boolean {
    const body = this.value;
    const { actor, headSha } = request;

    if (
      !new ReviewCommentBody(body).isCodexCleanReviewStatusComment({
        actor: actor,
      })
    ) {
      return false;
    }
    const reviewedCommit = new ReviewCommentBody(body).reviewedCommitIn();
    return (
      reviewedCommit.state === ReviewedCommitState.Found &&
      headSha.startsWith(reviewedCommit.value)
    );
  }

  reviewedCommitIn(): ReviewedCommit {
    const body = this.value;

    const match = body.match(REVIEWED_COMMIT_PATTERN);
    if (!match || typeof match[1] !== "string") {
      return { state: ReviewedCommitState.Missing };
    }
    return { state: ReviewedCommitState.Found, value: match[1] };
  }
}
export interface GitHubReviewClientRequestExactHeadReviewRequest {
  readonly repoRef: RepoRef;
  readonly prNumber: number;
  readonly options?: ExactHeadReviewOptions;
}

export class GitHubReviewClient {
  constructor(private readonly value: Octokit) {}
  async requestExactHeadReview(
    request: GitHubReviewClientRequestExactHeadReviewRequest,
  ): Promise<Result<ExactHeadReviewRequestResult, CiFailure>> {
    const octokit = this.value;
    const { repoRef, prNumber, options = {} } = request;

    const { owner, repo } = repoRef;
    const availability = options.availability;
    const signal = options.signal;
    const [
      expectedRevision = {
        state: ExactHeadReviewRevisionState.Unbound,
      },
    ] = [options.revision];
    const requested1 = await ResultAsync.fromPromise(
      octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
        ...(signal ? { request: { signal } } : {}),
      }),
      (cause) => new GithubRequestFailure(cause, signal).outcome(),
    );
    if (requested1.isErr()) return err(requested1.error);
    const { data: pr } = requested1.value;
    const headSha = pr.head.sha;
    const baseSha = pr.base.sha;
    const revision3 = new GitHubReviewAssertExpectedRevision({
      expected: expectedRevision,
      actual: {
        baseRef: pr.base.ref,
        baseSha,
        headSha,
      },
    }).execute();
    if (revision3.isErr()) return err(revision3.error);
    const snapshotResult = await new ReviewSnapshotQuery({
      baseSha,
      headSha,
      octokit,
      owner,
      prNumber,
      repo,
      signal,
    }).load();
    if (snapshotResult.isErr()) return err(snapshotResult.error);
    const snapshot = snapshotResult.value;
    if (expectedRevision.state === ExactHeadReviewRevisionState.Bound) {
      const requested2 = await ResultAsync.fromPromise(
        octokit.rest.pulls.get({
          owner,
          repo,
          pull_number: prNumber,
          ...(signal ? { request: { signal } } : {}),
        }),
        (cause) => new GithubRequestFailure(cause, signal).outcome(),
      );
      if (requested2.isErr()) return err(requested2.error);
      const { data: currentPr } = requested2.value;
      const revision4 = new GitHubReviewAssertExpectedRevision({
        expected: expectedRevision,
        actual: {
          baseRef: currentPr.base.ref,
          baseSha: currentPr.base.sha,
          headSha: currentPr.head.sha,
        },
      }).execute();
      if (revision4.isErr()) return err(revision4.error);
    }
    if (snapshot.codex.settled) {
      return ok({
        fallback: ExactHeadReviewFallback.None,
        headSha,
        provider: ExactHeadReviewProvider.Codex,
        requested: false,
        settled: true,
      });
    }
    if (snapshot.codex.usageLimited) {
      return ok({
        fallback: ExactHeadReviewFallback.CodexUsageLimit,
        headSha,
        provider: ExactHeadReviewProvider.Codex,
        requested: false,
        settled: false,
      });
    }
    if (snapshot.codex.requested) {
      return ok({
        fallback: ExactHeadReviewFallback.None,
        headSha,
        provider: ExactHeadReviewProvider.Codex,
        requested: false,
        settled: false,
      });
    }

    const codexMarker = new CodexReviewRevision({
      headSha: headSha,
      baseSha: baseSha,
    }).marker();
    const comment = await ResultAsync.fromPromise(
      octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: `@codex review\n\n${codexMarker}`,
        ...(signal ? { request: { signal } } : {}),
      }),
      (cause) => new GithubRequestFailure(cause, signal).outcome(),
    );
    if (comment.isErr()) return err(comment.error);
    if (!availability || availability.probe.timeoutMs <= 0) {
      return ok({
        fallback: ExactHeadReviewFallback.None,
        headSha,
        provider: ExactHeadReviewProvider.Codex,
        requested: true,
        settled: false,
      });
    }

    const probedResult = await new CodexAvailabilityProbe({
      availability,
      baseSha,
      headSha,
      octokit,
      owner,
      prNumber,
      repo,
      signal,
    }).run();
    if (probedResult.isErr()) return err(probedResult.error);
    const probed = probedResult.value;
    if (probed.kind === CodexProbeKind.UsageLimited) {
      return ok({
        fallback: ExactHeadReviewFallback.CodexUsageLimit,
        headSha,
        provider: ExactHeadReviewProvider.Codex,
        requested: true,
        settled: false,
      });
    }
    return ok({
      fallback: ExactHeadReviewFallback.None,
      headSha,
      provider: ExactHeadReviewProvider.Codex,
      requested: true,
      settled: probed.kind === CodexProbeKind.Settled,
    });
  }
}

export class CursorReviewRevision {
  constructor(private readonly request: string) {}
  marker(): string {
    const headSha = this.request;

    return `<!-- nook-cursor-review:${headSha} -->`;
  }
}

export class GitHubReviewIsTrustedExactHeadReviewRequest {
  constructor(
    private readonly request: {
      readonly authorAssociation: string;
      readonly body: string;
      readonly marker: string;
      readonly user: unknown;
    },
  ) {}
  execute(): boolean {
    const input = this.request;

    return (
      new GitHubReviewIsTrustedCodexReviewRequestComment(input).execute() &&
      input.body.trim() === `@codex review\n\n${input.marker}`
    );
  }
}

export class GitHubReviewIsTrustedCodexReviewRequestComment {
  constructor(
    private readonly request: {
      readonly authorAssociation: string;
      readonly body: string;
      readonly user: unknown;
    },
  ) {}
  execute(): boolean {
    const input = this.request;

    const trustedAssociations = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
    const login = new ReviewActor(input.user).actorLogin();
    const trustedWorkflowActor =
      login.state === ActorLoginState.Found &&
      login.value === "github-actions[bot]";
    return (
      (trustedAssociations.has(input.authorAssociation) ||
        trustedWorkflowActor) &&
      /^@codex review\n\n<!-- nook-codex-review:[^\s<>]+ -->$/.test(
        input.body.trim(),
      )
    );
  }
}

interface GitHubReviewAssertExpectedRevisionRequest {
  readonly expected: ExactHeadReviewRevision;
  readonly actual: PullRequestRevision;
}

class GitHubReviewAssertExpectedRevision {
  constructor(
    private readonly request: GitHubReviewAssertExpectedRevisionRequest,
  ) {}
  execute(): Result<void, CiFailure> {
    const { expected, actual } = this.request;

    if (
      expected.state === ExactHeadReviewRevisionState.Unbound ||
      (expected.revision.baseRef === actual.baseRef &&
        expected.revision.baseSha === actual.baseSha &&
        expected.revision.headSha === actual.headSha)
    ) {
      return ok();
    }
    return err({
      kind: CiFailureKind.Github,
      message: `Pull request revision changed from ${expected.revision.headSha}/${expected.revision.baseSha}/${expected.revision.baseRef} to ${actual.headSha}/${actual.baseSha}/${actual.baseRef}; no review was requested`,
    });
  }
}

export class SubmittedReviewState {
  constructor(private readonly request: string) {}
  matches(): boolean {
    const state = this.request;

    return (
      state === "APPROVED" ||
      state === "CHANGES_REQUESTED" ||
      state === "COMMENTED"
    );
  }
}

class ReviewSnapshotQuery {
  constructor(
    private readonly request: {
      baseSha: string;
      headSha: string;
      octokit: Octokit;
      owner: string;
      prNumber: number;
      repo: string;
      signal?: AbortSignal;
    },
  ) {}
  async load(): Promise<Result<ReviewSnapshot, CiFailure>> {
    const input = this.request;

    const [comments, reviews] = await Promise.all([
      new IssueCommentQuery(input).load(),
      new PullReviewQuery(input).load(),
    ]);
    if (comments.isErr()) return err(comments.error);
    if (reviews.isErr()) return err(reviews.error);
    return new ReviewSnapshotEvidence({
      comments: comments.value,
      reviews: reviews.value,
      headSha: input.headSha,
      baseSha: input.baseSha,
      reactionSource: input,
    }).project();
  }
}

interface GitHubReviewSnapshotFromRequest {
  readonly comments: IssueComment[];
  readonly reviews: PullReview[];
  readonly headSha: string;
  readonly baseSha: string;
  readonly reactionSource: {
    octokit: Octokit;
    owner: string;
    repo: string;
    signal?: AbortSignal;
  };
}

class ReviewSnapshotEvidence {
  constructor(private readonly request: GitHubReviewSnapshotFromRequest) {}
  async project(): Promise<Result<ReviewSnapshot, CiFailure>> {
    const { comments, reviews, headSha, baseSha, reactionSource } =
      this.request;

    const codexMarker = new CodexReviewRevision({
      headSha: headSha,
      baseSha: baseSha,
    }).marker();
    const cursorMarker = new CursorReviewRevision(headSha).marker();
    const codexRequests = comments.filter(
      (comment) =>
        comment.body.kind === GitHubTextKind.Present &&
        new GitHubReviewIsTrustedExactHeadReviewRequest({
          authorAssociation: comment.authorAssociation,
          body: comment.body.value,
          marker: codexMarker,
          user: comment.user,
        }).execute(),
    );
    const cursorRequests = comments.filter((comment) =>
      new GitHubTextQuery({
        marker: cursorMarker,
        text: comment.body,
      }).includes(),
    );
    const codexReviewSettled =
      codexRequests.length > 0 &&
      reviews.some((review) =>
        new SubmittedReviewEvidence({
          actorCheck: (actor) => new ReviewActor(actor).isCodexReviewer(),
          boundaryAt: new ReviewRequestHistory(codexRequests).latestTime(),
          headSha,
          review,
        }).matchesExactHead(),
      );
    const cursorReviewSettled = reviews.some((review) =>
      new SubmittedReviewEvidence({
        actorCheck: (actor) => new ReviewActor(actor).isCursorReviewer(),
        boundaryAt: { kind: GitHubTextKind.Missing },
        headSha,
        review,
      }).matchesExactHead(),
    );
    const cleanComment =
      codexRequests.length > 0 &&
      comments.some(
        (comment) =>
          comment.body.kind === GitHubTextKind.Present &&
          new ReviewTimestampComparison({
            value: comment.createdAt,
            boundary: new ReviewRequestHistory(codexRequests).latestTime(),
          }).isAtOrAfter() &&
          new ReviewCommentBody(comment.body.value).isCleanCodexReviewComment({
            actor: comment.user,
            headSha: headSha,
          }),
      );
    const lastCodexRequestIndex = comments.reduce(
      (lastIndex, comment, index) =>
        codexRequests.includes(comment) ? index : lastIndex,
      -1,
    );
    const usageLimited =
      lastCodexRequestIndex >= 0 &&
      comments.slice(lastCodexRequestIndex + 1).some(
        (comment) =>
          comment.body.kind === GitHubTextKind.Present &&
          new ReviewCommentBody(comment.body.value).isCodexUsageLimitComment({
            actor: comment.user,
          }),
      );
    const reactions =
      codexReviewSettled || cleanComment || codexRequests.length === 0
        ? ok([])
        : await ResultAsync.fromPromise(
            Promise.all(
              codexRequests.map((request) =>
                reactionSource.octokit.paginate(
                  reactionSource.octokit.rest.reactions.listForIssueComment,
                  {
                    owner: reactionSource.owner,
                    repo: reactionSource.repo,
                    comment_id: request.id,
                    per_page: 100,
                    ...(reactionSource.signal
                      ? { request: { signal: reactionSource.signal } }
                      : {}),
                  },
                ),
              ),
            ),
            (cause) =>
              new GithubRequestFailure(cause, reactionSource.signal).outcome(),
          );
    if (reactions.isErr()) return err(reactions.error);
    const requestReactions = reactions.value.flat();
    const approvalReaction = requestReactions.some(
      (reaction) =>
        reaction.content === "+1" &&
        new ReviewActor(reaction.user).isCodexReviewer(),
    );
    return ok({
      codex: {
        requested: codexRequests.length > 0,
        settled: codexReviewSettled || cleanComment || approvalReaction,
        usageLimited,
      },
      cursor: {
        requested: cursorRequests.length > 0,
        settled: cursorReviewSettled,
      },
    });
  }
}

class CodexAvailabilityProbe {
  constructor(
    private readonly request: {
      availability: ExactHeadReviewAvailability;
      baseSha: string;
      headSha: string;
      octokit: Octokit;
      owner: string;
      prNumber: number;
      repo: string;
      signal?: AbortSignal;
    },
  ) {}
  async run(): Promise<Result<CodexProbeResult, CiFailure>> {
    const input = this.request;

    const deadline = Date.now() + input.availability.probe.timeoutMs;
    while (Date.now() < deadline) {
      await input.availability.clock.waitMs(
        input.availability.probe.intervalMs,
      );
      const snapshotResult = await new ReviewSnapshotQuery(input).load();
      if (snapshotResult.isErr()) return err(snapshotResult.error);
      const snapshot = snapshotResult.value;
      if (snapshot.codex.settled) {
        return ok({ kind: CodexProbeKind.Settled });
      }
      if (snapshot.codex.usageLimited) {
        return ok({ kind: CodexProbeKind.UsageLimited });
      }
    }
    return ok({ kind: CodexProbeKind.Pending });
  }
}

class GitHubTextValue {
  constructor(private readonly request: unknown) {}
  read(): GitHubText {
    const value = this.request;

    if (typeof value === "string") {
      return { kind: GitHubTextKind.Present, value };
    }
    return { kind: GitHubTextKind.Missing };
  }
}

class GitHubTextQuery {
  constructor(private readonly request: GitHubTextIncludesInput) {}
  includes(): boolean {
    const input = this.request;

    return (
      input.text.kind === GitHubTextKind.Present &&
      input.text.value.includes(input.marker)
    );
  }
}

class SubmittedReviewEvidence {
  constructor(private readonly request: ExactHeadSubmittedReviewInput) {}
  matchesExactHead(): boolean {
    const input = this.request;

    return (
      input.review.commitId.kind === GitHubTextKind.Present &&
      input.review.commitId.value === input.headSha &&
      input.review.state.kind === GitHubTextKind.Present &&
      new SubmittedReviewState(input.review.state.value).matches() &&
      new ReviewTimestampComparison({
        value: input.review.submittedAt,
        boundary: input.boundaryAt,
      }).isAtOrAfter() &&
      input.actorCheck(input.review.user)
    );
  }
}

class ReviewRequestHistory {
  constructor(private readonly request: IssueComment[]) {}
  latestTime(): GitHubText {
    const requests = this.request;

    const [defaulted1 = { kind: GitHubTextKind.Missing }] = [
      requests.at(-1)?.createdAt,
    ];
    return defaulted1;
  }
}

interface GitHubReviewIsAtOrAfterRequest {
  readonly value: GitHubText;
  readonly boundary: GitHubText;
}

class ReviewTimestampComparison {
  constructor(private readonly request: GitHubReviewIsAtOrAfterRequest) {}
  isAtOrAfter(): boolean {
    const { value, boundary } = this.request;

    if (
      value.kind === GitHubTextKind.Missing ||
      boundary.kind === GitHubTextKind.Missing
    ) {
      return true;
    }
    return Date.parse(value.value) >= Date.parse(boundary.value);
  }
}

class IssueCommentQuery {
  constructor(
    private readonly request: {
      octokit: Octokit;
      owner: string;
      prNumber: number;
      repo: string;
      signal?: AbortSignal;
    },
  ) {}
  async load(): Promise<Result<IssueComment[], CiFailure>> {
    const input = this.request;

    const comments = await ResultAsync.fromPromise(
      input.octokit.paginate(input.octokit.rest.issues.listComments, {
        owner: input.owner,
        repo: input.repo,
        issue_number: input.prNumber,
        per_page: 100,
        ...(input.signal ? { request: { signal: input.signal } } : {}),
      }),
      (cause) => new GithubRequestFailure(cause, input.signal).outcome(),
    );
    if (comments.isErr()) return err(comments.error);
    return ok(
      comments.value.map((comment) => ({
        authorAssociation: comment.author_association,
        body: new GitHubTextValue(comment.body).read(),
        createdAt: new GitHubTextValue(comment.created_at).read(),
        id: comment.id,
        user: comment.user,
      })),
    );
  }
}

class PullReviewQuery {
  constructor(
    private readonly request: {
      octokit: Octokit;
      owner: string;
      prNumber: number;
      repo: string;
      signal?: AbortSignal;
    },
  ) {}
  async load(): Promise<Result<PullReview[], CiFailure>> {
    const input = this.request;

    const reviews = await ResultAsync.fromPromise(
      input.octokit.paginate(input.octokit.rest.pulls.listReviews, {
        owner: input.owner,
        repo: input.repo,
        pull_number: input.prNumber,
        per_page: 100,
        ...(input.signal ? { request: { signal: input.signal } } : {}),
      }),
      (cause) => new GithubRequestFailure(cause, input.signal).outcome(),
    );
    if (reviews.isErr()) return err(reviews.error);
    return ok(
      reviews.value.map((review) => ({
        body: new GitHubTextValue(review.body).read(),
        commitId: new GitHubTextValue(review.commit_id).read(),
        state: new GitHubTextValue(review.state).read(),
        submittedAt: new GitHubTextValue(review.submitted_at).read(),
        user: review.user,
      })),
    );
  }
}

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

export enum ExactHeadReviewRevisionState {
  Bound = "bound",
  Unbound = "unbound",
}

export type ExactHeadReviewRevision =
  | {
      revision: PullRequestRevision;
      state: ExactHeadReviewRevisionState.Bound;
    }
  | { state: ExactHeadReviewRevisionState.Unbound };

export type ExactHeadReviewOptions = {
  availability?: ExactHeadReviewAvailability;
  revision?: ExactHeadReviewRevision;
  signal?: AbortSignal;
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
  authorAssociation: string;
  body: GitHubText;
  createdAt: GitHubText;
  id: number;
  user: unknown;
};

type PullReview = {
  body: GitHubText;
  commitId: GitHubText;
  state: GitHubText;
  submittedAt: GitHubText;
  user: unknown;
};

export class CodexReviewRevision {
  constructor(
    private readonly revision: {
      readonly headSha: string;
      readonly baseSha?: string;
    },
  ) {}
  marker(): string {
    const { headSha, baseSha = "base-sha" } = this.revision;
    return `<!-- nook-codex-review:${headSha}:${baseSha} -->`;
  }
}

enum ReviewedCommitState {
  Missing = "missing",
  Found = "found",
}

type ReviewedCommit =
  | { state: ReviewedCommitState.Missing }
  | { state: ReviewedCommitState.Found; value: string };

enum ActorLoginState {
  Missing = "missing",
  Found = "found",
}

type ActorLogin =
  | { state: ActorLoginState.Missing }
  | { state: ActorLoginState.Found; value: string };

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

enum CodexProbeKind {
  Pending = "pending",
  Settled = "settled",
  UsageLimited = "usage-limited",
}

type CodexProbeResult =
  | { kind: CodexProbeKind.Pending }
  | { kind: CodexProbeKind.Settled }
  | { kind: CodexProbeKind.UsageLimited };

type GitHubTextIncludesInput = {
  marker: string;
  text: GitHubText;
};

type ExactHeadSubmittedReviewInput = {
  actorCheck: (actor: unknown) => boolean;
  boundaryAt: GitHubText;
  headSha: string;
  review: PullReview;
};
