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
  readPrNumber(): number {
    const [raw = ""] = [this.environment.PR_NUMBER?.trim()];
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(
        `PR_NUMBER must be a positive integer (received ${raw || "empty"})`,
      );
    }
    return value;
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
  ): Promise<PrAudit> {
    const octokit = this.value;
    const { repoRef, prNumber } = request;

    const { owner, repo } = repoRef;
    const [{ data: pr }, files] = await Promise.all([
      octokit.rest.pulls.get({ owner, repo, pull_number: prNumber }),
      octokit.paginate(octokit.rest.pulls.listFiles, {
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
      }),
    ]);
    const changedFiles = files.map((file) => file.filename);
    const requiredWorkflows = await new PullRequestAuditAuditWorkflows({
      baseBranch: pr.base.ref,
      headSha: pr.head.sha,
      octokit,
      prNumber,
      repoRef,
      workflows: new PullRequestWorkflowSelection(changedFiles).names(),
    }).execute();
    const [comparison, feedback, branchProtection, exactHeadDeployment] =
      await Promise.all([
        octokit.rest.repos.compareCommitsWithBasehead({
          owner,
          repo,
          basehead: `${pr.base.ref}...${pr.head.sha}`,
        }),
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
    const mergeable =
      typeof pr.mergeable === "boolean"
        ? pr.mergeable
        : (
            await octokit.rest.pulls.get({
              owner,
              repo,
              pull_number: prNumber,
            })
          ).data.mergeable;

    const reasons: string[] = [];
    if (pr.state !== "open") reasons.push(`state is ${pr.state}`);
    if (pr.draft) reasons.push("pull request is draft");
    const mergeability =
      mergeable === true
        ? PullRequestMergeability.Mergeable
        : mergeable === false
          ? PullRequestMergeability.Conflicting
          : PullRequestMergeability.Unknown;
    if (mergeability === PullRequestMergeability.Conflicting)
      reasons.push("pull request has a merge conflict");
    if (mergeability === PullRequestMergeability.Unknown)
      reasons.push("pull request mergeability is unknown");
    for (const workflow of requiredWorkflows) {
      if (workflow.state === WorkflowAuditState.NotIndexed) {
        reasons.push(
          `${workflow.workflowName} run is not indexed for the current head`,
        );
      } else if (workflow.status.state === WorkflowRunStatusState.Unavailable) {
        reasons.push(`${workflow.workflowName} run has no status`);
      } else if (workflow.status.state === WorkflowRunStatusState.Other) {
        reasons.push(
          `${workflow.workflowName} run is ${workflow.status.value}`,
        );
      } else if (
        workflow.conclusion.state === WorkflowConclusionState.Pending
      ) {
        reasons.push(`${workflow.workflowName} run has no conclusion`);
      } else if (
        workflow.conclusion.value !== GithubWorkflowConclusion.Success
      ) {
        reasons.push(
          `${workflow.workflowName} run concluded ${workflow.conclusion.value}`,
        );
      }
      if (workflow.state === WorkflowAuditState.Indexed) {
        for (const job of workflow.requiredJobAudits) {
          if (job.status !== WorkflowRunStatusState.Completed) {
            const [defaulted1 = "missing"] = [job.status];
            reasons.push(
              `${job.name} is ${defaulted1} on the latest ${workflow.workflowName} run`,
            );
          } else if (job.conclusion !== GithubWorkflowConclusion.Success) {
            const [defaulted2 = "unknown"] = [job.conclusion];
            reasons.push(
              `${job.name} concluded ${defaulted2} on the latest ${workflow.workflowName} run`,
            );
          }
        }
      }
    }
    if (
      requiredWorkflows.some(
        (workflow) => workflow.workflowFile === "pr.yml",
      ) &&
      exactHeadDeployment?.state !== "success"
    ) {
      reasons.push("exact-head github-pages deployment is not successful");
    }
    if (feedback.unresolvedThreads > 0) {
      reasons.push(
        `${feedback.unresolvedThreads} unresolved review thread(s) already present`,
      );
    }
    if (feedback.unhandledComments > 0) {
      reasons.push(
        `${feedback.unhandledComments} unhandled substantive PR comment(s) already present`,
      );
    }
    if (feedback.unthreadedReviewFindings > 0) {
      reasons.push(
        `${feedback.unthreadedReviewFindings} unthreaded submitted review finding(s) already present`,
      );
    }
    const [defaulted3 = false] = [pr.draft];
    return {
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
    };
  }

  async auditRequiredJobs(
    request: PullRequestAuditClientAuditRequiredJobsRequest,
  ): Promise<RequiredJobAudit[]> {
    const octokit = this.value;
    const { subject1, runId, requiredJobs } = request;
    const { owner, repo } = subject1;

    if (requiredJobs.length === 0) {
      return [];
    }
    const jobs = await octokit.paginate(
      octokit.rest.actions.listJobsForWorkflowRun,
      {
        owner,
        repo,
        run_id: runId,
        filter: "latest",
        per_page: 100,
      },
    );
    return requiredJobs.map((name) => {
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
    });
  }

  async inspectBranchProtection(
    request: PullRequestAuditClientInspectBranchProtectionRequest,
  ): Promise<BranchProtectionAudit> {
    const octokit = this.value;
    const { subject1, branch } = request;
    const { owner, repo } = subject1;

    try {
      const { data } = await octokit.rest.repos.getBranchProtection({
        owner,
        repo,
        branch,
      });
      const [defaulted6 = 0] = [
        data.required_pull_request_reviews?.required_approving_review_count,
      ];
      const [defaulted7 = false] = [
        data.required_conversation_resolution?.enabled,
      ];
      const [defaulted8 = new Array<string>()] = [
        data.required_status_checks?.checks?.map((check) => check.context),
      ];
      return {
        available: true,
        requiresApprovingReviews: defaulted6 > 0,
        requiresConversationResolution: defaulted7,
        requiredStatusChecks: defaulted8,
      };
    } catch (error: unknown) {
      if (
        new PullRequestAuditIsHttpStatus({
          error: error,
          status: 403,
        }).execute() ||
        new PullRequestAuditIsHttpStatus({
          error: error,
          status: 404,
        }).execute()
      ) {
        return { available: false };
      }
      throw error;
    }
  }

  async inspectExactHeadDeployment(
    request: PullRequestAuditClientInspectExactHeadDeploymentRequest,
  ): Promise<PrAudit["exactHeadDeployment"]> {
    const octokit = this.value;
    const { subject1, headSha } = request;
    const { owner, repo } = subject1;

    const { data: deployments } = await octokit.rest.repos.listDeployments({
      owner,
      repo,
      environment: "github-pages",
      sha: headSha,
      per_page: 20,
    });
    for (const deployment of deployments) {
      const { data: statuses } =
        await octokit.rest.repos.listDeploymentStatuses({
          owner,
          repo,
          deployment_id: deployment.id,
          per_page: 1,
        });
      const latest = statuses[0];
      if (latest) {
        return {
          environment: deployment.environment,
          state: latest.state,
          ...(latest.environment_url ? { url: latest.environment_url } : {}),
        };
      }
    }
    return;
  }
}

export class PullRequestAuditRunPrAudit {
  constructor(private readonly request: boolean) {}
  async execute(): Promise<void> {
    const requireReady = this.request;

    const repository = process.env.GITHUB_REPOSITORY?.trim();
    if (!repository) {
      throw new Error("GITHUB_REPOSITORY is required");
    }
    const prNumber = new PullRequestAuditEnvironment(
      process.env,
    ).readPrNumber();
    const octokit = new GitHubEnvironment(process.env).createOctokit();
    const repoRef = new GitHubRepositoryName(repository).parse();
    const audit = await new PullRequestAuditClient(octokit).buildPrAudit({
      repoRef: repoRef,
      prNumber: prNumber,
    });
    console.log(new JsonDocument(audit).format());
    if (requireReady && !audit.ready) {
      throw new Error(
        `PR #${prNumber} is not ready: ${audit.reasons.join("; ")}`,
      );
    }
  }
}

class PullRequestAuditAuditWorkflows {
  constructor(private readonly request: WorkflowAuditRequest) {}
  async execute(): Promise<WorkflowAudit[]> {
    const request = this.request;

    const { owner, repo } = request.repoRef;
    return Promise.all(
      request.workflows.map(async (workflow) => {
        const { data } = await request.octokit.rest.actions.listWorkflowRuns({
          owner,
          repo,
          workflow_id: workflow.workflowFile,
          event: "pull_request",
          head_sha: request.headSha,
          per_page: 20,
        });
        const runs = data.workflow_runs
          .filter((candidate) => {
            const pullRequests = Array.isArray(candidate.pull_requests)
              ? candidate.pull_requests
              : [];
            return (
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
        const run = runs[0];
        if (!run) {
          return { ...workflow, state: WorkflowAuditState.NotIndexed };
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
        return {
          ...workflow,
          state: WorkflowAuditState.Indexed,
          conclusion,
          requiredJobAudits,
          runId: run.id,
          status,
          url: run.html_url,
        };
      }),
    );
  }
}

interface PullRequestAuditIsHttpStatusRequest {
  readonly error: unknown;
  readonly status: number;
}

class PullRequestAuditIsHttpStatus {
  constructor(private readonly request: PullRequestAuditIsHttpStatusRequest) {}
  execute(): boolean {
    const { error, status } = this.request;

    return (
      error instanceof Error &&
      "status" in error &&
      (error as { status: number }).status === status
    );
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

export type PrAudit = {
  base: { branch: string; sha: string };
  branchProtection: BranchProtectionAudit;
  changedFiles: string[];
  exactHeadDeployment?: { environment: string; state: string; url?: string };
  externalReviewPolicy: "inspect-existing-feedback-without-waiting";
  feedback: Awaited<ReturnType<GitHubClient["inspectPrFeedback"]>>;
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
