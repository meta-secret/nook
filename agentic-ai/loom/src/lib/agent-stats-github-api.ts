import { GitHubEvidenceField } from './agent-stats-github-field.ts';
import {
  GitHubActionJobs,
  GitHubSourceVerification,
  GitHubValidationRequest,
} from './agent-stats-github-jobs.ts';
import { err, ok, type Result } from 'neverthrow';
import {
  type UntrustedYamlMap,
  type UntrustedYamlNode,
  UntrustedYamlBoundary,
} from './guards.ts';

import {
  CommandOutputPolicy,
  RepositoryCommand,
  RepositoryCommandExecutable,
} from './run.ts';

import { LoomFailureCode } from '../loom-failure.ts';

import type { RepositoryCommandRequest } from './run.ts';

export class GithubActionEvidenceApi {
  constructor(private readonly request: GitHubApiRequest) {}
  execute(): Result<UntrustedYamlNode, GitHubEvidenceFailure> {
    const request = this.request;
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
    const commandRequest: RepositoryCommandRequest = {
      command: RepositoryCommandExecutable.GitHub,
      args,
      rootDirectory: request.repoRoot,
      workingDirectory: request.repoRoot,
      outputPolicy: CommandOutputPolicy.GitHubApi,
    };
    const outputLaunch = new RepositoryCommand(commandRequest).execute();
    if (outputLaunch.isErr()) return err(outputLaunch.error);
    const output = outputLaunch.value;
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
}
export class GitHubDispatchedActionPages {
  constructor(
    private readonly request: CollectDispatchedActionAttemptPagesRequest,
  ) {}
  collect(): Result<UntrustedYamlNode, GitHubEvidenceFailure> {
    const request = this.request;
    const selectedRuns: UntrustedYamlMap[] = [];
    const sourceHeadByRun = new Map<number, string>();
    const titlePrefix = `E2E PR #${request.prNumber} @ `;
    const pageAdmission1 = new GitHubApiPages(request.pages).flatten();
    if (pageAdmission1.isErr()) return err(pageAdmission1.error);
    for (const page of pageAdmission1.value) {
      if (!UntrustedYamlBoundary.isRecord(page)) continue;
      const runsRequest: GitHubPropertyRequest = {
        record: page,
        key: 'workflow_runs',
      };
      const requiredField1 = new GitHubEvidenceField(runsRequest).array();
      if (requiredField1.isErr()) return err(requiredField1.error);
      for (const run of requiredField1.value) {
        if (!UntrustedYamlBoundary.isRecord(run)) continue;
        const titleRequest: GitHubPropertyRequest = {
          record: run,
          key: 'display_title',
        };
        const requiredField2 = new GitHubEvidenceField(titleRequest).string();
        if (requiredField2.isErr()) return err(requiredField2.error);
        const displayTitle = requiredField2.value;
        if (!displayTitle.startsWith(titlePrefix)) {
          continue;
        }
        const idRequest: GitHubPropertyRequest = { record: run, key: 'id' };
        const requiredField3 = new GitHubEvidenceField(idRequest).number();
        if (requiredField3.isErr()) return err(requiredField3.error);
        const runId = requiredField3.value;
        const sourceRequest: DispatchedSourceHeadRequest = {
          displayTitle,
          prNumber: request.prNumber,
          runId,
        };
        sourceHeadByRun.set(
          runId,
          new GitHubDispatchTitle(sourceRequest).sourceHead(),
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
    const githubResult1 = new GitHubActionAttemptPages(expandRequest).expand();
    if (githubResult1.isErr()) return err(githubResult1.error);
    const expanded = githubResult1.value;
    const associatedRuns: UntrustedYamlMap[] = [];
    const pageAdmission2 = new GitHubApiPages(expanded).flatten();
    if (pageAdmission2.isErr()) return err(pageAdmission2.error);
    for (const page of pageAdmission2.value) {
      if (!UntrustedYamlBoundary.isRecord(page)) continue;
      const runsRequest: GitHubPropertyRequest = {
        record: page,
        key: 'workflow_runs',
      };
      const requiredField4 = new GitHubEvidenceField(runsRequest).array();
      if (requiredField4.isErr()) return err(requiredField4.error);
      for (const run of requiredField4.value) {
        if (!UntrustedYamlBoundary.isRecord(run)) continue;
        const idRequest: GitHubPropertyRequest = { record: run, key: 'id' };
        const requiredField5 = new GitHubEvidenceField(idRequest).number();
        if (requiredField5.isErr()) return err(requiredField5.error);
        const runId = requiredField5.value;
        const verifiedRequest: GitHubPropertyRequest = {
          record: run,
          key: 'source_verified',
        };
        const sourceVerified =
          new GitHubEvidenceField(verifiedRequest).optionalString() === 'true';
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
}
export class GitHubActionAttemptPages {
  constructor(private readonly request: ExpandActionAttemptPagesRequest) {}
  expand(): Result<UntrustedYamlNode, GitHubEvidenceFailure> {
    const request = this.request;
    const pageAdmission3 = new GitHubApiPages(request.pages).flatten();
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
      const requiredField6 = new GitHubEvidenceField(totalRequest).number();
      if (requiredField6.isErr()) return err(requiredField6.error);
      expectedRunCount = Math.max(expectedRunCount, requiredField6.value);
      const runsRequest: GitHubPropertyRequest = {
        record: page,
        key: 'workflow_runs',
      };
      const requiredField7 = new GitHubEvidenceField(runsRequest).array();
      if (requiredField7.isErr()) return err(requiredField7.error);
      const runs = requiredField7.value;
      for (const run of runs) {
        if (!UntrustedYamlBoundary.isRecord(run)) {
          return err({
            code: LoomFailureCode.CommandFailed,
            message: 'GitHub Actions run must be a mapping',
          });
        }
        const idRequest: GitHubPropertyRequest = { record: run, key: 'id' };
        const requiredField8 = new GitHubEvidenceField(idRequest).number();
        if (requiredField8.isErr()) return err(requiredField8.error);
        const runId = requiredField8.value;
        const attemptRequest: GitHubPropertyRequest = {
          record: run,
          key: 'run_attempt',
        };
        const requiredField9 = new GitHubEvidenceField(attemptRequest).number();
        if (requiredField9.isErr()) return err(requiredField9.error);
        const latestAttempt = requiredField9.value;
        for (let attempt = 1; attempt <= latestAttempt; attempt += 1) {
          const attemptApiRequest: GitHubApiRequest = {
            repoRoot: request.repoRoot,
            endpoint: `repos/{owner}/{repo}/actions/runs/${runId}/attempts/${attempt}`,
          };
          const githubResult2 = new GithubActionEvidenceApi(
            attemptApiRequest,
          ).execute();
          if (githubResult2.isErr()) return err(githubResult2.error);
          const pageAdmission4 = new GitHubApiPages(
            githubResult2.value,
          ).flatten();
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
          const validationRequest: ActionAttemptSourceVerificationRequest = {
            repoRoot: request.repoRoot,
            runId,
            attempt,
            attemptRecord,
          };
          const githubResult3 = new GitHubActionAttempt(
            validationRequest,
          ).validationRequest();
          if (githubResult3.isErr()) return err(githubResult3.error);
          const validationRequested = githubResult3.value;
          const sourceVerificationRequest: ActionAttemptSourceVerificationRequest =
            {
              repoRoot: request.repoRoot,
              runId,
              attempt,
              attemptRecord,
            };
          const githubResult4 = new GitHubActionAttempt(
            sourceVerificationRequest,
          ).sourceVerification();
          if (githubResult4.isErr()) return err(githubResult4.error);
          const sourceVerified = githubResult4.value;
          const expandedRecord = {
            ...attemptRecord,
            validation_requested:
              validationRequested === GitHubValidationRequest.Requested
                ? 'true'
                : 'false',
            source_verified:
              sourceVerified === GitHubSourceVerification.Verified
                ? 'true'
                : 'false',
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
}
export class GitHubActionAttempt {
  constructor(
    private readonly request: ActionAttemptSourceVerificationRequest,
  ) {}
  sourceVerification(): Result<
    GitHubSourceVerification,
    GitHubEvidenceFailure
  > {
    const request = this.request;
    const workflowRequest: GitHubPropertyRequest = {
      record: request.attemptRecord,
      key: 'name',
    };
    const requiredField10 = new GitHubEvidenceField(workflowRequest).string();
    if (requiredField10.isErr()) return err(requiredField10.error);
    if (requiredField10.value !== 'E2E (PR)')
      return ok(GitHubSourceVerification.Verified);
    const jobsRequest: GitHubApiRequest = {
      repoRoot: request.repoRoot,
      endpoint: `repos/{owner}/{repo}/actions/runs/${request.runId}/attempts/${request.attempt}/jobs`,
      fields: ['per_page=100'],
    };
    const githubResult5 = new GithubActionEvidenceApi(jobsRequest).execute();
    if (githubResult5.isErr()) return err(githubResult5.error);
    const pageAdmission5 = new GitHubApiPages(githubResult5.value).flatten();
    if (pageAdmission5.isErr()) return err(pageAdmission5.error);
    for (const page of pageAdmission5.value) {
      if (!UntrustedYamlBoundary.isRecord(page)) {
        return err({
          code: LoomFailureCode.CommandFailed,
          message: 'GitHub Actions jobs page must be a mapping',
        });
      }
      const jobsProperty: GitHubPropertyRequest = { record: page, key: 'jobs' };
      const requiredField11 = new GitHubEvidenceField(jobsProperty).array();
      if (requiredField11.isErr()) return err(requiredField11.error);
      const verificationRequest: ActionJobsVerifiedSourceRequest = {
        jobs: requiredField11.value,
      };
      const verification = new GitHubActionJobs(
        verificationRequest.jobs,
      ).sourceVerification();
      if (verification.isErr()) return err(verification.error);
      if (verification.value === GitHubSourceVerification.Verified)
        return verification;
    }
    return ok(GitHubSourceVerification.Unverified);
  }
  validationRequest(): Result<GitHubValidationRequest, GitHubEvidenceFailure> {
    const request = this.request;
    const workflowRequest: GitHubPropertyRequest = {
      record: request.attemptRecord,
      key: 'name',
    };
    const requiredField12 = new GitHubEvidenceField(workflowRequest).string();
    if (requiredField12.isErr()) return err(requiredField12.error);
    const workflow = requiredField12.value;
    const gateJobName =
      workflow === 'PR'
        ? 'Validate explicit CI request'
        : workflow === 'Rust ecosystem checks'
          ? 'Validate explicit ecosystem request'
          : '';
    if (gateJobName.length === 0) return ok(GitHubValidationRequest.Requested);
    const jobsRequest: GitHubApiRequest = {
      repoRoot: request.repoRoot,
      endpoint: `repos/{owner}/{repo}/actions/runs/${request.runId}/attempts/${request.attempt}/jobs`,
      fields: ['per_page=100'],
    };
    const githubResult6 = new GithubActionEvidenceApi(jobsRequest).execute();
    if (githubResult6.isErr()) return err(githubResult6.error);
    const pageAdmission6 = new GitHubApiPages(githubResult6.value).flatten();
    if (pageAdmission6.isErr()) return err(pageAdmission6.error);
    for (const page of pageAdmission6.value) {
      if (!UntrustedYamlBoundary.isRecord(page)) {
        return err({
          code: LoomFailureCode.CommandFailed,
          message: 'GitHub Actions jobs page must be a mapping',
        });
      }
      const jobsProperty: GitHubPropertyRequest = { record: page, key: 'jobs' };
      const requiredField13 = new GitHubEvidenceField(jobsProperty).array();
      if (requiredField13.isErr()) return err(requiredField13.error);
      const validationRequest: ActionJobsRequestedValidationRequest = {
        jobs: requiredField13.value,
        gateJobName,
      };
      const validation = new GitHubActionJobs(
        validationRequest.jobs,
      ).validationRequest(validationRequest.gateJobName);
      if (validation.isErr()) return err(validation.error);
      if (validation.value === GitHubValidationRequest.Requested)
        return validation;
    }
    return ok(GitHubValidationRequest.NotRequested);
  }
}
export class GitHubDispatchTitle {
  constructor(private readonly request: DispatchedSourceHeadRequest) {}
  sourceHead(): string {
    const request = this.request;
    const prefix = `E2E PR #${request.prNumber} @ `;
    const suffixStart = request.displayTitle.indexOf(' · ', prefix.length);
    const headSha =
      suffixStart < 0
        ? ''
        : request.displayTitle.slice(prefix.length, suffixStart);
    return /^[0-9a-f]{40}$/.test(headSha) ? headSha : '';
  }
}
export class GitHubApiPages {
  constructor(private readonly request: UntrustedYamlNode) {}
  flatten(): Result<UntrustedYamlNode[], GitHubEvidenceFailure> {
    const value = this.request;
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

export type ActionJobsRequestedValidationRequest = {
  readonly jobs: readonly UntrustedYamlNode[];
  readonly gateJobName: string;
};

export type GitHubEvidenceFailure = {
  readonly code: LoomFailureCode;
  readonly message: string;
};
