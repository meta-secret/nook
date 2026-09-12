import { err, ok, ResultAsync, Result } from "neverthrow";
import { CiFailureKind, type CiFailure } from "./failure.js";
import { GithubRequestFailure } from "./github-failure.js";
import type { PrFeedbackSummary } from "./github.js";
import type { Octokit } from "@octokit/rest";

import {
  GitHubEnvironment,
  GitHubClient,
  GitHubRepositoryName,
  PullRequestWorkflowSelection,
  type RepoRef,
  type RequiredPrWorkflow,
} from "./github.js";
import { JsonDocument } from "./json.js";
export class PullRequestAuditEnvironment {
  constructor(private readonly environment: NodeJS.ProcessEnv) {}
  readPrNumber(): Result<number, CiFailure> {
    const [raw = ""] = [this.environment.PR_NUMBER?.trim()];
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
      return err({
        kind: CiFailureKind.Configuration,
        message: `PR_NUMBER must be a positive integer (received ${raw || "empty"})`,
      });
    }
    return ok(value);
  }
}

export interface PullRequestAuditClientBuildPrAuditRequest {
  readonly repoRef: RepoRef;
  readonly prNumber: number;
}

export interface PullRequestAuditClientAuditRequiredJobsRequest {
  readonly subject1: RepoRef;
  readonly runId: number;
  readonly requiredJobs: readonly string[];
}

export interface PullRequestAuditClientInspectBranchProtectionRequest {
  readonly subject1: RepoRef;
  readonly branch: string;
}

export interface PullRequestAuditClientInspectExactHeadDeploymentRequest {
  readonly subject1: RepoRef;
  readonly headSha: string;
}

