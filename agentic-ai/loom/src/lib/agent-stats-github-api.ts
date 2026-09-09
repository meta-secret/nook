import { err, ok, type Result } from 'neverthrow';
import {
  UntrustedYamlPropertyPresence,
  type UntrustedYamlMap,
  type UntrustedYamlNode,
  UntrustedYamlBoundary,
} from './guards.ts';

import { CommandOutputPolicy, HostCommand } from './run.ts';

import { LoomFailureCode, LoomFailure } from '../loom-failure.ts';

import type { UntrustedYamlPropertyArgs } from './guards.ts';

import type { RunCommandArgs } from './run.ts';

import type { LoomFailureDetailArgs } from '../loom-failure.ts';

export class GithubActionEvidenceApi {
  private constructor(
    private readonly request: CollectDispatchedActionAttemptPagesRequest,
  ) {}

  static collectDispatchedActionAttemptPages(
    request: CollectDispatchedActionAttemptPagesRequest,
  ): Result<UntrustedYamlNode, GitHubEvidenceFailure> {
    return new GithubActionEvidenceApi(request).execute();
  }

  private execute(): Result<UntrustedYamlNode, GitHubEvidenceFailure> {
    const request = this.request;
    const selectedRuns: UntrustedYamlMap[] = [];
    const sourceHeadByRun = new Map<number, string>();
    const titlePrefix = `E2E PR #${request.prNumber} @ `;
    const pageAdmission1 = GithubActionEvidenceApi.flattenApiPages(
      request.pages,
    );
    if (pageAdmission1.isErr()) return err(pageAdmission1.error);
    for (const page of pageAdmission1.value) {
      if (!UntrustedYamlBoundary.isRecord(page)) continue;
      const runsRequest: GitHubPropertyRequest = {
        record: page,
        key: 'workflow_runs',
      };
      for (const run of GithubActionEvidenceApi.requiredArrayProperty(
        runsRequest,
      )) {
        if (!UntrustedYamlBoundary.isRecord(run)) continue;
        const titleRequest: GitHubPropertyRequest = {
          record: run,
          key: 'display_title',
        };
        const displayTitle =
          GithubActionEvidenceApi.requiredStringProperty(titleRequest);
        if (!displayTitle.startsWith(titlePrefix)) {
          continue;
        }
        const idRequest: GitHubPropertyRequest = { record: run, key: 'id' };
        const runId = GithubActionEvidenceApi.requiredNumberProperty(idRequest);
        const sourceRequest: DispatchedSourceHeadRequest = {
          displayTitle,
          prNumber: request.prNumber,
          runId,
        };
        sourceHeadByRun.set(
          runId,
          GithubActionEvidenceApi.dispatchedSourceHead(sourceRequest),
        );
        selectedRuns.push(run);
      }
    }
    const selectedPageRecord = {
      total_count: selectedRuns.length,
      workflow_runs: selectedRuns,
    };
    const selectedPage = UntrustedYamlBoundary.seal(selectedPageRecord);
    const expandRequest: ExpandActionAttemptPagesRequest = {
      repoRoot: request.repoRoot,
      pages: UntrustedYamlBoundary.fromHost([selectedPage]),
    };
    const githubResult1 =
      GithubActionEvidenceApi.expandActionAttemptPages(expandRequest);
    if (githubResult1.isErr()) return err(githubResult1.error);
    const expanded = githubResult1.value;
    const associatedRuns: UntrustedYamlMap[] = [];
    const pageAdmission2 = GithubActionEvidenceApi.flattenApiPages(expanded);
    if (pageAdmission2.isErr()) return err(pageAdmission2.error);
    for (const page of pageAdmission2.value) {
      if (!UntrustedYamlBoundary.isRecord(page)) continue;
      const runsRequest: GitHubPropertyRequest = {
        record: page,
        key: 'workflow_runs',
      };
      for (const run of GithubActionEvidenceApi.requiredArrayProperty(
        runsRequest,
      )) {
        if (!UntrustedYamlBoundary.isRecord(run)) continue;
        const idRequest: GitHubPropertyRequest = { record: run, key: 'id' };
        const runId = GithubActionEvidenceApi.requiredNumberProperty(idRequest);
        const verifiedRequest: GitHubPropertyRequest = {
          record: run,
          key: 'source_verified',
        };
        const sourceVerified =
          GithubActionEvidenceApi.stringProperty(verifiedRequest) === 'true';
        const [headSha = ''] = [sourceHeadByRun.get(runId)];
        const associatedRecord = {
          ...run,
          head_sha: sourceVerified ? headSha : '',
          pull_requests: [{ number: request.prNumber }],
        };
        associatedRuns.push(UntrustedYamlBoundary.seal(associatedRecord));
      }
    }
    const associatedPageRecord = {
      total_count: selectedRuns.length,
      workflow_runs: associatedRuns,
    };
    const associatedPage = UntrustedYamlBoundary.seal(associatedPageRecord);
    return ok(UntrustedYamlBoundary.fromHost([associatedPage]));
  }

