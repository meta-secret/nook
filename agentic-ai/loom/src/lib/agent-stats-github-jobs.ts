import { err, ok, type Result } from 'neverthrow';
import {
  UntrustedYamlBoundary,
  UntrustedYamlPropertyPresence,
  type UntrustedYamlNode,
  type UntrustedYamlMap,
} from './guards.ts';
import { GitHubEvidenceField } from './agent-stats-github-field.ts';
import type { GitHubEvidenceFailure } from './agent-stats-github-api.ts';

export enum GitHubSourceVerification {
  Verified = 'verified',
  Unverified = 'unverified',
}
export enum GitHubValidationRequest {
  Requested = 'requested',
  NotRequested = 'notRequested',
}
enum GitHubStepMatch {
  Matched = 'matched',
  NotMatched = 'notMatched',
}

export class GitHubActionJobs {
  constructor(private readonly jobs: readonly UntrustedYamlNode[]) {}

  sourceVerification(): Result<
    GitHubSourceVerification,
    GitHubEvidenceFailure
  > {
    for (const job of this.jobs) {
      if (!UntrustedYamlBoundary.isRecord(job)) continue;
      const name = new GitHubEvidenceField({
        record: job,
        key: 'name',
      }).string();
      if (name.isErr()) return err(name.error);
      if (name.value !== 'Build PR browser image') continue;
      const step = new GitHubJobSteps(job).successful('Resolve PR head SHA');
      if (step.isErr()) return err(step.error);
      if (step.value === GitHubStepMatch.Matched)
        return ok(GitHubSourceVerification.Verified);
    }
    return ok(GitHubSourceVerification.Unverified);
  }

  validationRequest(
    gateJobName: string,
  ): Result<GitHubValidationRequest, GitHubEvidenceFailure> {
    for (const job of this.jobs) {
      if (!UntrustedYamlBoundary.isRecord(job)) continue;
      const name = new GitHubEvidenceField({
        record: job,
        key: 'name',
      }).string();
      if (name.isErr()) return err(name.error);
      if (name.value !== gateJobName) continue;
      const step = new GitHubJobSteps(job).successful(
        'Reject unsupported label events',
      );
      if (step.isErr()) return err(step.error);
      if (step.value === GitHubStepMatch.Matched)
        return ok(GitHubValidationRequest.Requested);
    }
    for (const job of this.jobs) {
      if (!UntrustedYamlBoundary.isRecord(job)) continue;
      const name = new GitHubEvidenceField({
        record: job,
        key: 'name',
      }).string();
      if (name.isErr()) return err(name.error);
      if (
        name.value !== gateJobName &&
        (gateJobName !== 'PR validation / Validate explicit CI request' ||
          name.value.startsWith('PR validation / ') ||
          name.value.startsWith('Rust ecosystem / ')) &&
        new GitHubEvidenceField({
          record: job,
          key: 'conclusion',
        }).optionalString() !== 'skipped'
      )
        return ok(GitHubValidationRequest.Requested);
    }
    return ok(GitHubValidationRequest.NotRequested);
  }
}

class GitHubJobSteps {
  constructor(private readonly job: UntrustedYamlMap) {}
  successful(stepName: string): Result<GitHubStepMatch, GitHubEvidenceFailure> {
    const request = { record: this.job, key: 'steps' };
    if (
      UntrustedYamlBoundary.property(request).presence ===
      UntrustedYamlPropertyPresence.Absent
    )
      return ok(GitHubStepMatch.NotMatched);
    const steps = new GitHubEvidenceField(request).array();
    if (steps.isErr()) return err(steps.error);
    for (const step of steps.value) {
      if (!UntrustedYamlBoundary.isRecord(step)) continue;
      const name = new GitHubEvidenceField({
        record: step,
        key: 'name',
      }).string();
      if (name.isErr()) return err(name.error);
      if (
        name.value === stepName &&
        new GitHubEvidenceField({
          record: step,
          key: 'conclusion',
        }).optionalString() === 'success'
      )
        return ok(GitHubStepMatch.Matched);
    }
    return ok(GitHubStepMatch.NotMatched);
  }
}
