import { err, ok, type Result } from 'neverthrow';
import type { GitHubEvidenceFailure } from './agent-stats-github-api.ts';
import {
  UntrustedYamlPropertyPresence,
  type UntrustedYamlMap,
  type UntrustedYamlNode,
  UntrustedYamlBoundary,
} from './guards.ts';
import {
  type ExpandActionAttemptPagesRequest,
  type CollectDispatchedActionAttemptPagesRequest,
  type GitHubApiRequest,
  type GitHubPropertyRequest as PropertyRequest,
  GithubActionEvidenceApi,
} from './agent-stats-github-api.ts';

import type { UntrustedYamlPropertyArgs } from './guards.ts';
import {
  type HeadSupersededRequest,
  type ObsoleteRunSecondsRequest,
  ValidationWorkflowHistory,
} from './agent-stats-github-validation.ts';
import {
  type DeliveryHeadStart,
  DeliveryHeadTimeline,
  LatestTimestamp,
  ReviewedDeliveryHistory,
  EarliestTimestamp,
} from './agent-stats-github-delivery.ts';
import {
  ReviewOutcome,
  ReviewFindingBody,
} from './agent-stats-github-review.ts';
import {
  type ActionObservation,
  type ActionObservationRequest,
  type SourcePrRunRequest,
  type ValidationCycleRecordRequest,
  ActionRunObservation,
  ActionObservationRecord,
  ActionAttemptStart,
  ActionRunIdentity,
  PullRequestActionRun,
  ValidationCycleRecord,
} from './agent-stats-github-actions.ts';

/** Owns the github agent evidence registry and its capability transitions. */
export class GithubAgentEvidence {
  private constructor() {}
  private static readonly CODEX_LOGIN = 'chatgpt-codex-connector[bot]';

  private static readonly GITHUB_ACTIONS_LOGIN = 'github-actions[bot]';

  private static readonly TRUSTED_REVIEW_ASSOCIATIONS = new Set([
    'OWNER',
    'MEMBER',
    'COLLABORATOR',
  ]);

