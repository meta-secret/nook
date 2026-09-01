import assert from "node:assert/strict";
import test from "node:test";

import type { Octokit } from "@octokit/rest";

import { PullRequestPathInventoryState, type RepoRef } from "../main/github.js";
import { buildPrAudit, WorkflowAuditState } from "../main/pr-audit.js";

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

test("buildPrAudit requires successful policy evidence for Cortex-only PRs", async () => {
  const successful = await buildPrAudit(
    mockOctokit({ cortexOnly: true }),
    repoRef,
    410,
  );
  assert.equal(successful.ready, true);
  assert.deepEqual(
    successful.requiredWorkflows.map((workflow) => workflow.workflowName),
    ["Repository policy"],
  );

  for (const options of [
    { cortexOnly: true, runStatus: MockRunStatus.InProgress },
    { cortexOnly: true, workflowConclusion: MockJobConclusion.Failure },
  ]) {
    const audit = await buildPrAudit(mockOctokit(options), repoRef, 410);
    assert.equal(audit.ready, false);
    assert.match(audit.reasons.join("\n"), /Repository policy run/u);
  }
});

test("buildPrAudit replaces old-base policy evidence and ignores metadata edits", async () => {
  const stale = await buildPrAudit(
    mockOctokit({ cortexOnly: true, staleBaseRun: true }),
    repoRef,
    410,
  );
  assert.equal(stale.ready, false);
  const replacement = await buildPrAudit(
    mockOctokit({ cortexOnly: true, metadataPolicyRun: true }),
    repoRef,
    410,
  );
  assert.equal(replacement.ready, true);
  const policy = replacement.requiredWorkflows[0];
  assert.equal(policy?.state, WorkflowAuditState.Indexed);
  if (policy?.state === WorkflowAuditState.Indexed)
    assert.equal(policy.runId, 42);
});

