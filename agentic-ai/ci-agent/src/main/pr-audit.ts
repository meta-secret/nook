import type { Octokit } from "@octokit/rest";

import {
  createOctokit,
  inspectPrFeedback,
  parseRepository,
  requiredPrWorkflows,
  type RepoRef,
  type RequiredPrWorkflow,
} from "./github.js";

type WorkflowAudit = RequiredPrWorkflow & {
  conclusion?: string;
  runId?: number;
  status?: string;
  url?: string;
};

type BranchProtectionAudit = {
  available: boolean;
  requiresApprovingReviews?: boolean;
  requiresConversationResolution?: boolean;
  requiredStatusChecks?: string[];
};

export type PrAudit = {
  base: { branch: string; sha: string };
  branchProtection: BranchProtectionAudit;
  changedFiles: string[];
  exactHeadDeployment?: { environment: string; state: string; url?: string };
  externalReviewPolicy: "require-current-head-codex-review-settled";
  feedback: Awaited<ReturnType<typeof inspectPrFeedback>>;
  head: { branch: string; sha: string };
  mergeState: {
    behindBy: number;
    draft: boolean;
    mergeability: "conflicting" | "mergeable" | "unknown";
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
  console.log(JSON.stringify(audit, null, 2));
  if (requireReady && !audit.ready) {
    throw new Error(`PR #${prNumber} is not ready: ${audit.reasons.join("; ")}`);
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
  const requiredWorkflows = await auditWorkflows(
    octokit,
    repoRef,
    prNumber,
    pr.head.sha,
    requiredPrWorkflows(changedFiles),
  );
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
    mergeable === true ? "mergeable" : mergeable === false ? "conflicting" : "unknown";
  if (mergeability === "conflicting") reasons.push("pull request has a merge conflict");
  if (mergeability === "unknown") reasons.push("pull request mergeability is unknown");
  if (comparison.data.behind_by > 0) {
    reasons.push(`head is behind ${pr.base.ref} by ${comparison.data.behind_by} commit(s)`);
  }
  for (const workflow of requiredWorkflows) {
    if (workflow.runId === undefined) {
      reasons.push(`${workflow.workflowName} run is not indexed for the current head`);
    } else if (workflow.status !== "completed") {
      reasons.push(`${workflow.workflowName} run is ${workflow.status}`);
    } else if (workflow.conclusion !== "success") {
      reasons.push(`${workflow.workflowName} run concluded ${workflow.conclusion}`);
    }
  }
  if (
    requiredWorkflows.some((workflow) => workflow.workflowFile === "pr.yml") &&
    exactHeadDeployment?.state !== "success"
  ) {
    reasons.push("exact-head github-pages deployment is not successful");
  }
  if (feedback.unresolvedThreads > 0) {
    reasons.push(`${feedback.unresolvedThreads} unresolved review thread(s) already present`);
  }
  if (feedback.substantiveComments > 0) {
    reasons.push(`${feedback.substantiveComments} substantive PR comment(s) already present`);
  }
  if (feedback.substantiveReviews > 0) {
    reasons.push(`${feedback.substantiveReviews} substantive current-head review(s) already present`);
  }
  if (!feedback.codexReview.settled) {
    reasons.push("current-head Codex review has not settled");
  }

  return {
    base: { branch: pr.base.ref, sha: pr.base.sha },
    branchProtection,
    changedFiles,
    exactHeadDeployment,
    externalReviewPolicy: "require-current-head-codex-review-settled",
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
  octokit: Octokit,
  { owner, repo }: RepoRef,
  prNumber: number,
  headSha: string,
  workflows: RequiredPrWorkflow[],
): Promise<WorkflowAudit[]> {
  return Promise.all(
    workflows.map(async (workflow) => {
      const { data } = await octokit.rest.actions.listWorkflowRuns({
        owner,
        repo,
        workflow_id: workflow.workflowFile,
        event: "pull_request",
        head_sha: headSha,
        per_page: 20,
      });
      const run = data.workflow_runs.find(
        (candidate) =>
          candidate.head_sha === headSha &&
          (candidate.pull_requests ?? []).some(
            (pullRequest) => pullRequest.number === prNumber,
          ),
      );
      return {
        ...workflow,
        conclusion: run?.conclusion ?? undefined,
        runId: run?.id,
        status: run?.status ?? undefined,
        url: run?.html_url ?? undefined,
      };
    }),
  );
}

async function inspectBranchProtection(
  octokit: Octokit,
  { owner, repo }: RepoRef,
  branch: string,
): Promise<BranchProtectionAudit> {
  try {
    const { data } = await octokit.rest.repos.getBranchProtection({ owner, repo, branch });
    return {
      available: true,
      requiresApprovingReviews:
        (data.required_pull_request_reviews?.required_approving_review_count ?? 0) > 0,
      requiresConversationResolution: data.required_conversation_resolution?.enabled ?? false,
      requiredStatusChecks:
        data.required_status_checks?.checks?.map((check) => check.context) ?? [],
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
        url: latest.environment_url ?? undefined,
      };
    }
  }
  return undefined;
}

function readPrNumber(): number {
  const raw = process.env.PR_NUMBER?.trim() ?? "";
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`PR_NUMBER must be a positive integer (received ${raw || "empty"})`);
  }
  return value;
}

function isHttpStatus(error: unknown, status: number): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status: number }).status === status
  );
}