  static collectAgentStatsGitHubEvidence(
    request: AgentStatsGitHubEvidenceRequest,
  ): Result<AgentStatsGitHubEvidence, GitHubEvidenceFailure> {
    const actionsEndpoint = 'repos/{owner}/{repo}/actions/runs';
    const createdRange = `created=${request.startedAt}..${request.mergedAt}`;
    const branchField = `branch=${request.branch}`;
    const actionsApiRequest: GitHubApiRequest = {
      repoRoot: request.repoRoot,
      endpoint: actionsEndpoint,
      fields: [branchField, createdRange, 'per_page=100'],
    };
    const githubResult1 =
      GithubActionEvidenceApi.runGitHubApi(actionsApiRequest);
    if (githubResult1.isErr()) return err(githubResult1.error);
    const actionPages = githubResult1.value;
    const attemptPagesRequest: ExpandActionAttemptPagesRequest = {
      repoRoot: request.repoRoot,
      pages: actionPages,
    };
    const githubResult2 =
      GithubActionEvidenceApi.expandActionAttemptPages(attemptPagesRequest);
    if (githubResult2.isErr()) return err(githubResult2.error);
    const expandedActionPages = githubResult2.value;
    const dispatchedApiRequest: GitHubApiRequest = {
      repoRoot: request.repoRoot,
      endpoint: 'repos/{owner}/{repo}/actions/workflows/e2e-pr.yml/runs',
      fields: [createdRange, 'event=workflow_dispatch', 'per_page=100'],
    };
    const githubResult3 =
      GithubActionEvidenceApi.runGitHubApi(dispatchedApiRequest);
    if (githubResult3.isErr()) return err(githubResult3.error);
    const dispatchedRequest: CollectDispatchedActionAttemptPagesRequest = {
      repoRoot: request.repoRoot,
      pages: githubResult3.value,
      prNumber: request.prNumber,
    };
    const githubResult4 =
      GithubActionEvidenceApi.collectDispatchedActionAttemptPages(
        dispatchedRequest,
      );
    if (githubResult4.isErr()) return err(githubResult4.error);
    const dispatchedActionPages = githubResult4.value;
    const allActionPages: UntrustedYamlNode = [
      ...GithubActionEvidenceApi.flattenApiPages(expandedActionPages),
      ...GithubActionEvidenceApi.flattenApiPages(dispatchedActionPages),
    ];
    const issueCommentsRequest: GitHubApiRequest = {
      repoRoot: request.repoRoot,
      endpoint: `repos/{owner}/{repo}/issues/${request.prNumber}/comments`,
      fields: ['per_page=100'],
    };
    const reviewsRequest: GitHubApiRequest = {
      repoRoot: request.repoRoot,
      endpoint: `repos/{owner}/{repo}/pulls/${request.prNumber}/reviews`,
      fields: ['per_page=100'],
    };
    const reviewCommentsRequest: GitHubApiRequest = {
      repoRoot: request.repoRoot,
      endpoint: `repos/{owner}/{repo}/pulls/${request.prNumber}/comments`,
      fields: ['per_page=100'],
    };
    const commitsRequest: GitHubApiRequest = {
      repoRoot: request.repoRoot,
      endpoint: `repos/{owner}/{repo}/pulls/${request.prNumber}/commits`,
      fields: ['per_page=100'],
    };
    const githubResult5 = GithubActionEvidenceApi.runGitHubApi(commitsRequest);
    if (githubResult5.isErr()) return err(githubResult5.error);
    const commitPages = githubResult5.value;
    const knownHeadShas: string[] = [];
    for (const commit of GithubActionEvidenceApi.flattenApiPages(commitPages)) {
      if (!UntrustedYamlBoundary.isRecord(commit)) continue;
      const propertyRequest: PropertyRequest = { record: commit, key: 'sha' };
      const headSha =
        GithubActionEvidenceApi.requiredStringProperty(propertyRequest);
      knownHeadShas.push(headSha);
    }
    if (!knownHeadShas.includes(request.finalHeadSha)) {
      knownHeadShas.push(request.finalHeadSha);
    }
    const githubResult6 =
      GithubActionEvidenceApi.runGitHubApi(issueCommentsRequest);
    if (githubResult6.isErr()) return err(githubResult6.error);
    const issueCommentPages = githubResult6.value;
    const reactionsRequest: CollectReviewReactionPagesRequest = {
      repoRoot: request.repoRoot,
      issueCommentPages,
    };
    const githubResult7 = GithubActionEvidenceApi.runGitHubApi(reviewsRequest);
    if (githubResult7.isErr()) return err(githubResult7.error);
    const githubResult8 = GithubActionEvidenceApi.runGitHubApi(
      reviewCommentsRequest,
    );
    if (githubResult8.isErr()) return err(githubResult8.error);
    const githubResult9 =
      GithubAgentEvidence.collectReviewReactionPages(reactionsRequest);
    if (githubResult9.isErr()) return err(githubResult9.error);
    const reviewRequest: BuildReviewEvidenceRequest = {
      issueCommentPages,
      reviewPages: githubResult7.value,
      reviewCommentPages: githubResult8.value,
      reviewReactionPages: githubResult9.value,
      knownHeadShas,
      mergedAt: request.mergedAt,
    };
    const reviews = GithubAgentEvidence.buildReviewEvidence(reviewRequest);
    const actionsRequest: BuildActionsEvidenceRequest = {
      pages: allActionPages,
      prNumber: request.prNumber,
      finalHeadSha: request.finalHeadSha,
      mergedAt: request.mergedAt,
      reviewEvents: reviews.events,
      deliveryHeadOrder: knownHeadShas,
    };
    const actions = GithubAgentEvidence.buildActionsEvidence(actionsRequest);
    const deliveryHeadsRequest = {
      actionHeads: actions.heads,
      reviewEvents: reviews.events,
      finalHeadSha: request.finalHeadSha,
    };
    const deliveryHeads = ReviewedDeliveryHistory.merge(deliveryHeadsRequest);

    return ok({
      githubActionsRuns: actions.runs,
      deliveryHeads,
      reviewEvents: reviews.events,
      validationCycles: actions.validationCycles,
      obsoleteValidationSeconds: actions.obsoleteValidationSeconds,
      obsoleteValidationCount: actions.obsoleteValidationCount,
      cancelledValidationSeconds: actions.cancelledValidationSeconds,
      cancelledValidationCount: actions.cancelledValidationCount,
      reviewRequestCount: reviews.requestCount,
      reviewFindingBatchCount: reviews.findingBatchCount,
      reviewFindingCount: reviews.findingCount,
    });
  }

