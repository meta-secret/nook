import assert from "node:assert/strict";
import test from "node:test";

import type { Octokit } from "@octokit/rest";

import {
  OptionalNumberKind,
  OptionalTextKind,
  PullRequestWatchState,
  ReviewCommentWatchEventKind,
  ReviewFeedbackSurface,
  WatchStopReason,
  parseReviewCommentWatchOptions,
  readGitHubSnapshot,
  watchReviewComments,
  type ReviewCommentWatchClock,
  type ReviewCommentWatchEvent,
  type ReviewCommentWatchTransport,
  type ReviewFeedbackReference,
  type ReviewFeedbackSnapshot,
} from "../main/review-comment-watch.js";

const repoRef = { owner: "meta-secret", repo: "nook" };
const target = { prNumber: 1175, repoRef };

function clock(onSleep: () => void = () => {}): ReviewCommentWatchClock {
  return {
    now: () => "2026-08-27T20:00:00.000Z",
    async sleep(): Promise<void> {
      onSleep();
    },
  };
}

function inlineComment(id: number): ReviewFeedbackReference {
  return {
    authorLogin: { kind: OptionalTextKind.Present, value: "reviewer" },
    commitId: `commit-${id}`,
    createdAt: {
      kind: OptionalTextKind.Present,
      value: "2026-08-27T19:00:00.000Z",
    },
    githubId: id,
    line: { kind: OptionalNumberKind.Present, value: 42 },
    nodeId: `inline-${id}`,
    path: "src/example.ts",
    replyToId: { kind: OptionalNumberKind.Missing },
    reviewId: { kind: OptionalNumberKind.Present, value: 100 + id },
    surface: ReviewFeedbackSurface.InlineReviewComment,
    url: `https://github.test/inline/${id}`,
  };
}

function submittedReview(id: number): ReviewFeedbackReference {
  return {
    authorLogin: { kind: OptionalTextKind.Present, value: "reviewer" },
    commitId: { kind: OptionalTextKind.Present, value: `commit-${id}` },
    createdAt: {
      kind: OptionalTextKind.Present,
      value: "2026-08-27T19:00:01.000Z",
    },
    githubId: id,
    nodeId: `review-${id}`,
    state: "COMMENTED",
    surface: ReviewFeedbackSurface.SubmittedReview,
    url: `https://github.test/review/${id}`,
  };
}

function conversationComment(id: number): ReviewFeedbackReference {
  return {
    authorLogin: { kind: OptionalTextKind.Present, value: "reviewer" },
    createdAt: {
      kind: OptionalTextKind.Present,
      value: "2026-08-27T19:00:02.000Z",
    },
    githubId: id,
    nodeId: `conversation-${id}`,
    surface: ReviewFeedbackSurface.PrConversationComment,
    url: `https://github.test/conversation/${id}`,
  };
}

function snapshot(input: {
  headSha: string;
  items?: readonly ReviewFeedbackReference[];
  state?: PullRequestWatchState;
}): ReviewFeedbackSnapshot {
  return {
    headSha: input.headSha,
    items: input.items ?? [],
    state: input.state ?? PullRequestWatchState.Open,
  };
}

function sequenceTransport(
  results: readonly (ReviewFeedbackSnapshot | Error)[],
): ReviewCommentWatchTransport {
  let index = 0;
  return {
    async readSnapshot(): Promise<ReviewFeedbackSnapshot> {
      const result = results[index];
      index += 1;
      if (result instanceof Error) throw result;
      if (!result) throw new Error("test snapshot sequence exhausted");
      return result;
    },
  };
}

function watchInput(input: {
  controller?: AbortController;
  events: ReviewCommentWatchEvent[];
  transport: ReviewCommentWatchTransport;
  watchClock?: ReviewCommentWatchClock;
}) {
  const controller = input.controller ?? new AbortController();
  return {
    clock: input.watchClock ?? clock(),
    emit: (event: ReviewCommentWatchEvent) => input.events.push(event),
    pollMilliseconds: 15_000,
    random: () => 0.5,
    repository: "meta-secret/nook",
    signal: controller.signal,
    target,
    transport: input.transport,
    watchId: "watch-1",
  };
}

test("validates the PR and polling interval", () => {
  assert.deepEqual(
    parseReviewCommentWatchOptions(["--pr", "42", "--poll-seconds", "15"]),
    {
      pollMilliseconds: 15_000,
      repository: "meta-secret/nook",
      target: { prNumber: 42, repoRef },
    },
  );
  assert.throws(
    () => parseReviewCommentWatchOptions(["--pr", "0"]),
    /positive integer/,
  );
  assert.throws(
    () =>
      parseReviewCommentWatchOptions([
        "--pr",
        "42",
        "--poll-seconds",
        "1",
      ]),
    /between 5 and 300/,
  );
  assert.throws(
    () => parseReviewCommentWatchOptions(["--pr", "42", "--other", "15"]),
    /unknown watch argument/,
  );
  assert.throws(
    () => parseReviewCommentWatchOptions(["--pr", "42", "--pr", "43"]),
    /provided only once/,
  );
});

