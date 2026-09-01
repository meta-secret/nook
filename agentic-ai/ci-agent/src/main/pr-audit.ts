import type { Octokit } from "@octokit/rest";

import {
  createOctokit,
  inspectPrFeedback,
  parseRepository,
  requiredPrWorkflows,
  type RepoRef,
  type RequiredPrWorkflow,
} from "./github.js";
import { prettyJson } from "./json.js";

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
  baseSha: string;
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
  feedback: Awaited<ReturnType<typeof inspectPrFeedback>>;
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

export async function runPrAudit(requireReady: boolean): Promise<void> {
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  if (!repository) {
    throw new Error("GITHUB_REPOSITORY is required");
  }
  const prNumber = readPrNumber();
  const octokit = createOctokit();
  const repoRef = parseRepository(repository);
  const audit = await buildPrAudit(octokit, repoRef, prNumber);
  console.log(prettyJson(audit));
  if (requireReady && !audit.ready) {
    throw new Error(
      `PR #${prNumber} is not ready: ${audit.reasons.join("; ")}`,
    );
  }
}

export async function buildPrAudit(
  octokit: Octokit,
  repoRef: RepoRef,
  prNumber: number,
): Promise<PrAudit> {
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
  const requiredWorkflows = await auditWorkflows({
    baseSha: pr.base.sha,
    headSha: pr.head.sha,
    octokit,
    prNumber,
    repoRef,
    workflows: requiredPrWorkflows(changedFiles),
  });
  const [comparison, feedback, branchProtection, exactHeadDeployment] =
    await Promise.all([
      octokit.rest.repos.compareCommitsWithBasehead({
        owner,
        repo,
        basehead: `${pr.base.ref}...${pr.head.sha}`,
      }),
      inspectPrFeedback(octokit, repoRef, prNumber),
      inspectBranchProtection(octokit, repoRef, pr.base.ref),
      inspectExactHeadDeployment(octokit, repoRef, pr.head.sha),
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
  if (comparison.data.behind_by > 0) {
    reasons.push(
      `head is behind ${pr.base.ref} by ${comparison.data.behind_by} commit(s)`,
    );
  }
  for (const workflow of requiredWorkflows) {
    if (workflow.state === WorkflowAuditState.NotIndexed) {
      reasons.push(
        `${workflow.workflowName} run is not indexed for the current head`,
      );
    } else if (workflow.status.state === WorkflowRunStatusState.Unavailable) {
      reasons.push(`${workflow.workflowName} run has no status`);
    } else if (workflow.status.state === WorkflowRunStatusState.Other) {
      reasons.push(`${workflow.workflowName} run is ${workflow.status.value}`);
    } else if (workflow.conclusion.state === WorkflowConclusionState.Pending) {
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
          reasons.push(
            `${job.name} is ${job.status ?? "missing"} on the latest ${workflow.workflowName} run`,
          );
        } else if (job.conclusion !== GithubWorkflowConclusion.Success) {
          reasons.push(
            `${job.name} concluded ${job.conclusion ?? "unknown"} on the latest ${workflow.workflowName} run`,
          );
        }
      }
    }
  }
  if (
    requiredWorkflows.some((workflow) => workflow.workflowFile === "pr.yml") &&
    exactHeadDeployment?.state !== "success"
  ) {
    reasons.push("exact-head github-pages deployment is not successful");
  }
  if (feedback.unresolvedThreads > 0) {
    reasons.push(
      `${feedback.unresolvedThreads} unresolved review thread(s) already present`,
    );
  }
  if (feedback.substantiveComments > 0) {
    reasons.push(
      `${feedback.substantiveComments} substantive PR comment(s) already present`,
    );
  }
  if (feedback.unthreadedReviewFindings > 0) {
    reasons.push(
      `${feedback.unthreadedReviewFindings} unthreaded submitted review finding(s) already present`,
    );
  }
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
      draft: pr.draft ?? false,
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

async function auditWorkflows(
  request: WorkflowAuditRequest,
): Promise<WorkflowAudit[]> {
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
        .filter(
          (candidate) =>
            candidate.head_sha === request.headSha &&
            (candidate.pull_requests ?? []).some(
              (pullRequest) =>
                pullRequest.number === request.prNumber &&
                (workflow.workflowFile === "web-research.yml" ||
                  pullRequest.base.sha === request.baseSha),
            ),
        )
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
      const requiredJobAudits = await auditRequiredJobs(
        request.octokit,
        { owner, repo },
        run.id,
        workflow.requiredJobs ?? [],
      );
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

async function auditRequiredJobs(
  octokit: Octokit,
  { owner, repo }: RepoRef,
  runId: number,
  requiredJobs: readonly string[],
): Promise<RequiredJobAudit[]> {
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

async function inspectBranchProtection(
  octokit: Octokit,
  { owner, repo }: RepoRef,
  branch: string,
): Promise<BranchProtectionAudit> {
  try {
    const { data } = await octokit.rest.repos.getBranchProtection({
      owner,
      repo,
      branch,
    });
    return {
      available: true,
      requiresApprovingReviews:
        (data.required_pull_request_reviews?.required_approving_review_count ??
          0) > 0,
      requiresConversationResolution:
        data.required_conversation_resolution?.enabled ?? false,
      requiredStatusChecks:
        data.required_status_checks?.checks?.map((check) => check.context) ??
        [],
    };
  } catch (error: unknown) {
    if (isHttpStatus(error, 403) || isHttpStatus(error, 404)) {
      return { available: false };
    }
    throw error;
  }
}

async function inspectExactHeadDeployment(
  octokit: Octokit,
  { owner, repo }: RepoRef,
  headSha: string,
): Promise<PrAudit["exactHeadDeployment"]> {
  const { data: deployments } = await octokit.rest.repos.listDeployments({
    owner,
    repo,
    environment: "github-pages",
    sha: headSha,
    per_page: 20,
  });
  for (const deployment of deployments) {
    const { data: statuses } = await octokit.rest.repos.listDeploymentStatuses({
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

function readPrNumber(): number {
  const raw = process.env.PR_NUMBER?.trim() ?? "";
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `PR_NUMBER must be a positive integer (received ${raw || "empty"})`,
    );
  }
  return value;
}

function isHttpStatus(error: unknown, status: number): boolean {
  return (
    error instanceof Error &&
    "status" in error &&
    (error as { status: number }).status === status
  );
}