  static buildActionsEvidence(
    request: BuildActionsEvidenceRequest,
  ): ActionsEvidence {
    const pages = GithubActionEvidenceApi.flattenApiPages(request.pages);
    const rawRuns: UntrustedYamlMap[] = [];
    let expectedRunCount = 0;
    for (const page of pages) {
      if (!UntrustedYamlBoundary.isRecord(page)) continue;
      const totalCountRequest: PropertyRequest = {
        record: page,
        key: 'total_count',
      };
      const totalCount =
        GithubActionEvidenceApi.requiredNumberProperty(totalCountRequest);
      expectedRunCount = Math.max(expectedRunCount, totalCount);
      const workflowRunsRequest: PropertyRequest = {
        record: page,
        key: 'workflow_runs',
      };
      const workflowRuns =
        GithubActionEvidenceApi.requiredArrayProperty(workflowRunsRequest);
      rawRuns.push(...workflowRuns.filter(UntrustedYamlBoundary.isRecord));
    }
    const collectedRunIds = new Set(rawRuns.map(ActionRunIdentity.read));
    if (collectedRunIds.size < expectedRunCount) {
      GithubActionEvidenceApi.failGitHubCollection(
        `GitHub Actions history is incomplete: expected ${expectedRunCount}, collected ${collectedRunIds.size}`,
      );
    }
    const deduplicatedRuns = new Map<string, ActionObservation>();
    for (const rawRun of rawRuns) {
      const associationRequest: SourcePrRunRequest = {
        run: rawRun,
        prNumber: request.prNumber,
      };
      if (!PullRequestActionRun.matches(associationRequest)) continue;
      if (ActionAttemptStart.read(rawRun) > request.mergedAt) continue;
      const observationRequest: ActionObservationRequest = {
        record: rawRun,
        prNumber: request.prNumber,
        observedThrough: request.mergedAt,
      };
      const observation = ActionRunObservation.create(observationRequest);
      const observationKey = `${observation.runId}:${observation.runAttempt}`;
      deduplicatedRuns.set(observationKey, observation);
    }
    const observations = [...deduplicatedRuns.values()];
    const attributedObservations = observations.filter(
      (observation) => observation.sourceAttributed,
    );
    const headStartsRequest = {
      actions: attributedObservations,
      reviewEvents: request.reviewEvents,
      finalHeadSha: request.finalHeadSha,
      deliveryHeadOrder: request.deliveryHeadOrder,
    };
    const headStarts = DeliveryHeadTimeline.starts(headStartsRequest);
    const headShas = headStarts.map((head) => head.headSha);
    if (!headShas.includes(request.finalHeadSha))
      headShas.push(request.finalHeadSha);
    const headObservations = headShas.map((headSha) => {
      const runs = attributedObservations.filter(
        (run) => run.headSha === headSha,
      );
      const headRequest: BuildHeadObservationRequest = {
        headSha,
        runs,
        finalHeadSha: request.finalHeadSha,
        headStarts,
      };
      return GithubAgentEvidence.buildHeadObservation(headRequest);
    });
    const runs = observations.map(ActionObservationRecord.encode);
    const heads = headObservations.map(
      GithubAgentEvidence.headObservationRecord,
    );
    const validationObservations = observations.filter(
      (run) =>
        ValidationWorkflowHistory.isValidationWorkflow(run.workflow) &&
        run.validationRequested &&
        run.trigger === 'pull_request',
    );
    const validationCycles = validationObservations.map((run) => {
      const supersededRequest: HeadSupersededRequest = {
        headSha: run.headSha,
        headStarts,
      };
      const supersededAt =
        ValidationWorkflowHistory.headSupersededAt(supersededRequest);
      const obsoleteRequest: ObsoleteRunSecondsRequest = { run, supersededAt };
      const obsoleteSeconds =
        ValidationWorkflowHistory.obsoleteRunSeconds(obsoleteRequest);
      const cycleRequest: ValidationCycleRecordRequest = {
        run,
        obsoleteSeconds,
      };
      return ValidationCycleRecord.encode(cycleRequest);
    });
    let obsoleteValidationSeconds = 0;
    let obsoleteValidationCount = 0;
    let cancelledValidationSeconds = 0;
    let cancelledValidationCount = 0;
    for (const cycle of validationCycles) {
      const obsoleteRequest: PropertyRequest = {
        record: cycle,
        key: 'obsolete_seconds',
      };
      const obsoleteSeconds =
        GithubActionEvidenceApi.numberProperty(obsoleteRequest);
      obsoleteValidationSeconds += obsoleteSeconds;
      if (obsoleteSeconds > 0) obsoleteValidationCount += 1;
      const conclusionRequest: PropertyRequest = {
        record: cycle,
        key: 'conclusion',
      };
      if (
        GithubActionEvidenceApi.stringProperty(conclusionRequest) ===
        'cancelled'
      ) {
        cancelledValidationCount += 1;
        const durationRequest: PropertyRequest = {
          record: cycle,
          key: 'duration_seconds',
        };
        cancelledValidationSeconds +=
          GithubActionEvidenceApi.numberProperty(durationRequest);
      }
    }
    return {
      runs,
      heads,
      validationCycles,
      obsoleteValidationSeconds,
      obsoleteValidationCount,
      cancelledValidationSeconds,
      cancelledValidationCount,
    };
  }

