import { CiResultAssertions } from "./result-assertions.js";
import assert from "node:assert/strict";
import test from "node:test";

import { Octokit } from "@octokit/rest";

import {
  ExactHeadReviewFallback,
  ExactHeadReviewProvider,
  ExactHeadReviewRevisionState,
  CodexReviewRevision,
  CursorReviewRevision,
  GitHubReviewClient,
} from "../main/github-review.js";
import type { PullRequestRevision } from "../main/github.js";

class GithubReviewMockOctokit {
  constructor(
    private readonly request: {
      comments?: MockComment[];
      createCalls?: { count: number };
      createdBodies?: string[];
      reactions?: Array<{ content: string; user: { login: string } }>;
      revisions?: PullRequestRevision[];
      reviews?: MockReview[];
      sha?: string;
    },
  ) {}
  execute(): Octokit {
    const input = this.request;

    const [
      comments = new Array<MockComment>(),
      createdBodies = new Array<string>(),
      reviews = [],
      sha = "head-sha",
      reactions = [],
    ] = [
      input.comments,
      input.createdBodies,
      input.reviews,
      input.sha,
      input.reactions,
    ];
    for (const comment of comments) {
      if (!Object.hasOwn(comment, "author_association")) {
        comment.author_association = "OWNER";
      }
    }
    let revisionReads = 0;
    return Object.assign(new Octokit(), {
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
              created_at: "2026-09-01T02:00:00.000Z",
              id: comments.length + 1,
            });
            return { data: { id: comments.length } };
          },
          listComments: async () => ({ data: comments }),
        },
        pulls: {
          get: async () => {
            const revision =
              input.revisions?.[
                Math.min(revisionReads, input.revisions.length - 1)
              ];
            revisionReads += 1;
            const [baseRef = "main", baseSha = "base-sha", headSha = sha] = [
              revision?.baseRef,
              revision?.baseSha,
              revision?.headSha,
            ];
            return {
              data: {
                base: {
                  ref: baseRef,
                  sha: baseSha,
                },
                head: { sha: headSha },
              },
            };
          },
          listReviews: async () => ({ data: reviews }),
        },
        reactions: {
          listForIssueComment: async () => ({
            data: reactions,
          }),
        },
      },
      paginate: async (
        route: (args: unknown) => Promise<{ data: unknown[] }>,
        args: unknown,
      ) => (await route(args)).data,
    });
  }
}

const repoRef = { owner: "meta-secret", repo: "nook" };
const headSha = "0123456789abcdef0123456789abcdef01234567";

type MockComment = {
  author_association?: string;
  body: string;
  created_at?: string;
  id: number;
  user?: { login: string };
};

type MockReview = {
  body?: string;
  commit_id: string;
  state: string;
  submitted_at?: string;
  user: { login: string };
};

