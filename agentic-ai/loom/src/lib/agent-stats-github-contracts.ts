import type { UntrustedYamlMap, UntrustedYamlNode } from './guards.ts';
import type { ReviewOutcome } from './agent-stats-github-review.ts';
import type { ActionObservation } from './agent-stats-github-actions.ts';
import type { DeliveryHeadStart } from './agent-stats-github-delivery.ts';

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

export type ActionsEvidence = {
  readonly runs: UntrustedYamlMap[];
  readonly heads: UntrustedYamlMap[];
  readonly validationCycles: UntrustedYamlMap[];
  readonly obsoleteValidationSeconds: number;
  readonly obsoleteValidationCount: number;
  readonly cancelledValidationSeconds: number;
  readonly cancelledValidationCount: number;
};

export type HeadObservation = {
  readonly headSha: string;
  readonly firstObservedAt: string;
  readonly lastObservedAt: string;
  readonly final: boolean;
  readonly actionRunCount: number;
  readonly actionSeconds: number;
  readonly obsoleteActionSeconds: number;
};

export type ReviewRequestObservation = {
  readonly commentId: number;
  readonly headSha: string;
  readonly requestedAt: string;
};

export type ReviewResultObservation = {
  readonly headSha: string;
  readonly completedAt: string;
  readonly outcome: ReviewOutcome;
  readonly findingCount: number;
  readonly requestCommentId: number;
};

export type ReviewEventObservation = {
  readonly headSha: string;
  readonly requestedAt: string;
  readonly completedAt: string;
  readonly outcome: ReviewOutcome;
  readonly requested: boolean;
  readonly findingCount: number;
  readonly latencySeconds: number;
};

export type ReviewEvidence = {
  readonly events: UntrustedYamlMap[];
  readonly requestCount: number;
  readonly findingBatchCount: number;
  readonly findingCount: number;
};

export type CollectReviewReactionPagesRequest = {
  readonly repoRoot: string;
  readonly issueCommentPages: UntrustedYamlNode;
};

export type BuildHeadObservationRequest = {
  readonly headSha: string;
  readonly runs: readonly ActionObservation[];
  readonly finalHeadSha: string;
  readonly headStarts: readonly DeliveryHeadStart[];
};

export type ReviewRequestsRequest = {
  readonly comments: readonly UntrustedYamlMap[];
  readonly knownHeadShas: readonly string[];
  readonly mergedAt: string;
};

export type ReviewResultsRequest = {
  readonly issueComments: readonly UntrustedYamlMap[];
  readonly reviews: readonly UntrustedYamlMap[];
  readonly reviewComments: readonly UntrustedYamlMap[];
  readonly reviewReactions: readonly UntrustedYamlMap[];
  readonly requests: readonly ReviewRequestObservation[];
  readonly knownHeadShas: readonly string[];
  readonly mergedAt: string;
};

export type ResolveHeadShaRequest = {
  readonly candidate: string;
  readonly knownHeadShas: readonly string[];
};

export type ReviewEventPairRequest = {
  readonly reviewRequest: ReviewRequestObservation;
  readonly result: ReviewResultObservation;
};

export type HasLoginRequest = {
  readonly record: UntrustedYamlMap;
  readonly expected: string;
};
