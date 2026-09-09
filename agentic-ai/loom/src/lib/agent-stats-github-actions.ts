import { type UntrustedYamlMap, UntrustedYamlBoundary } from './guards.ts';

import {
  type GitHubPropertyRequest as PropertyRequest,
  GithubActionEvidenceApi,
} from './agent-stats-github-api.ts';

export class ActionRunObservation {
  private constructor(private readonly request: ActionObservationRequest) {}
  static create(request: ActionObservationRequest): ActionObservation {
    return new ActionRunObservation(request).execute();
  }
  private execute(): ActionObservation {
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
    const status =
      GithubActionEvidenceApi.requiredStringProperty(statusRequest);
    const runAttempt =
      GithubActionEvidenceApi.requiredNumberProperty(attemptRequest);
    const recordedFinishedAt =
      GithubActionEvidenceApi.requiredStringProperty(updatedRequest);
    const crossesObservationBoundary =
      recordedFinishedAt > request.observedThrough;
    const startedAt = ActionAttemptStart.read(request.record);
    const headSha = GithubActionEvidenceApi.stringProperty(headRequest);
    const finishedAt =
      status !== 'completed' || crossesObservationBoundary
        ? request.observedThrough
        : recordedFinishedAt;
    const durationRequest: DurationSecondsRequest = { startedAt, finishedAt };
    return {
      workflow: GithubActionEvidenceApi.requiredStringProperty(workflowRequest),
      runId: GithubActionEvidenceApi.requiredNumberProperty(runIdRequest),
      runAttempt,
      headSha,
      trigger: GithubActionEvidenceApi.requiredStringProperty(triggerRequest),
      startedAt,
      finishedAt,
      durationSeconds: ActionDuration.seconds(durationRequest),
      conclusion:
        status !== 'completed' || crossesObservationBoundary
          ? 'nonterminal_at_merge'
          : GithubActionEvidenceApi.requiredStringProperty(conclusionRequest),
      sourcePr: request.prNumber,
      sourceAttributed: headSha.length > 0,
      validationRequested:
        GithubActionEvidenceApi.requiredStringProperty(validationRequest) ===
        'true',
    };
  }
}

export class ActionAttemptStart {
  private constructor(private readonly request: UntrustedYamlMap) {}
  static read(record: UntrustedYamlMap): string {
    return new ActionAttemptStart(record).execute();
  }
  private execute(): string {
    const record = this.request;
    const attemptRequest: PropertyRequest = { record, key: 'run_attempt' };
    const key =
      GithubActionEvidenceApi.requiredNumberProperty(attemptRequest) === 1
        ? 'created_at'
        : 'run_started_at';
    const startedRequest: PropertyRequest = { record, key };
    return GithubActionEvidenceApi.requiredStringProperty(startedRequest);
  }
}

export class ActionRunIdentity {
  private constructor(private readonly request: UntrustedYamlMap) {}
  static read(run: UntrustedYamlMap): number {
    return new ActionRunIdentity(run).execute();
  }
  private execute(): number {
    const run = this.request;
    const request: PropertyRequest = { record: run, key: 'id' };
    return GithubActionEvidenceApi.requiredNumberProperty(request);
  }
}

export class PullRequestActionRun {
  private constructor(private readonly request: SourcePrRunRequest) {}
  static matches(request: SourcePrRunRequest): boolean {
    return new PullRequestActionRun(request).execute();
  }
  private execute(): boolean {
    const request = this.request;
    const pullRequestsRequest: PropertyRequest = {
      record: request.run,
      key: 'pull_requests',
    };
    const pullRequests =
      GithubActionEvidenceApi.requiredArrayProperty(pullRequestsRequest);
    // The branch-and-merge-window Actions query is the outer source boundary.
    // GitHub clears this association for some old attempts after squash merge.
    if (pullRequests.length === 0) return true;
    return pullRequests.some((candidate) => {
      if (!UntrustedYamlBoundary.isRecord(candidate)) return false;
      const numberRequest: PropertyRequest = {
        record: candidate,
        key: 'number',
      };
      return (
        GithubActionEvidenceApi.numberProperty(numberRequest) ===
        request.prNumber
      );
    });
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
