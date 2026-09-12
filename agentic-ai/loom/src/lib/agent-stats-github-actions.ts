import { err, ok, type Result } from 'neverthrow';
import { GitHubEvidenceField } from './agent-stats-github-field.ts';
import type { GitHubEvidenceFailure } from './agent-stats-github-api.ts';
import { type UntrustedYamlMap, UntrustedYamlBoundary } from './guards.ts';

import { type GitHubPropertyRequest as PropertyRequest } from './agent-stats-github-api.ts';

export class ActionRunObservation {
  constructor(private readonly request: ActionObservationRequest) {}
  execute(): Result<ActionObservation, GitHubEvidenceFailure> {
    const request = this.request;
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
    const fieldAdmission1 = new GitHubEvidenceField(statusRequest).string();
    if (fieldAdmission1.isErr()) return err(fieldAdmission1.error);
    const status = fieldAdmission1.value;
    const fieldAdmission2 = new GitHubEvidenceField(attemptRequest).number();
    if (fieldAdmission2.isErr()) return err(fieldAdmission2.error);
    const runAttempt = fieldAdmission2.value;
    const fieldAdmission3 = new GitHubEvidenceField(updatedRequest).string();
    if (fieldAdmission3.isErr()) return err(fieldAdmission3.error);
    const recordedFinishedAt = fieldAdmission3.value;
    const crossesObservationBoundary =
      recordedFinishedAt > request.observedThrough;
    const fieldAdmission4 = new ActionAttemptStart(request.record).execute();
    if (fieldAdmission4.isErr()) return err(fieldAdmission4.error);
    const startedAt = fieldAdmission4.value;
    const headSha = new GitHubEvidenceField(headRequest).optionalString();
    const finishedAt =
      status !== 'completed' || crossesObservationBoundary
        ? request.observedThrough
        : recordedFinishedAt;
    const durationRequest: DurationSecondsRequest = { startedAt, finishedAt };
    const conclusionResult =
      status !== 'completed' || crossesObservationBoundary
        ? ok('nonterminal_at_merge')
        : new GitHubEvidenceField(conclusionRequest).string();
    if (conclusionResult.isErr()) return err(conclusionResult.error);
    const fieldAdmission5 = new GitHubEvidenceField(workflowRequest).string();
    if (fieldAdmission5.isErr()) return err(fieldAdmission5.error);
    const fieldAdmission6 = new GitHubEvidenceField(runIdRequest).number();
    if (fieldAdmission6.isErr()) return err(fieldAdmission6.error);
    const fieldAdmission7 = new GitHubEvidenceField(triggerRequest).string();
    if (fieldAdmission7.isErr()) return err(fieldAdmission7.error);
    const fieldAdmission8 = new GitHubEvidenceField(validationRequest).string();
    if (fieldAdmission8.isErr()) return err(fieldAdmission8.error);
    return ok({
      workflow: fieldAdmission5.value,
      runId: fieldAdmission6.value,
      runAttempt,
      headSha,
      trigger: fieldAdmission7.value,
      startedAt,
      finishedAt,
      durationSeconds: ActionDuration.seconds(durationRequest),
      conclusion: conclusionResult.value,
      sourcePr: request.prNumber,
      sourceAttributed: headSha.length > 0,
      validationRequested: fieldAdmission8.value === 'true',
    });
  }
}

export class ActionAttemptStart {
  constructor(private readonly request: UntrustedYamlMap) {}
  execute(): Result<string, GitHubEvidenceFailure> {
    const record = this.request;
    const attemptRequest: PropertyRequest = { record, key: 'run_attempt' };
    const fieldAdmission9 = new GitHubEvidenceField(attemptRequest).number();
    if (fieldAdmission9.isErr()) return err(fieldAdmission9.error);
    const key = fieldAdmission9.value === 1 ? 'created_at' : 'run_started_at';
    const startedRequest: PropertyRequest = { record, key };
    return new GitHubEvidenceField(startedRequest).string();
  }
}

export class ActionRunIdentity {
  constructor(private readonly request: UntrustedYamlMap) {}
  execute(): Result<number, GitHubEvidenceFailure> {
    const run = this.request;
    const request: PropertyRequest = { record: run, key: 'id' };
    return new GitHubEvidenceField(request).number();
  }
}

export class PullRequestActionRun {
  constructor(private readonly request: SourcePrRunRequest) {}
  execute(): Result<boolean, GitHubEvidenceFailure> {
    const request = this.request;
    const pullRequestsRequest: PropertyRequest = {
      record: request.run,
      key: 'pull_requests',
    };
    const fieldAdmission10 = new GitHubEvidenceField(
      pullRequestsRequest,
    ).array();
    if (fieldAdmission10.isErr()) return err(fieldAdmission10.error);
    const pullRequests = fieldAdmission10.value;
    // The branch-and-merge-window Actions query is the outer source boundary.
    // GitHub clears this association for some old attempts after squash merge.
    if (pullRequests.length === 0) return ok(true);
    return ok(
      pullRequests.some((candidate) => {
        if (!UntrustedYamlBoundary.isRecord(candidate)) return false;
        const numberRequest: PropertyRequest = {
          record: candidate,
          key: 'number',
        };
        return (
          new GitHubEvidenceField(numberRequest).optionalNumber() ===
          request.prNumber
        );
      }),
    );
  }
}

export class ActionDuration {
  private constructor(private readonly request: DurationSecondsRequest) {}
  static seconds(request: DurationSecondsRequest): number {
    return new ActionDuration(request).execute();
  }
  private execute(): number {
    const request = this.request;
    const startedAt = Date.parse(request.startedAt);
    const finishedAt = Date.parse(request.finishedAt);
    if (Number.isNaN(startedAt) || Number.isNaN(finishedAt)) return 0;
    return Math.max(0, Math.round((finishedAt - startedAt) / 1000));
  }
}

export class ActionObservationRecord {
  private constructor(private readonly request: ActionObservation) {}
  static encode(observation: ActionObservation): UntrustedYamlMap {
    return new ActionObservationRecord(observation).execute();
  }
  private execute(): UntrustedYamlMap {
    const observation = this.request;
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
      source_attributed: observation.sourceAttributed,
      validation_requested: observation.validationRequested,
    };
    return UntrustedYamlBoundary.seal(record);
  }
}

export class ValidationCycleRecord {
  private constructor(private readonly request: ValidationCycleRecordRequest) {}
  static encode(request: ValidationCycleRecordRequest): UntrustedYamlMap {
    return new ValidationCycleRecord(request).execute();
  }
  private execute(): UntrustedYamlMap {
    const request = this.request;
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
    return UntrustedYamlBoundary.seal(record);
  }
}

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
  readonly sourceAttributed: boolean;
  readonly validationRequested: boolean;
};

export type ActionObservationRequest = {
  readonly record: UntrustedYamlMap;
  readonly prNumber: number;
  readonly observedThrough: string;
};

export type SourcePrRunRequest = {
  readonly run: UntrustedYamlMap;
  readonly prNumber: number;
};

type DurationSecondsRequest = {
  readonly startedAt: string;
  readonly finishedAt: string;
};

export type ValidationCycleRecordRequest = {
  readonly run: ActionObservation;
  readonly obsoleteSeconds: number;
};