  static dispatchedSourceHead(request: DispatchedSourceHeadRequest): string {
    const prefix = `E2E PR #${request.prNumber} @ `;
    const suffixStart = request.displayTitle.indexOf(' · ', prefix.length);
    const headSha =
      suffixStart < 0
        ? ''
        : request.displayTitle.slice(prefix.length, suffixStart);
    return /^[0-9a-f]{40}$/.test(headSha) ? headSha : '';
  }

  static expandActionAttemptPages(
    request: ExpandActionAttemptPagesRequest,
  ): Result<UntrustedYamlNode, GitHubEvidenceFailure> {
    const pageAdmission3 = GithubActionEvidenceApi.flattenApiPages(
      request.pages,
    );
    if (pageAdmission3.isErr()) return err(pageAdmission3.error);
    const pages = pageAdmission3.value;
    const expandedRuns: UntrustedYamlMap[] = [];
    let expectedRunCount = 0;
    for (const page of pages) {
      if (!UntrustedYamlBoundary.isRecord(page)) {
        return err({
          code: LoomFailureCode.CommandFailed,
          message: 'GitHub Actions page must be a mapping',
        });
      }
      const totalRequest: GitHubPropertyRequest = {
        record: page,
        key: 'total_count',
      };
      expectedRunCount = Math.max(
        expectedRunCount,
        GithubActionEvidenceApi.requiredNumberProperty(totalRequest),
      );
      const runsRequest: GitHubPropertyRequest = {
        record: page,
        key: 'workflow_runs',
      };
      const runs = GithubActionEvidenceApi.requiredArrayProperty(runsRequest);
      for (const run of runs) {
        if (!UntrustedYamlBoundary.isRecord(run)) {
          return err({
            code: LoomFailureCode.CommandFailed,
            message: 'GitHub Actions run must be a mapping',
          });
        }
        const idRequest: GitHubPropertyRequest = { record: run, key: 'id' };
        const runId = GithubActionEvidenceApi.requiredNumberProperty(idRequest);
        const attemptRequest: GitHubPropertyRequest = {
          record: run,
          key: 'run_attempt',
        };
        const latestAttempt =
          GithubActionEvidenceApi.requiredNumberProperty(attemptRequest);
        for (let attempt = 1; attempt <= latestAttempt; attempt += 1) {
          const attemptApiRequest: GitHubApiRequest = {
            repoRoot: request.repoRoot,
            endpoint: `repos/{owner}/{repo}/actions/runs/${runId}/attempts/${attempt}`,
          };
          const githubResult2 =
            GithubActionEvidenceApi.runGitHubApi(attemptApiRequest);
          if (githubResult2.isErr()) return err(githubResult2.error);
          const pageAdmission4 = GithubActionEvidenceApi.flattenApiPages(
            githubResult2.value,
          );
          if (pageAdmission4.isErr()) return err(pageAdmission4.error);
          const attemptRecords = pageAdmission4.value;
          const attemptRecord = attemptRecords.find(
            UntrustedYamlBoundary.isRecord,
          );
          if (!attemptRecord) {
            return err({
              code: LoomFailureCode.CommandFailed,
              message: `GitHub Actions attempt ${runId}:${attempt} was not returned`,
            });
          }
          const validationRequest: ActionAttemptRequestedValidationRequest = {
            repoRoot: request.repoRoot,
            runId,
            attempt,
            attemptRecord,
          };
          const githubResult3 =
            GithubActionEvidenceApi.actionAttemptRequestedValidation(
              validationRequest,
            );
          if (githubResult3.isErr()) return err(githubResult3.error);
          const validationRequested = githubResult3.value;
          const sourceVerificationRequest: ActionAttemptSourceVerificationRequest =
            {
              repoRoot: request.repoRoot,
              runId,
              attempt,
              attemptRecord,
            };
          const githubResult4 =
            GithubActionEvidenceApi.actionAttemptSourceVerified(
              sourceVerificationRequest,
            );
          if (githubResult4.isErr()) return err(githubResult4.error);
          const sourceVerified = githubResult4.value;
          const expandedRecord = {
            ...attemptRecord,
            validation_requested: validationRequested ? 'true' : 'false',
            source_verified: sourceVerified ? 'true' : 'false',
          };
          expandedRuns.push(UntrustedYamlBoundary.seal(expandedRecord));
        }
      }
    }
    const expandedPageRecord = {
      total_count: expectedRunCount,
      workflow_runs: expandedRuns,
    };
    const expandedPage = UntrustedYamlBoundary.seal(expandedPageRecord);
    return ok(UntrustedYamlBoundary.fromHost([expandedPage]));
  }

