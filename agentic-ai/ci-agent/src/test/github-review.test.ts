import assert from "node:assert/strict";
import test from "node:test";

import type { Octokit } from "@octokit/rest";

import {
  ExactHeadReviewFallback,
  ExactHeadReviewProvider,
  ExactHeadReviewRevisionState,
  codexReviewRequestMarker,
  cursorReviewRequestMarker,
  requestExactHeadReview,
} from "../main/github-review.js";
import type { PullRequestRevision } from "../main/github.js";

const repoRef = { owner: "meta-secret", repo: "nook" };
const headSha = "0123456789abcdef0123456789abcdef01234567";

type MockComment = {
  author_association?: string;
  body: string;
  id: number;
  user?: { login: string };
};

type MockReview = {
  body?: string;
  commit_id: string;
  state: string;
  user: { login: string };
};

function mockOctokit(input: {
  comments?: MockComment[];
  createCalls?: { count: number };
  createdBodies?: string[];
  reactions?: Array<{ content: string; user: { login: string } }>;
  revisions?: PullRequestRevision[];
  reviews?: MockReview[];
  sha?: string;
}): Octokit {
  const comments = input.comments ?? [];
  for (const comment of comments) {
    comment.author_association ??= "OWNER";
  }
  const createdBodies = input.createdBodies ?? [];
  const reviews = input.reviews ?? [];
  const sha = input.sha ?? "head-sha";
  let revisionReads = 0;
  return {
    rest: {
      issues: {
        createComment: async ({ body }: { body: string }) => {
          if (input.createCalls) {
            input.createCalls.count += 1;
          }
          createdBodies.push(body);
          comments.push({
            author_association: "OWNER",
            body,
            id: comments.length + 1,
          });
          return { data: { id: comments.length } };
        },
        listComments: async () => ({ data: comments }),
      },
      pulls: {
        get: async () => {
          const revision = input.revisions?.[
            Math.min(revisionReads, input.revisions.length - 1)
          ];
          revisionReads += 1;
          return {
            data: {
              base: {
                ref: revision?.baseRef ?? "main",
                sha: revision?.baseSha ?? "base-sha",
              },
              head: { sha: revision?.headSha ?? sha },
            },
          };
        },
        listReviews: async () => ({ data: reviews }),
      },
      reactions: {
        listForIssueComment: async () => ({
          data: input.reactions ?? [],
        }),
      },
    },
    paginate: async (
      route: (args: unknown) => Promise<{ data: unknown[] }>,
      args: unknown,
    ) => (await route(args)).data,
  } as unknown as Octokit;
}

test("requestExactHeadReview posts one exact-head Codex marker", async () => {
  const createdBodies: string[] = [];
  const octokit = mockOctokit({ createdBodies });

  const first = await requestExactHeadReview(octokit, repoRef, 410);
  const second = await requestExactHeadReview(octokit, repoRef, 410);

  assert.deepEqual(first, {
    fallback: ExactHeadReviewFallback.None,
    headSha: "head-sha",
    provider: ExactHeadReviewProvider.Codex,
    requested: true,
    settled: false,
  });
  assert.deepEqual(second, {
    fallback: ExactHeadReviewFallback.None,
    headSha: "head-sha",
    provider: ExactHeadReviewProvider.Codex,
    requested: false,
    settled: false,
  });
  assert.deepEqual(createdBodies, [
    "@codex review\n\n<!-- nook-codex-review:head-sha:base-sha -->",
  ]);
});

test("requestExactHeadReview detects a revision change before Codex contact", async () => {
  const createCalls = { count: 0 };
  const expected: PullRequestRevision = {
    baseRef: "main",
    baseSha: "base-sha",
    headSha: "head-sha",
  };
  const octokit = mockOctokit({
    createCalls,
    revisions: [expected, { ...expected, headSha: "changed-head" }],
  });

  await assert.rejects(
    requestExactHeadReview(octokit, repoRef, 410, {
      revision: {
        revision: expected,
        state: ExactHeadReviewRevisionState.Bound,
      },
    }),
    /Pull request revision changed.*no review was requested/,
  );
  assert.equal(createCalls.count, 0);
});

test("review request identity changes with the base revision", () => {
  assert.notEqual(
    codexReviewRequestMarker(headSha, "base-one"),
    codexReviewRequestMarker(headSha, "base-two"),
  );
});

