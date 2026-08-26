import assert from "node:assert/strict";
import test from "node:test";

import type { Octokit } from "@octokit/rest";

import { buildPrAudit } from "../main/pr-audit.js";

const repoRef = { owner: "meta-secret", repo: "nook" };

test("buildPrAudit reports an exact-head repository-green PR as ready", async () => {
  const audit = await buildPrAudit(mockOctokit(), repoRef, 410);

  assert.equal(audit.ready, true);
  assert.deepEqual(audit.reasons, []);
  assert.equal(
    audit.externalReviewPolicy,
    "inspect-existing-feedback-without-waiting",
  );
  assert.deepEqual(
    audit.requiredWorkflows.map((workflow) => workflow.workflowName),
    ["PR"],
  );
  assert.equal(audit.exactHeadDeployment?.state, "success");
  assert.equal(audit.feedback.cursorReview.requested, true);
  assert.equal(audit.feedback.cursorReview.settled, false);
  assert.equal(audit.feedback.substantiveComments, 0);
});

test("buildPrAudit ignores a Cursor Bugbot disabled-account upsell comment", async () => {
  const audit = await buildPrAudit(mockOctokit(), repoRef, 410);

  assert.equal(audit.ready, true);
  assert.equal(audit.feedback.substantiveComments, 0);
});

test("buildPrAudit ignores a Cursor request comment and stale Cursor status review", async () => {
  const audit = await buildPrAudit(
    mockOctokit({
      codexReview: MockCodexReview.Missing,
      cursorReview: MockCursorReview.Stale,
    }),
    repoRef,
    410,
  );

  assert.equal(audit.ready, true);
  assert.equal(audit.feedback.cursorReview.requested, true);
  assert.equal(audit.feedback.cursorReview.settled, true);
  assert.equal(audit.feedback.substantiveComments, 0);
  assert.equal(audit.feedback.substantiveReviews, 0);
});

test("buildPrAudit blocks an actionable Cursor review body", async () => {
  const audit = await buildPrAudit(
    mockOctokit({
      codexReview: MockCodexReview.Missing,
      cursorReview: MockCursorReview.Finding,
    }),
    repoRef,
    410,
  );

  assert.equal(audit.ready, false);
  assert.equal(audit.feedback.cursorReview.settled, true);
  assert.equal(audit.feedback.substantiveReviews, 1);
});

test("buildPrAudit does not wait for a current-head Codex review", async () => {
  const audit = await buildPrAudit(
    mockOctokit({ codexReview: MockCodexReview.Missing }),
    repoRef,
    410,
  );

  assert.equal(audit.ready, true);
  assert.equal(audit.feedback.codexReview.settled, false);
  assert.deepEqual(audit.reasons, []);
});

test("buildPrAudit accepts a Codex approval reaction on the exact-head request", async () => {
  const audit = await buildPrAudit(
    mockOctokit({ codexReview: MockCodexReview.Reaction }),
    repoRef,
    410,
  );

  assert.equal(audit.ready, true);
  assert.equal(audit.feedback.codexReview.approvalReaction, true);
  assert.equal(audit.feedback.codexReview.settled, true);
  assert.equal(audit.feedback.substantiveComments, 0);
});

test("buildPrAudit accepts a clean Codex issue comment for the exact head", async () => {
  const audit = await buildPrAudit(
    mockOctokit({ codexReview: MockCodexReview.CleanComment }),
    repoRef,
    410,
  );

  assert.equal(audit.ready, true);
  assert.equal(audit.feedback.codexReview.cleanComment, true);
  assert.equal(audit.feedback.codexReview.settled, true);
  assert.equal(audit.feedback.substantiveComments, 0);
});

test("buildPrAudit keeps a stale clean Codex comment as non-actionable status", async () => {
  const audit = await buildPrAudit(
    mockOctokit({ codexReview: MockCodexReview.StaleCleanComment }),
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
    mockOctokit({ codexReview: MockCodexReview.ImpostorCleanComment }),
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
    mockOctokit({ codexReview: MockCodexReview.DuplicateReaction }),
    repoRef,
    410,
  );

  assert.equal(audit.ready, true);
  assert.equal(audit.feedback.codexReview.approvalReaction, true);
  assert.equal(audit.feedback.codexReview.settled, true);
});