  private static actionAttemptSourceVerified(
    request: ActionAttemptSourceVerificationRequest,
  ): Result<boolean, GitHubEvidenceFailure> {
    const workflowRequest: GitHubPropertyRequest = {
      record: request.attemptRecord,
      key: 'name',
    };
    if (
      GithubActionEvidenceApi.requiredStringProperty(workflowRequest) !==
      'E2E (PR)'
    )
      return ok(true);
    const jobsRequest: GitHubApiRequest = {
      repoRoot: request.repoRoot,
      endpoint: `repos/{owner}/{repo}/actions/runs/${request.runId}/attempts/${request.attempt}/jobs`,
      fields: ['per_page=100'],
    };
    const githubResult5 = GithubActionEvidenceApi.runGitHubApi(jobsRequest);
    if (githubResult5.isErr()) return err(githubResult5.error);
    const pageAdmission5 = GithubActionEvidenceApi.flattenApiPages(
      githubResult5.value,
    );
    if (pageAdmission5.isErr()) return err(pageAdmission5.error);
    for (const page of pageAdmission5.value) {
      if (!UntrustedYamlBoundary.isRecord(page)) {
        return err({
          code: LoomFailureCode.CommandFailed,
          message: 'GitHub Actions jobs page must be a mapping',
        });
      }
      const jobsProperty: GitHubPropertyRequest = { record: page, key: 'jobs' };
      const verificationRequest: ActionJobsVerifiedSourceRequest = {
        jobs: GithubActionEvidenceApi.requiredArrayProperty(jobsProperty),
      };
      if (GithubActionEvidenceApi.actionJobsVerifiedSource(verificationRequest))
        return ok(true);
    }
    return ok(false);
  }

  static actionJobsVerifiedSource(
    request: ActionJobsVerifiedSourceRequest,
  ): boolean {
    return request.jobs.some((job) => {
      if (!UntrustedYamlBoundary.isRecord(job)) return false;
      const nameRequest: GitHubPropertyRequest = { record: job, key: 'name' };
      if (
        GithubActionEvidenceApi.requiredStringProperty(nameRequest) !==
        'Build PR browser image'
      ) {
        return false;
      }
      const stepsRequest: GitHubPropertyRequest = { record: job, key: 'steps' };
      const stepsArgs: UntrustedYamlPropertyArgs = stepsRequest;
      const stepsProperty = UntrustedYamlBoundary.property(stepsArgs);
      if (stepsProperty.presence === UntrustedYamlPropertyPresence.Absent) {
        return false;
      }
      if (!Array.isArray(stepsProperty.value)) {
        GithubActionEvidenceApi.failGitHubCollection(
          'GitHub field steps must be a list',
        );
      }
      return stepsProperty.value.some((step) => {
        if (!UntrustedYamlBoundary.isRecord(step)) return false;
        const stepNameRequest: GitHubPropertyRequest = {
          record: step,
          key: 'name',
        };
        const conclusionRequest: GitHubPropertyRequest = {
          record: step,
          key: 'conclusion',
        };
        return (
          GithubActionEvidenceApi.requiredStringProperty(stepNameRequest) ===
            'Resolve PR head SHA' &&
          GithubActionEvidenceApi.stringProperty(conclusionRequest) ===
            'success'
        );
      });
    });
  }

