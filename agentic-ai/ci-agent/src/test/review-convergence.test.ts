import assert from "node:assert/strict";
import test from "node:test";

import type { PrFeedbackSummary } from "../main/github.js";
import {
  CodexReviewConvergenceOutcome,
  convergeCodexReview,
  type CodexReviewSnapshot,
  type ReviewConvergenceClock,
} from "../main/review-convergence.js";

const HEAD_SHA = "0123456789abcdef0123456789abcdef01234567";

function feedbackWith(
  values: Partial<PrFeedbackSummary> = {},
): PrFeedbackSummary {
  return {
    codexReview: {
      approvalReaction: false,
      cleanComment: false,
      currentHeadReview: false,
      requested: false,
      settled: false,
    },
    substantiveComments: 0,
    substantiveReviews: 0,
    unresolvedThreads: 0,
    ...values,
  };
}

type FakeClock = ReviewConvergenceClock & { currentMilliseconds: () => number };

function fakeClock(): FakeClock {
  let now = 0;
  return {
    currentMilliseconds: () => now,
    nowMilliseconds: () => now,
    sleepMilliseconds: async (delayMilliseconds) => {
      now += delayMilliseconds;
    },
  };
}

type SnapshotSequence = {
  next: () => Promise<CodexReviewSnapshot>;
};

function snapshotSequence(
  snapshots: CodexReviewSnapshot[],
): SnapshotSequence {
  let index = 0;
  return {
    next: async () => {
      const snapshot = snapshots[Math.min(index, snapshots.length - 1)];
      index += 1;
      assert.ok(snapshot);
      return snapshot;
    },
  };
}

test("automatic exact-head review settles during the grace period", async () => {
  const clock = fakeClock();
  const snapshots = snapshotSequence([
    { feedback: feedbackWith(), headSha: HEAD_SHA, stable: true },
    {
      feedback: feedbackWith({
        codexReview: {
          approvalReaction: false,
          cleanComment: true,
          currentHeadReview: false,
          requested: false,
          settled: true,
        },
      }),
      headSha: HEAD_SHA,
      stable: true,
    },
  ]);
  let requestCalls = 0;

  const result = await convergeCodexReview({
    automaticGraceSeconds: 60,
    clock,
    expectedHeadSha: HEAD_SHA,
    pollSeconds: 30,
    readSnapshot: snapshots.next,
    requestReview: async () => {
      requestCalls += 1;
      return { headSha: HEAD_SHA, requested: true, settled: false };
    },
    timeoutSeconds: 120,
  });

  assert.equal(result.outcome, CodexReviewConvergenceOutcome.Clean);
  assert.equal(result.waitedSeconds, 60);
  assert.equal(result.manualRequestCreated, false);
  assert.equal(requestCalls, 0);
});

test("manual exact-head review is requested once after automatic grace", async () => {
  const clock = fakeClock();
  const snapshots = snapshotSequence([
    { feedback: feedbackWith(), headSha: HEAD_SHA, stable: true },
    { feedback: feedbackWith(), headSha: HEAD_SHA, stable: true },
    {
      feedback: feedbackWith({
        codexReview: {
          approvalReaction: true,
          cleanComment: false,
          currentHeadReview: false,
          requested: true,
          settled: true,
        },
      }),
      headSha: HEAD_SHA,
      stable: true,
    },
  ]);
  let requestCalls = 0;

  const result = await convergeCodexReview({
    automaticGraceSeconds: 30,
    clock,
    expectedHeadSha: HEAD_SHA,
    pollSeconds: 30,
    readSnapshot: snapshots.next,
    requestReview: async () => {
      requestCalls += 1;
      return { headSha: HEAD_SHA, requested: true, settled: false };
    },
    timeoutSeconds: 120,
  });

  assert.equal(result.outcome, CodexReviewConvergenceOutcome.Clean);
  assert.equal(result.waitedSeconds, 60);
  assert.equal(result.manualRequestCreated, true);
  assert.equal(requestCalls, 1);
});