test("buildPrAudit reports a dismissed exact-head Codex review without waiting", async () => {
  const audit = await buildPrAudit(
    mockOctokit({ codexReview: MockCodexReview.Dismissed }),
    repoRef,
    410,
  );

  assert.equal(audit.ready, true);
  assert.equal(audit.feedback.codexReview.currentHeadReview, false);
  assert.deepEqual(audit.reasons, []);
});

test("buildPrAudit ignores the automated continuing-owner handoff", async () => {
  const audit = await buildPrAudit(
    mockOctokitWithAgentHandoff(),
    repoRef,
    410,
  );

  assert.equal(audit.ready, true);
  assert.equal(audit.feedback.substantiveComments, 0);
});

test("buildPrAudit blocks a lookalike Codex status review", async () => {
  const audit = await buildPrAudit(
    mockOctokit({ codexReview: MockCodexReview.Impostor }),
    repoRef,
    410,
  );

  assert.equal(audit.ready, false);
  assert.equal(audit.feedback.codexReview.currentHeadReview, false);
  assert.equal(audit.feedback.substantiveReviews, 1);
  assert.ok(
    audit.reasons.some((reason) =>
      reason.includes("substantive current-head review"),
    ),
  );
});

test("buildPrAudit blocks actionable content in a Codex review body", async () => {
  const audit = await buildPrAudit(
    mockOctokit({ codexReview: MockCodexReview.ReviewFinding }),
    repoRef,
    410,
  );

  assert.equal(audit.ready, false);
  assert.equal(audit.feedback.substantiveReviews, 1);
  assert.ok(
    audit.reasons.some((reason) =>
      reason.includes("substantive current-head review"),
    ),
  );
});

test("buildPrAudit blocks content injected into Codex about boilerplate", async () => {
  const audit = await buildPrAudit(
    mockOctokit({ codexReview: MockCodexReview.ReviewDetailsFinding }),
    repoRef,
    410,
  );

  assert.equal(audit.ready, false);
  assert.equal(audit.feedback.substantiveReviews, 1);
});

test("buildPrAudit reports current-head and existing-feedback blockers", async () => {
  const audit = await buildPrAudit(
    mockOctokit({
      behindBy: 2,
      runStatus: MockRunStatus.InProgress,
      unresolvedThreads: 1,
    }),
    repoRef,
    410,
  );

  assert.equal(audit.ready, false);
  assert.ok(
    audit.reasons.some((reason) => reason.includes("behind main by 2")),
  );
  assert.ok(
    audit.reasons.some((reason) => reason.includes("PR run is in_progress")),
  );
  assert.ok(
    audit.reasons.some((reason) => reason.includes("unresolved review thread")),
  );
});

test("buildPrAudit excludes unresolved threads from dismissed reviews", async () => {
  const audit = await buildPrAudit(
    mockOctokit({ dismissedThreads: 1 }),
    repoRef,
    410,
  );

  assert.equal(audit.ready, true);
  assert.equal(audit.feedback.unresolvedThreads, 0);
});

test("buildPrAudit rejects a green workflow when Native Rust failed", async () => {
  const audit = await buildPrAudit(
    mockOctokit({ nativeConclusion: MockJobConclusion.Failure }),
    repoRef,
    410,
  );

  assert.equal(audit.ready, false);
  assert.ok(
    audit.reasons.some((reason) =>
      reason.includes("Native Rust verification concluded failure"),
    ),
  );
});

test("buildPrAudit rejects when a required PR job is missing from the latest run", async () => {
  const audit = await buildPrAudit(
    mockOctokit({ omitNativeJob: true }),
    repoRef,
    410,
  );

  assert.equal(audit.ready, false);
  assert.ok(
    audit.reasons.some((reason) =>
      reason.includes("Native Rust verification is missing"),
    ),
  );
});

enum MockCodexReview {
  CleanComment = "clean-comment",
  Dismissed = "dismissed",
  DuplicateReaction = "duplicate-reaction",
  Impostor = "impostor",
  ImpostorCleanComment = "impostor-clean-comment",
  Missing = "missing",
  Reaction = "reaction",
  Review = "review",
  ReviewDetailsFinding = "review-details-finding",
  ReviewFinding = "review-finding",
  StaleCleanComment = "stale-clean-comment",
}