  private static actionAttemptRequestedValidation(
    request: ActionAttemptRequestedValidationRequest,
  ): Result<boolean, GitHubEvidenceFailure> {
    const workflowRequest: GitHubPropertyRequest = {
      record: request.attemptRecord,
      key: 'name',
    };
    const workflow =
      GithubActionEvidenceApi.requiredStringProperty(workflowRequest);
    const gateJobName =
      workflow === 'PR'
        ? 'Validate explicit CI request'
        : workflow === 'Rust ecosystem checks'
          ? 'Validate explicit ecosystem request'
          : '';
    if (gateJobName.length === 0) return ok(true);
    const jobsRequest: GitHubApiRequest = {
      repoRoot: request.repoRoot,
      endpoint: `repos/{owner}/{repo}/actions/runs/${request.runId}/attempts/${request.attempt}/jobs`,
      fields: ['per_page=100'],
    };
    const githubResult6 = GithubActionEvidenceApi.runGitHubApi(jobsRequest);
    if (githubResult6.isErr()) return err(githubResult6.error);
    const pageAdmission6 = GithubActionEvidenceApi.flattenApiPages(
      githubResult6.value,
    );
    if (pageAdmission6.isErr()) return err(pageAdmission6.error);
    for (const page of pageAdmission6.value) {
      if (!UntrustedYamlBoundary.isRecord(page)) {
        return err({
          code: LoomFailureCode.CommandFailed,
          message: 'GitHub Actions jobs page must be a mapping',
        });
      }
      const jobsProperty: GitHubPropertyRequest = { record: page, key: 'jobs' };
      const validationRequest: ActionJobsRequestedValidationRequest = {
        jobs: GithubActionEvidenceApi.requiredArrayProperty(jobsProperty),
        gateJobName,
      };
      if (
        GithubActionEvidenceApi.actionJobsRequestedValidation(validationRequest)
      )
        return ok(true);
    }
    return ok(false);
  }

  static actionJobsRequestedValidation(
    request: ActionJobsRequestedValidationRequest,
  ): boolean {
    const supportedGateRequest = request.jobs.some((job) => {
      if (!UntrustedYamlBoundary.isRecord(job)) return false;
      const nameRequest: GitHubPropertyRequest = { record: job, key: 'name' };
      if (
        GithubActionEvidenceApi.requiredStringProperty(nameRequest) !==
        request.gateJobName
      ) {
        return false;
      }
      const stepsRequest: GitHubPropertyRequest = { record: job, key: 'steps' };
      const stepsArgs: UntrustedYamlPropertyArgs = stepsRequest;
      const stepsProperty = UntrustedYamlBoundary.property(stepsArgs);
      if (stepsProperty.presence === UntrustedYamlPropertyPresence.Absent) {
        return false;
      }
      if (!Array.isArray(stepsProperty.value)) {
        GithubActionEvidenceApi.failGitHubCollection(
          'GitHub field steps must be a list',
        );
      }
      return stepsProperty.value.some((step) => {
        if (!UntrustedYamlBoundary.isRecord(step)) return false;
        const stepNameRequest: GitHubPropertyRequest = {
          record: step,
          key: 'name',
        };
        const stepConclusionRequest: GitHubPropertyRequest = {
          record: step,
          key: 'conclusion',
        };
        return (
          GithubActionEvidenceApi.requiredStringProperty(stepNameRequest) ===
            'Reject unsupported label events' &&
          GithubActionEvidenceApi.stringProperty(stepConclusionRequest) ===
            'success'
        );
      });
    });
    if (supportedGateRequest) return true;
    return request.jobs.some((job) => {
      if (!UntrustedYamlBoundary.isRecord(job)) return false;
      const nameRequest: GitHubPropertyRequest = { record: job, key: 'name' };
      const conclusionRequest: GitHubPropertyRequest = {
        record: job,
        key: 'conclusion',
      };
      return (
        GithubActionEvidenceApi.requiredStringProperty(nameRequest) !==
          request.gateJobName &&
        GithubActionEvidenceApi.stringProperty(conclusionRequest) !== 'skipped'
      );
    });
  }

