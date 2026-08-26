import {
  UntrustedYamlPropertyPresence,
  asUntrustedYamlNode,
  isRecord,
  sealUntrustedYamlMap,
  untrustedYamlProperty,
  type UntrustedYamlMap,
  type UntrustedYamlNode,
} from './guards.ts';
import { runCommand } from './run.ts';
import { LoomFailureCode, loomFailureDetail } from '../loom-failure.ts';

import type { UntrustedYamlPropertyArgs } from './guards.ts';
import type { RunCommandArgs } from './run.ts';
import type { LoomFailureDetailArgs } from '../loom-failure.ts';

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

export function expandActionAttemptPages(
  request: ExpandActionAttemptPagesRequest,
): UntrustedYamlNode {
  const pages = flattenApiPages(request.pages);
  const expandedRuns: UntrustedYamlMap[] = [];
  let expectedRunCount = 0;
  for (const page of pages) {
    if (!isRecord(page)) {
      failGitHubCollection('GitHub Actions page must be a mapping');
    }
    const totalRequest: GitHubPropertyRequest = {
      record: page,
      key: 'total_count',
    };
    expectedRunCount = Math.max(
      expectedRunCount,
      requiredNumberProperty(totalRequest),
    );
    const runsRequest: GitHubPropertyRequest = {
      record: page,
      key: 'workflow_runs',
    };
    const runs = requiredArrayProperty(runsRequest);
    for (const run of runs) {
      if (!isRecord(run)) {
        failGitHubCollection('GitHub Actions run must be a mapping');
      }
      const idRequest: GitHubPropertyRequest = { record: run, key: 'id' };
      const runId = requiredNumberProperty(idRequest);
      const attemptRequest: GitHubPropertyRequest = {
        record: run,
        key: 'run_attempt',
      };
      const latestAttempt = requiredNumberProperty(attemptRequest);
      for (let attempt = 1; attempt <= latestAttempt; attempt += 1) {
        const attemptApiRequest: GitHubApiRequest = {
          repoRoot: request.repoRoot,
          endpoint: `repos/{owner}/{repo}/actions/runs/${runId}/attempts/${attempt}`,
        };
        const attemptRecords = flattenApiPages(runGitHubApi(attemptApiRequest));
        const attemptRecord = attemptRecords.find(isRecord);
        if (!attemptRecord) {
          failGitHubCollection(
            `GitHub Actions attempt ${runId}:${attempt} was not returned`,
          );
        }
        const validationRequest: ActionAttemptRequestedValidationRequest = {
          repoRoot: request.repoRoot,
          runId,
          attempt,
          attemptRecord,
        };
        const validationRequested =
          actionAttemptRequestedValidation(validationRequest);
        const expandedRecord = {
          ...attemptRecord,
          validation_requested: validationRequested ? 'true' : 'false',
        };
        expandedRuns.push(sealUntrustedYamlMap(expandedRecord));
      }
    }
  }
  const expandedPageRecord = {
    total_count: expectedRunCount,
    workflow_runs: expandedRuns,
  };
  const expandedPage = sealUntrustedYamlMap(expandedPageRecord);
  return asUntrustedYamlNode([expandedPage]);
}

type ActionAttemptRequestedValidationRequest = {
  readonly repoRoot: string;
  readonly runId: number;
  readonly attempt: number;
  readonly attemptRecord: UntrustedYamlMap;
};

function actionAttemptRequestedValidation(
  request: ActionAttemptRequestedValidationRequest,
): boolean {
  const workflowRequest: GitHubPropertyRequest = {
    record: request.attemptRecord,
    key: 'name',
  };
  const workflow = requiredStringProperty(workflowRequest);
  const gateJobName =
    workflow === 'PR'
      ? 'Validate explicit CI request'
      : workflow === 'Rust ecosystem checks'
        ? 'Validate explicit ecosystem request'
        : '';
  if (gateJobName.length === 0) return true;
  const jobsRequest: GitHubApiRequest = {
    repoRoot: request.repoRoot,
    endpoint: `repos/{owner}/{repo}/actions/runs/${request.runId}/attempts/${request.attempt}/jobs`,
    fields: ['per_page=100'],
  };
  for (const page of flattenApiPages(runGitHubApi(jobsRequest))) {
    if (!isRecord(page)) {
      failGitHubCollection('GitHub Actions jobs page must be a mapping');
    }
    const jobsProperty: GitHubPropertyRequest = { record: page, key: 'jobs' };
    const validationRequest: ActionJobsRequestedValidationRequest = {
      jobs: requiredArrayProperty(jobsProperty),
      gateJobName,
    };
    if (actionJobsRequestedValidation(validationRequest)) return true;
  }
  return false;
}

export type ActionJobsRequestedValidationRequest = {
  readonly jobs: readonly UntrustedYamlNode[];
  readonly gateJobName: string;
};

