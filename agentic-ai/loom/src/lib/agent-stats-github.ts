import {
  UntrustedYamlPropertyPresence,
  isRecord,
  sealUntrustedYamlMap,
  untrustedYamlProperty,
  type UntrustedYamlMap,
  type UntrustedYamlNode,
} from './guards.ts';
import {
  expandActionAttemptPages,
  failGitHubCollection,
  flattenApiPages,
  numberProperty,
  requiredArrayProperty,
  requiredNumberProperty,
  requiredStringProperty,
  runGitHubApi,
  stringProperty,
  type ExpandActionAttemptPagesRequest,
  type GitHubApiRequest,
  type GitHubPropertyRequest as PropertyRequest,
} from './agent-stats-github-api.ts';

import type { UntrustedYamlPropertyArgs } from './guards.ts';
import { isValidationWorkflow } from './agent-stats-github-validation.ts';
import {
  maximumTimestamp,
  mergeReviewedDeliveryHeads,
  minimumTimestamp,
} from './agent-stats-github-delivery.ts';
import { substantiveReviewBodyFindingCount } from './agent-stats-github-review.ts';

const CODEX_LOGIN = 'chatgpt-codex-connector[bot]';
const TRUSTED_REVIEW_ASSOCIATIONS = new Set([
  'OWNER',
  'MEMBER',
  'COLLABORATOR',
]);

export enum ReviewOutcome {
  Findings = 'findings',
  Clean = 'clean',
  Unavailable = 'unavailable',
}

export type AgentStatsGitHubEvidenceRequest = {
  readonly repoRoot: string;
  readonly prNumber: number;
  readonly branch: string;
  readonly openedAt: string;
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
};