test("an old same-head review cannot settle a new base-bound request", async () => {
  const createdBodies: string[] = [];
  const octokit = mockOctokit({
    comments: [
      {
        body: `@codex review\n\n${codexReviewRequestMarker(headSha, "old-base")}`,
        id: 1,
      },
    ],
    createdBodies,
    reviews: [
      {
        commit_id: headSha,
        state: "COMMENTED",
        user: { login: "chatgpt-codex-connector[bot]" },
      },
    ],
    sha: headSha,
  });

  const result = await requestExactHeadReview(octokit, repoRef, 410);

  assert.equal(result.requested, true);
  assert.deepEqual(createdBodies, [
    `@codex review\n\n${codexReviewRequestMarker(headSha, "base-sha")}`,
  ]);
});

test("requestExactHeadReview ignores an untrusted exact-head marker", async () => {
  const createdBodies: string[] = [];
  const octokit = mockOctokit({
    comments: [
      {
        author_association: "NONE",
        body: `@codex review\n\n${codexReviewRequestMarker(headSha)}`,
        id: 1,
      },
    ],
    createdBodies,
    sha: headSha,
  });

  const result = await requestExactHeadReview(octokit, repoRef, 410);

  assert.equal(result.requested, true);
  assert.deepEqual(createdBodies, [
    `@codex review\n\n${codexReviewRequestMarker(headSha)}`,
  ]);
});

test("requestExactHeadReview keeps a workflow-token request idempotent", async () => {
  const createdBodies: string[] = [];
  const octokit = mockOctokit({
    comments: [
      {
        author_association: "CONTRIBUTOR",
        body: `@codex review\n\n${codexReviewRequestMarker(headSha)}`,
        id: 1,
        user: { login: "github-actions[bot]" },
      },
    ],
    createdBodies,
    sha: headSha,
  });

  const result = await requestExactHeadReview(octokit, repoRef, 410);

  assert.equal(result.requested, false);
  assert.deepEqual(createdBodies, []);
});

test("requestExactHeadReview reports an exact-head Codex approval reaction as settled", async () => {
  const createCalls = { count: 0 };
  const octokit = mockOctokit({
    comments: [
      {
        body: `@codex review\n\n${codexReviewRequestMarker(headSha)}`,
        id: 1,
      },
    ],
    createCalls,
    reactions: [
      { content: "+1", user: { login: "chatgpt-codex-connector[bot]" } },
    ],
    sha: headSha,
  });

  const result = await requestExactHeadReview(octokit, repoRef, 410);

  assert.deepEqual(result, {
    fallback: ExactHeadReviewFallback.None,
    headSha,
    provider: ExactHeadReviewProvider.Codex,
    requested: false,
    settled: true,
  });
  assert.equal(createCalls.count, 0);
});

test("requestExactHeadReview does not treat an eye reaction as settled", async () => {
  const createCalls = { count: 0 };
  const octokit = mockOctokit({
    comments: [
      {
        body: `@codex review\n\n${codexReviewRequestMarker(headSha)}`,
        id: 1,
      },
    ],
    createCalls,
    reactions: [
      { content: "eyes", user: { login: "chatgpt-codex-connector[bot]" } },
    ],
    sha: headSha,
  });

  const result = await requestExactHeadReview(octokit, repoRef, 410);

  assert.equal(result.requested, false);
  assert.equal(result.settled, false);
  assert.equal(createCalls.count, 0);
});

test("requestExactHeadReview does not request a fallback after a Codex usage limit", async () => {
  const createdBodies: string[] = [];
  const octokit = mockOctokit({
    comments: [
      {
        body: `@codex review\n\n${codexReviewRequestMarker(headSha)}`,
        id: 1,
      },
      {
        body: "You have reached your Codex usage limits for code reviews.",
        id: 2,
        user: { login: "chatgpt-codex-connector[bot]" },
      },
    ],
    createdBodies,
    sha: headSha,
  });

  const fallback = await requestExactHeadReview(octokit, repoRef, 410);
  const idempotent = await requestExactHeadReview(octokit, repoRef, 410);

  assert.deepEqual(fallback, {
    fallback: ExactHeadReviewFallback.CodexUsageLimit,
    headSha,
    provider: ExactHeadReviewProvider.Codex,
    requested: false,
    settled: false,
  });
  assert.deepEqual(idempotent, {
    fallback: ExactHeadReviewFallback.CodexUsageLimit,
    headSha,
    provider: ExactHeadReviewProvider.Codex,
    requested: false,
    settled: false,
  });
  assert.deepEqual(createdBodies, []);
});