test("actionable feedback stops convergence before validation", async () => {
  const clock = fakeClock();

  const result = await convergeCodexReview({
    automaticGraceSeconds: 60,
    clock,
    expectedHeadSha: HEAD_SHA,
    pollSeconds: 30,
    readSnapshot: async () => ({
      feedback: feedbackWith({ unresolvedThreads: 2 }),
      headSha: HEAD_SHA,
      stable: true,
    }),
    requestReview: async () => ({
      headSha: HEAD_SHA,
      requested: true,
      settled: false,
    }),
    timeoutSeconds: 120,
  });

  assert.equal(result.outcome, CodexReviewConvergenceOutcome.Feedback);
  assert.equal(result.feedback.unresolvedThreads, 2);
  assert.equal(result.waitedSeconds, 0);
});

test("review service timeout remains non-blocking", async () => {
  const clock = fakeClock();
  let requestCalls = 0;

  const result = await convergeCodexReview({
    automaticGraceSeconds: 30,
    clock,
    expectedHeadSha: HEAD_SHA,
    pollSeconds: 30,
    readSnapshot: async () => ({
      feedback: feedbackWith(),
      headSha: HEAD_SHA,
      stable: true,
    }),
    requestReview: async () => {
      requestCalls += 1;
      return { headSha: HEAD_SHA, requested: true, settled: false };
    },
    timeoutSeconds: 90,
  });

  assert.equal(result.outcome, CodexReviewConvergenceOutcome.Timeout);
  assert.equal(result.waitedSeconds, 90);
  assert.equal(requestCalls, 1);
});

test("head replacement invalidates review convergence", async () => {
  const clock = fakeClock();
  const replacementHead = "abcdef0123456789abcdef0123456789abcdef01";

  const result = await convergeCodexReview({
    automaticGraceSeconds: 60,
    clock,
    expectedHeadSha: HEAD_SHA,
    pollSeconds: 30,
    readSnapshot: async () => ({
      feedback: feedbackWith(),
      headSha: replacementHead,
      stable: true,
    }),
    requestReview: async () => ({
      headSha: HEAD_SHA,
      requested: true,
      settled: false,
    }),
    timeoutSeconds: 120,
  });

  assert.equal(result.outcome, CodexReviewConvergenceOutcome.HeadChanged);
  assert.equal(result.headSha, replacementHead);
});

test("an unstable feedback snapshot invalidates convergence", async () => {
  const clock = fakeClock();

  const result = await convergeCodexReview({
    automaticGraceSeconds: 60,
    clock,
    expectedHeadSha: HEAD_SHA,
    pollSeconds: 30,
    readSnapshot: async () => ({
      feedback: feedbackWith({
        codexReview: {
          approvalReaction: false,
          cleanComment: true,
          currentHeadReview: false,
          requested: false,
          settled: true,
        },
      }),
      headSha: HEAD_SHA,
      stable: false,
    }),
    requestReview: async () => ({
      headSha: HEAD_SHA,
      requested: true,
      settled: false,
    }),
    timeoutSeconds: 120,
  });

  assert.equal(result.outcome, CodexReviewConvergenceOutcome.HeadChanged);
});

test("settled review is reread before inline findings are accepted as clean", async () => {
  const clock = fakeClock();
  const settledFeedback = feedbackWith({
    codexReview: {
      approvalReaction: false,
      cleanComment: false,
      currentHeadReview: true,
      requested: false,
      settled: true,
    },
  });
  const snapshots = snapshotSequence([
    { feedback: settledFeedback, headSha: HEAD_SHA, stable: true },
    {
      feedback: feedbackWith({
        codexReview: settledFeedback.codexReview,
        unresolvedThreads: 1,
      }),
      headSha: HEAD_SHA,
      stable: true,
    },
  ]);

  const result = await convergeCodexReview({
    automaticGraceSeconds: 60,
    clock,
    expectedHeadSha: HEAD_SHA,
    pollSeconds: 30,
    readSnapshot: snapshots.next,
    requestReview: async () => ({
      headSha: HEAD_SHA,
      requested: true,
      settled: false,
    }),
    timeoutSeconds: 120,
  });

  assert.equal(result.outcome, CodexReviewConvergenceOutcome.Feedback);
  assert.equal(result.feedback.unresolvedThreads, 1);
});
