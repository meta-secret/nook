import assert from "node:assert/strict";
import test from "node:test";

import type { Octokit } from "@octokit/rest";

import {
  assertNoPendingPrFeedback,
  requiredPrCheckNames,
  requiredPrWorkflows,
  waitForPrChecks,
} from "../main/github.js";

const repoRef = { owner: "meta-secret", repo: "nook" };

test("requiredPrCheckNames maps changed paths to repository-owned gates", () => {
  assert.deepEqual(requiredPrCheckNames([".cortex/rules.md"]), []);
  assert.deepEqual(
    requiredPrCheckNames(["nook-app/nook-core/src/lib.rs"]),
    ["Verify and preview"],
  );
  assert.deepEqual(
    requiredPrCheckNames(["nook-app/nook-web/nook-web-research/src/main.ts"]),
    ["Build and deploy research catalog"],
  );
  assert.deepEqual(
    requiredPrCheckNames([
      "nook-app/nook-core/src/lib.rs",
      "nook-app/nook-web/nook-web-research/src/main.ts",
    ]),
    ["Build and deploy research catalog", "Verify and preview"],
  );
  assert.deepEqual(requiredPrWorkflows(["nook-app/nook-core/src/lib.rs"]), [
    {
      checkName: "Verify and preview",
      workflowFile: "pr.yml",
      workflowName: "PR",
    },
  ]);
});

test("waitForPrChecks ignores external checks and accepts a completed repository run", async () => {
  const octokit = mockOctokit({
    files: ["nook-app/nook-core/src/lib.rs"],
    workflowRuns: [workflowRun(41, "completed", "success")],
  });

  await waitForPrChecks(octokit, repoRef, 347, { discoveryTimeoutMs: 100 });
});

test("waitForPrChecks fails a repository-owned check", async () => {
  const octokit = mockOctokit({
    files: ["nook-app/nook-core/src/lib.rs"],
    workflowRuns: [workflowRun(42, "completed", "failure")],
  });

  await assert.rejects(
    waitForPrChecks(octokit, repoRef, 347, { discoveryTimeoutMs: 100 }),
    /completed with failure/,
  );
});

test("waitForPrChecks delegates an active repository run to the event watcher", async () => {
  const watched: number[] = [];
  const octokit = mockOctokit({
    files: ["nook-app/nook-core/src/lib.rs"],
    workflowRuns: [workflowRun(43, "in_progress")],
  });

  await waitForPrChecks(octokit, repoRef, 347, {
    discoveryTimeoutMs: 100,
    watcher: async (_repo, runId) => {
      watched.push(runId);
    },
  });

  assert.deepEqual(watched, [43]);
});

test("assertNoPendingPrFeedback ignores repository status comments", async () => {
  const octokit = mockOctokit({
    issueComments: [
      { body: "### Preview deployed\n\nhttps://example.test" },
      { body: "<!-- nook-core-coverage -->\n### nook-core + nook-auth2 coverage" },
    ],
    reviews: [
      {
        commit_id: "head-sha",
        state: "COMMENTED",
        body: "### 💡 Codex Review\n\nReview summary",
      },
    ],
  });

  await assertNoPendingPrFeedback(octokit, repoRef, 347);
});

test("assertNoPendingPrFeedback blocks unresolved review threads", async () => {
  const octokit = mockOctokit({ unresolvedThreads: 1 });

  await assert.rejects(
    assertNoPendingPrFeedback(octokit, repoRef, 347),
    /feedback requiring manual handling.*threads=1/,
  );
});

type MockOptions = {
  files?: string[];
  workflowRuns?: Array<ReturnType<typeof workflowRun>>;
  issueComments?: Array<{ body: string }>;
  reviews?: Array<{ commit_id: string; state: string; body: string }>;
  unresolvedThreads?: number;
};

function mockOctokit(options: MockOptions): Octokit {
  const pulls = {
    listFiles: async () => ({
      data: (options.files ?? []).map((filename) => ({ filename })),
    }),
    get: async () => ({ data: { head: { sha: "head-sha" } } }),
    listReviews: async () => ({ data: options.reviews ?? [] }),
  };
  const issues = {
    listComments: async () => ({ data: options.issueComments ?? [] }),
  };
  const octokit = {
    rest: {
      pulls,
      issues,
      actions: {
        listWorkflowRuns: async () => ({
          data: { workflow_runs: options.workflowRuns ?? [] },
        }),
      },
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

function workflowRun(
  id: number,
  status: "queued" | "in_progress" | "completed",
  conclusion?: string,
) {
  return {
    id,
    status,
    conclusion: conclusion ?? null,
    created_at: "2026-07-15T00:00:00Z",
    head_sha: "head-sha",
    pull_requests: [{ number: 347 }],
  };
}