  static runGitHubApi(
    request: GitHubApiRequest,
  ): Result<UntrustedYamlNode, GitHubEvidenceFailure> {
    const args = [
      'api',
      '--paginate',
      '--slurp',
      '-X',
      'GET',
      request.endpoint,
    ];
    const [defaulted1 = []] = [request.fields];
    for (const field of defaulted1) args.push('-f', field);
    const commandRequest: RunCommandArgs = {
      command: 'gh',
      args,
      cwd: request.repoRoot,
      outputPolicy: CommandOutputPolicy.GitHubApi,
    };
    const output = HostCommand.run(commandRequest);
    if (output.exitCode !== 0) {
      return err({
        code: LoomFailureCode.CommandFailed,
        message: output.stderr || output.stdout || 'GitHub API request failed',
      });
    }
    try {
      return ok(
        UntrustedYamlBoundary.fromHost(
          JSON.parse(output.stdout) as UntrustedYamlNode,
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err({
        code: LoomFailureCode.CommandFailed,
        message: `GitHub API response is invalid JSON: ${message}`,
      });
    }
  }

  static flattenApiPages(
    value: UntrustedYamlNode,
  ): Result<UntrustedYamlNode[], GitHubEvidenceFailure> {
    if (!Array.isArray(value)) {
      return err({
        code: LoomFailureCode.CommandFailed,
        message: 'GitHub API pagination did not return a list',
      });
    }
    const flattened: UntrustedYamlNode[] = [];
    for (const page of value) {
      if (Array.isArray(page)) flattened.push(...page);
      else flattened.push(page);
    }
    return ok(flattened);
  }

  static stringProperty(request: GitHubPropertyRequest): string {
    const args: UntrustedYamlPropertyArgs = request;
    const property = UntrustedYamlBoundary.property(args);
    return property.presence === UntrustedYamlPropertyPresence.Present &&
      typeof property.value === 'string'
      ? property.value
      : '';
  }

  static numberProperty(request: GitHubPropertyRequest): number {
    const args: UntrustedYamlPropertyArgs = request;
    const property = UntrustedYamlBoundary.property(args);
    return property.presence === UntrustedYamlPropertyPresence.Present &&
      typeof property.value === 'number'
      ? property.value
      : 0;
  }

  static requiredStringProperty(request: GitHubPropertyRequest): string {
    const value = GithubActionEvidenceApi.stringProperty(request);
    if (value.length === 0) {
      GithubActionEvidenceApi.failGitHubCollection(
        `GitHub field ${request.key} must be a non-empty string`,
      );
    }
    return value;
  }

  static requiredNumberProperty(request: GitHubPropertyRequest): number {
    const args: UntrustedYamlPropertyArgs = request;
    const property = UntrustedYamlBoundary.property(args);
    if (
      property.presence === UntrustedYamlPropertyPresence.Absent ||
      typeof property.value !== 'number' ||
      !Number.isInteger(property.value) ||
      property.value < 0
    ) {
      GithubActionEvidenceApi.failGitHubCollection(
        `GitHub field ${request.key} must be a non-negative integer`,
      );
    }
    return property.value;
  }

  static requiredArrayProperty(
    request: GitHubPropertyRequest,
  ): readonly UntrustedYamlNode[] {
    const args: UntrustedYamlPropertyArgs = request;
    const property = UntrustedYamlBoundary.property(args);
    if (
      property.presence === UntrustedYamlPropertyPresence.Absent ||
      !Array.isArray(property.value)
    ) {
      GithubActionEvidenceApi.failGitHubCollection(
        `GitHub field ${request.key} must be a list`,
      );
    }
    return property.value;
  }

  static failGitHubCollection(message: string): never {
    const detail: LoomFailureDetailArgs = {
      code: LoomFailureCode.CommandFailed,
      text: message,
    };
    LoomFailure.detail(detail);
  }
}

export type GitHubApiRequest = {
  readonly repoRoot: string;
  readonly endpoint: string;
  readonly fields?: readonly string[];
};

export type GitHubPropertyRequest = {
  readonly record: UntrustedYamlMap;
  readonly key: string;
};

export type ExpandActionAttemptPagesRequest = {
  readonly repoRoot: string;
  readonly pages: UntrustedYamlNode;
};

export type CollectDispatchedActionAttemptPagesRequest = {
  readonly repoRoot: string;
  readonly pages: UntrustedYamlNode;
  readonly prNumber: number;
};

type DispatchedSourceHeadRequest = {
  readonly displayTitle: string;
  readonly prNumber: number;
  readonly runId: number;
};

type ActionAttemptSourceVerificationRequest = {
  readonly repoRoot: string;
  readonly runId: number;
  readonly attempt: number;
  readonly attemptRecord: UntrustedYamlMap;
};

export type ActionJobsVerifiedSourceRequest = {
  readonly jobs: readonly UntrustedYamlNode[];
};

type ActionAttemptRequestedValidationRequest = {
  readonly repoRoot: string;
  readonly runId: number;
  readonly attempt: number;
  readonly attemptRecord: UntrustedYamlMap;
};

export type ActionJobsRequestedValidationRequest = {
  readonly jobs: readonly UntrustedYamlNode[];
  readonly gateJobName: string;
};

export type GitHubEvidenceFailure = {
  readonly code: LoomFailureCode;
  readonly message: string;
};
