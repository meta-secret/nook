import assert from "node:assert/strict";
import test from "node:test";

import type { Octokit } from "@octokit/rest";

import {
  assertNoPendingPrFeedback,
  requiredPrCheckNames,
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
});

test("waitForPrChecks ignores pending external checks", async () => {
  const octokit = mockOctokit({
    files: ["nook-app/nook-core/src/lib.rs"],
    checkRuns: [
      checkRun("Codex", "in_progress"),
      checkRun("Verify and preview", "completed", "success"),
    ],
  });

  await waitForPrChecks(octokit, repoRef, 347, 0, 1_000);
});

test("waitForPrChecks fails a repository-owned check", async () => {
  const octokit = mockOctokit({
    files: ["nook-app/nook-core/src/lib.rs"],
    checkRuns: [checkRun("Verify and preview", "completed", "failure")],
  });

  await assert.rejects(
    waitForPrChecks(octokit, repoRef, 347, 0, 1_000),
    /repository-owned checks failed/,
  );
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
  checkRuns?: Array<ReturnType<typeof checkRun>>;
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
      checks: {
        listForRef: async () => ({ data: { check_runs: options.checkRuns ?? [] } }),
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

function checkRun(
  name: string,
  status: "queued" | "in_progress" | "completed",
  conclusion?: string,
) {
  return {
    name,
    status,
    conclusion,
    app: { slug: name === "Codex" ? "codex" : "github-actions" },
  };
}