export class PullRequestAuditClient {
  constructor(private readonly value: Octokit) {}
  async buildPrAudit(
    request: PullRequestAuditClientBuildPrAuditRequest,
  ): Promise<Result<PrAudit, CiFailure>> {
    const octokit = this.value;
    const { repoRef, prNumber } = request;

    const { owner, repo } = repoRef;
    const loaded = await ResultAsync.fromPromise(
      Promise.all([
        octokit.rest.pulls.get({ owner, repo, pull_number: prNumber }),
        octokit.paginate(octokit.rest.pulls.listFiles, {
          owner,
          repo,
          pull_number: prNumber,
          per_page: 100,
        }),
      ]),
      (cause) => new GithubRequestFailure(cause).outcome(),
    );
    if (loaded.isErr()) return err(loaded.error);
    const [{ data: pr }, files] = loaded.value;
    const changedFiles = files.map((file) => file.filename);
    const workflows = await new PullRequestAuditAuditWorkflows({
      baseBranch: pr.base.ref,
      headSha: pr.head.sha,
      octokit,
      prNumber,
      repoRef,
      workflows: new PullRequestWorkflowSelection(changedFiles).names(),
    }).execute();
    if (workflows.isErr()) return err(workflows.error);
    const requiredWorkflows = workflows.value;
    const [
      comparisonResult,
      feedbackResult,
      protectionResult,
      deploymentResult,
    ] = await Promise.all([
      ResultAsync.fromPromise(
        octokit.rest.repos.compareCommitsWithBasehead({
          owner,
          repo,
          basehead: `${pr.base.ref}...${pr.head.sha}`,
        }),
        (cause) => new GithubRequestFailure(cause).outcome(),
      ),
      new GitHubClient(octokit).inspectPrFeedback({
        repoRef: repoRef,
        prNumber: prNumber,
      }),
      new PullRequestAuditClient(octokit).inspectBranchProtection({
        subject1: repoRef,
        branch: pr.base.ref,
      }),
      new PullRequestAuditClient(octokit).inspectExactHeadDeployment({
        subject1: repoRef,
        headSha: pr.head.sha,
      }),
    ]);
    if (comparisonResult.isErr()) return err(comparisonResult.error);
    if (feedbackResult.isErr()) return err(feedbackResult.error);
    if (protectionResult.isErr()) return err(protectionResult.error);
    if (deploymentResult.isErr()) return err(deploymentResult.error);
    const comparison = comparisonResult.value,
      feedback = feedbackResult.value,
      branchProtection = protectionResult.value,
      exactHeadDeployment = deploymentResult.value;
    let mergeable = pr.mergeable;
    if (typeof mergeable !== "boolean") {
      const refreshed = await ResultAsync.fromPromise(
        octokit.rest.pulls.get({ owner, repo, pull_number: prNumber }),
        (cause) => new GithubRequestFailure(cause).outcome(),
      );
      if (refreshed.isErr()) return err(refreshed.error);
      mergeable = refreshed.value.data.mergeable;
    }

    let reasons: string[] = [];
    if (pr.state !== "open") reasons = [...reasons, `state is ${pr.state}`];
    if (pr.draft) reasons = [...reasons, "pull request is draft"];
    const mergeability =
      mergeable === true
        ? PullRequestMergeability.Mergeable
        : mergeable === false
          ? PullRequestMergeability.Conflicting
          : PullRequestMergeability.Unknown;
    if (mergeability === PullRequestMergeability.Conflicting)
      reasons = [...reasons, "pull request has a merge conflict"];
    if (mergeability === PullRequestMergeability.Unknown)
      reasons = [...reasons, "pull request mergeability is unknown"];
    for (const workflow of requiredWorkflows) {
      if (workflow.state === WorkflowAuditState.NotIndexed) {
        reasons = [
          ...reasons,
          `${workflow.workflowName} run is not indexed for the current head`,
        ];
      } else if (workflow.status.state === WorkflowRunStatusState.Unavailable) {
        reasons = [...reasons, `${workflow.workflowName} run has no status`];
      } else if (workflow.status.state === WorkflowRunStatusState.Other) {
        reasons = [
          ...reasons,
          `${workflow.workflowName} run is ${workflow.status.value}`,
        ];
      } else if (
        workflow.conclusion.state === WorkflowConclusionState.Pending
      ) {
        reasons = [
          ...reasons,
          `${workflow.workflowName} run has no conclusion`,
        ];
      } else if (
        workflow.conclusion.value !== GithubWorkflowConclusion.Success
      ) {
        reasons = [
          ...reasons,
          `${workflow.workflowName} run concluded ${workflow.conclusion.value}`,
        ];
      }
      if (workflow.state === WorkflowAuditState.Indexed) {
        for (const job of workflow.requiredJobAudits) {
          if (job.status !== WorkflowRunStatusState.Completed) {
            const [defaulted1 = "missing"] = [job.status];
            reasons = [
              ...reasons,
              `${job.name} is ${defaulted1} on the latest ${workflow.workflowName} run`,
            ];
          } else if (job.conclusion !== GithubWorkflowConclusion.Success) {
            const [defaulted2 = "unknown"] = [job.conclusion];
            reasons = [
              ...reasons,
              `${job.name} concluded ${defaulted2} on the latest ${workflow.workflowName} run`,
            ];
          }
        }
      }
    }
    if (
      requiredWorkflows.some((workflow) =>
        workflow.requiredJobs?.includes("PR validation / Verify and preview"),
      ) &&
      (exactHeadDeployment.availability ===
        ExactHeadDeploymentAvailability.Unavailable ||
        exactHeadDeployment.state !== "success")
    ) {
      reasons = [
        ...reasons,
        "exact-head github-pages deployment is not successful",
      ];
    }
    if (feedback.unresolvedThreads > 0) {
      reasons = [
        ...reasons,
        `${feedback.unresolvedThreads} unresolved review thread(s) already present`,
      ];
    }
    if (feedback.unhandledComments > 0) {
      reasons = [
        ...reasons,
        `${feedback.unhandledComments} unhandled substantive PR comment(s) already present`,
      ];
    }
    if (feedback.unthreadedReviewFindings > 0) {
      reasons = [
        ...reasons,
        `${feedback.unthreadedReviewFindings} unthreaded submitted review finding(s) already present`,
      ];
    }
    const [defaulted3 = false] = [pr.draft];
    return ok({
      base: { branch: pr.base.ref, sha: pr.base.sha },
      branchProtection,
      changedFiles,
      exactHeadDeployment,
      externalReviewPolicy: "inspect-existing-feedback-without-waiting",
      feedback,
      head: { branch: pr.head.ref, sha: pr.head.sha },
      mergeState: {
        behindBy: comparison.data.behind_by,
        draft: defaulted3,
        mergeability,
        state: pr.state,
      },
      number: pr.number,
      ready: reasons.length === 0,
      reasons,
      repository: `${owner}/${repo}`,
      requiredWorkflows,
      url: pr.html_url,
    });
  }