test("requestExactHeadReview recognizes a clean Codex comment for the exact head", async () => {
  const createCalls = { count: 0 };
  const octokit = mockOctokit({
    comments: [
      {
        body: `@codex review\n\n${codexReviewRequestMarker(headSha)}`,
        id: 1,
      },
      {
        body: `Codex Review: Didn't find any major issues. What shall we delve into next?\n\n**Reviewed commit:** \`${headSha.slice(0, 10)}\``,
        id: 2,
        user: { login: "chatgpt-codex-connector[bot]" },
      },
    ],
    createCalls,
    sha: headSha,
  });

  const result = await requestExactHeadReview(octokit, repoRef, 410);

  assert.deepEqual(result, {
    fallback: ExactHeadReviewFallback.None,
    headSha,
    provider: ExactHeadReviewProvider.Codex,
    requested: false,
    settled: true,
  });
  assert.equal(createCalls.count, 0);
});

test("requestExactHeadReview keeps a Codex usage limit non-blocking", async () => {
  const createdBodies: string[] = [];
  const comments: MockComment[] = [];
  const octokit = mockOctokit({ comments, createdBodies, sha: headSha });
  const clock = {
    async waitMs(): Promise<void> {
      comments.push({
        body: "You have reached your Codex usage limits for code reviews.",
        id: comments.length + 1,
        user: { login: "chatgpt-codex-connector[bot]" },
      });
    },
  };

  const result = await requestExactHeadReview(octokit, repoRef, 410, {
    availability: {
      clock,
      probe: { intervalMs: 1, timeoutMs: 20 },
    },
  });

  assert.deepEqual(result, {
    fallback: ExactHeadReviewFallback.CodexUsageLimit,
    headSha,
    provider: ExactHeadReviewProvider.Codex,
    requested: true,
    settled: false,
  });
  assert.deepEqual(createdBodies, [
    `@codex review\n\n${codexReviewRequestMarker(headSha)}`,
  ]);
});

test("requestExactHeadReview still prefers Codex on a new head after an older usage-limit comment", async () => {
  const createdBodies: string[] = [];
  const octokit = mockOctokit({
    comments: [
      {
        body: `@codex review\n\n${codexReviewRequestMarker("old-head-sha")}`,
        id: 1,
      },
      {
        body: "You have reached your Codex usage limits for code reviews.",
        id: 2,
        user: { login: "chatgpt-codex-connector[bot]" },
      },
    ],
    createdBodies,
    sha: headSha,
  });

  const result = await requestExactHeadReview(octokit, repoRef, 410);

  assert.deepEqual(result, {
    fallback: ExactHeadReviewFallback.None,
    headSha,
    provider: ExactHeadReviewProvider.Codex,
    requested: true,
    settled: false,
  });
  assert.deepEqual(createdBodies, [
    `@codex review\n\n${codexReviewRequestMarker(headSha)}`,
  ]);
});

test("requestExactHeadReview does not request Cursor while Codex is pending", async () => {
  const createdBodies: string[] = [];
  const octokit = mockOctokit({
    comments: [
      {
        body: `@codex review\n\n${codexReviewRequestMarker(headSha)}`,
        id: 1,
      },
    ],
    createdBodies,
    sha: headSha,
  });

  const result = await requestExactHeadReview(octokit, repoRef, 410);

  assert.deepEqual(result, {
    fallback: ExactHeadReviewFallback.None,
    headSha,
    provider: ExactHeadReviewProvider.Codex,
    requested: false,
    settled: false,
  });
  assert.deepEqual(createdBodies, []);
});

test("requestExactHeadReview ignores an inactive Cursor review fallback", async () => {
  const createCalls = { count: 0 };
  const octokit = mockOctokit({
    comments: [
      {
        body: `@codex review\n\n${codexReviewRequestMarker(headSha)}`,
        id: 1,
      },
      {
        body: "You have reached your Codex usage limits for code reviews.",
        id: 2,
        user: { login: "chatgpt-codex-connector[bot]" },
      },
      {
        body: `cursor review\n\n${cursorReviewRequestMarker(headSha)}`,
        id: 3,
      },
    ],
    createCalls,
    reviews: [
      {
        body: "Found a bug in the fallback path.",
        commit_id: headSha,
        state: "COMMENTED",
        user: { login: "cursor[bot]" },
      },
    ],
    sha: headSha,
  });

  const result = await requestExactHeadReview(octokit, repoRef, 410);

  assert.deepEqual(result, {
    fallback: ExactHeadReviewFallback.CodexUsageLimit,
    headSha,
    provider: ExactHeadReviewProvider.Codex,
    requested: false,
    settled: false,
  });
  assert.equal(createCalls.count, 0);
});
