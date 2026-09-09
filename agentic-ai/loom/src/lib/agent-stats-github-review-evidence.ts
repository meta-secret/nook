import { err, ok, type Result } from 'neverthrow';
import { LoomFailureCode } from '../loom-failure.ts';
import {
  UntrustedYamlBoundary,
  UntrustedYamlPropertyPresence,
  type UntrustedYamlMap,
  type UntrustedYamlNode,
  type UntrustedYamlPropertyArgs,
} from './guards.ts';
import {
  GithubActionEvidenceApi,
  type GitHubEvidenceFailure,
  type GitHubPropertyRequest as PropertyRequest,
  type GitHubApiRequest,
} from './agent-stats-github-api.ts';
import { GitHubEvidenceField } from './agent-stats-github-field.ts';
import {
  ReviewFindingBody,
  ReviewOutcome,
} from './agent-stats-github-review.ts';
import type {
  BuildReviewEvidenceRequest,
  ReviewEvidence,
  ReviewRequestsRequest,
  ReviewResultsRequest,
  ReviewRequestObservation,
  ReviewResultObservation,
  ReviewEventObservation,
  ResolveHeadShaRequest,
  ReviewEventPairRequest,
  HasLoginRequest,
  CollectReviewReactionPagesRequest,
} from './agent-stats-github-contracts.ts';
const CODEX_LOGIN = 'chatgpt-codex-connector[bot]';
const GITHUB_ACTIONS_LOGIN = 'github-actions[bot]';
const TRUSTED_REVIEW_ASSOCIATIONS = new Set([
  'OWNER',
  'MEMBER',
  'COLLABORATOR',
]);
export class GitHubReviewEvidence {
  constructor(private readonly request: BuildReviewEvidenceRequest) {}
  build(): Result<ReviewEvidence, GitHubEvidenceFailure> {
    const request = this.request;
    const pageAdmission7 = GithubActionEvidenceApi.flattenApiPages(
      request.issueCommentPages,
    );
    if (pageAdmission7.isErr()) return err(pageAdmission7.error);
    const issueComments = pageAdmission7.value.filter(
      UntrustedYamlBoundary.isRecord,
    );
    const pageAdmission8 = GithubActionEvidenceApi.flattenApiPages(
      request.reviewPages,
    );
    if (pageAdmission8.isErr()) return err(pageAdmission8.error);
    const reviews = pageAdmission8.value.filter(UntrustedYamlBoundary.isRecord);
    const pageAdmission9 = GithubActionEvidenceApi.flattenApiPages(
      request.reviewCommentPages,
    );
    if (pageAdmission9.isErr()) return err(pageAdmission9.error);
    const reviewComments = pageAdmission9.value.filter(
      UntrustedYamlBoundary.isRecord,
    );
    const pageAdmission10 = GithubActionEvidenceApi.flattenApiPages(
      request.reviewReactionPages,
    );
    if (pageAdmission10.isErr()) return err(pageAdmission10.error);
    const reviewReactions = pageAdmission10.value.filter(
      UntrustedYamlBoundary.isRecord,
    );
    const requestsRequest: ReviewRequestsRequest = {
      comments: issueComments,
      knownHeadShas: request.knownHeadShas,
      mergedAt: request.mergedAt,
    };
    const requiredField2 = this.reviewRequests(requestsRequest);
    if (requiredField2.isErr()) return err(requiredField2.error);
    const requests = requiredField2.value;
    const resultsRequest: ReviewResultsRequest = {
      issueComments,
      reviews,
      reviewComments,
      reviewReactions,
      requests,
      knownHeadShas: request.knownHeadShas,
      mergedAt: request.mergedAt,
    };
    const requiredField3 = this.reviewResults(resultsRequest);
    if (requiredField3.isErr()) return err(requiredField3.error);
    const results = requiredField3.value;
    const events: ReviewEventObservation[] = [];
    const matchedResultKeys = new Set<string>();
    for (const reviewRequest of requests) {
      const result = results.find(
        (candidate) =>
          candidate.headSha === reviewRequest.headSha &&
          candidate.completedAt >= reviewRequest.requestedAt &&
          (candidate.requestCommentId === 0 ||
            candidate.requestCommentId === reviewRequest.commentId) &&
          !matchedResultKeys.has(this.reviewResultKey(candidate)),
      );
      if (result) {
        matchedResultKeys.add(this.reviewResultKey(result));
        const pairRequest: ReviewEventPairRequest = { reviewRequest, result };
        events.push(this.reviewEventFromPair(pairRequest));
      } else {
        const event: ReviewEventObservation = {
          headSha: reviewRequest.headSha,
          requestedAt: reviewRequest.requestedAt,
          completedAt: '',
          outcome: ReviewOutcome.Unavailable,
          requested: true,
          findingCount: 0,
          latencySeconds: 0,
        };
        events.push(event);
      }
    }
    for (const result of results) {
      if (matchedResultKeys.has(this.reviewResultKey(result))) continue;
      const event: ReviewEventObservation = {
        headSha: result.headSha,
        requestedAt: result.completedAt,
        completedAt: result.completedAt,
        outcome: result.outcome,
        requested: false,
        findingCount: result.findingCount,
        latencySeconds: 0,
      };
      events.push(event);
    }
    let findingBatchCount = 0;
    let findingCount = 0;
    for (const event of events) {
      if (event.outcome !== ReviewOutcome.Findings) continue;
      findingBatchCount += 1;
      findingCount += event.findingCount;
    }
    return ok({
      events: events.map(this.reviewEventRecord),
      requestCount: requests.length,
      findingBatchCount,
      findingCount,
    });
  }
  private reviewRequests(
    request: ReviewRequestsRequest,
  ): Result<ReviewRequestObservation[], GitHubEvidenceFailure> {
    const observations: ReviewRequestObservation[] = [];
    for (const comment of request.comments) {
      const cutoffRequest: PropertyRequest = {
        record: comment,
        key: 'created_at',
      };
      const requiredField8 = new GitHubEvidenceField(cutoffRequest).string();
      if (requiredField8.isErr()) return err(requiredField8.error);
      if (requiredField8.value > request.mergedAt) continue;
      if (!new GitHubReviewAuthor(comment).trustedRequester()) continue;
      const bodyRequest: PropertyRequest = { record: comment, key: 'body' };
      const requiredField9 = new GitHubEvidenceField(bodyRequest).string();
      if (requiredField9.isErr()) return err(requiredField9.error);
      const body = requiredField9.value;
      const marker = body.match(/nook-codex-review:([0-9a-f]{7,40})/);
      if (!marker) continue;
      const [defaulted1 = ''] = [marker[1]];
      const headRequest: ResolveHeadShaRequest = {
        candidate: defaulted1,
        knownHeadShas: request.knownHeadShas,
      };
      const headSha = this.resolveHeadSha(headRequest);
      if (headSha.length === 0) continue;
      const createdAtRequest: PropertyRequest = {
        record: comment,
        key: 'created_at',
      };
      const commentIdRequest: PropertyRequest = { record: comment, key: 'id' };
      const requiredField10 = new GitHubEvidenceField(
        commentIdRequest,
      ).number();
      if (requiredField10.isErr()) return err(requiredField10.error);
      const commentId = requiredField10.value;
      const requiredField11 = new GitHubEvidenceField(
        createdAtRequest,
      ).string();
      if (requiredField11.isErr()) return err(requiredField11.error);
      const requestedAt = requiredField11.value;
      const observation: ReviewRequestObservation = {
        commentId,
        headSha,
        requestedAt,
      };
      observations.push(observation);
    }
    return ok(observations);
  }
  private reviewResults(
    request: ReviewResultsRequest,
  ): Result<ReviewResultObservation[], GitHubEvidenceFailure> {
    const results: ReviewResultObservation[] = [];
    for (const review of request.reviews) {
      const reviewLoginRequest: HasLoginRequest = {
        record: review,
        expected: CODEX_LOGIN,
      };
      if (
        !new GitHubReviewAuthor(reviewLoginRequest.record).hasLogin(
          reviewLoginRequest.expected,
        )
      )
        continue;
      const stateRequest: PropertyRequest = { record: review, key: 'state' };
      if (GithubActionEvidenceApi.stringProperty(stateRequest) === 'PENDING')
        continue;
      const cutoffRequest: PropertyRequest = {
        record: review,
        key: 'submitted_at',
      };
      const requiredField12 = new GitHubEvidenceField(cutoffRequest).string();
      if (requiredField12.isErr()) return err(requiredField12.error);
      if (requiredField12.value > request.mergedAt) continue;
      const reviewIdRequest: PropertyRequest = { record: review, key: 'id' };
      const requiredField13 = new GitHubEvidenceField(reviewIdRequest).number();
      if (requiredField13.isErr()) return err(requiredField13.error);
      const reviewId = requiredField13.value;
      let inlineFindingCount = 0;
      for (const comment of request.reviewComments) {
        const commentLoginRequest: HasLoginRequest = {
          record: comment,
          expected: CODEX_LOGIN,
        };
        if (
          !new GitHubReviewAuthor(commentLoginRequest.record).hasLogin(
            commentLoginRequest.expected,
          )
        )
          continue;
        const reviewRequest: PropertyRequest = {
          record: comment,
          key: 'pull_request_review_id',
        };
        const replyRequest: PropertyRequest = {
          record: comment,
          key: 'in_reply_to_id',
        };
        const requiredField14 = new GitHubEvidenceField(reviewRequest).number();
        if (requiredField14.isErr()) return err(requiredField14.error);
        if (
          requiredField14.value === reviewId &&
          GithubActionEvidenceApi.numberProperty(replyRequest) === 0
        )
          inlineFindingCount += 1;
      }
      const bodyRequest: PropertyRequest = { record: review, key: 'body' };
      const bodyFindingCount = ReviewFindingBody.countFindings(
        GithubActionEvidenceApi.stringProperty(bodyRequest),
      );
      const findingCount = inlineFindingCount + bodyFindingCount;
      if (findingCount === 0) continue;
      const commitRequest: PropertyRequest = {
        record: review,
        key: 'commit_id',
      };
      const requiredField15 = new GitHubEvidenceField(commitRequest).string();
      if (requiredField15.isErr()) return err(requiredField15.error);
      const candidate = requiredField15.value;
      const headRequest: ResolveHeadShaRequest = {
        candidate,
        knownHeadShas: request.knownHeadShas,
      };
      const headSha = this.resolveHeadSha(headRequest);
      if (headSha.length === 0) continue;
      const submittedAtRequest: PropertyRequest = {
        record: review,
        key: 'submitted_at',
      };
      const requiredField16 = new GitHubEvidenceField(
        submittedAtRequest,
      ).string();
      if (requiredField16.isErr()) return err(requiredField16.error);
      const observation: ReviewResultObservation = {
        headSha,
        completedAt: requiredField16.value,
        outcome: ReviewOutcome.Findings,
        findingCount,
        requestCommentId: 0,
      };
      results.push(observation);
    }
    for (const comment of request.issueComments) {
      const cutoffRequest: PropertyRequest = {
        record: comment,
        key: 'created_at',
      };
      const requiredField17 = new GitHubEvidenceField(cutoffRequest).string();
      if (requiredField17.isErr()) return err(requiredField17.error);
      if (requiredField17.value > request.mergedAt) continue;
      const commentLoginRequest: HasLoginRequest = {
        record: comment,
        expected: CODEX_LOGIN,
      };
      if (
        !new GitHubReviewAuthor(commentLoginRequest.record).hasLogin(
          commentLoginRequest.expected,
        )
      )
        continue;
      const bodyRequest: PropertyRequest = { record: comment, key: 'body' };
      const requiredField18 = new GitHubEvidenceField(bodyRequest).string();
      if (requiredField18.isErr()) return err(requiredField18.error);
      const body = requiredField18.value;
      if (!body.includes('find any major issues')) continue;
      const match = body.match(/Reviewed commit:\*\* `([0-9a-f]{7,40})/i);
      if (!match) continue;
      const [defaulted2 = ''] = [match[1]];
      const headRequest: ResolveHeadShaRequest = {
        candidate: defaulted2,
        knownHeadShas: request.knownHeadShas,
      };
      const headSha = this.resolveHeadSha(headRequest);
      if (headSha.length === 0) continue;
      const createdAtRequest: PropertyRequest = {
        record: comment,
        key: 'created_at',
      };
      const requiredField19 = new GitHubEvidenceField(
        createdAtRequest,
      ).string();
      if (requiredField19.isErr()) return err(requiredField19.error);
      const observation: ReviewResultObservation = {
        headSha,
        completedAt: requiredField19.value,
        outcome: ReviewOutcome.Clean,
        findingCount: 0,
        requestCommentId: 0,
      };
      results.push(observation);
    }
    for (const reaction of request.reviewReactions) {
      const cutoffRequest: PropertyRequest = {
        record: reaction,
        key: 'created_at',
      };
      const requiredField20 = new GitHubEvidenceField(cutoffRequest).string();
      if (requiredField20.isErr()) return err(requiredField20.error);
      if (requiredField20.value > request.mergedAt) continue;
      const reactionLoginRequest: HasLoginRequest = {
        record: reaction,
        expected: CODEX_LOGIN,
      };
      if (
        !new GitHubReviewAuthor(reactionLoginRequest.record).hasLogin(
          reactionLoginRequest.expected,
        )
      )
        continue;
      const contentRequest: PropertyRequest = {
        record: reaction,
        key: 'content',
      };
      const requiredField21 = new GitHubEvidenceField(contentRequest).string();
      if (requiredField21.isErr()) return err(requiredField21.error);
      if (requiredField21.value !== '+1') continue;
      const commentIdRequest: PropertyRequest = {
        record: reaction,
        key: 'request_comment_id',
      };
      const requiredField22 = new GitHubEvidenceField(
        commentIdRequest,
      ).number();
      if (requiredField22.isErr()) return err(requiredField22.error);
      const commentId = requiredField22.value;
      const reviewRequest = request.requests.find(
        (candidate) => candidate.commentId === commentId,
      );
      if (!reviewRequest) continue;
      if (
        results.some(
          (result) =>
            result.headSha === reviewRequest.headSha &&
            result.completedAt >= reviewRequest.requestedAt,
        )
      ) {
        continue;
      }
      const createdAtRequest: PropertyRequest = {
        record: reaction,
        key: 'created_at',
      };
      const requiredField23 = new GitHubEvidenceField(
        createdAtRequest,
      ).string();
      if (requiredField23.isErr()) return err(requiredField23.error);
      const observation: ReviewResultObservation = {
        headSha: reviewRequest.headSha,
        completedAt: requiredField23.value,
        outcome: ReviewOutcome.Clean,
        findingCount: 0,
        requestCommentId: commentId,
      };
      results.push(observation);
    }
    return ok(results);
  }
  private resolveHeadSha(request: ResolveHeadShaRequest): string {
    // Full SHAs arrive only through trusted request markers or Codex-authored
    // results. Keep them even when a later rebase removes them from PR ancestry.
    if (/^[0-9a-f]{40}$/.test(request.candidate)) {
      return request.candidate;
    }
    const matches = request.knownHeadShas.filter((headSha) =>
      headSha.startsWith(request.candidate),
    );
    const [defaulted3 = ''] = [matches[0]];
    return matches.length === 1 ? defaulted3 : '';
  }
  private reviewEventFromPair(
    request: ReviewEventPairRequest,
  ): ReviewEventObservation {
    const requestedAt = Date.parse(request.reviewRequest.requestedAt);
    const completedAt = Date.parse(request.result.completedAt);
    return {
      headSha: request.reviewRequest.headSha,
      requestedAt: request.reviewRequest.requestedAt,
      completedAt: request.result.completedAt,
      outcome: request.result.outcome,
      requested: true,
      findingCount: request.result.findingCount,
      latencySeconds: Math.max(
        0,
        Math.round((completedAt - requestedAt) / 1000),
      ),
    };
  }
  private reviewResultKey(result: ReviewResultObservation): string {
    return `${result.headSha}:${result.completedAt}:${result.outcome}:${result.requestCommentId}`;
  }
  private reviewEventRecord(event: ReviewEventObservation): UntrustedYamlMap {
    const record = {
      head_sha: event.headSha,
      requested_at: event.requestedAt,
      completed_at: event.completedAt,
      reviewer: 'codex',
      outcome: event.outcome,
      requested: event.requested,
      finding_count: event.findingCount,
      latency_seconds: event.latencySeconds,
    };
    return UntrustedYamlBoundary.seal(record);
  }
}
export class GitHubReviewReactions {
  constructor(private readonly request: CollectReviewReactionPagesRequest) {}
  collect(): Result<UntrustedYamlNode, GitHubEvidenceFailure> {
    const request = this.request;
    const reactions: UntrustedYamlMap[] = [];
    const pageAdmission11 = GithubActionEvidenceApi.flattenApiPages(
      request.issueCommentPages,
    );
    if (pageAdmission11.isErr()) return err(pageAdmission11.error);
    const comments = pageAdmission11.value.filter(
      UntrustedYamlBoundary.isRecord,
    );
    for (const comment of comments) {
      if (!new GitHubReviewAuthor(comment).trustedRequester()) continue;
      const bodyRequest: PropertyRequest = { record: comment, key: 'body' };
      const requiredField4 = new GitHubEvidenceField(bodyRequest).string();
      if (requiredField4.isErr()) return err(requiredField4.error);
      const body = requiredField4.value;
      if (!/nook-codex-review:[0-9a-f]{7,40}/.test(body)) continue;
      const commentIdRequest: PropertyRequest = { record: comment, key: 'id' };
      const requiredField5 = new GitHubEvidenceField(commentIdRequest).number();
      if (requiredField5.isErr()) return err(requiredField5.error);
      const commentId = requiredField5.value;
      const apiRequest: GitHubApiRequest = {
        repoRoot: request.repoRoot,
        endpoint: `repos/{owner}/{repo}/issues/comments/${commentId}/reactions`,
        fields: ['per_page=100'],
      };
      const githubResult10 = GithubActionEvidenceApi.runGitHubApi(apiRequest);
      if (githubResult10.isErr()) return err(githubResult10.error);
      const pageAdmission12 = GithubActionEvidenceApi.flattenApiPages(
        githubResult10.value,
      );
      if (pageAdmission12.isErr()) return err(pageAdmission12.error);
      for (const reaction of pageAdmission12.value) {
        if (!UntrustedYamlBoundary.isRecord(reaction)) {
          return err({
            code: LoomFailureCode.CommandFailed,
            message: 'GitHub reaction must be a mapping',
          });
        }
        const contentRequest: PropertyRequest = {
          record: reaction,
          key: 'content',
        };
        const createdAtRequest: PropertyRequest = {
          record: reaction,
          key: 'created_at',
        };
        const userRequest: UntrustedYamlPropertyArgs = {
          record: reaction,
          key: 'user',
        };
        const user = UntrustedYamlBoundary.property(userRequest);
        if (
          user.presence === UntrustedYamlPropertyPresence.Absent ||
          !UntrustedYamlBoundary.isRecord(user.value)
        ) {
          return err({
            code: LoomFailureCode.CommandFailed,
            message: 'GitHub reaction user must be a mapping',
          });
        }
        const requiredField6 = new GitHubEvidenceField(contentRequest).string();
        if (requiredField6.isErr()) return err(requiredField6.error);
        const requiredField7 = new GitHubEvidenceField(
          createdAtRequest,
        ).string();
        if (requiredField7.isErr()) return err(requiredField7.error);
        const reactionRecord = {
          request_comment_id: commentId,
          content: requiredField6.value,
          created_at: requiredField7.value,
          user: user.value,
        };
        reactions.push(UntrustedYamlBoundary.seal(reactionRecord));
      }
    }
    return ok([reactions]);
  }
}
class GitHubReviewAuthor {
  constructor(private readonly record: UntrustedYamlMap) {}
  hasLogin(expected: string): boolean {
    const request = { record: this.record, expected };
    const userArgs: UntrustedYamlPropertyArgs = {
      record: request.record,
      key: 'user',
    };
    const user = UntrustedYamlBoundary.property(userArgs);
    if (
      user.presence === UntrustedYamlPropertyPresence.Absent ||
      !UntrustedYamlBoundary.isRecord(user.value)
    ) {
      return false;
    }
    const loginRequest: PropertyRequest = { record: user.value, key: 'login' };
    return (
      GithubActionEvidenceApi.stringProperty(loginRequest) === request.expected
    );
  }
  trustedRequester(): boolean {
    const comment = this.record;
    const associationRequest: PropertyRequest = {
      record: comment,
      key: 'author_association',
    };
    if (
      TRUSTED_REVIEW_ASSOCIATIONS.has(
        GithubActionEvidenceApi.stringProperty(associationRequest),
      )
    ) {
      return true;
    }
    const loginRequest: HasLoginRequest = {
      record: comment,
      expected: GITHUB_ACTIONS_LOGIN,
    };
    return this.hasLogin(loginRequest.expected);
  }
}
