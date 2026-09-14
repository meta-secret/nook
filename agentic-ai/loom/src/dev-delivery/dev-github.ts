import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

import { CommandFailureMessage } from './dev-command.ts';
import { GitHubJsonDocument } from './dev-github-json.ts';
import {
  DevelopmentPullRequestGateway,
  type AdmittedDevelopmentPullRequest,
  type DevelopmentPullRequestLookup,
  type DevelopmentPullRequestMutationRequest,
} from './dev-github-pull-request.ts';
import {
  CommandExecutable,
  type CommandOutput,
  type CommandRunner,
  DevFailureKind,
  type DevFailure,
  type BuildProof,
  type BuildProofRequest,
  type CiAttempt,
  CommitSha,
  type DevelopmentCiObservationRequest,
  type DevelopmentCiAttemptPolicyRequest,
  type DevelopmentPullRequest,
  PullRequestNumber,
  type PullRequestStatus,
  RepositorySlug,
  WorkflowRunId,
} from './dev-types.ts';

export { GitHubJsonDocument } from './dev-github-json.ts';
export {
  DevelopmentPullRequestLookupKind,
  type AdmittedDevelopmentPullRequest,
  type DevelopmentPullRequestLookup,
  type DevelopmentPullRequestMutationRequest,
  type PullRequestReviewEvidenceRequest,
} from './dev-github-pull-request.ts';

export const DevDeliveryContract = {
  remoteBuild: {
    workflowName: 'Remote task',
    taskName: 'build:compile',
    jobName: 'Remote / build:compile',
    titlePattern:
      /^Remote \/ build:compile @ ([0-9a-f]{40}) \/ compile-cache=(?:publish|read-only) \/ [A-Za-z0-9._-]+$/u,
  },
  promotion: {
    workflowName: 'CI',
    requiredJobs: ['Dev promotion readiness'],
  },
  pagesEnvironment: 'github-pages',
} as const;

/** Rejects every non-terminal prior CI attempt before a dev publication. */
export class DevelopmentCiAttemptPolicy {
  requireTerminal(
    request: DevelopmentCiAttemptPolicyRequest,
  ): Result<void, DevFailure> {
    if (!request.replacement) return ok();
    if (request.attempts.length === 0) {
      return err({
        kind: DevFailureKind.Checks,
        message:
          'No exact-head CI attempt is discoverable for the prior dev pull-request head; refusing to replace it',
      });
    }
    const active = request.attempts.find(
      (attempt) => attempt.status !== 'completed',
    );
    if (active) {
      return err({
        kind: DevFailureKind.Checks,
        message: `The prior dev pull-request CI attempt ${active.runId.value()} is ${active.status}; wait for its terminal outcome before changing origin/dev`,
      });
    }
    return ok();
  }
}

const remoteRunSchema = z.object({
  databaseId: z.number().int().positive(),
  headBranch: z.string(),
  headSha: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  event: z.string(),
  workflowName: z.string(),
  displayTitle: z.string(),
});
const remoteRunListSchema = z.array(remoteRunSchema);
type RemoteRunRecord = z.infer<typeof remoteRunSchema>;

const runJobSchema = z.object({
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
});
const runJobsSchema = z.object({ jobs: z.array(runJobSchema) });
type RunJobRecord = z.infer<typeof runJobSchema>;

const ciRunSchema = z.object({
  databaseId: z.number().int().positive(),
  headBranch: z.string(),
  headSha: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  event: z.string(),
  workflowName: z.string(),
});
const ciRunListSchema = z.array(ciRunSchema);
type CiRunRecord = z.infer<typeof ciRunSchema>;

const deploymentSchema = z.object({
  id: z.number().int().positive(),
  sha: z.string(),
  environment: z.string(),
  created_at: z.string(),
});
const deploymentsSchema = z.array(deploymentSchema);
type DeploymentRecord = z.infer<typeof deploymentSchema>;

const deploymentStatusSchema = z.object({
  state: z.string(),
  created_at: z.string(),
});
const deploymentStatusesSchema = z.array(deploymentStatusSchema);
type DeploymentStatusRecord = z.infer<typeof deploymentStatusSchema>;

interface GitHubInvocation {
  readonly args: readonly string[];
  readonly workingDirectory: string;
}

interface PromotionEvidenceRequest {
  readonly sha: CommitSha;
  readonly pullRequest: AdmittedDevelopmentPullRequest;
  readonly workingDirectory: string;
}