void test("requestExactHeadReview posts one exact-head Codex marker", async () => {
  const createdBodies: string[] = [];
  const octokit = new GithubReviewMockOctokit({ createdBodies }).execute();

  const first = await new GitHubReviewClient(octokit)
    .requestExactHeadReview({
      repoRef: repoRef,
      prNumber: 410,
    })
    .then(CiResultAssertions.assertSuccess);
  const second = await new GitHubReviewClient(octokit)
    .requestExactHeadReview({
      repoRef: repoRef,
      prNumber: 410,
    })
    .then(CiResultAssertions.assertSuccess);

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

void test("requestExactHeadReview detects a revision change before Codex contact", async () => {
  const createCalls = { count: 0 };
  const expected: PullRequestRevision = {
    baseRef: "main",
    baseSha: "base-sha",
    headSha: "head-sha",
  };
  const octokit = new GithubReviewMockOctokit({
    createCalls,
    revisions: [expected, { ...expected, headSha: "changed-head" }],
  }).execute();

  await CiResultAssertions.assertAsyncFailure(
    new GitHubReviewClient(octokit).requestExactHeadReview({
      repoRef: repoRef,
      prNumber: 410,
      options: {
        revision: {
          revision: expected,
          state: ExactHeadReviewRevisionState.Bound,
        },
      },
    }),
    /Pull request revision changed.*no review was requested/,
  );
  assert.equal(createCalls.count, 0);
});

void test("review request identity changes with the base revision", () => {
  assert.notEqual(
    new CodexReviewRevision({ headSha: headSha, baseSha: "base-one" }).marker(),
    new CodexReviewRevision({ headSha: headSha, baseSha: "base-two" }).marker(),
  );
});

void test("an old same-head review cannot settle a new base-bound request", async () => {
  const createdBodies: string[] = [];
  const octokit = new GithubReviewMockOctokit({
    comments: [
      {
        body: `@codex review\n\n${new CodexReviewRevision({ headSha: headSha, baseSha: "old-base" }).marker()}`,
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
  }).execute();

  const result = await new GitHubReviewClient(octokit)
    .requestExactHeadReview({
      repoRef: repoRef,
      prNumber: 410,
    })
    .then(CiResultAssertions.assertSuccess);

  assert.equal(result.requested, true);
  assert.deepEqual(createdBodies, [
    `@codex review\n\n${new CodexReviewRevision({ headSha: headSha, baseSha: "base-sha" }).marker()}`,
  ]);
});

void test("requestExactHeadReview ignores an untrusted exact-head marker", async () => {
  const createdBodies: string[] = [];
  const octokit = new GithubReviewMockOctokit({
    comments: [
      {
        author_association: "NONE",
        body: `@codex review\n\n${new CodexReviewRevision({ headSha: headSha }).marker()}`,
        id: 1,
      },
    ],
    createdBodies,
    sha: headSha,
  }).execute();

  const result = await new GitHubReviewClient(octokit)
    .requestExactHeadReview({
      repoRef: repoRef,
      prNumber: 410,
    })
    .then(CiResultAssertions.assertSuccess);

  assert.equal(result.requested, true);
  assert.deepEqual(createdBodies, [
    `@codex review\n\n${new CodexReviewRevision({ headSha: headSha }).marker()}`,
  ]);
});

void test("requestExactHeadReview keeps a workflow-token request idempotent", async () => {
  const createdBodies: string[] = [];
  const octokit = new GithubReviewMockOctokit({
    comments: [
      {
        author_association: "CONTRIBUTOR",
        body: `@codex review\n\n${new CodexReviewRevision({ headSha: headSha }).marker()}`,
        id: 1,
        user: { login: "github-actions[bot]" },
      },
    ],
    createdBodies,
    sha: headSha,
  }).execute();

  const result = await new GitHubReviewClient(octokit)
    .requestExactHeadReview({
      repoRef: repoRef,
      prNumber: 410,
    })
    .then(CiResultAssertions.assertSuccess);

  assert.equal(result.requested, false);
  assert.deepEqual(createdBodies, []);
});

void test("requestExactHeadReview reports an exact-head Codex approval reaction as settled", async () => {
  const createCalls = { count: 0 };
  const octokit = new GithubReviewMockOctokit({
    comments: [
      {
        body: `@codex review\n\n${new CodexReviewRevision({ headSha: headSha }).marker()}`,
        id: 1,
      },
    ],
    createCalls,
    reactions: [
      { content: "+1", user: { login: "chatgpt-codex-connector[bot]" } },
    ],
    sha: headSha,
  }).execute();

  const result = await new GitHubReviewClient(octokit)
    .requestExactHeadReview({
      repoRef: repoRef,
      prNumber: 410,
    })
    .then(CiResultAssertions.assertSuccess);

  assert.deepEqual(result, {
    fallback: ExactHeadReviewFallback.None,
    headSha,
    provider: ExactHeadReviewProvider.Codex,
    requested: false,
    settled: true,
  });
  assert.equal(createCalls.count, 0);
});

void test("requestExactHeadReview does not treat an eye reaction as settled", async () => {
  const createCalls = { count: 0 };
  const octokit = new GithubReviewMockOctokit({
    comments: [
      {
        body: `@codex review\n\n${new CodexReviewRevision({ headSha: headSha }).marker()}`,
        id: 1,
      },
    ],
    createCalls,
    reactions: [
      { content: "eyes", user: { login: "chatgpt-codex-connector[bot]" } },
    ],
    sha: headSha,
  }).execute();

  const result = await new GitHubReviewClient(octokit)
    .requestExactHeadReview({
      repoRef: repoRef,
      prNumber: 410,
    })
    .then(CiResultAssertions.assertSuccess);

  assert.equal(result.requested, false);
  assert.equal(result.settled, false);
  assert.equal(createCalls.count, 0);
});

void test("requestExactHeadReview does not request a fallback after a Codex usage limit", async () => {
  const createdBodies: string[] = [];
  const octokit = new GithubReviewMockOctokit({
    comments: [
      {
        body: `@codex review\n\n${new CodexReviewRevision({ headSha: headSha }).marker()}`,
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
  }).execute();

  const fallback = await new GitHubReviewClient(octokit)
    .requestExactHeadReview({ repoRef: repoRef, prNumber: 410 })
    .then(CiResultAssertions.assertSuccess);
  const idempotent = await new GitHubReviewClient(octokit)
    .requestExactHeadReview({ repoRef: repoRef, prNumber: 410 })
    .then(CiResultAssertions.assertSuccess);

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

void test("requestExactHeadReview recognizes a clean Codex comment for the exact head", async () => {
  const createCalls = { count: 0 };
  const octokit = new GithubReviewMockOctokit({
    comments: [
      {
        body: `@codex review\n\n${new CodexReviewRevision({ headSha: headSha }).marker()}`,
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
  }).execute();

  const result = await new GitHubReviewClient(octokit)
    .requestExactHeadReview({
      repoRef: repoRef,
      prNumber: 410,
    })
    .then(CiResultAssertions.assertSuccess);

  assert.deepEqual(result, {
    fallback: ExactHeadReviewFallback.None,
    headSha,
    provider: ExactHeadReviewProvider.Codex,
    requested: false,
    settled: true,
  });
  assert.equal(createCalls.count, 0);
});

void test("requestExactHeadReview keeps a Codex usage limit non-blocking", async () => {
  const createdBodies: string[] = [];
  const comments: MockComment[] = [];
  const octokit = new GithubReviewMockOctokit({
    comments,
    createdBodies,
    sha: headSha,
  }).execute();
  const clock = {
    async waitMs(): Promise<void> {
      comments.push({
        body: "You have reached your Codex usage limits for code reviews.",
        id: comments.length + 1,
        user: { login: "chatgpt-codex-connector[bot]" },
      });
    },
  };

  const result = await new GitHubReviewClient(octokit)
    .requestExactHeadReview({
      repoRef: repoRef,
      prNumber: 410,
      options: {
        availability: {
          clock,
          probe: { intervalMs: 1, timeoutMs: 20 },
        },
      },
    })
    .then(CiResultAssertions.assertSuccess);

  assert.deepEqual(result, {
    fallback: ExactHeadReviewFallback.CodexUsageLimit,
    headSha,
    provider: ExactHeadReviewProvider.Codex,
    requested: true,
    settled: false,
  });
  assert.deepEqual(createdBodies, [
    `@codex review\n\n${new CodexReviewRevision({ headSha: headSha }).marker()}`,
  ]);
});

void test("requestExactHeadReview still prefers Codex on a new head after an older usage-limit comment", async () => {
  const createdBodies: string[] = [];
  const octokit = new GithubReviewMockOctokit({
    comments: [
      {
        body: `@codex review\n\n${new CodexReviewRevision({ headSha: "old-head-sha" }).marker()}`,
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
  }).execute();

  const result = await new GitHubReviewClient(octokit)
    .requestExactHeadReview({
      repoRef: repoRef,
      prNumber: 410,
    })
    .then(CiResultAssertions.assertSuccess);

  assert.deepEqual(result, {
    fallback: ExactHeadReviewFallback.None,
    headSha,
    provider: ExactHeadReviewProvider.Codex,
    requested: true,
    settled: false,
  });
  assert.deepEqual(createdBodies, [
    `@codex review\n\n${new CodexReviewRevision({ headSha: headSha }).marker()}`,
  ]);
});

void test("requestExactHeadReview does not request Cursor while Codex is pending", async () => {
  const createdBodies: string[] = [];
  const octokit = new GithubReviewMockOctokit({
    comments: [
      {
        body: `@codex review\n\n${new CodexReviewRevision({ headSha: headSha }).marker()}`,
        id: 1,
      },
    ],
    createdBodies,
    sha: headSha,
  }).execute();

  const result = await new GitHubReviewClient(octokit)
    .requestExactHeadReview({
      repoRef: repoRef,
      prNumber: 410,
    })
    .then(CiResultAssertions.assertSuccess);

  assert.deepEqual(result, {
    fallback: ExactHeadReviewFallback.None,
    headSha,
    provider: ExactHeadReviewProvider.Codex,
    requested: false,
    settled: false,
  });
  assert.deepEqual(createdBodies, []);
});

void test("requestExactHeadReview ignores an inactive Cursor review fallback", async () => {
  const createCalls = { count: 0 };
  const octokit = new GithubReviewMockOctokit({
    comments: [
      {
        body: `@codex review\n\n${new CodexReviewRevision({ headSha: headSha }).marker()}`,
        id: 1,
      },
      {
        body: "You have reached your Codex usage limits for code reviews.",
        id: 2,
        user: { login: "chatgpt-codex-connector[bot]" },
      },
      {
        body: `cursor review\n\n${new CursorReviewRevision(headSha).marker()}`,
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
  }).execute();

  const result = await new GitHubReviewClient(octokit)
    .requestExactHeadReview({
      repoRef: repoRef,
      prNumber: 410,
    })
    .then(CiResultAssertions.assertSuccess);

  assert.deepEqual(result, {
    fallback: ExactHeadReviewFallback.CodexUsageLimit,
    headSha,
    provider: ExactHeadReviewProvider.Codex,
    requested: false,
    settled: false,
  });
  assert.equal(createCalls.count, 0);
});
