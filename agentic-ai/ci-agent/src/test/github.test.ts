import assert from "node:assert/strict";
import test from "node:test";

import type { Octokit } from "@octokit/rest";

import {
  assertNoPendingPrFeedback,
  markAgentManagedPr,
  requiredPrCheckNames,
  requiredPrWorkflows,
  squashMergePr,
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

test("markAgentManagedPr marks and wakes a reused PR", async () => {
  let updatedBody = "";
  const octokit = {
    rest: {
      pulls: {
        get: async () => ({ data: { body: "Existing body" } }),
        update: async ({ body }: { body: string }) => {
          updatedBody = body;
          return { data: {} };
        },
      },
    },
  } as unknown as Octokit;

  await markAgentManagedPr(octokit, repoRef, 347, "run-42");
  assert.match(updatedBody, /<!-- nook-agent-managed -->/);
  assert.match(updatedBody, /<!-- nook-agent-monitor-wake:run-42 -->/);
});

test("squashMergePr requires the audited head SHA", async () => {
  let mergeSha = "";
  const octokit = {
    rest: {
      pulls: {
        merge: async ({ sha }: { sha: string }) => {
          mergeSha = sha;
          return { data: {} };
        },
      },
      git: { deleteRef: async () => ({ data: {} }) },
    },
  } as unknown as Octokit;

  await squashMergePr(octokit, repoRef, 347, "agent/fix", "audited-sha");
  assert.equal(mergeSha, "audited-sha");
});

type MockOptions = {
  files?: string[];
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
