import assert from "node:assert/strict";
import test from "node:test";

import type { Octokit } from "@octokit/rest";

import {
  createFixPr,
  requestCodexReview,
  requiredPrCheckNames,
  requiredPrWorkflows,
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

test("createFixPr leaves the PR body free of automatic merge control markers", async () => {
  let createdBody = "";
  const octokit = {
    rest: {
      pulls: {
        create: async ({ body }: { body: string }) => {
          createdBody = body;
          return { data: { number: 347 } };
        },
      },
    },
  } as unknown as Octokit;

  const priorBody = process.env.AGENT_PR_BODY;
  process.env.AGENT_PR_BODY = "## Summary\n\nOpen this PR for review.";
  try {
    const prNumber = await createFixPr(octokit, repoRef, "agent/fix", "run-42");
    assert.equal(prNumber, 347);
    assert.equal(createdBody, "## Summary\n\nOpen this PR for review.");
    assert.doesNotMatch(createdBody, /nook-agent-managed|nook-agent-monitor-wake/);
  } finally {
    if (priorBody === undefined) {
      delete process.env.AGENT_PR_BODY;
    } else {
      process.env.AGENT_PR_BODY = priorBody;
    }
  }
});

test("requestCodexReview posts one exact-head idempotency marker", async () => {
  const createdBodies: string[] = [];
  const comments: Array<{ body: string; id: number }> = [];
  const octokit = {
    rest: {
      issues: {
        createComment: async ({ body }: { body: string }) => {
          createdBodies.push(body);
          comments.push({ body, id: 1 });
          return { data: { id: 1 } };
        },
        listComments: async () => ({ data: comments }),
      },
      pulls: {
        get: async () => ({ data: { head: { sha: "head-sha" } } }),
        listReviews: async () => ({ data: [] }),
      },
    },
    paginate: async (
      route: (args: unknown) => Promise<{ data: unknown[] }>,
      args: unknown,
    ) => (await route(args)).data,
  } as unknown as Octokit;

  const first = await requestCodexReview(octokit, repoRef, 410);
  const second = await requestCodexReview(octokit, repoRef, 410);

  assert.deepEqual(first, { headSha: "head-sha", requested: true, settled: false });
  assert.deepEqual(second, { headSha: "head-sha", requested: false, settled: false });
  assert.deepEqual(createdBodies, [
    "@codex review\n\n<!-- nook-codex-review:head-sha -->",
  ]);
});