test("resyncs, ignores unchanged snapshots, batches all three new surfaces, and stops on close", async () => {
  const existing = inlineComment(1);
  const added = [inlineComment(2), submittedReview(3), conversationComment(4)];
  const events: ReviewCommentWatchEvent[] = [];
  const first = snapshot({ headSha: "head-one", items: [existing] });
  const changed = snapshot({
    headSha: "head-two",
    items: [existing, ...added],
  });
  const closed = snapshot({
    headSha: "head-two",
    items: [existing, ...added],
    state: PullRequestWatchState.Closed,
  });

  await watchReviewComments(
    watchInput({
      events,
      transport: sequenceTransport([first, first, changed, closed]),
    }),
  );

  assert.deepEqual(
    events.map((event) => event.kind),
    [
      ReviewCommentWatchEventKind.ResyncRequired,
      ReviewCommentWatchEventKind.Observed,
      ReviewCommentWatchEventKind.Stopped,
    ],
  );
  const observed = events[1];
  assert.equal(observed?.kind, ReviewCommentWatchEventKind.Observed);
  if (observed?.kind !== ReviewCommentWatchEventKind.Observed) return;
  assert.deepEqual(observed.headShaAtObservation, {
    kind: OptionalTextKind.Present,
    value: "head-two",
  });
  assert.deepEqual(observed.items, added);
  assert.deepEqual(
    events.map((event) => event.sequence),
    [1, 2, 3],
  );
  assert.equal(
    events[2]?.kind === ReviewCommentWatchEventKind.Stopped
      ? events[2].reason
      : "",
    WatchStopReason.PrNotOpen,
  );
});

test("retries without advancing state and emits one degraded event per failure streak", async () => {
  const events: ReviewCommentWatchEvent[] = [];
  const open = snapshot({ headSha: "head" });
  const closed = snapshot({
    headSha: "head",
    state: PullRequestWatchState.Closed,
  });
  const failure = new Error("sensitive transport detail");
  await watchReviewComments(
    watchInput({
      events,
      transport: sequenceTransport([
        open,
        failure,
        failure,
        failure,
        failure,
        closed,
      ]),
    }),
  );

  assert.deepEqual(
    events.map((event) => event.kind),
    [
      ReviewCommentWatchEventKind.ResyncRequired,
      ReviewCommentWatchEventKind.Degraded,
      ReviewCommentWatchEventKind.Stopped,
    ],
  );
  assert.equal(JSON.stringify(events).includes("sensitive transport detail"), false);
});

test("bootstrap retries and establishes high-water state only after a complete snapshot", async () => {
  const events: ReviewCommentWatchEvent[] = [];
  const existing = inlineComment(40);
  const added = conversationComment(41);
  const failure = new Error("bootstrap unavailable");
  const firstComplete = snapshot({ headSha: "head-one", items: [existing] });
  const changed = snapshot({
    headSha: "head-two",
    items: [existing, added],
  });
  const closed = snapshot({
    headSha: "head-two",
    items: [existing, added],
    state: PullRequestWatchState.Closed,
  });

  await watchReviewComments(
    watchInput({
      events,
      transport: sequenceTransport([
        failure,
        failure,
        failure,
        firstComplete,
        changed,
        closed,
      ]),
    }),
  );

  assert.deepEqual(
    events.map((event) => event.kind),
    [
      ReviewCommentWatchEventKind.Degraded,
      ReviewCommentWatchEventKind.ResyncRequired,
      ReviewCommentWatchEventKind.Observed,
      ReviewCommentWatchEventKind.Stopped,
    ],
  );
  assert.deepEqual(events[0]?.headShaAtObservation, {
    kind: OptionalTextKind.Missing,
  });
  const observed = events[2];
  assert.equal(observed?.kind, ReviewCommentWatchEventKind.Observed);
  if (observed?.kind !== ReviewCommentWatchEventKind.Observed) return;
  assert.deepEqual(observed.items, [added]);
});

test("recovery resets degraded suppression and preserves newly observed feedback", async () => {
  const events: ReviewCommentWatchEvent[] = [];
  const open = snapshot({ headSha: "head" });
  const recovered = snapshot({
    headSha: "head-two",
    items: [conversationComment(8)],
  });
  const closed = snapshot({
    headSha: "head-two",
    items: [conversationComment(8)],
    state: PullRequestWatchState.Closed,
  });
  const failure = new Error("transient");
  await watchReviewComments(
    watchInput({
      events,
      transport: sequenceTransport([
        open,
        failure,
        failure,
        failure,
        recovered,
        failure,
        failure,
        failure,
        closed,
      ]),
    }),
  );

  assert.equal(
    events.filter(
      (event) => event.kind === ReviewCommentWatchEventKind.Degraded,
    ).length,
    2,
  );
  const observed = events.find(
    (event) => event.kind === ReviewCommentWatchEventKind.Observed,
  );
  assert.deepEqual(observed?.headShaAtObservation, {
    kind: OptionalTextKind.Present,
    value: "head-two",
  });
});