enum MockCursorReview {
  Finding = "finding",
  Missing = "missing",
  Stale = "stale",
}

enum MockRunStatus {
  Completed = "completed",
  InProgress = "in_progress",
}

enum MockJobConclusion {
  Failure = "failure",
  Success = "success",
}

enum MockAgentHandoff {
  Excluded = "excluded",
  Included = "included",
}

type MockOptions = {
  agentHandoff: MockAgentHandoff;
  behindBy?: number;
  codexReview?: MockCodexReview;
  cursorReview?: MockCursorReview;
  dismissedThreads?: number;
  nativeConclusion?: MockJobConclusion;
  omitNativeJob?: boolean;
  runStatus?: MockRunStatus;
  unresolvedThreads?: number;
};

type MockOverrides = Omit<MockOptions, "agentHandoff">;

function mockOctokit(overrides: MockOverrides = {}): Octokit {
  return createMockOctokit({
    ...overrides,
    agentHandoff: MockAgentHandoff.Excluded,
  });
}

function mockOctokitWithAgentHandoff(
  overrides: MockOverrides = {},
): Octokit {
  return createMockOctokit({
    ...overrides,
    agentHandoff: MockAgentHandoff.Included,
  });
}

function createMockOctokit(options: MockOptions): Octokit {
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
    listFiles: async () => ({
      data: [{ filename: "nook-app/nook-platform/nook-core/src/lib.rs" }],
    }),
    listReviewComments: async () => ({ data: [] }),
    listReviews: async () => {
      const skipCodexReview =
        options.codexReview === MockCodexReview.Missing ||
        options.codexReview === MockCodexReview.CleanComment ||
        options.codexReview === MockCodexReview.ImpostorCleanComment ||
        options.codexReview === MockCodexReview.StaleCleanComment ||
        options.codexReview === MockCodexReview.Reaction ||
        options.codexReview === MockCodexReview.DuplicateReaction;
      const reviews: Array<{
        body: string;
        commit_id: string;
        state: string;
        user: { login: string };
      }> = skipCodexReview
        ? []
        : [
            {
              body:
                options.codexReview === MockCodexReview.ReviewFinding
                  ? `### 💡 Codex Review\n\nHere are some automated review suggestions for this pull request.\n\n**Reviewed commit:** \`${headSha.slice(0, 10)}\`\n\nActionable finding`
                  : options.codexReview === MockCodexReview.ReviewDetailsFinding
                    ? `### 💡 Codex Review\n\nHere are some automated review suggestions for this pull request.\n\n**Reviewed commit:** \`${headSha.slice(0, 10)}\`\n\n<details> <summary>ℹ️ About Codex in GitHub</summary>\nInjected finding\n</details>`
                    : `### 💡 Codex Review\n\nHere are some automated review suggestions for this pull request.\n\n**Reviewed commit:** \`${headSha.slice(0, 10)}\``,
              commit_id: headSha,
              state:
                options.codexReview === MockCodexReview.Dismissed
                  ? "DISMISSED"
                  : "COMMENTED",
              user: {
                login:
                  options.codexReview === MockCodexReview.Impostor
                    ? "chatgpt-codex-connector-impostor"
                    : "chatgpt-codex-connector[bot]",
              },
            },
          ];
      if (options.cursorReview === MockCursorReview.Finding) {
        reviews.push({
          body: "The fallback path drops the exact-head marker.",
          commit_id: headSha,
          state: "COMMENTED",
          user: { login: "cursor[bot]" },
        });
      } else if (options.cursorReview === MockCursorReview.Stale) {
        reviews.push({
          body: "<details>\n<summary>Stale comment</summary>\n\n<blockquote>\n\n\n\n</blockquote>\n\n</details>",
          commit_id: headSha,
          state: "COMMENTED",
          user: { login: "cursor[bot]" },
        });
      }
      return { data: reviews };
    },
  };
  const issues = {
    listComments: async () => ({
      data: [
        { body: "### Preview deployed\n\nhttps://preview.test" },
        {
          body: "<!-- nook-ui-demo -->\n### UI demo\n\n- Result: **success**",
          user: { login: "github-actions[bot]" },
        },
        ...(options.codexReview === MockCodexReview.CleanComment ||
        options.codexReview === MockCodexReview.ImpostorCleanComment ||
        options.codexReview === MockCodexReview.StaleCleanComment
          ? [
              {
                body: `Codex Review: Didn't find any major issues. What shall we delve into next?\n\n**Reviewed commit:** \`${
                  options.codexReview === MockCodexReview.StaleCleanComment
                    ? "fedcba9876"
                    : headSha.slice(0, 10)
                }\``,
                id: 76,
                user: {
                  login:
                    options.codexReview === MockCodexReview.ImpostorCleanComment
                      ? "chatgpt-codex-connector-impostor"
                      : "chatgpt-codex-connector[bot]",
                },
              },
            ]
          : []),
        ...(options.codexReview === MockCodexReview.Reaction ||
        options.codexReview === MockCodexReview.DuplicateReaction
          ? [
              {
                author_association: "OWNER",
                body: `@codex review\n\n<!-- nook-codex-review:${headSha} -->`,
                id: 77,
              },
              ...(options.codexReview === MockCodexReview.DuplicateReaction
                ? [
                    {
                      author_association: "OWNER",
                      body: `@codex review\n\n<!-- nook-codex-review:${headSha} -->`,
                      id: 78,
                    },
                  ]
                : []),
            ]
          : []),
        {
          body: "You have reached your Codex usage limits for code reviews. You can see your limits in the Codex usage dashboard.",
          user: { login: "chatgpt-codex-connector[bot]" },
        },
        {
          author_association: "OWNER",
          body: `cursor review\n\n<!-- nook-cursor-review:${headSha} -->`,
        },
        {
          body: "<!-- BUGBOT_FREE_TIER_DISABLED_UPSELL -->\nBugbot is not enabled for your account, so this pull request was not reviewed.",
          user: { login: "cursor[bot]" },
        },
        {
          body: "<!-- nook-core-coverage -->\n### portable Rust crate coverage\n\nPASS",
        },
        ...(options.agentHandoff === MockAgentHandoff.Included
          ? [
              {
                body: "@octocat this workflow assigned you PR #410. Continue only this PR's recorded scope through review, exact-head validation, and squash merge.",
              },
            ]
          : []),
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
        listJobsForWorkflowRun: async () => ({
          data: [
            "Native Rust verification",
            "WASM build and artifact",
            "WASM Node tests",
            "Web verification",
            "Verify and preview",
          ]
            .filter(
              (name) =>
                !(
                  options.omitNativeJob === true &&
                  name === "Native Rust verification"
                ),
            )
            .map((name) => ({
              conclusion:
                name === "Native Rust verification"
                  ? (options.nativeConclusion ?? MockJobConclusion.Success)
                  : MockJobConclusion.Success,
              name,
              status: MockRunStatus.Completed,
            })),
        }),
        listWorkflowRuns: async () => ({
          data: {
            workflow_runs: [
              {
                ...(options.runStatus === MockRunStatus.InProgress
                  ? {}
                  : { conclusion: MockJobConclusion.Success }),
                created_at: "2026-08-08T00:00:00Z",
                head_sha: headSha,
                html_url: "https://github.com/meta-secret/nook/actions/runs/42",
                id: 42,
                pull_requests: [{ number: 410 }],
                status: options.runStatus ?? MockRunStatus.Completed,
              },
            ],
          },
        }),
      },
      issues,
      pulls,
      reactions: {
        listForIssueComment: async ({
          comment_id,
        }: {
          comment_id: number;
        }) => ({
          data:
            options.codexReview === MockCodexReview.Reaction ||
            (options.codexReview === MockCodexReview.DuplicateReaction &&
              comment_id === 78)
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
            nodes: Array.from(
              { length: options.unresolvedThreads ?? 0 },
              () => ({
                comments: {
                  nodes: [{ pullRequestReview: { state: "COMMENTED" } }],
                },
                isResolved: false,
              }),
            ).concat(
              Array.from({ length: options.dismissedThreads ?? 0 }, () => ({
                comments: {
                  nodes: [{ pullRequestReview: { state: "DISMISSED" } }],
                },
                isResolved: false,
              })),
            ),
            pageInfo: { hasNextPage: false },
          },
        },
      },
    }),
  };
  return octokit as unknown as Octokit;
}