  async auditRequiredJobs(
    request: PullRequestAuditClientAuditRequiredJobsRequest,
  ): Promise<Result<RequiredJobAudit[], CiFailure>> {
    const octokit = this.value;
    const { subject1, runId, requiredJobs } = request;
    const { owner, repo } = subject1;

    if (requiredJobs.length === 0) {
      return ok([]);
    }
    const loaded = await ResultAsync.fromPromise(
      octokit.paginate(octokit.rest.actions.listJobsForWorkflowRun, {
        owner,
        repo,
        run_id: runId,
        filter: "latest",
        per_page: 100,
      }),
      (cause) => new GithubRequestFailure(cause).outcome(),
    );
    if (loaded.isErr()) return err(loaded.error);
    const jobs = loaded.value;
    return ok(
      requiredJobs.map((name) => {
        const job = jobs.find((candidate) => candidate.name === name);
        if (!job) {
          return { name };
        }
        return {
          name,
          ...(typeof job.conclusion === "string"
            ? { conclusion: job.conclusion }
            : {}),
          ...(typeof job.status === "string" ? { status: job.status } : {}),
        };
      }),
    );
  }

  async inspectBranchProtection(
    request: PullRequestAuditClientInspectBranchProtectionRequest,
  ): Promise<Result<BranchProtectionAudit, CiFailure>> {
    const octokit = this.value;
    const { subject1, branch } = request;
    const { owner, repo } = subject1;

    const loaded = await ResultAsync.fromPromise(
      octokit.rest.repos.getBranchProtection({ owner, repo, branch }),
      (cause) => new GithubRequestFailure(cause).outcome(),
    );
    if (loaded.isErr())
      return loaded.error.kind === CiFailureKind.Github &&
        (loaded.error.code === 403 || loaded.error.code === 404)
        ? ok({ available: false })
        : err(loaded.error);
    const { data } = loaded.value;
    return ok({
      available: true,
      requiresApprovingReviews:
        (data.required_pull_request_reviews?.required_approving_review_count ||
          0) > 0,
      requiresConversationResolution:
        data.required_conversation_resolution?.enabled || false,
      requiredStatusChecks:
        data.required_status_checks?.checks?.map((check) => check.context) ||
        [],
    });
  }

  async inspectExactHeadDeployment(
    request: PullRequestAuditClientInspectExactHeadDeploymentRequest,
  ): Promise<Result<PrAudit["exactHeadDeployment"], CiFailure>> {
    const octokit = this.value;
    const { subject1, headSha } = request;
    const { owner, repo } = subject1;

    const loaded = await ResultAsync.fromPromise(
      octokit.rest.repos.listDeployments({
        owner,
        repo,
        environment: "github-pages",
        sha: headSha,
        per_page: 20,
      }),
      (cause) => new GithubRequestFailure(cause).outcome(),
    );
    if (loaded.isErr()) return err(loaded.error);
    const { data: deployments } = loaded.value;
    for (const deployment of deployments) {
      const loaded = await ResultAsync.fromPromise(
        octokit.rest.repos.listDeploymentStatuses({
          owner,
          repo,
          deployment_id: deployment.id,
          per_page: 1,
        }),
        (cause) => new GithubRequestFailure(cause).outcome(),
      );
      if (loaded.isErr()) return err(loaded.error);
      const { data: statuses } = loaded.value;
      const latest = statuses[0];
      if (latest) {
        return ok({
          availability: ExactHeadDeploymentAvailability.Found,
          environment: deployment.environment,
          state: latest.state,
          ...(latest.environment_url ? { url: latest.environment_url } : {}),
        });
      }
    }
    return ok({
      availability: ExactHeadDeploymentAvailability.Unavailable,
    });
  }
}

