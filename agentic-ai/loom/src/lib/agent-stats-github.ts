import {
  GitHubReviewReactions,
  GitHubReviewEvidence,
} from './agent-stats-github-review-evidence.ts';
import { GitHubEvidenceField } from './agent-stats-github-field.ts';
import type {
  AgentStatsGitHubEvidenceRequest,
  AgentStatsGitHubEvidence,
  BuildActionsEvidenceRequest,
  BuildReviewEvidenceRequest,
  ActionsEvidence,
  HeadObservation,
  CollectReviewReactionPagesRequest,
  BuildHeadObservationRequest,
} from './agent-stats-github-contracts.ts';
export type {
  AgentStatsGitHubEvidenceRequest,
  AgentStatsGitHubEvidence,
  BuildActionsEvidenceRequest,
  BuildReviewEvidenceRequest,
} from './agent-stats-github-contracts.ts';
import { LoomFailureCode } from '../loom-failure.ts';
import { err, ok, type Result } from 'neverthrow';
import type { GitHubEvidenceFailure } from './agent-stats-github-api.ts';
import {
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

import {
  type HeadSupersededRequest,
  type ObsoleteRunSecondsRequest,
  ValidationWorkflowHistory,
} from './agent-stats-github-validation.ts';
import {
  DeliveryHeadTimeline,
  LatestTimestamp,
  ReviewedDeliveryHistory,
  EarliestTimestamp,
} from './agent-stats-github-delivery.ts';

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
    const pageAdmission1 =
      GithubActionEvidenceApi.flattenApiPages(expandedActionPages);
    if (pageAdmission1.isErr()) return err(pageAdmission1.error);
    const pageAdmission2 = GithubActionEvidenceApi.flattenApiPages(
      dispatchedActionPages,
    );
    if (pageAdmission2.isErr()) return err(pageAdmission2.error);
    const allActionPages: UntrustedYamlNode = [
      ...pageAdmission1.value,
      ...pageAdmission2.value,
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
    const pageAdmission3 = GithubActionEvidenceApi.flattenApiPages(commitPages);
    if (pageAdmission3.isErr()) return err(pageAdmission3.error);
    for (const commit of pageAdmission3.value) {
      if (!UntrustedYamlBoundary.isRecord(commit)) continue;
      const propertyRequest: PropertyRequest = { record: commit, key: 'sha' };
      const requiredField1 = new GitHubEvidenceField(propertyRequest).string();
      if (requiredField1.isErr()) return err(requiredField1.error);
      const headSha = requiredField1.value;
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
    const githubResult9 = new GitHubReviewReactions(reactionsRequest).collect();
    if (githubResult9.isErr()) return err(githubResult9.error);
    const reviewRequest: BuildReviewEvidenceRequest = {
      issueCommentPages,
      reviewPages: githubResult7.value,
      reviewCommentPages: githubResult8.value,
      reviewReactionPages: githubResult9.value,
      knownHeadShas,
      mergedAt: request.mergedAt,
    };
    const pageAdmission4 = new GitHubReviewEvidence(reviewRequest).build();
    if (pageAdmission4.isErr()) return err(pageAdmission4.error);
    const reviews = pageAdmission4.value;
    const actionsRequest: BuildActionsEvidenceRequest = {
      pages: allActionPages,
      prNumber: request.prNumber,
      finalHeadSha: request.finalHeadSha,
      mergedAt: request.mergedAt,
      reviewEvents: reviews.events,
      deliveryHeadOrder: knownHeadShas,
    };
    const pageAdmission5 =
      GithubAgentEvidence.buildActionsEvidence(actionsRequest);
    if (pageAdmission5.isErr()) return err(pageAdmission5.error);
    const actions = pageAdmission5.value;
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
  ): Result<ActionsEvidence, GitHubEvidenceFailure> {
    const pageAdmission6 = GithubActionEvidenceApi.flattenApiPages(
      request.pages,
    );
    if (pageAdmission6.isErr()) return err(pageAdmission6.error);
    const pages = pageAdmission6.value;
    const rawRuns: UntrustedYamlMap[] = [];
    let expectedRunCount = 0;
    for (const page of pages) {
      if (!UntrustedYamlBoundary.isRecord(page)) continue;
      const totalCountRequest: PropertyRequest = {
        record: page,
        key: 'total_count',
      };
      const fieldAdmission1 = new GitHubEvidenceField(
        totalCountRequest,
      ).number();
      if (fieldAdmission1.isErr()) return err(fieldAdmission1.error);
      const totalCount = fieldAdmission1.value;
      expectedRunCount = Math.max(expectedRunCount, totalCount);
      const workflowRunsRequest: PropertyRequest = {
        record: page,
        key: 'workflow_runs',
      };
      const fieldAdmission2 = new GitHubEvidenceField(
        workflowRunsRequest,
      ).array();
      if (fieldAdmission2.isErr()) return err(fieldAdmission2.error);
      const workflowRuns = fieldAdmission2.value;
      rawRuns.push(...workflowRuns.filter(UntrustedYamlBoundary.isRecord));
    }
    const collectedRunIds = new Set<number>();
    for (const run of rawRuns) {
      const identity = new ActionRunIdentity(run).execute();
      if (identity.isErr()) return err(identity.error);
      collectedRunIds.add(identity.value);
    }
    if (collectedRunIds.size < expectedRunCount) {
      return err({
        code: LoomFailureCode.CommandFailed,
        message: `GitHub Actions history is incomplete: expected ${expectedRunCount}, collected ${collectedRunIds.size}`,
      });
    }
    const deduplicatedRuns = new Map<string, ActionObservation>();
    for (const rawRun of rawRuns) {
      const associationRequest: SourcePrRunRequest = {
        run: rawRun,
        prNumber: request.prNumber,
      };
      const association = new PullRequestActionRun(
        associationRequest,
      ).execute();
      if (association.isErr()) return err(association.error);
      if (!association.value) continue;
      const attemptStart = new ActionAttemptStart(rawRun).execute();
      if (attemptStart.isErr()) return err(attemptStart.error);
      if (attemptStart.value > request.mergedAt) continue;
      const observationRequest: ActionObservationRequest = {
        record: rawRun,
        prNumber: request.prNumber,
        observedThrough: request.mergedAt,
      };
      const observationResult = new ActionRunObservation(
        observationRequest,
      ).execute();
      if (observationResult.isErr()) return err(observationResult.error);
      const observation = observationResult.value;
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
    return ok({
      runs,
      heads,
      validationCycles,
      obsoleteValidationSeconds,
      obsoleteValidationCount,
      cancelledValidationSeconds,
      cancelledValidationCount,
    });
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
}