test("buildPrAudit paginates past metadata-only policy runs", async () => {
  const audit = await buildPrAudit(
    mockOctokit({ cortexOnly: true, metadataPolicyRunCount: 21 }),
    repoRef,
    410,
  );
  assert.equal(audit.ready, true);
  const policy = audit.requiredWorkflows[0];
  assert.equal(policy?.state, WorkflowAuditState.Indexed);
  if (policy?.state === WorkflowAuditState.Indexed)
    assert.equal(policy.runId, 42);
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

test("buildPrAudit keeps old actionable comments in scope", async () => {
  const audit = await buildPrAudit(
    mockOctokit({
      codexReview: MockCodexReview.Missing,
      historicalFinding: true,
    }),
    repoRef,
    410,
  );

  assert.equal(audit.ready, false);
  assert.equal(audit.feedback.substantiveComments, 1);
  assert.equal(audit.feedback.unhandledComments, 1);
});

test("buildPrAudit deletes retired automation comments", async () => {
  const deletedCommentIds: number[] = [];
  const audit = await buildPrAudit(
    mockOctokit({ deletedCommentIds, legacyAutomationComment: true }),
    repoRef,
    410,
  );

  assert.equal(audit.ready, true);
  assert.deepEqual(deletedCommentIds, [82]);
  assert.equal(audit.feedback.substantiveComments, 0);
});

test("buildPrAudit deletes retired automation but blocks genuine comments", async () => {
  const deletedCommentIds: number[] = [];
  const audit = await buildPrAudit(
    mockOctokit({
      deletedCommentIds,
      historicalFinding: true,
      legacyAutomationComment: true,
    }),
    repoRef,
    410,
  );

  assert.equal(audit.ready, false);
  assert.deepEqual(deletedCommentIds, [82]);
  assert.equal(audit.feedback.substantiveComments, 1);
  assert.equal(audit.feedback.unhandledComments, 1);
});

test("buildPrAudit fails when retired automation cannot be deleted", async () => {
  await assert.rejects(
    buildPrAudit(
      mockOctokit({
        legacyAutomationComment: true,
        legacyAutomationDeletionFails: true,
      }),
      repoRef,
      410,
    ),
    /legacy automation deletion failed/,
  );
});

test("buildPrAudit keeps resolved old comments visible without blocking", async () => {
  const audit = await buildPrAudit(
    mockOctokit({
      codexReview: MockCodexReview.Missing,
      handledHistoricalFinding: true,
      historicalFinding: true,
    }),
    repoRef,
    410,
  );

  assert.equal(audit.ready, true);
  assert.equal(audit.feedback.substantiveComments, 1);
  assert.equal(audit.feedback.unhandledComments, 0);
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
  const audit = await buildPrAudit(mockOctokitWithAgentHandoff(), repoRef, 410);

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
  assert.equal(audit.feedback.unthreadedReviewFindings, 1);
  assert.ok(
    audit.reasons.some((reason) =>
      reason.includes("unthreaded submitted review finding"),
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
  assert.equal(audit.feedback.unthreadedReviewFindings, 1);
  assert.ok(
    audit.reasons.some((reason) =>
      reason.includes("unthreaded submitted review finding"),
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

test("buildPrAudit keeps handled submitted reviews visible without blocking", async () => {
  const audit = await buildPrAudit(
    mockOctokit({
      codexReview: MockCodexReview.ReviewFinding,
      resolvedInlineReviewFinding: true,
    }),
    repoRef,
    410,
  );

  assert.equal(audit.ready, true);
  assert.equal(audit.feedback.substantiveReviews, 1);
  assert.equal(audit.feedback.unthreadedReviewFindings, 0);
  assert.equal(audit.feedback.unresolvedThreads, 0);
});

test("buildPrAudit still blocks an unresolved thread from an old review", async () => {
  const audit = await buildPrAudit(
    mockOctokit({
      codexReview: MockCodexReview.ReviewFinding,
      resolvedInlineReviewFinding: true,
      unresolvedThreads: 1,
    }),
    repoRef,
    410,
  );

  assert.equal(audit.ready, false);
  assert.equal(audit.feedback.substantiveReviews, 1);
  assert.equal(audit.feedback.unthreadedReviewFindings, 0);
  assert.equal(audit.feedback.unresolvedThreads, 1);
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

test("buildPrAudit counts unresolved threads from dismissed reviews", async () => {
  const audit = await buildPrAudit(
    mockOctokit({ dismissedThreads: 1 }),
    repoRef,
    410,
  );

  assert.equal(audit.ready, false);
  assert.equal(audit.feedback.unresolvedThreads, 1);
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

test("buildPrAudit rejects validation from a previous base revision", async () => {
  const audit = await buildPrAudit(
    mockOctokit({ staleBaseRun: true }),
    repoRef,
    410,
  );

  assert.equal(audit.ready, false);
  assert.match(audit.reasons.join("\n"), /not indexed for the current head/);
});

test("buildPrAudit rejects a same-count synchronize during file inventory", async () => {
  await assert.rejects(
    buildPrAudit(mockOctokit({ sameCountSynchronize: true }), repoRef, 410),
    /Pull request revision changed/u,
  );
});

test("buildPrAudit rejects a synchronize after all audit evidence settles", async () => {
  await assert.rejects(
    buildPrAudit(mockOctokit({ lateSynchronize: true }), repoRef, 410),
    /Pull request revision changed/u,
  );
});

test("buildPrAudit conservatively audits every workflow for a capped inventory", async () => {
  const audit = await buildPrAudit(
    mockOctokit({
      cappedFileInventory: true,
      omitSecondaryWorkflowRuns: true,
    }),
    repoRef,
    410,
  );

  assert.equal(
    audit.changedFileInventory.state,
    PullRequestPathInventoryState.Uninspectable,
  );
  assert.deepEqual(
    audit.requiredWorkflows.map((workflow) => workflow.workflowName),
    ["Repository policy", "Web research", "Rust ecosystem checks", "PR"],
  );
  assert.equal(audit.ready, false);
  assert.ok(
    audit.reasons.includes(
      "Repository policy run is not indexed for the current head",
    ),
  );
  assert.ok(
    audit.reasons.includes(
      "Web research run is not indexed for the current head",
    ),
  );
  assert.ok(
    audit.reasons.includes(
      "Rust ecosystem checks run is not indexed for the current head",
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
  Skipped = "skipped",
  Success = "success",
}

enum MockAgentHandoff {
  Excluded = "excluded",
  Included = "included",
}

type MockOptions = {
  agentHandoff: MockAgentHandoff;
  behindBy?: number;
  cappedFileInventory?: boolean;
  codexReview?: MockCodexReview;
  cortexOnly?: boolean;
  currentHeadFinding?: boolean;
  cursorReview?: MockCursorReview;
  deletedCommentIds?: number[];
  dismissedThreads?: number;
  handledHistoricalFinding?: boolean;
  historicalFinding?: boolean;
  legacyAutomationComment?: boolean;
  legacyAutomationDeletionFails?: boolean;
  metadataPolicyRun?: boolean;
  metadataPolicyRunCount?: number;
  lateSynchronize?: boolean;
  headRepository?: RepoRef;
  nativeConclusion?: MockJobConclusion;
  omitNativeJob?: boolean;
  omitSecondaryWorkflowRuns?: boolean;
  runStatus?: MockRunStatus;
  resolvedInlineReviewFinding?: boolean;
  sameCountSynchronize?: boolean;
  staleBaseRun?: boolean;
  unresolvedThreads?: number;
  workflowConclusion?: MockJobConclusion;
};

type MockOverrides = Omit<MockOptions, "agentHandoff">;

function mockOctokit(overrides: MockOverrides = {}): Octokit {
  return createMockOctokit({
    ...overrides,
    agentHandoff: MockAgentHandoff.Excluded,
  });
}

function mockOctokitWithAgentHandoff(overrides: MockOverrides = {}): Octokit {
  return createMockOctokit({
    ...overrides,
    agentHandoff: MockAgentHandoff.Included,
  });
}

function createMockOctokit(options: MockOptions): Octokit {
  const headSha = "0123456789abcdef0123456789abcdef01234567";
  const nextHeadSha = "123456789abcdef0123456789abcdef012345678";
  const priorHeadSha = "89abcdef0123456789abcdef0123456789abcdef";
  const headRepository = options.headRepository ?? repoRef;
  let pullGetCalls = 0;
  const pulls = {
    get: async () => {
      pullGetCalls += 1;
      return {
        data: {
          base: { ref: "main", sha: "base-sha" },
          draft: false,
          head: {
            ref: "feature",
            repo: {
              name: headRepository.repo,
              owner: { login: headRepository.owner },
            },
            sha:
              options.sameCountSynchronize === true && pullGetCalls === 1
                ? priorHeadSha
                : options.lateSynchronize === true && pullGetCalls >= 3
                  ? nextHeadSha
                  : headSha,
          },
          html_url: "https://github.com/meta-secret/nook/pull/410",
          changed_files: options.cappedFileInventory === true ? 3000 : 1,
          created_at: "2026-08-08T00:00:00Z",
          mergeable: true,
          number: 410,
          state: "open",
        },
      };
    },
    listFiles: async () => ({
      data:
        options.cappedFileInventory === true
          ? Array.from({ length: 3000 }, (_, index) => ({
              filename: `.cortex/generated/${index}.md`,
              status: "modified",
            }))
          : [
              {
                filename:
                  options.cortexOnly === true ||
                  options.sameCountSynchronize === true
                    ? ".cortex/AGENTS.md"
                    : "nook-app/nook-platform/nook-core/src/lib.rs",
                status: "modified",
              },
            ],
    }),
    listReviewComments: async () => ({
      data:
        options.resolvedInlineReviewFinding === true
          ? [
              {
                pull_request_review_id: 90,
                user: { login: "chatgpt-codex-connector[bot]" },
              },
            ]
          : [],
    }),
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
        id: number;
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
              id: 90,
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
          id: 91,
          state: "COMMENTED",
          user: { login: "cursor[bot]" },
        });
      } else if (options.cursorReview === MockCursorReview.Stale) {
        reviews.push({
          body: "<details>\n<summary>Stale comment</summary>\n\n<blockquote>\n\n\n\n</blockquote>\n\n</details>",
          commit_id: headSha,
          id: 92,
          state: "COMMENTED",
          user: { login: "cursor[bot]" },
        });
      }
      return { data: reviews };
    },
  };
  const issues = {
    deleteComment: async ({ comment_id }: { comment_id: number }) => {
      if (options.legacyAutomationDeletionFails === true) {
        throw new Error("legacy automation deletion failed");
      }
      options.deletedCommentIds?.push(comment_id);
      return { data: {} };
    },
    listComments: async () => ({
      data: [
        {
          body: "### Preview deployed\n\nhttps://preview.test",
          user: { login: "github-actions[bot]" },
        },
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
                body: `@codex review\n\n<!-- nook-codex-review:${headSha}:base-sha -->`,
                created_at: "2026-08-08T00:00:00Z",
                id: 77,
              },
              ...(options.codexReview === MockCodexReview.DuplicateReaction
                ? [
                    {
                      author_association: "OWNER",
                      body: `@codex review\n\n<!-- nook-codex-review:${headSha}:base-sha -->`,
                      created_at: "2026-08-08T00:00:30Z",
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
          user: { login: "github-actions[bot]" },
        },
        ...(options.legacyAutomationComment === true
          ? [
              {
                body: `<!-- nook-head-transition:${headSha}:main:2026-09-01T08:24:05Z -->\nExact-head delivery boundary (automated).`,
                id: 82,
                user: { login: "github-actions[bot]" },
              },
            ]
          : []),
        ...(options.historicalFinding === true
          ? [
              {
                author_association: "MEMBER",
                body: "The older head drops the replacement-state guard.",
                created_at: "2026-08-08T00:00:30Z",
                id: 81,
                user: { login: "reviewer" },
              },
            ]
          : []),
        ...(options.currentHeadFinding === true
          ? [
              {
                body: "The current head drops the replacement-state guard.",
                created_at: "2026-08-08T00:01:30Z",
                user: { login: "reviewer" },
              },
            ]
          : []),
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
        listJobsForWorkflowRun: async ({ run_id }: { run_id: number }) => ({
          data: [
            "Enforce repository policy",
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
                run_id >= 43 && name === "Enforce repository policy"
                  ? MockJobConclusion.Skipped
                  : name === "Native Rust verification"
                    ? (options.nativeConclusion ?? MockJobConclusion.Success)
                    : MockJobConclusion.Success,
              name,
              status: MockRunStatus.Completed,
            })),
        }),
        listWorkflowRuns: async ({ workflow_id }: { workflow_id: string }) => ({
          data: {
            workflow_runs:
              options.omitSecondaryWorkflowRuns === true &&
              workflow_id !== "pr.yml"
                ? []
                : [
                    ...(workflow_id === "repository-policy.yml"
                      ? Array.from(
                          {
                            length:
                              options.metadataPolicyRunCount ??
                              (options.metadataPolicyRun === true ? 1 : 0),
                          },
                          (_, index) => ({
                            conclusion: MockJobConclusion.Success,
                            created_at: `2026-08-09T00:${String(index).padStart(2, "0")}:00Z`,
                            head_sha: headSha,
                            html_url: `https://github.com/meta-secret/nook/actions/runs/${43 + index}`,
                            id: 43 + index,
                            pull_requests: [
                              { base: { sha: "base-sha" }, number: 410 },
                            ],
                            status: MockRunStatus.Completed,
                          }),
                        )
                      : []),
                    {
                      ...(options.runStatus === MockRunStatus.InProgress
                        ? {}
                        : {
                            conclusion:
                              options.workflowConclusion ??
                              MockJobConclusion.Success,
                          }),
                      created_at: "2026-08-08T00:00:00Z",
                      head_sha: headSha,
                      html_url:
                        "https://github.com/meta-secret/nook/actions/runs/42",
                      id: 42,
                      pull_requests: [
                        {
                          base: {
                            sha:
                              options.staleBaseRun === true
                                ? "previous-base-sha"
                                : "base-sha",
                          },
                          number: 410,
                        },
                      ],
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
    ) => {
      const response = (await route(args)).data;
      return Array.isArray(response)
        ? response
        : (response as { workflow_runs: unknown[] }).workflow_runs;
    },
    graphql: async () => ({
      repository: {
        pullRequest: {
          comments: {
            nodes:
              options.handledHistoricalFinding === true
                ? [
                    {
                      databaseId: 81,
                      isMinimized: true,
                      minimizedReason: "resolved",
                    },
                  ]
                : [],
            pageInfo: { hasNextPage: false },
          },
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