export type BuildReviewEvidenceRequest = {
  readonly issueCommentPages: UntrustedYamlNode;
  readonly reviewPages: UntrustedYamlNode;
  readonly reviewCommentPages: UntrustedYamlNode;
  readonly reviewReactionPages: UntrustedYamlNode;
  readonly knownHeadShas: readonly string[];
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

type ActionObservation = {
  readonly workflow: string;
  readonly runId: number;
  readonly runAttempt: number;
  readonly headSha: string;
  readonly trigger: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationSeconds: number;
  readonly conclusion: string;
  readonly sourcePr: number;
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

export function collectAgentStatsGitHubEvidence(
  request: AgentStatsGitHubEvidenceRequest,
): AgentStatsGitHubEvidence {
  const actionsEndpoint = 'repos/{owner}/{repo}/actions/runs';
  const createdRange = `created=${request.openedAt}..${request.mergedAt}`;
  const branchField = `branch=${request.branch}`;
  const actionsApiRequest: GitHubApiRequest = {
    repoRoot: request.repoRoot,
    endpoint: actionsEndpoint,
    fields: [branchField, createdRange, 'per_page=100'],
  };
  const actionPages = runGitHubApi(actionsApiRequest);
  const attemptPagesRequest: ExpandActionAttemptPagesRequest = {
    repoRoot: request.repoRoot,
    pages: actionPages,
  };
  const expandedActionPages = expandActionAttemptPages(attemptPagesRequest);
  const actionsRequest: BuildActionsEvidenceRequest = {
    pages: expandedActionPages,
    prNumber: request.prNumber,
    finalHeadSha: request.finalHeadSha,
    mergedAt: request.mergedAt,
  };
  const actions = buildActionsEvidence(actionsRequest);

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
  const commitPages = runGitHubApi(commitsRequest);
  const knownHeadShas = flattenApiPages(commitPages)
    .filter(isRecord)
    .map((commit) => {
      const propertyRequest: PropertyRequest = { record: commit, key: 'sha' };
      return requiredStringProperty(propertyRequest);
    });
  for (const headSha of actions.heads
    .map((head) => {
      const propertyRequest: PropertyRequest = {
        record: head,
        key: 'head_sha',
      };
      return stringProperty(propertyRequest);
    })
    .filter((headSha) => headSha.length > 0)) {
    if (!knownHeadShas.includes(headSha)) knownHeadShas.push(headSha);
  }
  if (!knownHeadShas.includes(request.finalHeadSha)) {
    knownHeadShas.push(request.finalHeadSha);
  }
  const issueCommentPages = runGitHubApi(issueCommentsRequest);
  const reactionsRequest: CollectReviewReactionPagesRequest = {
    repoRoot: request.repoRoot,
    issueCommentPages,
  };
  const reviewRequest: BuildReviewEvidenceRequest = {
    issueCommentPages,
    reviewPages: runGitHubApi(reviewsRequest),
    reviewCommentPages: runGitHubApi(reviewCommentsRequest),
    reviewReactionPages: collectReviewReactionPages(reactionsRequest),
    knownHeadShas,
  };
  const reviews = buildReviewEvidence(reviewRequest);
  const deliveryHeadsRequest = {
    actionHeads: actions.heads,
    reviewEvents: reviews.events,
    finalHeadSha: request.finalHeadSha,
  };
  const deliveryHeads = mergeReviewedDeliveryHeads(deliveryHeadsRequest);

  return {
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
  };
}

export function buildActionsEvidence(
  request: BuildActionsEvidenceRequest,
): ActionsEvidence {
  const pages = flattenApiPages(request.pages);
  const rawRuns: UntrustedYamlMap[] = [];
  let expectedRunCount = 0;
  for (const page of pages) {
    if (!isRecord(page)) continue;
    const totalCountRequest: PropertyRequest = {
      record: page,
      key: 'total_count',
    };
    const totalCount = requiredNumberProperty(totalCountRequest);
    expectedRunCount = Math.max(expectedRunCount, totalCount);
    const workflowRunsRequest: PropertyRequest = {
      record: page,
      key: 'workflow_runs',
    };
    const workflowRuns = requiredArrayProperty(workflowRunsRequest);
    rawRuns.push(...workflowRuns.filter(isRecord));
  }
  const collectedRunIds = new Set(rawRuns.map(actionRunId));
  if (collectedRunIds.size < expectedRunCount) {
    failGitHubCollection(
      `GitHub Actions history is incomplete: expected ${expectedRunCount}, collected ${collectedRunIds.size}`,
    );
  }
  const deduplicatedRuns = new Map<string, ActionObservation>();
  for (const rawRun of rawRuns) {
    const associationRequest: SourcePrRunRequest = {
      run: rawRun,
      prNumber: request.prNumber,
    };
    if (!isSourcePrRun(associationRequest)) continue;
    const startedRequest: PropertyRequest = {
      record: rawRun,
      key: 'run_started_at',
    };
    if (requiredStringProperty(startedRequest) > request.mergedAt) continue;
    const observationRequest: ActionObservationRequest = {
      record: rawRun,
      prNumber: request.prNumber,
    };
    const observation = actionObservation(observationRequest);
    const observationKey = `${observation.runId}:${observation.runAttempt}`;
    deduplicatedRuns.set(observationKey, observation);
  }
  const observations = [...deduplicatedRuns.values()];
  const observationTimes = observations.map((run) => run.startedAt).sort();
  const headShas: string[] = [];
  for (const observationTime of observationTimes) {
    const observedAtTime = observations.filter(
      (run) => run.startedAt === observationTime,
    );
    for (const observed of observedAtTime) {
      if (!headShas.includes(observed.headSha)) headShas.push(observed.headSha);
    }
  }
  if (!headShas.includes(request.finalHeadSha))
    headShas.push(request.finalHeadSha);
  const headObservations = headShas.map((headSha) => {
    const runs = observations.filter((run) => run.headSha === headSha);
    const headRequest: BuildHeadObservationRequest = {
      headSha,
      runs,
      allRuns: observations,
      finalHeadSha: request.finalHeadSha,
      orderedHeadShas: headShas,
    };
    return buildHeadObservation(headRequest);
  });
  const runs = observations.map(actionObservationRecord);
  const heads = headObservations.map(headObservationRecord);
  const validationObservations = observations.filter((run) =>
    isValidationWorkflow(run.workflow),
  );
  const validationCycles = validationObservations.map((run) => {
    const supersededRequest: HeadSupersededRequest = {
      headSha: run.headSha,
      allRuns: observations,
      orderedHeadShas: headShas,
    };
    const supersededAt = headSupersededAt(supersededRequest);
    const obsoleteRequest: ObsoleteRunSecondsRequest = { run, supersededAt };
    const obsoleteSeconds = obsoleteRunSeconds(obsoleteRequest);
    const cycleRequest: ValidationCycleRecordRequest = { run, obsoleteSeconds };
    return validationCycleRecord(cycleRequest);
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
    const obsoleteSeconds = numberProperty(obsoleteRequest);
    obsoleteValidationSeconds += obsoleteSeconds;
    if (obsoleteSeconds > 0) obsoleteValidationCount += 1;
    const conclusionRequest: PropertyRequest = {
      record: cycle,
      key: 'conclusion',
    };
    if (stringProperty(conclusionRequest) === 'cancelled') {
      cancelledValidationCount += 1;
      const durationRequest: PropertyRequest = {
        record: cycle,
        key: 'duration_seconds',
      };
      cancelledValidationSeconds += numberProperty(durationRequest);
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

export function buildReviewEvidence(
  request: BuildReviewEvidenceRequest,
): ReviewEvidence {
  const issueComments = flattenApiPages(request.issueCommentPages).filter(
    isRecord,
  );
  const reviews = flattenApiPages(request.reviewPages).filter(isRecord);
  const reviewComments = flattenApiPages(request.reviewCommentPages).filter(
    isRecord,
  );
  const reviewReactions = flattenApiPages(request.reviewReactionPages).filter(
    isRecord,
  );
  const requestsRequest: ReviewRequestsRequest = {
    comments: issueComments,
    knownHeadShas: request.knownHeadShas,
  };
  const requests = reviewRequests(requestsRequest);
  const resultsRequest: ReviewResultsRequest = {
    issueComments,
    reviews,
    reviewComments,
    reviewReactions,
    requests,
    knownHeadShas: request.knownHeadShas,
  };
  const results = reviewResults(resultsRequest);
  const events: ReviewEventObservation[] = [];
  const matchedResultKeys = new Set<string>();
  for (const reviewRequest of requests) {
    const result = results.find(
      (candidate) =>
        candidate.headSha === reviewRequest.headSha &&
        candidate.completedAt >= reviewRequest.requestedAt,
    );
    if (result) {
      matchedResultKeys.add(reviewResultKey(result));
      const pairRequest: ReviewEventPairRequest = { reviewRequest, result };
      events.push(reviewEventFromPair(pairRequest));
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
    if (matchedResultKeys.has(reviewResultKey(result))) continue;
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
    events: events.map(reviewEventRecord),
    requestCount: requests.length,
    findingBatchCount,
    findingCount,
  };
}

type CollectReviewReactionPagesRequest = {
  readonly repoRoot: string;
  readonly issueCommentPages: UntrustedYamlNode;
};

function collectReviewReactionPages(
  request: CollectReviewReactionPagesRequest,
): UntrustedYamlNode {
  const reactions: UntrustedYamlMap[] = [];
  const comments = flattenApiPages(request.issueCommentPages).filter(isRecord);
  for (const comment of comments) {
    const associationRequest: PropertyRequest = {
      record: comment,
      key: 'author_association',
    };
    if (
      !TRUSTED_REVIEW_ASSOCIATIONS.has(
        requiredStringProperty(associationRequest),
      )
    ) {
      continue;
    }
    const bodyRequest: PropertyRequest = { record: comment, key: 'body' };
    const body = requiredStringProperty(bodyRequest);
    if (!/nook-codex-review:[0-9a-f]{7,40}/.test(body)) continue;
    const commentIdRequest: PropertyRequest = { record: comment, key: 'id' };
    const commentId = requiredNumberProperty(commentIdRequest);
    const apiRequest: GitHubApiRequest = {
      repoRoot: request.repoRoot,
      endpoint: `repos/{owner}/{repo}/issues/comments/${commentId}/reactions`,
      fields: ['per_page=100'],
    };
    for (const reaction of flattenApiPages(runGitHubApi(apiRequest))) {
      if (!isRecord(reaction)) {
        failGitHubCollection('GitHub reaction must be a mapping');
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
      const user = untrustedYamlProperty(userRequest);
      if (
        user.presence === UntrustedYamlPropertyPresence.Absent ||
        !isRecord(user.value)
      ) {
        failGitHubCollection('GitHub reaction user must be a mapping');
      }
      const reactionRecord = {
        request_comment_id: commentId,
        content: requiredStringProperty(contentRequest),
        created_at: requiredStringProperty(createdAtRequest),
        user: user.value,
      };
      reactions.push(sealUntrustedYamlMap(reactionRecord));
    }
  }
  return [reactions];
}

type BuildHeadObservationRequest = {
  readonly headSha: string;
  readonly runs: readonly ActionObservation[];
  readonly allRuns: readonly ActionObservation[];
  readonly finalHeadSha: string;
  readonly orderedHeadShas: readonly string[];
};

function buildHeadObservation(
  request: BuildHeadObservationRequest,
): HeadObservation {
  const timestamps = request.runs.flatMap((run) => [
    run.startedAt,
    run.finishedAt,
  ]);
  const timestampRequest: TimestampExtremaRequest = { values: timestamps };
  const firstObservedAt = minimumTimestamp(timestampRequest);
  const lastObservedAt = maximumTimestamp(timestampRequest);
  const supersededRequest: HeadSupersededRequest = {
    headSha: request.headSha,
    allRuns: request.allRuns,
    orderedHeadShas: request.orderedHeadShas,
  };
  const supersededAt = headSupersededAt(supersededRequest);
  let actionSeconds = 0;
  let obsoleteActionSeconds = 0;
  for (const run of request.runs) {
    actionSeconds += run.durationSeconds;
    const obsoleteRequest: ObsoleteRunSecondsRequest = { run, supersededAt };
    obsoleteActionSeconds += obsoleteRunSeconds(obsoleteRequest);
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

type HeadSupersededRequest = {
  readonly headSha: string;
  readonly allRuns: readonly ActionObservation[];
  readonly orderedHeadShas: readonly string[];
};

function headSupersededAt(request: HeadSupersededRequest): string {
  const currentIndex = request.orderedHeadShas.indexOf(request.headSha);
  if (currentIndex < 0) return '';
  const laterHeads = new Set(request.orderedHeadShas.slice(currentIndex + 1));
  const laterStarts = request.allRuns
    .filter((run) => laterHeads.has(run.headSha))
    .map((run) => run.startedAt);
  const timestampRequest: TimestampExtremaRequest = { values: laterStarts };
  return minimumTimestamp(timestampRequest);
}

type ObsoleteRunSecondsRequest = {
  readonly run: ActionObservation;
  readonly supersededAt: string;
};

function obsoleteRunSeconds(request: ObsoleteRunSecondsRequest): number {
  if (
    request.supersededAt.length === 0 ||
    request.run.finishedAt <= request.supersededAt
  ) {
    return 0;
  }
  const obsoleteStart = Math.max(
    Date.parse(request.run.startedAt),
    Date.parse(request.supersededAt),
  );
  const finishedAt = Date.parse(request.run.finishedAt);
  return Math.max(0, Math.round((finishedAt - obsoleteStart) / 1000));
}

type ReviewRequestsRequest = {
  readonly comments: readonly UntrustedYamlMap[];
  readonly knownHeadShas: readonly string[];
};

function reviewRequests(
  request: ReviewRequestsRequest,
): ReviewRequestObservation[] {
  const byHead = new Map<string, ReviewRequestObservation>();
  for (const comment of request.comments) {
    const associationRequest: PropertyRequest = {
      record: comment,
      key: 'author_association',
    };
    const association = requiredStringProperty(associationRequest);
    if (!TRUSTED_REVIEW_ASSOCIATIONS.has(association)) continue;
    const bodyRequest: PropertyRequest = { record: comment, key: 'body' };
    const body = requiredStringProperty(bodyRequest);
    const marker = body.match(/nook-codex-review:([0-9a-f]{7,40})/);
    if (!marker) continue;
    const headRequest: ResolveHeadShaRequest = {
      candidate: marker[1] ?? '',
      knownHeadShas: request.knownHeadShas,
    };
    const headSha = resolveHeadSha(headRequest);
    if (headSha.length === 0 || byHead.has(headSha)) continue;
    const createdAtRequest: PropertyRequest = {
      record: comment,
      key: 'created_at',
    };
    const commentIdRequest: PropertyRequest = { record: comment, key: 'id' };
    const observation: ReviewRequestObservation = {
      commentId: requiredNumberProperty(commentIdRequest),
      headSha,
      requestedAt: requiredStringProperty(createdAtRequest),
    };
    byHead.set(headSha, observation);
  }
  return [...byHead.values()];
}

type ReviewResultsRequest = {
  readonly issueComments: readonly UntrustedYamlMap[];
  readonly reviews: readonly UntrustedYamlMap[];
  readonly reviewComments: readonly UntrustedYamlMap[];
  readonly reviewReactions: readonly UntrustedYamlMap[];
  readonly requests: readonly ReviewRequestObservation[];
  readonly knownHeadShas: readonly string[];
};

function reviewResults(
  request: ReviewResultsRequest,
): ReviewResultObservation[] {
  const results: ReviewResultObservation[] = [];
  for (const review of request.reviews) {
    const reviewLoginRequest: HasLoginRequest = {
      record: review,
      expected: CODEX_LOGIN,
    };
    if (!hasLogin(reviewLoginRequest)) continue;
    const reviewIdRequest: PropertyRequest = { record: review, key: 'id' };
    const reviewId = requiredNumberProperty(reviewIdRequest);
    const inlineFindingCount = request.reviewComments.filter((comment) => {
      const commentLoginRequest: HasLoginRequest = {
        record: comment,
        expected: CODEX_LOGIN,
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
        hasLogin(commentLoginRequest) &&
        requiredNumberProperty(reviewRequest) === reviewId &&
        numberProperty(replyRequest) === 0
      );
    }).length;
    const bodyRequest: PropertyRequest = { record: review, key: 'body' };
    const bodyFindingCount = substantiveReviewBodyFindingCount(
      stringProperty(bodyRequest),
    );
    const findingCount = inlineFindingCount + bodyFindingCount;
    if (findingCount === 0) continue;
    const commitRequest: PropertyRequest = { record: review, key: 'commit_id' };
    const candidate = requiredStringProperty(commitRequest);
    const headRequest: ResolveHeadShaRequest = {
      candidate,
      knownHeadShas: request.knownHeadShas,
    };
    const headSha = resolveHeadSha(headRequest);
    if (headSha.length === 0) continue;
    const submittedAtRequest: PropertyRequest = {
      record: review,
      key: 'submitted_at',
    };
    const observation: ReviewResultObservation = {
      headSha,
      completedAt: requiredStringProperty(submittedAtRequest),
      outcome: ReviewOutcome.Findings,
      findingCount,
    };
    results.push(observation);
  }
  for (const comment of request.issueComments) {
    const commentLoginRequest: HasLoginRequest = {
      record: comment,
      expected: CODEX_LOGIN,
    };
    if (!hasLogin(commentLoginRequest)) continue;
    const bodyRequest: PropertyRequest = { record: comment, key: 'body' };
    const body = requiredStringProperty(bodyRequest);
    if (!body.includes('find any major issues')) continue;
    const match = body.match(/Reviewed commit:\*\* `([0-9a-f]{7,40})/i);
    if (!match) continue;
    const headRequest: ResolveHeadShaRequest = {
      candidate: match[1] ?? '',
      knownHeadShas: request.knownHeadShas,
    };
    const headSha = resolveHeadSha(headRequest);
    if (headSha.length === 0) continue;
    const createdAtRequest: PropertyRequest = {
      record: comment,
      key: 'created_at',
    };
    const observation: ReviewResultObservation = {
      headSha,
      completedAt: requiredStringProperty(createdAtRequest),
      outcome: ReviewOutcome.Clean,
      findingCount: 0,
    };
    results.push(observation);
  }
  for (const reaction of request.reviewReactions) {
    const reactionLoginRequest: HasLoginRequest = {
      record: reaction,
      expected: CODEX_LOGIN,
    };
    if (!hasLogin(reactionLoginRequest)) continue;
    const contentRequest: PropertyRequest = {
      record: reaction,
      key: 'content',
    };
    if (requiredStringProperty(contentRequest) !== '+1') continue;
    const commentIdRequest: PropertyRequest = {
      record: reaction,
      key: 'request_comment_id',
    };
    const commentId = requiredNumberProperty(commentIdRequest);
    const reviewRequest = request.requests.find(
      (candidate) => candidate.commentId === commentId,
    );
    if (!reviewRequest) continue;
    if (results.some((result) => result.headSha === reviewRequest.headSha)) {
      continue;
    }
    const createdAtRequest: PropertyRequest = {
      record: reaction,
      key: 'created_at',
    };
    const observation: ReviewResultObservation = {
      headSha: reviewRequest.headSha,
      completedAt: requiredStringProperty(createdAtRequest),
      outcome: ReviewOutcome.Clean,
      findingCount: 0,
    };
    results.push(observation);
  }
  return results;
}

type ResolveHeadShaRequest = {
  readonly candidate: string;
  readonly knownHeadShas: readonly string[];
};

function resolveHeadSha(request: ResolveHeadShaRequest): string {
  if (
    /^[0-9a-f]{40}$/.test(request.candidate) &&
    request.knownHeadShas.includes(request.candidate)
  ) {
    return request.candidate;
  }
  const matches = request.knownHeadShas.filter((headSha) =>
    headSha.startsWith(request.candidate),
  );
  return matches.length === 1 ? (matches[0] ?? '') : '';
}

type ReviewEventPairRequest = {
  readonly reviewRequest: ReviewRequestObservation;
  readonly result: ReviewResultObservation;
};

function reviewEventFromPair(
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
    latencySeconds: Math.max(0, Math.round((completedAt - requestedAt) / 1000)),
  };
}

function reviewResultKey(result: ReviewResultObservation): string {
  return `${result.headSha}:${result.completedAt}:${result.outcome}`;
}

type ActionObservationRequest = {
  readonly record: UntrustedYamlMap;
  readonly prNumber: number;
};

function actionObservation(
  request: ActionObservationRequest,
): ActionObservation {
  const startedRequest: PropertyRequest = {
    record: request.record,
    key: 'run_started_at',
  };
  const updatedRequest: PropertyRequest = {
    record: request.record,
    key: 'updated_at',
  };
  const workflowRequest: PropertyRequest = {
    record: request.record,
    key: 'name',
  };
  const runIdRequest: PropertyRequest = { record: request.record, key: 'id' };
  const attemptRequest: PropertyRequest = {
    record: request.record,
    key: 'run_attempt',
  };
  const headRequest: PropertyRequest = {
    record: request.record,
    key: 'head_sha',
  };
  const triggerRequest: PropertyRequest = {
    record: request.record,
    key: 'event',
  };
  const conclusionRequest: PropertyRequest = {
    record: request.record,
    key: 'conclusion',
  };
  const statusRequest: PropertyRequest = {
    record: request.record,
    key: 'status',
  };
  const status = requiredStringProperty(statusRequest);
  if (status !== 'completed') {
    failGitHubCollection(
      `GitHub Actions attempt ${requiredNumberProperty(runIdRequest)}:${requiredNumberProperty(attemptRequest)} is ${status}; retry collection after completion`,
    );
  }
  const startedAt = requiredStringProperty(startedRequest);
  const finishedAt = requiredStringProperty(updatedRequest);
  const durationRequest: DurationSecondsRequest = { startedAt, finishedAt };
  return {
    workflow: requiredStringProperty(workflowRequest),
    runId: requiredNumberProperty(runIdRequest),
    runAttempt: requiredNumberProperty(attemptRequest),
    headSha: requiredStringProperty(headRequest),
    trigger: requiredStringProperty(triggerRequest),
    startedAt,
    finishedAt,
    durationSeconds: durationSeconds(durationRequest),
    conclusion: requiredStringProperty(conclusionRequest),
    sourcePr: request.prNumber,
  };
}

function actionRunId(run: UntrustedYamlMap): number {
  const request: PropertyRequest = { record: run, key: 'id' };
  return requiredNumberProperty(request);
}

type SourcePrRunRequest = {
  readonly run: UntrustedYamlMap;
  readonly prNumber: number;
};

function isSourcePrRun(request: SourcePrRunRequest): boolean {
  const pullRequestsRequest: PropertyRequest = {
    record: request.run,
    key: 'pull_requests',
  };
  const pullRequests = requiredArrayProperty(pullRequestsRequest);
  return pullRequests.some((candidate) => {
    if (!isRecord(candidate)) return false;
    const numberRequest: PropertyRequest = { record: candidate, key: 'number' };
    return numberProperty(numberRequest) === request.prNumber;
  });
}

type DurationSecondsRequest = {
  readonly startedAt: string;
  readonly finishedAt: string;
};

function durationSeconds(request: DurationSecondsRequest): number {
  const startedAt = Date.parse(request.startedAt);
  const finishedAt = Date.parse(request.finishedAt);
  if (Number.isNaN(startedAt) || Number.isNaN(finishedAt)) return 0;
  return Math.max(0, Math.round((finishedAt - startedAt) / 1000));
}

function actionObservationRecord(
  observation: ActionObservation,
): UntrustedYamlMap {
  const record = {
    workflow: observation.workflow,
    run_id: observation.runId,
    run_attempt: observation.runAttempt,
    head_sha: observation.headSha,
    trigger: observation.trigger,
    started_at: observation.startedAt,
    finished_at: observation.finishedAt,
    duration_seconds: observation.durationSeconds,
    conclusion: observation.conclusion,
    source_pr: observation.sourcePr,
  };
  return sealUntrustedYamlMap(record);
}

function headObservationRecord(observation: HeadObservation): UntrustedYamlMap {
  const record = {
    head_sha: observation.headSha,
    first_observed_at: observation.firstObservedAt,
    last_observed_at: observation.lastObservedAt,
    final: observation.final,
    action_run_count: observation.actionRunCount,
    action_seconds: observation.actionSeconds,
    obsolete_action_seconds: observation.obsoleteActionSeconds,
  };
  return sealUntrustedYamlMap(record);
}

type ValidationCycleRecordRequest = {
  readonly run: ActionObservation;
  readonly obsoleteSeconds: number;
};

function validationCycleRecord(
  request: ValidationCycleRecordRequest,
): UntrustedYamlMap {
  const record = {
    workflow: request.run.workflow,
    head_sha: request.run.headSha,
    run_id: request.run.runId,
    run_attempt: request.run.runAttempt,
    started_at: request.run.startedAt,
    finished_at: request.run.finishedAt,
    duration_seconds: request.run.durationSeconds,
    conclusion: request.run.conclusion,
    obsolete_seconds: request.obsoleteSeconds,
  };
  return sealUntrustedYamlMap(record);
}

function reviewEventRecord(event: ReviewEventObservation): UntrustedYamlMap {
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
  return sealUntrustedYamlMap(record);
}

type HasLoginRequest = {
  readonly record: UntrustedYamlMap;
  readonly expected: string;
};

function hasLogin(request: HasLoginRequest): boolean {
  const userArgs: UntrustedYamlPropertyArgs = {
    record: request.record,
    key: 'user',
  };
  const user = untrustedYamlProperty(userArgs);
  if (
    user.presence === UntrustedYamlPropertyPresence.Absent ||
    !isRecord(user.value)
  ) {
    return false;
  }
  const loginRequest: PropertyRequest = { record: user.value, key: 'login' };
  return stringProperty(loginRequest) === request.expected;
}