export enum AuditRequirement {
  Snapshot,
  Ready,
}
export class PullRequestAuditRunPrAudit {
  constructor(private readonly requirement: AuditRequirement) {}
  async execute(): Promise<Result<void, CiFailure>> {
    const repository = process.env.GITHUB_REPOSITORY?.trim();
    if (!repository)
      return err({
        kind: CiFailureKind.Configuration,
        message: "GITHUB_REPOSITORY is required",
      });
    const prNumber = new PullRequestAuditEnvironment(
      process.env,
    ).readPrNumber();
    if (prNumber.isErr()) return err(prNumber.error);
    const client = new GitHubEnvironment(process.env).createOctokit();
    if (client.isErr()) return err(client.error);
    const repoRef = new GitHubRepositoryName(repository).parse();
    if (repoRef.isErr()) return err(repoRef.error);
    const audit = await new PullRequestAuditClient(client.value).buildPrAudit({
      repoRef: repoRef.value,
      prNumber: prNumber.value,
    });
    if (audit.isErr()) return err(audit.error);
    const report = new JsonDocument(audit.value).format();
    if (report.isErr()) return err(report.error);
    console.log(report.value);
    if (this.requirement === AuditRequirement.Ready && !audit.value.ready)
      return err({
        kind: CiFailureKind.Github,
        message: `PR #${prNumber.value} is not ready: ${audit.value.reasons.join("; ")}`,
      });
    return ok();
  }
}

class PullRequestAuditAuditWorkflows {
  constructor(private readonly request: WorkflowAuditRequest) {}
  async execute(): Promise<Result<WorkflowAudit[], CiFailure>> {
    const request = this.request;

    const { owner, repo } = request.repoRef;
    const outcomes = await Promise.all(
      request.workflows.map(
        async (workflow): Promise<Result<WorkflowAudit, CiFailure>> => {
          const loaded = await ResultAsync.fromPromise(
            request.octokit.rest.actions.listWorkflowRuns({
              owner,
              repo,
              workflow_id: workflow.workflowFile,
              event: "pull_request",
              head_sha: request.headSha,
              per_page: 20,
            }),
            (cause) => new GithubRequestFailure(cause).outcome(),
          );
          if (loaded.isErr()) return err(loaded.error);
          const { data } = loaded.value;
          const runs = data.workflow_runs
            .filter((candidate) => {
              const pullRequests = Array.isArray(candidate.pull_requests)
                ? candidate.pull_requests
                : [];
              return (
                candidate.event === "pull_request" &&
                candidate.head_sha === request.headSha &&
                pullRequests.some(
                  (pullRequest) =>
                    pullRequest.number === request.prNumber &&
                    pullRequest.base.ref === request.baseBranch,
                )
              );
            })
            .sort(
              (left, right) =>
                Date.parse(right.created_at) - Date.parse(left.created_at),
            );
          const [requiredJobs = []] = [workflow.requiredJobs];
          const productJobs = requiredJobs.filter((name) =>
            name.startsWith("PR validation / "),
          );
          const requestJobs =
            productJobs.length > 0
              ? [...productJobs, "PR validation / Validate explicit CI request"]
              : requiredJobs;
          const applicableRuns = [];
          for (const candidate of runs) {
            const jobs = await new PullRequestAuditClient(
              request.octokit,
            ).auditRequiredJobs({
              subject1: { owner, repo },
              runId: candidate.id,
              requiredJobs: requestJobs,
            });
            if (jobs.isErr()) return err(jobs.error);
            if (
              jobs.value.some(
                (job) =>
                  typeof job.status === "string" &&
                  job.status.length > 0 &&
                  job.conclusion !== "skipped",
              )
            ) {
              applicableRuns.push(candidate);
              break;
            }
          }
          const run = applicableRuns[0];
          if (!run) {
            return ok({ ...workflow, state: WorkflowAuditState.NotIndexed });
          }
          const conclusion: WorkflowConclusion = run.conclusion
            ? {
                state: WorkflowConclusionState.Reported,
                value: run.conclusion,
              }
            : { state: WorkflowConclusionState.Pending };
          const status: WorkflowRunStatus =
            run.status === WorkflowRunStatusState.Completed
              ? { state: WorkflowRunStatusState.Completed }
              : typeof run.status === "string"
                ? { state: WorkflowRunStatusState.Other, value: run.status }
                : { state: WorkflowRunStatusState.Unavailable };
          const [defaulted5 = []] = [workflow.requiredJobs];
          const requiredJobAudits = await new PullRequestAuditClient(
            request.octokit,
          ).auditRequiredJobs({
            subject1: { owner, repo },
            runId: run.id,
            requiredJobs: defaulted5,
          });
          if (requiredJobAudits.isErr()) return err(requiredJobAudits.error);
          return ok({
            ...workflow,
            state: WorkflowAuditState.Indexed,
            conclusion,
            requiredJobAudits: requiredJobAudits.value,
            runId: run.id,
            status,
            url: run.html_url,
          });
        },
      ),
    );
    return Result.combine(outcomes);
  }
}

