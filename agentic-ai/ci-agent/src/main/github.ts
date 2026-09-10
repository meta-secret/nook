import { PullRequestRevisionConstraint } from "./github-revision.js";
export {
  GitHubRepositoryName,
  PullRequestRevisionComparison,
  PullRequestRevisionConstraint,
} from "./github-revision.js";
export type {
  GitHubSamePullRequestRevisionRequest,
  GitHubAssertPullRequestRevisionRequest,
} from "./github-revision.js";
import { err, ok, ResultAsync, type Result } from "neverthrow";
import { CiFailureKind, type CiFailure } from "./failure.js";
import { GithubRequestFailure } from "./github-failure.js";
import { Octokit } from "@octokit/rest";

import {
  CodexReviewRevision,
  CursorReviewRevision,
  ReviewCommentBody,
  ReviewActor,
  SubmittedReviewState,
  GitHubReviewIsTrustedCodexReviewRequestComment,
  GitHubReviewIsTrustedExactHeadReviewRequest,
} from "./github-review.js";
import { Logger } from "./logger.js";
export class GitHubEnvironment {
  constructor(private readonly environment: NodeJS.ProcessEnv) {}
  resolveGitHubToken(): Result<string, CiFailure> {
    const token =
      this.environment.NOOK_GITHUB_PAT?.trim() ||
      this.environment.GITHUB_TOKEN?.trim() ||
      this.environment.GH_TOKEN?.trim();
    if (!token) {
      return err({
        kind: CiFailureKind.Github,
        message: "NOOK_GITHUB_PAT, GITHUB_TOKEN, or GH_TOKEN is required",
      });
    }
    return ok(token);
  }

  createOctokit(): Result<Octokit, CiFailure> {
    const token = this.resolveGitHubToken();
    if (token.isErr()) return err(token.error);
    try {
      return ok(new Octokit({ auth: token.value }));
    } catch {
      return err({
        kind: CiFailureKind.Configuration,
        message: "Unable to create GitHub client",
      });
    }
  }
}

export interface GitHubClientReadPullRequestRevisionRequest {
  readonly repoRef: RepoRef;
  readonly prNumber: number;
  readonly signal?: AbortSignal;
}

export interface GitHubClientFindOpenPrRequest {
  readonly subject1: RepoRef;
  readonly headBranch: string;
}

export interface GitHubClientBranchExistsOnOriginRequest {
  readonly subject1: RepoRef;
  readonly branch: string;
}

export interface GitHubClientInspectPrFeedbackRequest {
  readonly repoRef: RepoRef;
  readonly prNumber: number;
  readonly options?: InspectPrFeedbackOptions;
}

