import assert from "node:assert/strict";
import test from "node:test";

import type { Octokit } from "@octokit/rest";

import { buildPrAudit } from "../main/pr-audit.js";

const repoRef = { owner: "meta-secret", repo: "nook" };

test("buildPrAudit reports an exact-head repository-green PR as ready", async () => {
  const audit = await buildPrAudit(mockOctokit(), repoRef, 410);

  assert.equal(audit.ready, true);
  assert.deepEqual(audit.reasons, []);
  assert.equal(audit.externalReviewPolicy, "inspect-present-feedback-only-never-wait");
  assert.deepEqual(audit.requiredWorkflows.map((workflow) => workflow.workflowName), ["PR"]);
  assert.equal(audit.exactHeadDeployment?.state, "success");
});

test("buildPrAudit reports current-head and existing-feedback blockers", async () => {
  const audit = await buildPrAudit(
    mockOctokit({ behindBy: 2, runStatus: "in_progress", unresolvedThreads: 1 }),
    repoRef,
    410,
  );

  assert.equal(audit.ready, false);
  assert.ok(audit.reasons.some((reason) => reason.includes("behind main by 2")));
  assert.ok(audit.reasons.some((reason) => reason.includes("PR run is in_progress")));
  assert.ok(audit.reasons.some((reason) => reason.includes("unresolved review thread")));
});

type MockOptions = {
  behindBy?: number;
  runStatus?: "completed" | "in_progress";
  unresolvedThreads?: number;
};

function mockOctokit(options: MockOptions = {}): Octokit {
  const pulls = {
    get: async () => ({
      data: {
        base: { ref: "main", sha: "base-sha" },
        draft: false,
        head: { ref: "feature", sha: "head-sha" },
        html_url: "https://github.com/meta-secret/nook/pull/410",
        mergeable: true,
        number: 410,
        state: "open",
      },
    }),
    listFiles: async () => ({ data: [{ filename: "nook-app/nook-core/src/lib.rs" }] }),
    listReviews: async () => ({
      data: [
        {
          body: "### 💡 Codex Review\n\nStatus summary",
          commit_id: "head-sha",
          state: "COMMENTED",
        },
      ],
    }),
  };
  const issues = {
    listComments: async () => ({
      data: [{ body: "### Preview deployed\n\nhttps://preview.test" }],
    }),
  };
  const repos = {
    compareCommitsWithBasehead: async () => ({
      data: { behind_by: options.behindBy ?? 0 },
    }),
    getBranchProtection: async () => ({
      data: {
        required_conversation_resolution: { enabled: true },
        required_pull_request_reviews: { required_approving_review_count: 0 },
        required_status_checks: { checks: [] },
      },
    }),
    listDeployments: async () => ({
      data: [{ environment: "github-pages", id: 99 }],
    }),
    listDeploymentStatuses: async () => ({
      data: [{ environment_url: "https://preview.test", state: "success" }],
    }),
  };
  const octokit = {
    rest: {
      actions: {
        listWorkflowRuns: async () => ({
          data: {
            workflow_runs: [
              {
                conclusion: options.runStatus === "in_progress" ? undefined : "success",
                head_sha: "head-sha",
                html_url: "https://github.com/meta-secret/nook/actions/runs/42",
                id: 42,
                pull_requests: [{ number: 410 }],
                status: options.runStatus ?? "completed",
              },
            ],
          },
        }),
      },
      issues,
      pulls,
      repos,
    },
    paginate: async (
      route: (args: unknown) => Promise<{ data: unknown[] }>,
      args: unknown,
    ) => (await route(args)).data,
    graphql: async () => ({
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: Array.from({ length: options.unresolvedThreads ?? 0 }, () => ({
              isResolved: false,
            })),
            pageInfo: { hasNextPage: false },
          },
        },
      },
    }),
  };
  return octokit as unknown as Octokit;
}
