import assert from "node:assert/strict";
import test from "node:test";

import type { Octokit } from "@octokit/rest";

import { buildPrAudit } from "../main/pr-audit.js";

const repoRef = { owner: "meta-secret", repo: "nook" };

test("buildPrAudit reports an exact-head repository-green PR as ready", async () => {
  const audit = await buildPrAudit(mockOctokit(), repoRef, 410);

  assert.equal(audit.ready, true);
  assert.deepEqual(audit.reasons, []);
  assert.equal(audit.externalReviewPolicy, "inspect-existing-feedback-without-waiting");
  assert.deepEqual(audit.requiredWorkflows.map((workflow) => workflow.workflowName), ["PR"]);
  assert.equal(audit.exactHeadDeployment?.state, "success");
});

test("buildPrAudit does not wait for a current-head Codex review", async () => {
  const audit = await buildPrAudit(mockOctokit({ codexReview: "missing" }), repoRef, 410);

  assert.equal(audit.ready, true);
  assert.equal(audit.feedback.codexReview.settled, false);
  assert.deepEqual(audit.reasons, []);
});

test("buildPrAudit accepts a Codex approval reaction on the exact-head request", async () => {
  const audit = await buildPrAudit(mockOctokit({ codexReview: "reaction" }), repoRef, 410);

  assert.equal(audit.ready, true);
  assert.equal(audit.feedback.codexReview.approvalReaction, true);
  assert.equal(audit.feedback.codexReview.settled, true);
  assert.equal(audit.feedback.substantiveComments, 0);
});

test("buildPrAudit accepts a clean Codex issue comment for the exact head", async () => {
  const audit = await buildPrAudit(mockOctokit({ codexReview: "clean-comment" }), repoRef, 410);

  assert.equal(audit.ready, true);
  assert.equal(audit.feedback.codexReview.cleanComment, true);
  assert.equal(audit.feedback.codexReview.settled, true);
  assert.equal(audit.feedback.substantiveComments, 0);
});

test("buildPrAudit keeps a stale clean Codex comment as non-actionable status", async () => {
  const audit = await buildPrAudit(
    mockOctokit({ codexReview: "stale-clean-comment" }),
    repoRef,
    410,
  );

  assert.equal(audit.ready, true);
  assert.equal(audit.feedback.codexReview.cleanComment, false);
  assert.equal(audit.feedback.codexReview.settled, false);
  assert.equal(audit.feedback.substantiveComments, 0);
});

test("buildPrAudit rejects a lookalike clean Codex comment", async () => {
  const audit = await buildPrAudit(
    mockOctokit({ codexReview: "impostor-clean-comment" }),
    repoRef,
    410,
  );

  assert.equal(audit.ready, false);
  assert.equal(audit.feedback.codexReview.cleanComment, false);
  assert.equal(audit.feedback.codexReview.settled, false);
  assert.equal(audit.feedback.substantiveComments, 1);
});

test("buildPrAudit checks every duplicate exact-head Codex request for approval", async () => {
  const audit = await buildPrAudit(
    mockOctokit({ codexReview: "duplicate-reaction" }),
    repoRef,
    410,
  );

  assert.equal(audit.ready, true);
  assert.equal(audit.feedback.codexReview.approvalReaction, true);
  assert.equal(audit.feedback.codexReview.settled, true);
});

test("buildPrAudit reports a dismissed exact-head Codex review without waiting", async () => {
  const audit = await buildPrAudit(mockOctokit({ codexReview: "dismissed" }), repoRef, 410);

  assert.equal(audit.ready, true);
  assert.equal(audit.feedback.codexReview.currentHeadReview, false);
  assert.deepEqual(audit.reasons, []);
});

test("buildPrAudit blocks a lookalike Codex status review", async () => {
  const audit = await buildPrAudit(mockOctokit({ codexReview: "impostor" }), repoRef, 410);

  assert.equal(audit.ready, false);
  assert.equal(audit.feedback.codexReview.currentHeadReview, false);
  assert.equal(audit.feedback.substantiveReviews, 1);
  assert.ok(audit.reasons.some((reason) => reason.includes("substantive current-head review")));
});