  static buildReviewEvidence(
    request: BuildReviewEvidenceRequest,
  ): ReviewEvidence {
    const issueComments = GithubActionEvidenceApi.flattenApiPages(
      request.issueCommentPages,
    ).filter(UntrustedYamlBoundary.isRecord);
    const reviews = GithubActionEvidenceApi.flattenApiPages(
      request.reviewPages,
    ).filter(UntrustedYamlBoundary.isRecord);
    const reviewComments = GithubActionEvidenceApi.flattenApiPages(
      request.reviewCommentPages,
    ).filter(UntrustedYamlBoundary.isRecord);
    const reviewReactions = GithubActionEvidenceApi.flattenApiPages(
      request.reviewReactionPages,
    ).filter(UntrustedYamlBoundary.isRecord);
    const requestsRequest: ReviewRequestsRequest = {
      comments: issueComments,
      knownHeadShas: request.knownHeadShas,
      mergedAt: request.mergedAt,
    };
    const requests = GithubAgentEvidence.reviewRequests(requestsRequest);
    const resultsRequest: ReviewResultsRequest = {
      issueComments,
      reviews,
      reviewComments,
      reviewReactions,
      requests,
      knownHeadShas: request.knownHeadShas,
      mergedAt: request.mergedAt,
    };
    const results = GithubAgentEvidence.reviewResults(resultsRequest);
    const events: ReviewEventObservation[] = [];
    const matchedResultKeys = new Set<string>();
    for (const reviewRequest of requests) {
      const result = results.find(
        (candidate) =>
          candidate.headSha === reviewRequest.headSha &&
          candidate.completedAt >= reviewRequest.requestedAt &&
          (candidate.requestCommentId === 0 ||
            candidate.requestCommentId === reviewRequest.commentId) &&
          !matchedResultKeys.has(
            GithubAgentEvidence.reviewResultKey(candidate),
          ),
      );
      if (result) {
        matchedResultKeys.add(GithubAgentEvidence.reviewResultKey(result));
        const pairRequest: ReviewEventPairRequest = { reviewRequest, result };
        events.push(GithubAgentEvidence.reviewEventFromPair(pairRequest));
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
      if (matchedResultKeys.has(GithubAgentEvidence.reviewResultKey(result)))
        continue;
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
    return {
      events: events.map(GithubAgentEvidence.reviewEventRecord),
      requestCount: requests.length,
      findingBatchCount,
      findingCount,
    };
  }

  private static collectReviewReactionPages(
    request: CollectReviewReactionPagesRequest,
  ): Result<UntrustedYamlNode, GitHubEvidenceFailure> {
    const reactions: UntrustedYamlMap[] = [];
    const comments = GithubActionEvidenceApi.flattenApiPages(
      request.issueCommentPages,
    ).filter(UntrustedYamlBoundary.isRecord);
    for (const comment of comments) {
      if (!GithubAgentEvidence.isTrustedReviewRequester(comment)) continue;
      const bodyRequest: PropertyRequest = { record: comment, key: 'body' };
      const body = GithubActionEvidenceApi.requiredStringProperty(bodyRequest);
      if (!/nook-codex-review:[0-9a-f]{7,40}/.test(body)) continue;
      const commentIdRequest: PropertyRequest = { record: comment, key: 'id' };
      const commentId =
        GithubActionEvidenceApi.requiredNumberProperty(commentIdRequest);
      const apiRequest: GitHubApiRequest = {
        repoRoot: request.repoRoot,
        endpoint: `repos/{owner}/{repo}/issues/comments/${commentId}/reactions`,
        fields: ['per_page=100'],
      };
      const githubResult10 = GithubActionEvidenceApi.runGitHubApi(apiRequest);
      if (githubResult10.isErr()) return err(githubResult10.error);
      for (const reaction of GithubActionEvidenceApi.flattenApiPages(
        githubResult10.value,
      )) {
        if (!UntrustedYamlBoundary.isRecord(reaction)) {
          GithubActionEvidenceApi.failGitHubCollection(
            'GitHub reaction must be a mapping',
          );
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
          GithubActionEvidenceApi.failGitHubCollection(
            'GitHub reaction user must be a mapping',
          );
        }
        const reactionRecord = {
          request_comment_id: commentId,
          content:
            GithubActionEvidenceApi.requiredStringProperty(contentRequest),
          created_at:
            GithubActionEvidenceApi.requiredStringProperty(createdAtRequest),
          user: user.value,
        };
        reactions.push(UntrustedYamlBoundary.seal(reactionRecord));
      }
    }
    return ok([reactions]);
  }

  private static buildHeadObservation(
    request: BuildHeadObservationRequest,
  ): HeadObservation {
    const timestamps = request.runs.flatMap((run) => [
      run.startedAt,
      run.finishedAt,
    ]);
    const deliveryStart = request.headStarts.find(
      (head) => head.headSha === request.headSha,
    );
    if (deliveryStart) timestamps.push(deliveryStart.observedAt);
    const timestampRequest = { values: timestamps };
    const firstObservedAt = EarliestTimestamp.select(timestampRequest);
    const lastObservedAt = LatestTimestamp.select(timestampRequest);
    const supersededRequest: HeadSupersededRequest = {
      headSha: request.headSha,
      headStarts: request.headStarts,
    };
    const supersededAt =
      ValidationWorkflowHistory.headSupersededAt(supersededRequest);
    let actionSeconds = 0;
    let obsoleteActionSeconds = 0;
    for (const run of request.runs) {
      actionSeconds += run.durationSeconds;
      const obsoleteRequest: ObsoleteRunSecondsRequest = { run, supersededAt };
      obsoleteActionSeconds +=
        ValidationWorkflowHistory.obsoleteRunSeconds(obsoleteRequest);
    }
    return {
      headSha: request.headSha,
      firstObservedAt,
      lastObservedAt,
      final: request.headSha === request.finalHeadSha,
      actionRunCount: request.runs.length,
      actionSeconds,
      obsoleteActionSeconds,
    };
  }

  private static reviewRequests(
    request: ReviewRequestsRequest,
  ): ReviewRequestObservation[] {
    const observations: ReviewRequestObservation[] = [];
    for (const comment of request.comments) {
      const cutoffRequest: PropertyRequest = {
        record: comment,
        key: 'created_at',
      };
      if (
        GithubActionEvidenceApi.requiredStringProperty(cutoffRequest) >
        request.mergedAt
      )
        continue;
      if (!GithubAgentEvidence.isTrustedReviewRequester(comment)) continue;
      const bodyRequest: PropertyRequest = { record: comment, key: 'body' };
      const body = GithubActionEvidenceApi.requiredStringProperty(bodyRequest);
      const marker = body.match(/nook-codex-review:([0-9a-f]{7,40})/);
      if (!marker) continue;
      const [defaulted1 = ''] = [marker[1]];
      const headRequest: ResolveHeadShaRequest = {
        candidate: defaulted1,
        knownHeadShas: request.knownHeadShas,
      };
      const headSha = GithubAgentEvidence.resolveHeadSha(headRequest);
      if (headSha.length === 0) continue;
      const createdAtRequest: PropertyRequest = {
        record: comment,
        key: 'created_at',
      };
      const commentIdRequest: PropertyRequest = { record: comment, key: 'id' };
      const commentId =
        GithubActionEvidenceApi.requiredNumberProperty(commentIdRequest);
      const requestedAt =
        GithubActionEvidenceApi.requiredStringProperty(createdAtRequest);
      const observation: ReviewRequestObservation = {
        commentId,
        headSha,
        requestedAt,
      };
      observations.push(observation);
    }
    return observations;
  }

  private static reviewResults(
    request: ReviewResultsRequest,
  ): ReviewResultObservation[] {
    const results: ReviewResultObservation[] = [];
    for (const review of request.reviews) {
      const reviewLoginRequest: HasLoginRequest = {
        record: review,
        expected: GithubAgentEvidence.CODEX_LOGIN,
      };
      if (!GithubAgentEvidence.hasLogin(reviewLoginRequest)) continue;
      const stateRequest: PropertyRequest = { record: review, key: 'state' };
      if (GithubActionEvidenceApi.stringProperty(stateRequest) === 'PENDING')
        continue;
      const cutoffRequest: PropertyRequest = {
        record: review,
        key: 'submitted_at',
      };
      if (
        GithubActionEvidenceApi.requiredStringProperty(cutoffRequest) >
        request.mergedAt
      )
        continue;
      const reviewIdRequest: PropertyRequest = { record: review, key: 'id' };
      const reviewId =
        GithubActionEvidenceApi.requiredNumberProperty(reviewIdRequest);
      const inlineFindingCount = request.reviewComments.filter((comment) => {
        const commentLoginRequest: HasLoginRequest = {
          record: comment,
          expected: GithubAgentEvidence.CODEX_LOGIN,
        };
        const reviewRequest: PropertyRequest = {
          record: comment,
          key: 'pull_request_review_id',
        };
        const replyRequest: PropertyRequest = {
          record: comment,
          key: 'in_reply_to_id',
        };
        return (
          GithubAgentEvidence.hasLogin(commentLoginRequest) &&
          GithubActionEvidenceApi.requiredNumberProperty(reviewRequest) ===
            reviewId &&
          GithubActionEvidenceApi.numberProperty(replyRequest) === 0
        );
      }).length;
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
      const candidate =
        GithubActionEvidenceApi.requiredStringProperty(commitRequest);
      const headRequest: ResolveHeadShaRequest = {
        candidate,
        knownHeadShas: request.knownHeadShas,
      };
      const headSha = GithubAgentEvidence.resolveHeadSha(headRequest);
      if (headSha.length === 0) continue;
      const submittedAtRequest: PropertyRequest = {
        record: review,
        key: 'submitted_at',
      };
      const observation: ReviewResultObservation = {
        headSha,
        completedAt:
          GithubActionEvidenceApi.requiredStringProperty(submittedAtRequest),
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
      if (
        GithubActionEvidenceApi.requiredStringProperty(cutoffRequest) >
        request.mergedAt
      )
        continue;
      const commentLoginRequest: HasLoginRequest = {
        record: comment,
        expected: GithubAgentEvidence.CODEX_LOGIN,
      };
      if (!GithubAgentEvidence.hasLogin(commentLoginRequest)) continue;
      const bodyRequest: PropertyRequest = { record: comment, key: 'body' };
      const body = GithubActionEvidenceApi.requiredStringProperty(bodyRequest);
      if (!body.includes('find any major issues')) continue;
      const match = body.match(/Reviewed commit:\*\* `([0-9a-f]{7,40})/i);
      if (!match) continue;
      const [defaulted2 = ''] = [match[1]];
      const headRequest: ResolveHeadShaRequest = {
        candidate: defaulted2,
        knownHeadShas: request.knownHeadShas,
      };
      const headSha = GithubAgentEvidence.resolveHeadSha(headRequest);
      if (headSha.length === 0) continue;
      const createdAtRequest: PropertyRequest = {
        record: comment,
        key: 'created_at',
      };
      const observation: ReviewResultObservation = {
        headSha,
        completedAt:
          GithubActionEvidenceApi.requiredStringProperty(createdAtRequest),
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
      if (
        GithubActionEvidenceApi.requiredStringProperty(cutoffRequest) >
        request.mergedAt
      )
        continue;
      const reactionLoginRequest: HasLoginRequest = {
        record: reaction,
        expected: GithubAgentEvidence.CODEX_LOGIN,
      };
      if (!GithubAgentEvidence.hasLogin(reactionLoginRequest)) continue;
      const contentRequest: PropertyRequest = {
        record: reaction,
        key: 'content',
      };
      if (
        GithubActionEvidenceApi.requiredStringProperty(contentRequest) !== '+1'
      )
        continue;
      const commentIdRequest: PropertyRequest = {
        record: reaction,
        key: 'request_comment_id',
      };
      const commentId =
        GithubActionEvidenceApi.requiredNumberProperty(commentIdRequest);
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
      const observation: ReviewResultObservation = {
        headSha: reviewRequest.headSha,
        completedAt:
          GithubActionEvidenceApi.requiredStringProperty(createdAtRequest),
        outcome: ReviewOutcome.Clean,
        findingCount: 0,
        requestCommentId: commentId,
      };
      results.push(observation);
    }
    return results;
  }

  private static resolveHeadSha(request: ResolveHeadShaRequest): string {
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

  private static reviewEventFromPair(
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

  private static reviewResultKey(result: ReviewResultObservation): string {
    return `${result.headSha}:${result.completedAt}:${result.outcome}:${result.requestCommentId}`;
  }

  private static headObservationRecord(
    observation: HeadObservation,
  ): UntrustedYamlMap {
    const record = {
      head_sha: observation.headSha,
      first_observed_at: observation.firstObservedAt,
      last_observed_at: observation.lastObservedAt,
      final: observation.final,
      action_run_count: observation.actionRunCount,
      action_seconds: observation.actionSeconds,
      obsolete_action_seconds: observation.obsoleteActionSeconds,
    };
    return UntrustedYamlBoundary.seal(record);
  }

  private static reviewEventRecord(
    event: ReviewEventObservation,
  ): UntrustedYamlMap {
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

  private static hasLogin(request: HasLoginRequest): boolean {
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

  private static isTrustedReviewRequester(comment: UntrustedYamlMap): boolean {
    const associationRequest: PropertyRequest = {
      record: comment,
      key: 'author_association',
    };
    if (
      GithubAgentEvidence.TRUSTED_REVIEW_ASSOCIATIONS.has(
        GithubActionEvidenceApi.stringProperty(associationRequest),
      )
    ) {
      return true;
    }
    const loginRequest: HasLoginRequest = {
      record: comment,
      expected: GithubAgentEvidence.GITHUB_ACTIONS_LOGIN,
    };
    return GithubAgentEvidence.hasLogin(loginRequest);
  }
}

export type AgentStatsGitHubEvidenceRequest = {
  readonly repoRoot: string;
  readonly prNumber: number;
  readonly branch: string;
  readonly openedAt: string;
  readonly startedAt: string;
  readonly mergedAt: string;
  readonly finalHeadSha: string;
};

export type AgentStatsGitHubEvidence = {
  readonly githubActionsRuns: UntrustedYamlMap[];
  readonly deliveryHeads: UntrustedYamlMap[];
  readonly reviewEvents: UntrustedYamlMap[];
  readonly validationCycles: UntrustedYamlMap[];
  readonly obsoleteValidationSeconds: number;
  readonly obsoleteValidationCount: number;
  readonly cancelledValidationSeconds: number;
  readonly cancelledValidationCount: number;
  readonly reviewRequestCount: number;
  readonly reviewFindingBatchCount: number;
  readonly reviewFindingCount: number;
};

export type BuildActionsEvidenceRequest = {
  readonly pages: UntrustedYamlNode;
  readonly prNumber: number;
  readonly finalHeadSha: string;
  readonly mergedAt: string;
  readonly reviewEvents: readonly UntrustedYamlMap[];
  readonly deliveryHeadOrder: readonly string[];
};

export type BuildReviewEvidenceRequest = {
  readonly issueCommentPages: UntrustedYamlNode;
  readonly reviewPages: UntrustedYamlNode;
  readonly reviewCommentPages: UntrustedYamlNode;
  readonly reviewReactionPages: UntrustedYamlNode;
  readonly knownHeadShas: readonly string[];
  readonly mergedAt: string;
};

type ActionsEvidence = {
  readonly runs: UntrustedYamlMap[];
  readonly heads: UntrustedYamlMap[];
  readonly validationCycles: UntrustedYamlMap[];
  readonly obsoleteValidationSeconds: number;
  readonly obsoleteValidationCount: number;
  readonly cancelledValidationSeconds: number;
  readonly cancelledValidationCount: number;
};

type HeadObservation = {
  readonly headSha: string;
  readonly firstObservedAt: string;
  readonly lastObservedAt: string;
  readonly final: boolean;
  readonly actionRunCount: number;
  readonly actionSeconds: number;
  readonly obsoleteActionSeconds: number;
};

type ReviewRequestObservation = {
  readonly commentId: number;
  readonly headSha: string;
  readonly requestedAt: string;
};

type ReviewResultObservation = {
  readonly headSha: string;
  readonly completedAt: string;
  readonly outcome: ReviewOutcome;
  readonly findingCount: number;
  readonly requestCommentId: number;
};

type ReviewEventObservation = {
  readonly headSha: string;
  readonly requestedAt: string;
  readonly completedAt: string;
  readonly outcome: ReviewOutcome;
  readonly requested: boolean;
  readonly findingCount: number;
  readonly latencySeconds: number;
};

type ReviewEvidence = {
  readonly events: UntrustedYamlMap[];
  readonly requestCount: number;
  readonly findingBatchCount: number;
  readonly findingCount: number;
};

type CollectReviewReactionPagesRequest = {
  readonly repoRoot: string;
  readonly issueCommentPages: UntrustedYamlNode;
};

type BuildHeadObservationRequest = {
  readonly headSha: string;
  readonly runs: readonly ActionObservation[];
  readonly finalHeadSha: string;
  readonly headStarts: readonly DeliveryHeadStart[];
};

type ReviewRequestsRequest = {
  readonly comments: readonly UntrustedYamlMap[];
  readonly knownHeadShas: readonly string[];
  readonly mergedAt: string;
};

type ReviewResultsRequest = {
  readonly issueComments: readonly UntrustedYamlMap[];
  readonly reviews: readonly UntrustedYamlMap[];
  readonly reviewComments: readonly UntrustedYamlMap[];
  readonly reviewReactions: readonly UntrustedYamlMap[];
  readonly requests: readonly ReviewRequestObservation[];
  readonly knownHeadShas: readonly string[];
  readonly mergedAt: string;
};

type ResolveHeadShaRequest = {
  readonly candidate: string;
  readonly knownHeadShas: readonly string[];
};

type ReviewEventPairRequest = {
  readonly reviewRequest: ReviewRequestObservation;
  readonly result: ReviewResultObservation;
};

type HasLoginRequest = {
  readonly record: UntrustedYamlMap;
  readonly expected: string;
};