export function actionJobsRequestedValidation(
  request: ActionJobsRequestedValidationRequest,
): boolean {
  const supportedGateRequest = request.jobs.some((job) => {
    if (!isRecord(job)) return false;
    const nameRequest: GitHubPropertyRequest = { record: job, key: 'name' };
    if (requiredStringProperty(nameRequest) !== request.gateJobName) {
      return false;
    }
    const stepsRequest: GitHubPropertyRequest = { record: job, key: 'steps' };
    const stepsArgs: UntrustedYamlPropertyArgs = stepsRequest;
    const stepsProperty = untrustedYamlProperty(stepsArgs);
    if (stepsProperty.presence === UntrustedYamlPropertyPresence.Absent) {
      return false;
    }
    if (!Array.isArray(stepsProperty.value)) {
      failGitHubCollection('GitHub field steps must be a list');
    }
    return stepsProperty.value.some((step) => {
      if (!isRecord(step)) return false;
      const stepNameRequest: GitHubPropertyRequest = {
        record: step,
        key: 'name',
      };
      const stepConclusionRequest: GitHubPropertyRequest = {
        record: step,
        key: 'conclusion',
      };
      return (
        requiredStringProperty(stepNameRequest) ===
          'Reject unsupported label events' &&
        stringProperty(stepConclusionRequest) === 'success'
      );
    });
  });
  if (supportedGateRequest) return true;
  return request.jobs.some((job) => {
    if (!isRecord(job)) return false;
    const nameRequest: GitHubPropertyRequest = { record: job, key: 'name' };
    const conclusionRequest: GitHubPropertyRequest = {
      record: job,
      key: 'conclusion',
    };
    return (
      requiredStringProperty(nameRequest) !== request.gateJobName &&
      stringProperty(conclusionRequest) !== 'skipped'
    );
  });
}

export function runGitHubApi(request: GitHubApiRequest): UntrustedYamlNode {
  const args = ['api', '--paginate', '--slurp', '-X', 'GET', request.endpoint];
  for (const field of request.fields ?? []) args.push('-f', field);
  const commandRequest: RunCommandArgs = {
    command: 'gh',
    args,
    cwd: request.repoRoot,
  };
  const output = runCommand(commandRequest);
  if (output.exitCode !== 0) {
    failGitHubCollection(
      output.stderr || output.stdout || 'GitHub API request failed',
    );
  }
  try {
    return asUntrustedYamlNode(JSON.parse(output.stdout) as UntrustedYamlNode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failGitHubCollection(`GitHub API response is invalid JSON: ${message}`);
  }
}

export function flattenApiPages(value: UntrustedYamlNode): UntrustedYamlNode[] {
  if (!Array.isArray(value)) {
    failGitHubCollection('GitHub API pagination did not return a list');
  }
  const flattened: UntrustedYamlNode[] = [];
  for (const page of value) {
    if (Array.isArray(page)) flattened.push(...page);
    else flattened.push(page);
  }
  return flattened;
}

export function stringProperty(request: GitHubPropertyRequest): string {
  const args: UntrustedYamlPropertyArgs = request;
  const property = untrustedYamlProperty(args);
  return property.presence === UntrustedYamlPropertyPresence.Present &&
    typeof property.value === 'string'
    ? property.value
    : '';
}

export function numberProperty(request: GitHubPropertyRequest): number {
  const args: UntrustedYamlPropertyArgs = request;
  const property = untrustedYamlProperty(args);
  return property.presence === UntrustedYamlPropertyPresence.Present &&
    typeof property.value === 'number'
    ? property.value
    : 0;
}

export function requiredStringProperty(request: GitHubPropertyRequest): string {
  const value = stringProperty(request);
  if (value.length === 0) {
    failGitHubCollection(
      `GitHub field ${request.key} must be a non-empty string`,
    );
  }
  return value;
}

export function requiredNumberProperty(request: GitHubPropertyRequest): number {
  const args: UntrustedYamlPropertyArgs = request;
  const property = untrustedYamlProperty(args);
  if (
    property.presence === UntrustedYamlPropertyPresence.Absent ||
    typeof property.value !== 'number' ||
    !Number.isInteger(property.value) ||
    property.value < 0
  ) {
    failGitHubCollection(
      `GitHub field ${request.key} must be a non-negative integer`,
    );
  }
  return property.value;
}

export function requiredArrayProperty(
  request: GitHubPropertyRequest,
): readonly UntrustedYamlNode[] {
  const args: UntrustedYamlPropertyArgs = request;
  const property = untrustedYamlProperty(args);
  if (
    property.presence === UntrustedYamlPropertyPresence.Absent ||
    !Array.isArray(property.value)
  ) {
    failGitHubCollection(`GitHub field ${request.key} must be a list`);
  }
  return property.value;
}

export function failGitHubCollection(message: string): never {
  const detail: LoomFailureDetailArgs = {
    code: LoomFailureCode.CommandFailed,
    text: message,
  };
  loomFailureDetail(detail);
}