type DatabaseIdRecord = { readonly databaseId: number };
type DeploymentDateRecord = { readonly created_at: string };

/** Owns GitHub observations and the two explicitly authorized PR mutations. */
export class DevGitHubGateway {
  private readonly pullRequests: DevelopmentPullRequestGateway;

  constructor(
    private readonly request: {
      readonly runner: CommandRunner;
      readonly workingDirectory: string;
    },
  ) {
    this.pullRequests = new DevelopmentPullRequestGateway({
      runner: request.runner,
    });
  }

  buildProof(request: BuildProofRequest): Result<BuildProof, DevFailure> {
    const output = this.successful({
      args: [
        'run',
        'list',
        '--workflow',
        'remote.yml',
        '--branch',
        request.branch.value(),
        '--commit',
        request.sha.value(),
        '--event',
        'workflow_dispatch',
        '--limit',
        '100',
        '--json',
        'databaseId,headBranch,headSha,status,conclusion,event,workflowName,displayTitle',
      ],
      workingDirectory: this.request.workingDirectory,
    });
    if (output.isErr()) return err(output.error);
    const runs = new GitHubJsonDocument(output.value.stdout).decode(
      remoteRunListSchema,
    );
    if (runs.isErr()) return err(runs.error);
    const candidates = runs.value
      .filter((run) => this.isExactRemoteBuildRun({ run, request }))
      .sort(DevGitHubGateway.compareDatabaseIds);
    const run = candidates[0];
    if (!run) {
      return err({
        kind: DevFailureKind.Evidence,
        message:
          'No successful exact-source remote build proof was found; dispatch remote.yml build:compile for the current feature commit',
      });
    }
    const runId = WorkflowRunId.parse(run.databaseId);
    if (runId.isErr()) return err(runId.error);
    const jobs = this.remoteRunJobs({
      runId: runId.value,
      workingDirectory: this.request.workingDirectory,
    });
    if (jobs.isErr()) return err(jobs.error);
    const compileJob = jobs.value.find(
      (job) => job.name === DevDeliveryContract.remoteBuild.jobName,
    );
    if (!compileJob) {
      return err({
        kind: DevFailureKind.Evidence,
        message: `Remote build run ${run.databaseId} has no '${DevDeliveryContract.remoteBuild.jobName}' job`,
      });
    }
    if (
      compileJob.status !== 'completed' ||
      compileJob.conclusion !== 'success'
    ) {
      return err({
        kind: DevFailureKind.Evidence,
        message: `Remote build run ${run.databaseId} did not complete '${DevDeliveryContract.remoteBuild.jobName}' successfully`,
      });
    }
    return ok({ sha: request.sha, runId: runId.value });
  }

  ensureDevelopmentPullRequest(
    request: DevelopmentPullRequestMutationRequest,
  ): Result<DevelopmentPullRequest, DevFailure> {
    return this.pullRequests.ensureDevelopmentPullRequest(request);
  }

  readDevelopmentPullRequest(request: {
    readonly workingDirectory: string;
  }): Result<AdmittedDevelopmentPullRequest, DevFailure> {
    return this.pullRequests.readDevelopmentPullRequest(request);
  }

  findDevelopmentPullRequest(request: {
    readonly workingDirectory: string;
  }): Result<DevelopmentPullRequestLookup, DevFailure> {
    return this.pullRequests.findDevelopmentPullRequest(request);
  }

  readPullRequestStatus(request: {
    readonly number: PullRequestNumber;
    readonly workingDirectory: string;
  }): Result<PullRequestStatus, DevFailure> {
    return this.pullRequests.readPullRequestStatus(request);
  }

  requireDevelopmentCiTerminal(
    request: DevelopmentCiObservationRequest,
  ): Result<void, DevFailure> {
    const output = this.successful({
      args: [
        'run',
        'list',
        '--workflow',
        'ci.yml',
        '--branch',
        'dev',
        '--commit',
        request.sha.value(),
        '--event',
        'pull_request',
        '--limit',
        '100',
        '--json',
        'databaseId,headBranch,headSha,status,conclusion,event,workflowName',
      ],
      workingDirectory: request.workingDirectory,
    });
    if (output.isErr()) return err(output.error);
    const decoded = new GitHubJsonDocument(output.value.stdout).decode(
      ciRunListSchema,
    );
    if (decoded.isErr()) return err(decoded.error);
    const attempts: CiAttempt[] = [];
    for (const run of decoded.value) {
      if (!this.isExactCiRun({ run, sha: request.sha })) continue;
      const runId = WorkflowRunId.parse(run.databaseId);
      if (runId.isErr()) return err(runId.error);
      attempts.push({ runId: runId.value, status: run.status });
    }
    return new DevelopmentCiAttemptPolicy().requireTerminal({
      attempts,
      replacement: request.replacement,
    });
  }