test("an abort signal interrupts the wait and produces a graceful stop", async () => {
  const controller = new AbortController();
  const events: ReviewCommentWatchEvent[] = [];
  await watchReviewComments(
    watchInput({
      controller,
      events,
      transport: sequenceTransport([snapshot({ headSha: "head" })]),
      watchClock: clock(() => controller.abort()),
    }),
  );

  const stopped = events.at(-1);
  assert.equal(stopped?.kind, ReviewCommentWatchEventKind.Stopped);
  assert.equal(
    stopped?.kind === ReviewCommentWatchEventKind.Stopped ? stopped.reason : "",
    WatchStopReason.Signal,
  );
});

test("GitHub snapshot pagination retains more than 100 records and excludes bodies", async () => {
  const inline = Array.from({ length: 101 }, (_, index) => ({
    body: `untrusted body ${index}`,
    commit_id: "head",
    created_at: "2026-08-27T19:00:00.000Z",
    html_url: `https://github.test/inline/${index}`,
    id: index + 1,
    ...(index === 0 ? {} : { in_reply_to_id: index }),
    line: 7,
    node_id: `node-${index}`,
    path: "src/example.ts",
    pull_request_review_id: 90,
    user: { login: "reviewer" },
  }));
  const rest = {
    issues: {
      listComments: async () => ({ data: [] }),
    },
    pulls: {
      get: async () => ({ data: { head: { sha: "head" }, state: "open" } }),
      listReviewComments: async () => ({ data: inline }),
      listReviews: async () => ({
        data: [
          {
            commit_id: "head",
            html_url: "https://github.test/review/pending",
            id: 200,
            node_id: "review-pending",
            state: "PENDING",
            user: { login: "reviewer" },
          },
          {
            commit_id: "head",
            html_url: "https://github.test/review/submitted",
            id: 201,
            node_id: "review-submitted",
            state: "COMMENTED",
            submitted_at: "2026-08-27T19:01:00.000Z",
            user: { login: "reviewer" },
          },
        ],
      }),
    },
  };
  const octokit = {
    paginate: async (
      route: (input: object) => Promise<{ data: object[] }>,
      input: object,
    ) => (await route(input)).data,
    rest,
  } as unknown as Octokit;

  const result = await readGitHubSnapshot(octokit, target);

  assert.equal(result.items.length, 102);
  assert.equal(JSON.stringify(result).includes("untrusted body"), false);
  assert.equal(result.items[0]?.surface, ReviewFeedbackSurface.InlineReviewComment);
  assert.equal(
    result.items.some((item) => item.githubId === 200),
    false,
  );
  assert.equal(
    result.items.some(
      (item) =>
        item.githubId === 201 &&
        item.surface === ReviewFeedbackSurface.SubmittedReview,
    ),
    true,
  );
});

test("pending reviews stay outside high-water state until GitHub submits them", async () => {
  const pendingReview = {
    commit_id: "head",
    html_url: "https://github.test/review/300",
    id: 300,
    node_id: "review-300",
    state: "PENDING",
    user: { login: "reviewer" },
  };
  let submitted = false;
  const rest = {
    issues: { listComments: async () => ({ data: [] }) },
    pulls: {
      get: async () => ({ data: { head: { sha: "head" }, state: "open" } }),
      listReviewComments: async () => ({ data: [] }),
      listReviews: async () => ({
        data: submitted
          ? [
              {
                ...pendingReview,
                state: "COMMENTED",
                submitted_at: "2026-08-27T19:05:00.000Z",
              },
            ]
          : [pendingReview],
      }),
    },
  };
  const octokit = {
    paginate: async (
      route: (input: object) => Promise<{ data: object[] }>,
      input: object,
    ) => (await route(input)).data,
    rest,
  } as unknown as Octokit;

  const pendingSnapshot = await readGitHubSnapshot(octokit, target);
  submitted = true;
  const submittedSnapshot = await readGitHubSnapshot(octokit, target);

  assert.equal(pendingSnapshot.items.length, 0);
  assert.equal(submittedSnapshot.items.length, 1);
  assert.equal(
    submittedSnapshot.items[0]?.surface,
    ReviewFeedbackSurface.SubmittedReview,
  );
  assert.equal(submittedSnapshot.items[0]?.githubId, 300);
});