export enum WorkflowAuditState {
  NotIndexed = "not-indexed",
  Indexed = "indexed",
}

export enum WorkflowConclusionState {
  Pending = "pending",
  Reported = "reported",
}

export enum WorkflowRunStatusState {
  Unavailable = "unavailable",
  Completed = "completed",
  Other = "other",
}

export enum GithubWorkflowConclusion {
  Success = "success",
}

type WorkflowConclusion =
  | { state: WorkflowConclusionState.Pending }
  | { state: WorkflowConclusionState.Reported; value: string };

type WorkflowRunStatus =
  | { state: WorkflowRunStatusState.Unavailable }
  | { state: WorkflowRunStatusState.Completed }
  | { state: WorkflowRunStatusState.Other; value: string };

type RequiredJobAudit = {
  name: string;
  conclusion?: string;
  status?: string;
};

type WorkflowAudit = RequiredPrWorkflow &
  (
    | { state: WorkflowAuditState.NotIndexed }
    | {
        state: WorkflowAuditState.Indexed;
        conclusion: WorkflowConclusion;
        requiredJobAudits: RequiredJobAudit[];
        runId: number;
        status: WorkflowRunStatus;
        url: string;
      }
  );

type WorkflowAuditRequest = {
  baseBranch: string;
  headSha: string;
  octokit: Octokit;
  prNumber: number;
  repoRef: RepoRef;
  workflows: RequiredPrWorkflow[];
};

type BranchProtectionAudit = {
  available: boolean;
  requiresApprovingReviews?: boolean;
  requiresConversationResolution?: boolean;
  requiredStatusChecks?: string[];
};

export enum PullRequestMergeability {
  Conflicting = "conflicting",
  Mergeable = "mergeable",
  Unknown = "unknown",
}

export enum ExactHeadDeploymentAvailability {
  Found = "found",
  Unavailable = "unavailable",
}

export type ExactHeadDeployment =
  | {
      availability: ExactHeadDeploymentAvailability.Found;
      environment: string;
      state: string;
      url?: string;
    }
  | { availability: ExactHeadDeploymentAvailability.Unavailable };

export type PrAudit = {
  base: { branch: string; sha: string };
  branchProtection: BranchProtectionAudit;
  changedFiles: string[];
  exactHeadDeployment: ExactHeadDeployment;
  externalReviewPolicy: "inspect-existing-feedback-without-waiting";
  feedback: PrFeedbackSummary;
  head: { branch: string; sha: string };
  mergeState: {
    behindBy: number;
    draft: boolean;
    mergeability: PullRequestMergeability;
    state: string;
  };
  number: number;
  ready: boolean;
  reasons: string[];
  repository: string;
  requiredWorkflows: WorkflowAudit[];
  url: string;
};