  requirePromotionEvidence(
    request: PromotionEvidenceRequest,
  ): Result<void, DevFailure> {
    const slowCi = this.requireSlowCi(request);
    if (slowCi.isErr()) return err(slowCi.error);
    const reviews = this.pullRequests.requireCleanReviews({
      pullRequest: request.pullRequest,
      workingDirectory: request.workingDirectory,
    });
    if (reviews.isErr()) return err(reviews.error);
    return this.requirePagesDeployment(request);
  }

  private isExactRemoteBuildRun(request: {
    readonly run: RemoteRunRecord;
    readonly request: BuildProofRequest;
  }): boolean {
    const { run } = request;
    const titleMatch = DevDeliveryContract.remoteBuild.titlePattern.exec(
      run.displayTitle,
    );
    return (
      run.workflowName === DevDeliveryContract.remoteBuild.workflowName &&
      run.event === 'workflow_dispatch' &&
      run.headBranch === request.request.branch.value() &&
      run.headSha === request.request.sha.value() &&
      run.status === 'completed' &&
      run.conclusion === 'success' &&
      titleMatch?.[1] === request.request.sha.value()
    );
  }

  private remoteRunJobs(request: {
    readonly runId: WorkflowRunId;
    readonly workingDirectory: string;
  }): Result<readonly RunJobRecord[], DevFailure> {
    const output = this.successful({
      args: ['run', 'view', String(request.runId.value()), '--json', 'jobs'],
      workingDirectory: request.workingDirectory,
    });
    if (output.isErr()) return err(output.error);
    const decoded = new GitHubJsonDocument(output.value.stdout).decode(
      runJobsSchema,
    );
    if (decoded.isErr()) return err(decoded.error);
    return ok(decoded.value.jobs);
  }

  private requireSlowCi(
    request: PromotionEvidenceRequest,
  ): Result<void, DevFailure> {
    const output = this.successful({
      args: [
        'run',
        'list',
        '--workflow',
        'ci.yml',
        '--branch',
        'dev',
        '--commit',
        request.sha.value(),
        '--event',
        'pull_request',
        '--limit',
        '100',
        '--json',
        'databaseId,headBranch,headSha,status,conclusion,event,workflowName',
      ],
      workingDirectory: request.workingDirectory,
    });
    if (output.isErr()) return err(output.error);
    const decoded = new GitHubJsonDocument(output.value.stdout).decode(
      ciRunListSchema,
    );
    if (decoded.isErr()) return err(decoded.error);
    const candidates = decoded.value
      .filter((run) => this.isExactCiRun({ run, sha: request.sha }))
      .sort(DevGitHubGateway.compareDatabaseIds);
    const run = candidates[0];
    if (!run) {
      return err({
        kind: DevFailureKind.Checks,
        message:
          'No exact-head CI workflow run exists for the dev-to-main pull request',
      });
    }
    if (run.status !== 'completed' || run.conclusion !== 'success') {
      return err({
        kind: DevFailureKind.Checks,
        message: `The latest exact-head CI workflow run ${run.databaseId} is not successful`,
      });
    }
    const runId = WorkflowRunId.parse(run.databaseId);
    if (runId.isErr()) return err(runId.error);
    const jobs = this.remoteRunJobs({
      runId: runId.value,
      workingDirectory: request.workingDirectory,
    });
    if (jobs.isErr()) return err(jobs.error);
    for (const name of DevDeliveryContract.promotion.requiredJobs) {
      const job = jobs.value.find((candidate) => candidate.name === name);
      if (!job) {
        return err({
          kind: DevFailureKind.Checks,
          message: `Exact-head CI run ${run.databaseId} has no '${name}' gate`,
        });
      }
      if (job.status !== 'completed' || job.conclusion !== 'success') {
        return err({
          kind: DevFailureKind.Checks,
          message: `Exact-head CI gate '${name}' did not succeed`,
        });
      }
    }
    return ok();
  }

