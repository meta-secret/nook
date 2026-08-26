import {
  isRecord,
  sealUntrustedYamlMap,
  type UntrustedYamlMap,
} from './guards.ts';
import {
  numberProperty,
  requiredArrayProperty,
  requiredNumberProperty,
  requiredStringProperty,
  type GitHubPropertyRequest as PropertyRequest,
} from './agent-stats-github-api.ts';

export type ActionObservation = {
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
  readonly validationRequested: boolean;
};

export type ActionObservationRequest = {
  readonly record: UntrustedYamlMap;
  readonly prNumber: number;
  readonly observedThrough: string;
};

export function actionObservation(
  request: ActionObservationRequest,
): ActionObservation {
  const startedRequest: PropertyRequest = {
    record: request.record,
    key: 'created_at',
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
  const validationRequest: PropertyRequest = {
    record: request.record,
    key: 'validation_requested',
  };
  const statusRequest: PropertyRequest = {
    record: request.record,
    key: 'status',
  };
  const status = requiredStringProperty(statusRequest);
  const recordedFinishedAt = requiredStringProperty(updatedRequest);
  const crossesObservationBoundary =
    recordedFinishedAt > request.observedThrough;
  const startedAt = requiredStringProperty(startedRequest);
  const headSha = requiredStringProperty(headRequest);
  const finishedAt =
    status !== 'completed' || crossesObservationBoundary
      ? request.observedThrough
      : recordedFinishedAt;
  const durationRequest: DurationSecondsRequest = { startedAt, finishedAt };
  return {
    workflow: requiredStringProperty(workflowRequest),
    runId: requiredNumberProperty(runIdRequest),
    runAttempt: requiredNumberProperty(attemptRequest),
    headSha,
    trigger: requiredStringProperty(triggerRequest),
    startedAt,
    finishedAt,
    durationSeconds: durationSeconds(durationRequest),
    conclusion:
      status !== 'completed' || crossesObservationBoundary
        ? 'nonterminal_at_merge'
        : requiredStringProperty(conclusionRequest),
    sourcePr: request.prNumber,
    validationRequested: requiredStringProperty(validationRequest) === 'true',
  };
}

export function actionRunId(run: UntrustedYamlMap): number {
  const request: PropertyRequest = { record: run, key: 'id' };
  return requiredNumberProperty(request);
}

export type SourcePrRunRequest = {
  readonly run: UntrustedYamlMap;
  readonly prNumber: number;
};

export function isSourcePrRun(request: SourcePrRunRequest): boolean {
  const pullRequestsRequest: PropertyRequest = {
    record: request.run,
    key: 'pull_requests',
  };
  const pullRequests = requiredArrayProperty(pullRequestsRequest);
  // The branch-and-merge-window Actions query is the outer source boundary.
  // GitHub clears this association for some old attempts after squash merge.
  if (pullRequests.length === 0) return true;
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

export function actionObservationRecord(
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

export type ValidationCycleRecordRequest = {
  readonly run: ActionObservation;
  readonly obsoleteSeconds: number;
};

export function validationCycleRecord(
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