export class GitHubClient {
  constructor(private readonly value: Octokit) {}
  async readPullRequestRevision(
    request: GitHubClientReadPullRequestRevisionRequest,
  ): Promise<Result<PullRequestRevision, CiFailure>> {
    const octokit = this.value;
    const { repoRef, prNumber, signal } = request;

    const { owner, repo } = repoRef;
    const response1 = await ResultAsync.fromPromise(
      octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
        ...(signal ? { request: { signal } } : {}),
      }),
      (cause) => new GithubRequestFailure(cause).outcome(),
    );
    if (response1.isErr()) return err(response1.error);
    const { data: pr } = response1.value;
    return ok({
      baseRef: pr.base.ref,
      baseSha: pr.base.sha,
      headSha: pr.head.sha,
    });
  }

  async findOpenPr(
    request: GitHubClientFindOpenPrRequest,
  ): Promise<Result<OpenPrLookup, CiFailure>> {
    const octokit = this.value;
    const { subject1, headBranch } = request;
    const { owner, repo } = subject1;

    const response2 = await ResultAsync.fromPromise(
      octokit.rest.pulls.list({
        owner,
        repo,
        state: "open",
        head: `${owner}:${headBranch}`,
        per_page: 1,
      }),
      (cause) => new GithubRequestFailure(cause).outcome(),
    );
    if (response2.isErr()) return err(response2.error);
    const { data } = response2.value;
    const match = data[0];
    return ok(
      match
        ? {
            kind: OpenPrLookupKind.Found,
            number: match.number,
            baseBranch: match.base.ref,
          }
        : { kind: OpenPrLookupKind.NotFound },
    );
  }

  async branchExistsOnOrigin(
    request: GitHubClientBranchExistsOnOriginRequest,
  ): Promise<Result<boolean, CiFailure>> {
    const octokit = this.value;
    const { subject1, branch } = request;
    const { owner, repo } = subject1;

    const branchResult = await ResultAsync.fromPromise(
      octokit.rest.repos.getBranch({ owner, repo, branch }),
      (cause) => new GithubRequestFailure(cause).outcome(),
    );
    if (branchResult.isOk()) return ok(true);
    return branchResult.error.kind === CiFailureKind.Github &&
      branchResult.error.code === 404
      ? ok(false)
      : err(branchResult.error);
  }

  async inspectPrFeedback(
    request: GitHubClientInspectPrFeedbackRequest,
  ): Promise<Result<PrFeedbackSummary, CiFailure>> {
    const octokit = this.value;
    const { repoRef, prNumber, options = {} } = request;

    const { owner, repo } = repoRef;
    const { expectedRevision, signal } = options;
    const response3 = await ResultAsync.fromPromise(
      octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
        ...(signal ? { request: { signal } } : {}),
      }),
      (cause) => new GithubRequestFailure(cause).outcome(),
    );
    if (response3.isErr()) return err(response3.error);
    const { data: pr } = response3.value;
    if (expectedRevision) {
      const revision = new PullRequestRevisionConstraint({
        expected: expectedRevision,
        actual: {
          baseRef: pr.base.ref,
          baseSha: pr.base.sha,
          headSha: pr.head.sha,
        },
      }).enforce();
      if (revision.isErr()) return err(revision.error);
    }
    const feedback = await ResultAsync.fromPromise(
      Promise.all([
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
      ]),
      (cause) => new GithubRequestFailure(cause, signal).outcome(),
    );
    if (feedback.isErr()) return err(feedback.error);
    const [issueComments, reviews, reviewComments] = feedback.value;
    const retiredAutomationComments = issueComments.filter((comment) => {
      const { body = "" } = comment;
      return new GitHubIsRetiredHeadTransitionAutomationComment({
        body,
        user: comment.user,
      }).execute();
    });
    const retired = await ResultAsync.fromPromise(
      Promise.all(
        retiredAutomationComments.map((comment) =>
          octokit.rest.issues.deleteComment({
            owner,
            repo,
            comment_id: comment.id,
            ...(signal ? { request: { signal } } : {}),
          }),
        ),
      ),
      (cause) => new GithubRequestFailure(cause, signal).outcome(),
    );
    if (retired.isErr()) return err(retired.error);
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
      const pageResult = await ResultAsync.fromPromise(
        octokit.graphql<ReviewThreadPage>(REVIEW_THREADS_QUERY, {
          owner,
          repo,
          number: prNumber,
          ...(signal ? { request: { signal } } : {}),
          ...(pagination.kind === PaginationKind.NextPage
            ? { cursor: pagination.cursor }
            : {}),
        }),
        (cause) => new GithubRequestFailure(cause, signal).outcome(),
      );
      if (pageResult.isErr()) return err(pageResult.error);
      const page: ReviewThreadPage = pageResult.value;
      const threads: ReviewThreads = page.repository.pullRequest.reviewThreads;
      unresolvedThreads += threads.nodes.filter(
        (thread) => !thread.isResolved,
      ).length;
      pagination =
        threads.pageInfo.hasNextPage && threads.pageInfo.endCursor
          ? {
              kind: PaginationKind.NextPage,
              cursor: threads.pageInfo.endCursor,
            }
          : { kind: PaginationKind.Complete };
    }

    let handledIssueCommentIds = new Set<number>();
    pagination = { kind: PaginationKind.FirstPage };
    while (pagination.kind !== PaginationKind.Complete) {
      const pageResult = await ResultAsync.fromPromise(
        octokit.graphql<IssueCommentStatePage>(ISSUE_COMMENT_STATES_QUERY, {
          owner,
          repo,
          number: prNumber,
          ...(signal ? { request: { signal } } : {}),
          ...(pagination.kind === PaginationKind.NextPage
            ? { cursor: pagination.cursor }
            : {}),
        }),
        (cause) => new GithubRequestFailure(cause, signal).outcome(),
      );
      if (pageResult.isErr()) return err(pageResult.error);
      const page: IssueCommentStatePage = pageResult.value;
      const comments = page.repository.pullRequest.comments;
      for (const comment of comments.nodes) {
        if (
          comment.isMinimized &&
          comment.minimizedReason === "resolved" &&
          typeof comment.databaseId === "number"
        ) {
          handledIssueCommentIds = new Set([
            ...handledIssueCommentIds,
            comment.databaseId,
          ]);
        }
      }
      pagination =
        comments.pageInfo.hasNextPage && comments.pageInfo.endCursor
          ? {
              kind: PaginationKind.NextPage,
              cursor: comments.pageInfo.endCursor,
            }
          : { kind: PaginationKind.Complete };
    }

    const marker = new CodexReviewRevision({
      headSha: pr.head.sha,
      baseSha: pr.base.sha,
    }).marker();
    const cursorMarker = new CursorReviewRevision(pr.head.sha).marker();
    const reviewRequests = activeIssueComments.filter((comment) => {
      const { body = "" } = comment;
      return new GitHubReviewIsTrustedExactHeadReviewRequest({
        authorAssociation: comment.author_association,
        body,
        marker,
        user: comment.user,
      }).execute();
    });
    const cursorReviewRequests = activeIssueComments.filter((comment) =>
      comment.body?.includes(cursorMarker),
    );
    const currentHeadReview = reviews.some(
      (review) =>
        review.commit_id === pr.head.sha &&
        new SubmittedReviewState(review.state).matches() &&
        new ReviewActor(review.user).isCodexReviewer(),
    );
    const currentHeadCursorReview = reviews.some(
      (review) =>
        review.commit_id === pr.head.sha &&
        new SubmittedReviewState(review.state).matches() &&
        new ReviewActor(review.user).isCursorReviewer(),
    );
    const reactions = await ResultAsync.fromPromise(
      Promise.all(
        reviewRequests.map((request) =>
          octokit.paginate(octokit.rest.reactions.listForIssueComment, {
            owner,
            repo,
            comment_id: request.id,
            per_page: 100,
            ...(signal ? { request: { signal } } : {}),
          }),
        ),
      ),
      (cause) => new GithubRequestFailure(cause, signal).outcome(),
    );
    if (reactions.isErr()) return err(reactions.error);
    const requestReactions = reactions.value.flat();
    const approvalReaction = requestReactions.some(
      (reaction) =>
        reaction.content === "+1" &&
        new ReviewActor(reaction.user).isCodexReviewer(),
    );
    const cleanComment = activeIssueComments.some((comment) => {
      const { body = "" } = comment;
      return new ReviewCommentBody(body).isCleanCodexReviewComment({
        actor: comment.user,
        headSha: pr.head.sha,
      });
    });

    const substantiveComments = activeIssueComments.filter((comment) => {
      const { body = "" } = comment;
      return (
        !new GitHubIsRepositoryStatusComment({
          authorAssociation: comment.author_association,
          body,
          cursorMarker,
          marker,
          user: comment.user,
        }).execute() &&
        !new ReviewCommentBody(body).isCodexCleanReviewStatusComment({
          actor: comment.user,
        }) &&
        !new ReviewBodyClassification(body).isNonActionable()
      );
    });
    const unhandledComments = substantiveComments.filter(
      (comment) => !handledIssueCommentIds.has(comment.id),
    );
    const substantiveReviews = reviews.filter((review) => {
      if (
        !new SubmittedReviewState(review.state).matches() ||
        review.state === "APPROVED"
      ) {
        return false;
      }
      if (review.state === "CHANGES_REQUESTED") {
        return true;
      }
      const [body = ""] = [review.body?.trim()];
      return (
        body.length > 0 &&
        !new ReviewCommentBody(body).isCodexReviewStatusBody({
          actor: review.user,
        }) &&
        !new ReviewCommentBody(body).isCursorReviewStatusBody({
          actor: review.user,
        }) &&
        !new ReviewBodyClassification(body).isNonActionable()
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
    const normalizedReviews: ReviewFindingReview[] = reviews.map((review) => {
      const [body = ""] = [review.body?.trim()];
      const [reviewerLogin = ""] = [review.user?.login];
      return {
        active: new SubmittedReviewState(review.state).matches(),
        actionable: new GitHubIsActionableReviewBody({
          body,
          state: review.state,
          user: review.user,
        }).execute(),
        reviewId: review.id,
        reviewerLogin,
      };
    });
    const findingBatchRequest: AutomatedFindingBatchRequest = {
      comments: normalizedReviewComments,
      reviews: normalizedReviews,
    };

    return ok({
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
      findingBatches: new AutomatedFindingHistory(
        findingBatchRequest,
      ).countBatches(),
      substantiveComments: substantiveComments.length,
      substantiveReviews: substantiveReviews.length,
      unhandledComments: unhandledComments.length,
      unthreadedReviewFindings: unthreadedReviewFindings.length,
      unresolvedThreads,
    });
  }
  async createFixPr(
    request: FixPullRequestInput,
  ): Promise<Result<number, CiFailure>> {
    const octokit = this.value;
    const {
      repoRef,
      headBranch,
      runId,
      fixLabel = "main CI",
      baseBranch = "main",
    } = request;
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

    const created = await ResultAsync.fromPromise(
      octokit.rest.pulls.create({
        owner,
        repo,
        title,
        head: headBranch,
        base: baseBranch,
        body: requestedBody,
      }),
      (cause) => new GithubRequestFailure(cause).outcome(),
    );
    if (created.isOk()) return ok(created.value.data.number);
    const existing = await this.findOpenPr({ subject1: repoRef, headBranch });
    if (existing.isErr()) return err(existing.error);
    if (existing.value.kind === OpenPrLookupKind.Found) {
      if (existing.value.baseBranch !== baseBranch)
        return err({
          kind: CiFailureKind.Github,
          message: `Open PR for ${headBranch} targets ${existing.value.baseBranch}, expected ${baseBranch}`,
        });
      return ok(existing.value.number);
    }
    return err(created.error);
  }
}

export class PullRequestChangedPath {
  constructor(private readonly value: string) {}
  isRustEcosystemPath(): boolean {
    const path = this.value;

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

  isWebResearchPath(): boolean {
    const path = this.value;

    return (
      path === ".github/workflows/web-research.yml" ||
      path.startsWith("nook-app/nook-web/nook-web-research/")
    );
  }

  isMainPrIgnoredPath(): boolean {
    const path = this.value;

    return (
      path.startsWith(".cortex/") ||
      path.startsWith(".cursor/") ||
      path.startsWith("agentic-ai/") ||
      new PullRequestChangedPath(path).isWebResearchPath()
    );
  }
}

export class PullRequestWorkflowSelection {
  constructor(private readonly request: string[]) {}
  names(): RequiredPrWorkflow[] {
    const paths = this.request;

    let required: RequiredPrWorkflow[] = [];

    if (
      paths.some((path) => new PullRequestChangedPath(path).isWebResearchPath())
    ) {
      required = [...required, WEB_RESEARCH_PR_WORKFLOW];
    }
    // Product PRs run ecosystem jobs inside pr.yml. Only minds-only PRs still
    // require the thin rust-ecosystem.yml entry point.
    if (
      paths.some((path) =>
        new PullRequestChangedPath(path).isRustEcosystemPath(),
      ) &&
      paths.every((path) =>
        new PullRequestChangedPath(path).isMainPrIgnoredPath(),
      )
    ) {
      required = [...required, RUST_ECOSYSTEM_PR_WORKFLOW];
    }
    if (
      paths.some(
        (path) => !new PullRequestChangedPath(path).isMainPrIgnoredPath(),
      )
    ) {
      required = [...required, MAIN_PR_WORKFLOW];
    }

    return required;
  }
}

export class PullRequestCheckSelection {
  constructor(private readonly request: string[]) {}
  names(): string[] {
    const paths = this.request;

    return new PullRequestWorkflowSelection(paths)
      .names()
      .map((workflow) => workflow.checkName);
  }
}

export class AutomatedFindingHistory {
  constructor(private readonly request: AutomatedFindingBatchRequest) {}
  countBatches(): number {
    const request = this.request;

    let reviewIds = new Set<number>();
    const activeAutomatedReviewIds = new Set(
      request.reviews
        .filter((review) => {
          const reviewer = { login: review.reviewerLogin };
          return (
            review.active &&
            (new ReviewActor(reviewer).isCodexReviewer() ||
              new ReviewActor(reviewer).isCursorReviewer())
          );
        })
        .map((review) => review.reviewId),
    );
    for (const comment of request.comments) {
      if (comment.isReply) continue;
      if (activeAutomatedReviewIds.has(comment.reviewId)) {
        reviewIds = new Set([...reviewIds, comment.reviewId]);
      }
    }
    for (const review of request.reviews) {
      if (!review.actionable) continue;
      const reviewer = { login: review.reviewerLogin };
      if (
        !new ReviewActor(reviewer).isCodexReviewer() &&
        !new ReviewActor(reviewer).isCursorReviewer()
      )
        continue;
      if (review.reviewId > 0)
        reviewIds = new Set([...reviewIds, review.reviewId]);
    }
    return reviewIds.size;
  }
}

export class GitHubIsRepositoryStatusComment {
  constructor(private readonly request: RepositoryStatusCommentInput) {}
  execute(): boolean {
    const input = this.request;

    const trimmed = input.body.trimStart();
    return (
      (new GitHubActor(input.user).isActionsBot() &&
        (trimmed.startsWith("### Preview deployed") ||
          trimmed.startsWith("### Web research preview") ||
          trimmed.startsWith("<!-- nook-ui-demo -->") ||
          trimmed.startsWith("<!-- nook-core-coverage -->"))) ||
      new GitHubReviewIsTrustedCodexReviewRequestComment({
        authorAssociation: input.authorAssociation,
        body: input.body,
        user: input.user,
      }).execute() ||
      (["OWNER", "MEMBER", "COLLABORATOR"].includes(input.authorAssociation) &&
        /^cursor review\n\n<!-- nook-cursor-review:[^\s<>]+ -->$/.test(
          input.body.trim(),
        )) ||
      new ImplementationHandoffComment(trimmed).matches() ||
      (new ReviewActor(input.user).isCodexReviewer() &&
        trimmed.startsWith(
          "You have reached your Codex usage limits for code reviews.",
        )) ||
      (new ReviewActor(input.user).isCodexReviewer() &&
        trimmed.startsWith("<!-- codex-pull-request-review-summary -->")) ||
      (new ReviewActor(input.user).isCursorReviewer() &&
        trimmed.startsWith("<!-- BUGBOT_FREE_TIER_DISABLED_UPSELL -->"))
    );
  }
}

class GitHubActor {
  constructor(private readonly request: RepositoryStatusCommentInput["user"]) {}
  isActionsBot(): boolean {
    const user = this.request;

    return (
      typeof user === "object" &&
      !!user &&
      "login" in user &&
      user.login === "github-actions[bot]"
    );
  }
}

class GitHubIsRetiredHeadTransitionAutomationComment {
  constructor(
    private readonly request: {
      readonly body: string;
      readonly user: unknown;
    },
  ) {}
  execute(): boolean {
    const input = this.request;

    return (
      new GitHubActor(input.user).isActionsBot() &&
      input.body.trim().endsWith("\nExact-head delivery boundary (automated).")
    );
  }
}

export class ReviewBodyClassification {
  constructor(private readonly request: string) {}
  isNonActionable(): boolean {
    const body = this.request;

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
}

class GitHubIsActionableReviewBody {
  constructor(
    private readonly request: {
      readonly body: string;
      readonly state: string;
      readonly user: unknown;
    },
  ) {}
  execute(): boolean {
    const input = this.request;

    if (
      !new ReviewActor(input.user).isCodexReviewer() &&
      !new ReviewActor(input.user).isCursorReviewer()
    ) {
      return false;
    }
    if (!new SubmittedReviewState(input.state).matches()) return false;
    if (input.state === "APPROVED") return false;
    if (input.state === "CHANGES_REQUESTED") return true;
    return (
      input.body.length > 0 &&
      !new ReviewCommentBody(input.body).isCodexReviewStatusBody({
        actor: input.user,
      }) &&
      !new ReviewCommentBody(input.body).isCursorReviewStatusBody({
        actor: input.user,
      }) &&
      !new ReviewBodyClassification(input.body).isNonActionable()
    );
  }
}

class ImplementationHandoffComment {
  constructor(private readonly request: string) {}
  matches(): boolean {
    const body = this.request;

    return AGENT_IMPLEMENTATION_HANDOFF_COMMENT.test(body.trim());
  }
}

export {
  CODEX_AVAILABILITY_PROBE,
  DEFAULT_REVIEW_CLOCK,
  ExactHeadReviewFallback,
  ExactHeadReviewProvider,
  CodexReviewRevision,
  CursorReviewRevision,
  GitHubReviewIsTrustedCodexReviewRequestComment,
  GitHubReviewIsTrustedExactHeadReviewRequest,
  GitHubReviewClient,
} from "./github-review.js";

const log = new Logger("github");

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

/** PAT preferred — PRs from GITHUB_TOKEN do not trigger pull_request workflows. */

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

const AGENT_IMPLEMENTATION_HANDOFF_COMMENT =
  /^@[a-z0-9-]+ this workflow assigned you PR #\d+\. Continue only this PR's recorded scope through review, exact-head validation, and squash merge\.$/;

export interface FixPullRequestInput {
  readonly repoRef: RepoRef;
  readonly headBranch: string;
  readonly runId: string;
  readonly fixLabel?: string;
  readonly baseBranch?: string;
}
