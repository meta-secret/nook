import { err, ok, type Result } from "neverthrow";
import { z } from "zod";

import { CommandFailureMessage } from "./dev-command.ts";
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
  type DevelopmentPullRequest,
  PullRequestNumber,
  PullRequestReviewDecision,
  PullRequestState,
  type PullRequestStatus,
  RepositorySlug,
  WorkflowRunId,
} from "./dev-types.ts";

export const DevDeliveryContract = {
  remoteBuild: {
    workflowName: "Remote task",
    taskName: "build:compile",
    jobName: "Remote / build:compile",
    titlePattern: /^Remote \/ build:compile @ ([0-9a-f]{40}) \/ [A-Za-z0-9._-]+$/u,
  },
  promotion: {
    workflowName: "CI",
    requiredJobs: ["Dev promotion readiness"],
  },
  pagesEnvironment: "github-pages",
} as const;

/** Rejects every non-terminal prior CI attempt before a dev publication. */
export class DevelopmentCiAttemptPolicy {
  requireTerminal(attempts: readonly CiAttempt[]): Result<void, DevFailure> {
    const active = attempts.find((attempt) => attempt.status !== "completed");
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

const pullRequestListEntrySchema = z.object({
  number: z.number().int().positive(),
  headRefName: z.string(),
  baseRefName: z.string(),
  headRefOid: z.string(),
  baseRefOid: z.string(),
  url: z.string(),
  isDraft: z.boolean(),
});
const pullRequestListSchema = z.array(pullRequestListEntrySchema);
type PullRequestListEntry = z.infer<typeof pullRequestListEntrySchema>;

const repositoryReferenceSchema = z.object({ nameWithOwner: z.string() });
const pullRequestViewSchema = z.object({
  number: z.number().int().positive(),
  headRefName: z.string(),
  baseRefName: z.string(),
  headRefOid: z.string(),
  baseRefOid: z.string(),
  url: z.string(),
  isDraft: z.boolean(),
  state: z.string(),
  headRepository: repositoryReferenceSchema,
  baseRepository: repositoryReferenceSchema,
  reviewDecision: z.string().nullable(),
});
type PullRequestView = z.infer<typeof pullRequestViewSchema>;

const pullRequestStatusSchema = z.object({
  state: z.string(),
  mergedAt: z.string().nullable(),
});

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

const reviewThreadsSchema = z.object({
  data: z.object({
    repository: z.object({
      pullRequest: z.object({
        reviewThreads: z.object({
          nodes: z.array(
            z.object({ isResolved: z.boolean(), isOutdated: z.boolean() }),
          ),
        }),
      }),
    }),
  }),
});

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

interface PullRequestSelection {
  readonly number: PullRequestNumber;
  readonly raw: PullRequestListEntry;
}

interface PullRequestReadRequest {
  readonly number: PullRequestNumber;
  readonly workingDirectory: string;
}

interface PromotionEvidenceRequest {
  readonly sha: CommitSha;
  readonly pullRequest: DevelopmentPullRequest;
  readonly workingDirectory: string;
}

/** Decodes JSON only at the GitHub CLI transport boundary. */
export class GitHubJsonDocument {
  constructor(private readonly source: string) {}

  decode<T>(schema: z.ZodType<T>): Result<T, DevFailure> {
    let value: unknown;
    try {
      value = JSON.parse(this.source);
    } catch {
      return err({
        kind: DevFailureKind.GitHub,
        message: "GitHub returned invalid JSON",
      });
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      return err({
        kind: DevFailureKind.GitHub,
        message: "GitHub returned an unexpected response shape",
      });
    }
    return ok(parsed.data);
  }
}

/** Owns GitHub observations and the two explicitly authorized PR mutations. */
export class DevGitHubGateway {
  constructor(
    private readonly request: {
      readonly runner: CommandRunner;
      readonly workingDirectory: string;
    },
  ) {}

  buildProof(request: BuildProofRequest): Result<BuildProof, DevFailure> {
    const output = this.successful({
      args: [
        "run",
        "list",
        "--workflow",
        "remote.yml",
        "--branch",
        request.branch.value(),
        "--commit",
        request.sha.value(),
        "--event",
        "workflow_dispatch",
        "--limit",
        "100",
        "--json",
        "databaseId,headBranch,headSha,status,conclusion,event,workflowName,displayTitle",
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
      .sort((left, right) => right.databaseId - left.databaseId);
    const run = candidates[0];
    if (!run) {
      return err({
        kind: DevFailureKind.Evidence,
        message:
          "No successful exact-source remote build proof was found; dispatch remote.yml build:compile for the current feature commit",
      });
    }
    const runId = WorkflowRunId.parse(run.databaseId);
    if (runId.isErr()) return err(runId.error);
    const jobs = this.remoteRunJobs(runId.value, this.request.workingDirectory);
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
      compileJob.status !== "completed" ||
      compileJob.conclusion !== "success"
    ) {
      return err({
        kind: DevFailureKind.Evidence,
        message: `Remote build run ${run.databaseId} did not complete '${DevDeliveryContract.remoteBuild.jobName}' successfully`,
      });
    }
    return ok({ sha: request.sha, runId: runId.value });
  }

  ensureDevelopmentPullRequest(
    request: {
      readonly expectedSha: CommitSha;
      readonly workingDirectory: string;
    },
  ): Result<DevelopmentPullRequest, DevFailure> {
    const selection = this.openPullRequests(request.workingDirectory);
    if (selection.isErr()) return err(selection.error);
    const existing = selection.value[0];
    if (selection.value.length > 1) {
      return err({
        kind: DevFailureKind.GitHub,
        message: "More than one open dev-to-main pull request exists; refusing to choose one",
      });
    }
    if (existing) {
      const edited = this.successful({
        args: [
          "pr",
          "edit",
          String(existing.number.value()),
          "--title",
          "Promote development to main",
          "--body",
          "This pull request records the manager-controlled development promotion. The tested dev commit is promoted with an ordinary fast-forward push.",
        ],
        workingDirectory: request.workingDirectory,
      });
      if (edited.isErr()) return err(edited.error);
    } else {
      const created = this.successful({
        args: [
          "pr",
          "create",
          "--base",
          "main",
          "--head",
          "dev",
          "--title",
          "Promote development to main",
          "--body",
          "This pull request records the manager-controlled development promotion. The tested dev commit is promoted with an ordinary fast-forward push.",
        ],
        workingDirectory: request.workingDirectory,
      });
      if (created.isErr()) return err(created.error);
    }
    const live = this.readDevelopmentPullRequest({
      workingDirectory: request.workingDirectory,
    });
    if (live.isErr()) return err(live.error);
    if (!live.value.headSha.equals(request.expectedSha)) {
      return err({
        kind: DevFailureKind.Race,
        message: "The dev-to-main pull request head changed while it was being published",
      });
    }
    return ok(live.value);
  }

  readDevelopmentPullRequest(request: {
    readonly workingDirectory: string;
  }): Result<DevelopmentPullRequest, DevFailure> {
    const selection = this.openPullRequests(request.workingDirectory);
    if (selection.isErr()) return err(selection.error);
    const selected = selection.value[0];
    if (selection.value.length > 1) {
      return err({
        kind: DevFailureKind.GitHub,
        message: "More than one open dev-to-main pull request exists; refusing to choose one",
      });
    }
    if (!selected) {
      return err({
        kind: DevFailureKind.GitHub,
        message: "No open same-repository dev-to-main pull request exists",
      });
    }
    return this.readPullRequest({
      number: selected.number,
      workingDirectory: request.workingDirectory,
    });
  }

  findDevelopmentPullRequest(request: {
    readonly workingDirectory: string;
  }): Result<DevelopmentPullRequest | undefined, DevFailure> {
    const selection = this.openPullRequests(request.workingDirectory);
    if (selection.isErr()) return err(selection.error);
    if (selection.value.length > 1) {
      return err({
        kind: DevFailureKind.GitHub,
        message: "More than one open dev-to-main pull request exists; refusing to choose one",
      });
    }
    const selected = selection.value.at(0);
    if (!selected) return ok(undefined);
    return this.readPullRequest({
      number: selected.number,
      workingDirectory: request.workingDirectory,
    });
  }

  readPullRequestStatus(request: PullRequestReadRequest): Result<PullRequestStatus, DevFailure> {
    const output = this.successful({
      args: [
        "pr",
        "view",
        String(request.number.value()),
        "--json",
        "state,mergedAt",
      ],
      workingDirectory: request.workingDirectory,
    });
    if (output.isErr()) return err(output.error);
    const decoded = new GitHubJsonDocument(output.value.stdout).decode(
      pullRequestStatusSchema,
    );
    if (decoded.isErr()) return err(decoded.error);
    let state: PullRequestState;
    switch (decoded.value.state) {
      case PullRequestState.Open:
        state = PullRequestState.Open;
        break;
      case PullRequestState.Closed:
        state = PullRequestState.Closed;
        break;
      case PullRequestState.Merged:
        state = PullRequestState.Merged;
        break;
      default:
        return err({
          kind: DevFailureKind.GitHub,
          message: `GitHub returned an unsupported pull-request state: ${decoded.value.state}`,
        });
    }
    return ok({
      state,
      merged: state === PullRequestState.Merged && typeof decoded.value.mergedAt === "string",
    });
  }

  requireDevelopmentCiTerminal(
    request: DevelopmentCiObservationRequest,
  ): Result<void, DevFailure> {
    const output = this.successful({
      args: [
        "run",
        "list",
        "--workflow",
        "ci.yml",
        "--branch",
        "dev",
        "--commit",
        request.sha.value(),
        "--event",
        "pull_request",
        "--limit",
        "100",
        "--json",
        "databaseId,headBranch,headSha,status,conclusion,event,workflowName",
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
      if (!this.isExactCiRun(run, request.sha)) continue;
      const runId = WorkflowRunId.parse(run.databaseId);
      if (runId.isErr()) return err(runId.error);
      attempts.push({ runId: runId.value, status: run.status });
    }
    return new DevelopmentCiAttemptPolicy().requireTerminal(attempts);
  }

  requirePromotionEvidence(request: PromotionEvidenceRequest): Result<void, DevFailure> {
    const slowCi = this.requireSlowCi(request);
    if (slowCi.isErr()) return err(slowCi.error);
    const reviews = this.requireCleanReviews(request);
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
      run.event === "workflow_dispatch" &&
      run.headBranch === request.request.branch.value() &&
      run.headSha === request.request.sha.value() &&
      run.status === "completed" &&
      run.conclusion === "success" &&
      titleMatch?.[1] === request.request.sha.value()
    );
  }

  private remoteRunJobs(
    runId: WorkflowRunId,
    workingDirectory: string,
  ): Result<readonly RunJobRecord[], DevFailure> {
    const output = this.successful({
      args: ["run", "view", String(runId.value()), "--json", "jobs"],
      workingDirectory,
    });
    if (output.isErr()) return err(output.error);
    const decoded = new GitHubJsonDocument(output.value.stdout).decode(
      runJobsSchema,
    );
    if (decoded.isErr()) return err(decoded.error);
    return ok(decoded.value.jobs);
  }

  private openPullRequests(
    workingDirectory: string,
  ): Result<readonly PullRequestSelection[], DevFailure> {
    const output = this.successful({
      args: [
        "pr",
        "list",
        "--state",
        "open",
        "--head",
        "dev",
        "--base",
        "main",
        "--limit",
        "10",
        "--json",
        "number,headRefName,baseRefName,headRefOid,baseRefOid,url,isDraft",
      ],
      workingDirectory,
    });
    if (output.isErr()) return err(output.error);
    const decoded = new GitHubJsonDocument(output.value.stdout).decode(
      pullRequestListSchema,
    );
    if (decoded.isErr()) return err(decoded.error);
    const selections: PullRequestSelection[] = [];
    for (const raw of decoded.value) {
      const number = PullRequestNumber.parse(raw.number);
      if (number.isErr()) return err(number.error);
      selections.push({ number: number.value, raw });
    }
    return ok(selections);
  }

  private readPullRequest(
    request: PullRequestReadRequest,
  ): Result<DevelopmentPullRequest, DevFailure> {
    const output = this.successful({
      args: [
        "pr",
        "view",
        String(request.number.value()),
        "--json",
        "number,headRefName,baseRefName,headRefOid,baseRefOid,url,isDraft,state,headRepository,baseRepository,reviewDecision",
      ],
      workingDirectory: request.workingDirectory,
    });
    if (output.isErr()) return err(output.error);
    const decoded = new GitHubJsonDocument(output.value.stdout).decode(
      pullRequestViewSchema,
    );
    if (decoded.isErr()) return err(decoded.error);
    return this.admitDevelopmentPullRequest(decoded.value, request.workingDirectory);
  }

  private admitDevelopmentPullRequest(
    view: PullRequestView,
    workingDirectory: string,
  ): Result<DevelopmentPullRequest, DevFailure> {
    const repository = this.repository(workingDirectory);
    if (repository.isErr()) return err(repository.error);
    if (
      view.state !== PullRequestState.Open ||
      view.headRefName !== "dev" ||
      view.baseRefName !== "main" ||
      view.headRepository.nameWithOwner !== repository.value.value() ||
      view.baseRepository.nameWithOwner !== repository.value.value()
    ) {
      return err({
        kind: DevFailureKind.GitHub,
        message: "The live pull request is not a same-repository open dev-to-main pull request",
      });
    }
    const headSha = CommitSha.parse(view.headRefOid);
    if (headSha.isErr()) return err(headSha.error);
    const baseSha = CommitSha.parse(view.baseRefOid);
    if (baseSha.isErr()) return err(baseSha.error);
    const number = PullRequestNumber.parse(view.number);
    if (number.isErr()) return err(number.error);
    return ok({
      number: number.value,
      headSha: headSha.value,
      baseSha: baseSha.value,
      url: view.url,
      isDraft: view.isDraft,
      reviewDecision: DevGitHubGateway.reviewDecision(view.reviewDecision),
    });
  }

  private requireSlowCi(request: PromotionEvidenceRequest): Result<void, DevFailure> {
    const output = this.successful({
      args: [
        "run",
        "list",
        "--workflow",
        "ci.yml",
        "--branch",
        "dev",
        "--commit",
        request.sha.value(),
        "--event",
        "pull_request",
        "--limit",
        "100",
        "--json",
        "databaseId,headBranch,headSha,status,conclusion,event,workflowName",
      ],
      workingDirectory: request.workingDirectory,
    });
    if (output.isErr()) return err(output.error);
    const decoded = new GitHubJsonDocument(output.value.stdout).decode(
      ciRunListSchema,
    );
    if (decoded.isErr()) return err(decoded.error);
    const candidates = decoded.value
      .filter((run) => this.isExactCiRun(run, request.sha))
      .sort((left, right) => right.databaseId - left.databaseId);
    const run = candidates[0];
    if (!run) {
      return err({
        kind: DevFailureKind.Checks,
        message: "No exact-head CI workflow run exists for the dev-to-main pull request",
      });
    }
    if (run.status !== "completed" || run.conclusion !== "success") {
      return err({
        kind: DevFailureKind.Checks,
        message: `The latest exact-head CI workflow run ${run.databaseId} is not successful`,
      });
    }
    const runId = WorkflowRunId.parse(run.databaseId);
    if (runId.isErr()) return err(runId.error);
    const jobs = this.remoteRunJobs(runId.value, request.workingDirectory);
    if (jobs.isErr()) return err(jobs.error);
    for (const name of DevDeliveryContract.promotion.requiredJobs) {
      const job = jobs.value.find((candidate) => candidate.name === name);
      if (!job) {
        return err({
          kind: DevFailureKind.Checks,
          message: `Exact-head CI run ${run.databaseId} has no '${name}' gate`,
        });
      }
      if (job.status !== "completed" || job.conclusion !== "success") {
        return err({
          kind: DevFailureKind.Checks,
          message: `Exact-head CI gate '${name}' did not succeed`,
        });
      }
    }
    return ok();
  }

  private isExactCiRun(run: CiRunRecord, sha: CommitSha): boolean {
    return (
      run.workflowName === DevDeliveryContract.promotion.workflowName &&
      run.event === "pull_request" &&
      run.headBranch === "dev" &&
      run.headSha === sha.value()
    );
  }

  private requireCleanReviews(request: PromotionEvidenceRequest): Result<void, DevFailure> {
    const output = this.successful({
      args: [
        "pr",
        "view",
        String(request.pullRequest.number.value()),
        "--json",
        "reviewDecision",
      ],
      workingDirectory: request.workingDirectory,
    });
    if (output.isErr()) return err(output.error);
    const decoded = new GitHubJsonDocument(output.value.stdout).decode(
      z.object({ reviewDecision: z.string().nullable() }),
    );
    if (decoded.isErr()) return err(decoded.error);
    const reviewDecision = DevGitHubGateway.reviewDecision(
      decoded.value.reviewDecision,
    );
    if (reviewDecision !== PullRequestReviewDecision.Approved) {
      return err({
        kind: DevFailureKind.Reviews,
        message: `The current dev-to-main review decision is ${reviewDecision}; promotion requires APPROVED`,
      });
    }

    const repository = this.repository(request.workingDirectory);
    if (repository.isErr()) return err(repository.error);
    const query = [
      "query($owner:String!,$repo:String!,$number:Int!){",
      "repository(owner:$owner,name:$repo){",
      "pullRequest(number:$number){",
      "reviewThreads(first:100){nodes{isResolved isOutdated}}",
      "}}}}",
    ].join("");
    const threads = this.successful({
      args: [
        "api",
        "graphql",
        "-f",
        `query=${query}`,
        "-F",
        `owner=${repository.value.owner}`,
        "-F",
        `repo=${repository.value.repository}`,
        "-F",
        `number=${request.pullRequest.number.value()}`,
      ],
      workingDirectory: request.workingDirectory,
    });
    if (threads.isErr()) return err(threads.error);
    const decodedThreads = new GitHubJsonDocument(threads.value.stdout).decode(
      reviewThreadsSchema,
    );
    if (decodedThreads.isErr()) return err(decodedThreads.error);
    if (
      decodedThreads.value.data.repository.pullRequest.reviewThreads.nodes.some(
        (thread) => !thread.isResolved,
      )
    ) {
      return err({
        kind: DevFailureKind.Reviews,
        message: "The dev-to-main pull request has an unresolved review thread",
      });
    }
    return ok();
  }

  private requirePagesDeployment(request: PromotionEvidenceRequest): Result<void, DevFailure> {
    const repository = this.repository(request.workingDirectory);
    if (repository.isErr()) return err(repository.error);
    const deployments = this.successful({
      args: [
        "api",
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
        message: "No exact-head github-pages deployment exists for promotion",
      });
    }
    for (const deployment of candidates) {
      const statuses = this.deploymentStatuses({
        deployment,
        repository,
        workingDirectory: request.workingDirectory,
      });
      if (statuses.isErr()) return err(statuses.error);
      const latest = [...statuses.value].sort((left, right) =>
        right.created_at.localeCompare(left.created_at),
      )[0];
      if (latest && latest.state === "success") return ok();
    }
    return err({
      kind: DevFailureKind.Deployment,
      message: "Every exact-head github-pages deployment is missing a latest successful status",
    });
  }

  private deploymentStatuses(request: {
    readonly deployment: DeploymentRecord;
    readonly repository: RepositorySlug;
    readonly workingDirectory: string;
  }): Result<readonly DeploymentStatusRecord[], DevFailure> {
    const output = this.successful({
      args: [
        "api",
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

  private repository(workingDirectory: string): Result<RepositorySlug, DevFailure> {
    const output = this.successful({
      args: ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
      workingDirectory,
    });
    if (output.isErr()) return err(output.error);
    return RepositorySlug.parse(output.value.stdout.trim());
  }

  private static reviewDecision(input: string | null): PullRequestReviewDecision {
    if (typeof input !== "string") return PullRequestReviewDecision.Empty;
    switch (input) {
      case PullRequestReviewDecision.Approved:
        return PullRequestReviewDecision.Approved;
      case PullRequestReviewDecision.ChangesRequested:
        return PullRequestReviewDecision.ChangesRequested;
      case PullRequestReviewDecision.ReviewRequired:
        return PullRequestReviewDecision.ReviewRequired;
      case PullRequestReviewDecision.Empty:
        return PullRequestReviewDecision.Empty;
      default:
        return PullRequestReviewDecision.Unknown;
    }
  }

  private execute(request: GitHubInvocation): Result<CommandOutput, DevFailure> {
    return this.request.runner.run({
      executable: CommandExecutable.GitHub,
      args: request.args,
      workingDirectory: request.workingDirectory,
    });
  }

  private successful(request: GitHubInvocation): Result<CommandOutput, DevFailure> {
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
