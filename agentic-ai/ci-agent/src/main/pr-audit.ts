import type { Octokit } from "@octokit/rest";

import {
  AGENT_MANAGED_PR_MARKER,
  createOctokit,
  inspectPrFeedback,
  markAgentManagedPr,
  parseRepository,
  requiredPrWorkflows,
  squashMergePr,
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
  externalReviewPolicy: "inspect-present-feedback-only-never-wait";
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

export async function runPrMonitor(): Promise<void> {
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  if (!repository) {
    throw new Error("GITHUB_REPOSITORY is required");
  }
  const prNumber = readPrNumber();
  const octokit = createOctokit();
  const repoRef = parseRepository(repository);
  const { data: pr } = await octokit.rest.pulls.get({
    owner: repoRef.owner,
    repo: repoRef.repo,
    pull_number: prNumber,
  });
  const { data: authenticated } = await octokit.rest.users.getAuthenticated();
  const trustedAgentPr = isTrustedAgentPr(
    pr.head.repo?.full_name,
    pr.head.ref,
    repository,
    pr.user?.login,
    authenticated.login,
  );
  if (trustedAgentPr) {
    await markAgentManagedPr(octokit, repoRef, prNumber, `manual-${Date.now()}`);
    console.log(
      `Armed event-driven monitoring for PR #${prNumber}; this command exits without waiting or polling`,
    );
  } else {
    console.log(
      `PR #${prNumber} is not authored by the authenticated agent identity on a trusted branch; printing a read-only audit`,
    );
  }
  const audit = await buildPrAudit(octokit, repoRef, prNumber);
  console.log(JSON.stringify(audit, null, 2));
}

export async function runPrEvent(): Promise<void> {
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  if (!repository) {
    throw new Error("GITHUB_REPOSITORY is required");
  }
  const prNumber = readPrNumber();
  const octokit = createOctokit();
  const repoRef = parseRepository(repository);
  const { data: pr } = await octokit.rest.pulls.get({
    owner: repoRef.owner,
    repo: repoRef.repo,
    pull_number: prNumber,
  });
  const { data: authenticated } = await octokit.rest.users.getAuthenticated();
  const trustedAgentPr = isTrustedAgentPr(
    pr.head.repo?.full_name,
    pr.head.ref,
    repository,
    pr.user?.login,
    authenticated.login,
  );
  if (!(pr.body ?? "").includes(AGENT_MANAGED_PR_MARKER) || !trustedAgentPr) {
    console.log(`PR #${prNumber} is not agent-managed; ignoring event`);
    return;
  }
  if (pr.merged || pr.state === "closed") {
    console.log(`Agent-managed PR #${prNumber} is already ${pr.merged ? "merged" : "closed"}`);
    return;
  }

  const audit = await buildPrAudit(octokit, repoRef, prNumber);
  console.log(JSON.stringify(audit, null, 2));
  if (audit.ready) {
    await squashMergePr(octokit, repoRef, prNumber, audit.head.branch, audit.head.sha);
    console.log(`Squash-merged agent-managed PR #${prNumber}`);
    return;
  }
  if (isAwaitingRepositoryEvent(audit)) {
    console.log(
      `PR #${prNumber} is awaiting another repository-owned workflow event: ${audit.reasons.join("; ")}`,
    );
    return;
  }
  throw new Error(
    `Agent-managed PR #${prNumber} requires a fix or feedback handling: ${audit.reasons.join("; ")}`,
  );
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

  return {
    base: { branch: pr.base.ref, sha: pr.base.sha },
    branchProtection,
    changedFiles,
    exactHeadDeployment,
    externalReviewPolicy: "inspect-present-feedback-only-never-wait",
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

function isTransientEventReason(reason: string): boolean {
  return (
    reason.includes("run is not indexed for the current head") ||
    reason.includes("run is queued") ||
    reason.includes("run is in_progress")
  );
}

export function isAwaitingRepositoryEvent(
  audit: Pick<PrAudit, "reasons" | "requiredWorkflows">,
): boolean {
  const mainWorkflowPending = audit.requiredWorkflows.some(
    (workflow) =>
      workflow.workflowFile === "pr.yml" &&
      (workflow.runId === undefined || workflow.status !== "completed"),
  );
  const repositoryWorkflowPending = audit.requiredWorkflows.some(
    (workflow) => workflow.runId === undefined || workflow.status !== "completed",
  );
  return audit.reasons.every(
    (reason) =>
      isTransientEventReason(reason) ||
      (repositoryWorkflowPending && reason === "pull request mergeability is unknown") ||
      (mainWorkflowPending && reason === "exact-head github-pages deployment is not successful"),
  );
}

export function isTrustedAgentHead(
  headRepository: string | undefined,
  headBranch: string,
  repository: string,
): boolean {
  return (
    headRepository === repository &&
    ["agent/", "fix/", "codex/"].some((prefix) => headBranch.startsWith(prefix))
  );
}

export function isTrustedAgentPr(
  headRepository: string | undefined,
  headBranch: string,
  repository: string,
  prAuthor: string | undefined,
  authenticatedLogin: string,
): boolean {
  return (
    isTrustedAgentHead(headRepository, headBranch, repository) &&
    prAuthor === authenticatedLogin
  );
}