test("buildPrAudit blocks actionable content in a Codex review body", async () => {
  const audit = await buildPrAudit(
    mockOctokit({ codexReview: "review-finding" }),
    repoRef,
    410,
  );

  assert.equal(audit.ready, false);
  assert.equal(audit.feedback.substantiveReviews, 1);
  assert.ok(audit.reasons.some((reason) => reason.includes("substantive current-head review")));
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
  codexReview?:
    | "clean-comment"
    | "dismissed"
    | "duplicate-reaction"
    | "impostor"
    | "impostor-clean-comment"
    | "missing"
    | "reaction"
    | "review"
    | "review-finding"
    | "stale-clean-comment";
  runStatus?: "completed" | "in_progress";
  unresolvedThreads?: number;
};

function mockOctokit(options: MockOptions = {}): Octokit {
  const headSha = "0123456789abcdef0123456789abcdef01234567";
  const pulls = {
    get: async () => ({
      data: {
        base: { ref: "main", sha: "base-sha" },
        draft: false,
        head: { ref: "feature", sha: headSha },
        html_url: "https://github.com/meta-secret/nook/pull/410",
        mergeable: true,
        number: 410,
        state: "open",
      },
    }),
    listFiles: async () => ({ data: [{ filename: "nook-app/nook-core/src/lib.rs" }] }),
    listReviews: async () => {
      if (
        options.codexReview === "missing" ||
        options.codexReview === "clean-comment" ||
        options.codexReview === "impostor-clean-comment" ||
        options.codexReview === "stale-clean-comment" ||
        options.codexReview === "reaction" ||
        options.codexReview === "duplicate-reaction"
      ) {
        return { data: [] };
      }
      return {
        data: [
          {
            body:
              options.codexReview === "review-finding"
                ? `### 💡 Codex Review\n\nHere are some automated review suggestions for this pull request.\n\n**Reviewed commit:** \`${headSha.slice(0, 10)}\`\n\nActionable finding`
                : `### 💡 Codex Review\n\nHere are some automated review suggestions for this pull request.\n\n**Reviewed commit:** \`${headSha.slice(0, 10)}\``,
            commit_id: headSha,
            state: options.codexReview === "dismissed" ? "DISMISSED" : "COMMENTED",
            user: {
              login:
                options.codexReview === "impostor"
                  ? "chatgpt-codex-connector-impostor"
                  : "chatgpt-codex-connector[bot]",
            },
          },
        ],
      };
    },
  };
  const issues = {
    listComments: async () => ({
      data: [
        { body: "### Preview deployed\n\nhttps://preview.test" },
        ...(options.codexReview === "clean-comment" ||
        options.codexReview === "impostor-clean-comment" ||
        options.codexReview === "stale-clean-comment"
          ? [
              {
                body: `Codex Review: Didn't find any major issues. What shall we delve into next?\n\n**Reviewed commit:** \`${
                  options.codexReview === "stale-clean-comment"
                    ? "fedcba9876"
                    : headSha.slice(0, 10)
                }\``,
                id: 76,
                user: {
                  login:
                    options.codexReview === "impostor-clean-comment"
                      ? "chatgpt-codex-connector-impostor"
                      : "chatgpt-codex-connector[bot]",
                },
              },
            ]
          : []),
        ...(options.codexReview === "reaction" ||
        options.codexReview === "duplicate-reaction"
          ? [
              {
                body:
                  `Please review this exact head.\n\n@codex review\n\n<!-- nook-codex-review:${headSha} -->`,
                id: 77,
              },
              ...(options.codexReview === "duplicate-reaction"
                ? [
                    {
                      body: `@codex review\n\n<!-- nook-codex-review:${headSha} -->`,
                      id: 78,
                    },
                  ]
                : []),
            ]
          : []),
        {
          body: "You have reached your Codex usage limits for code reviews. You can see your limits in the Codex usage dashboard.",
        },
        { body: "<!-- nook-core-coverage -->\n### nook-core + nook-auth2 coverage\n\nPASS" },
      ],
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
                head_sha: headSha,
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
      reactions: {
        listForIssueComment: async ({ comment_id }: { comment_id: number }) => ({
          data:
            options.codexReview === "reaction" ||
            (options.codexReview === "duplicate-reaction" && comment_id === 78)
              ? [
                  {
                    content: "+1",
                    user: { login: "chatgpt-codex-connector[bot]" },
                  },
                ]
              : [],
        }),
      },
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