  private isExactCiRun(request: {
    readonly run: CiRunRecord;
    readonly sha: CommitSha;
  }): boolean {
    const { run, sha } = request;
    return (
      run.workflowName === DevDeliveryContract.promotion.workflowName &&
      run.event === 'pull_request' &&
      run.headBranch === 'dev' &&
      run.headSha === sha.value()
    );
  }

  private requirePagesDeployment(
    request: PromotionEvidenceRequest,
  ): Result<void, DevFailure> {
    const repository = this.repository(request.workingDirectory);
    if (repository.isErr()) return err(repository.error);
    const deployments = this.successful({
      args: [
        'api',
        `repos/${repository.value.value()}/deployments?sha=${request.sha.value()}&environment=${DevDeliveryContract.pagesEnvironment}&per_page=100`,
      ],
      workingDirectory: request.workingDirectory,
    });
    if (deployments.isErr()) return err(deployments.error);
    const decoded = new GitHubJsonDocument(deployments.value.stdout).decode(
      deploymentsSchema,
    );
    if (decoded.isErr()) return err(decoded.error);
    const candidates = decoded.value.filter(
      (deployment) =>
        deployment.sha === request.sha.value() &&
        deployment.environment === DevDeliveryContract.pagesEnvironment,
    );
    if (candidates.length === 0) {
      return err({
        kind: DevFailureKind.Deployment,
        message: 'No exact-head github-pages deployment exists for promotion',
      });
    }
    for (const deployment of candidates) {
      const statuses = this.deploymentStatuses({
        deployment,
        repository: repository.value,
        workingDirectory: request.workingDirectory,
      });
      if (statuses.isErr()) return err(statuses.error);
      const latest = [...statuses.value].sort(
        DevGitHubGateway.compareDeploymentDates,
      )[0];
      if (latest && latest.state === 'success') return ok();
    }
    return err({
      kind: DevFailureKind.Deployment,
      message:
        'Every exact-head github-pages deployment is missing a latest successful status',
    });
  }

  private deploymentStatuses(request: {
    readonly deployment: DeploymentRecord;
    readonly repository: RepositorySlug;
    readonly workingDirectory: string;
  }): Result<readonly DeploymentStatusRecord[], DevFailure> {
    const output = this.successful({
      args: [
        'api',
        `repos/${request.repository.value()}/deployments/${request.deployment.id}/statuses?per_page=100`,
      ],
      workingDirectory: request.workingDirectory,
    });
    if (output.isErr()) return err(output.error);
    const decoded = new GitHubJsonDocument(output.value.stdout).decode(
      deploymentStatusesSchema,
    );
    if (decoded.isErr()) return err(decoded.error);
    return ok(decoded.value);
  }

  private repository(
    workingDirectory: string,
  ): Result<RepositorySlug, DevFailure> {
    const output = this.successful({
      args: [
        'repo',
        'view',
        '--json',
        'nameWithOwner',
        '--jq',
        '.nameWithOwner',
      ],
      workingDirectory,
    });
    if (output.isErr()) return err(output.error);
    return RepositorySlug.parse(output.value.stdout.trim());
  }

  private static compareDatabaseIds(
    ...records: [DatabaseIdRecord, DatabaseIdRecord]
  ): number {
    const [left, right] = records;
    return right.databaseId - left.databaseId;
  }

  private static compareDeploymentDates(
    ...records: [DeploymentDateRecord, DeploymentDateRecord]
  ): number {
    const [left, right] = records;
    return right.created_at.localeCompare(left.created_at);
  }

  private execute(
    request: GitHubInvocation,
  ): Result<CommandOutput, DevFailure> {
    return this.request.runner.run({
      executable: CommandExecutable.GitHub,
      args: request.args,
      workingDirectory: request.workingDirectory,
    });
  }

  private successful(
    request: GitHubInvocation,
  ): Result<CommandOutput, DevFailure> {
    const output = this.execute(request);
    if (output.isErr()) return err(output.error);
    if (output.value.exitCode !== 0) {
      return err({
        kind: DevFailureKind.GitHub,
        message: `GitHub command failed: ${new CommandFailureMessage(output.value).text()}`,
      });
    }
    return ok(output.value);
  }
}
