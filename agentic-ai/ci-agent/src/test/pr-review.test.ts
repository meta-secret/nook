import assert from "node:assert/strict";
import test from "node:test";

import type { PrFeedbackSummary } from "../main/github.js";
import {
  ReviewStabilizationState,
  stabilizeExactHeadReview,
} from "../main/pr-review.js";

const cleanFeedback: PrFeedbackSummary = {
  codexReview: {
    approvalReaction: true,
    cleanComment: false,
    currentHeadReview: false,
    requested: true,
    settled: true,
  },
  cursorReview: {
    currentHeadReview: false,
    requested: false,
    settled: false,
  },
  currentIterationComments: 0,
  findingBatches: 0,
  substantiveComments: 0,
  substantiveReviews: 0,
  unresolvedThreads: 0,
};

test("stabilizeExactHeadReview waits once and accepts clean feedback", async () => {
  let now = 0;
  let requests = 0;
  const result = await stabilizeExactHeadReview({
    inspectFeedback: async () => cleanFeedback,
    now: () => now,
    pollIntervalMs: 15,
    requestReview: async () => {
      requests += 1;
      return { headSha: "head-sha", settled: requests > 1 };
    },
    timeoutMs: 60,
    waitMs: async (milliseconds) => {
      now += milliseconds;
    },
  });

  assert.equal(requests, 2);
  assert.equal(result.state, ReviewStabilizationState.Clean);
  assert.equal(result.headSha, "head-sha");
});

test("stabilizeExactHeadReview rejects settled actionable feedback", async () => {
  const result = await stabilizeExactHeadReview({
    inspectFeedback: async () => ({
      ...cleanFeedback,
      substantiveReviews: 1,
      unresolvedThreads: 2,
    }),
    now: () => 0,
    pollIntervalMs: 15,
    requestReview: async () => ({ headSha: "head-sha", settled: true }),
    timeoutMs: 60,
    waitMs: async () => {},
  });

  assert.equal(result.state, ReviewStabilizationState.Findings);
  assert.equal(result.feedback?.unresolvedThreads, 2);
});

test("stabilizeExactHeadReview opens the circuit after three finding batches", async () => {
  let requests = 0;
  const result = await stabilizeExactHeadReview({
    inspectFeedback: async () => ({
      ...cleanFeedback,
      findingBatches: 3,
      unresolvedThreads: 1,
    }),
    now: () => 0,
    pollIntervalMs: 15,
    requestReview: async () => {
      requests += 1;
      return { headSha: "head-sha", settled: true };
    },
    timeoutMs: 60,
    waitMs: async () => {},
  });

  assert.equal(result.state, ReviewStabilizationState.CircuitBreaker);
  assert.equal(requests, 0);
});

test("stabilizeExactHeadReview ignores historical top-level comments", async () => {
  const result = await stabilizeExactHeadReview({
    inspectFeedback: async () => ({
      ...cleanFeedback,
      substantiveComments: 4,
    }),
    now: () => 0,
    pollIntervalMs: 15,
    requestReview: async () => ({ headSha: "head-sha", settled: true }),
    timeoutMs: 60,
    waitMs: async () => {},
  });

  assert.equal(result.state, ReviewStabilizationState.Clean);
});

test("stabilizeExactHeadReview permits validation after the bounded timeout", async () => {
  let now = 0;
  let feedbackInspections = 0;
  const result = await stabilizeExactHeadReview({
    inspectFeedback: async () => {
      feedbackInspections += 1;
      return cleanFeedback;
    },
    now: () => now,
    pollIntervalMs: 15,
    requestReview: async () => ({ headSha: "head-sha", settled: false }),
    timeoutMs: 30,
    waitMs: async (milliseconds) => {
      now += milliseconds;
    },
  });

  assert.equal(result.state, ReviewStabilizationState.TimedOut);
  assert.equal(feedbackInspections, 3);
});

test("stabilizeExactHeadReview stops on findings discovered at timeout", async () => {
  let now = 0;
  const result = await stabilizeExactHeadReview({
    inspectFeedback: async () => ({
      ...cleanFeedback,
      unresolvedThreads: 1,
    }),
    now: () => now,
    pollIntervalMs: 15,
    requestReview: async () => ({ headSha: "head-sha", settled: false }),
    timeoutMs: 0,
    waitMs: async (milliseconds) => {
      now += milliseconds;
    },
  });

  assert.equal(result.state, ReviewStabilizationState.Findings);
  assert.equal(result.feedback?.unresolvedThreads, 1);
});

test("stabilizeExactHeadReview reinspects a review settled at the deadline", async () => {
  let now = 30;
  let inspections = 0;
  const result = await stabilizeExactHeadReview({
    inspectFeedback: async () => {
      inspections += 1;
      return inspections === 1
        ? cleanFeedback
        : { ...cleanFeedback, unresolvedThreads: 1 };
    },
    now: () => now,
    pollIntervalMs: 15,
    requestReview: async () => {
      now = 31;
      return { headSha: "head-sha", settled: true };
    },
    timeoutMs: 1,
    waitMs: async () => {},
  });

  assert.equal(result.state, ReviewStabilizationState.Findings);
  assert.equal(result.feedback?.unresolvedThreads, 1);
  assert.equal(inspections, 2);
});

test("stabilizeExactHeadReview preserves a bounded zero-wait feedback snapshot", async () => {
  const result = await stabilizeExactHeadReview({
    inspectFeedback: () =>
      new Promise((resolve) => {
        setTimeout(
          () => resolve({ ...cleanFeedback, unresolvedThreads: 1 }),
          5,
        );
      }),
    now: () => 0,
    pollIntervalMs: 15,
    requestReview: async () => ({ headSha: "head-sha", settled: false }),
    timeoutMs: 0,
    waitMs: async () => {},
  });

  assert.equal(result.state, ReviewStabilizationState.Findings);
  assert.equal(result.feedback?.unresolvedThreads, 1);
});

test("stabilizeExactHeadReview stops on current-iteration comments", async () => {
  const result = await stabilizeExactHeadReview({
    inspectFeedback: async () => ({
      ...cleanFeedback,
      currentIterationComments: 1,
    }),
    now: () => 0,
    pollIntervalMs: 15,
    requestReview: async () => ({ headSha: "head-sha", settled: true }),
    timeoutMs: 60,
    waitMs: async () => {},
  });

  assert.equal(result.state, ReviewStabilizationState.Findings);
});

test("stabilizeExactHeadReview bounds transient request errors", async () => {
  let now = 0;
  let requests = 0;
  const result = await stabilizeExactHeadReview({
    inspectFeedback: async () => cleanFeedback,
    now: () => now,
    pollIntervalMs: 15,
    requestReview: async () => {
      requests += 1;
      throw new Error("transient GitHub failure");
    },
    timeoutMs: 30,
    waitMs: async (milliseconds) => {
      now += milliseconds;
    },
  });

  assert.equal(requests, 2);
  assert.equal(result.state, ReviewStabilizationState.TimedOut);
  assert.equal(result.headSha, "");
});

test("stabilizeExactHeadReview bounds feedback errors after review settles", async () => {
  let now = 0;
  let feedbackInspections = 0;
  const result = await stabilizeExactHeadReview({
    inspectFeedback: async () => {
      feedbackInspections += 1;
      throw new Error("review threads unavailable");
    },
    now: () => now,
    pollIntervalMs: 15,
    requestReview: async () => ({ headSha: "head-sha", settled: true }),
    timeoutMs: 30,
    waitMs: async (milliseconds) => {
      now += milliseconds;
    },
  });

  assert.equal(result.state, ReviewStabilizationState.TimedOut);
  assert.equal(feedbackInspections, 4);
});

test("stabilizeExactHeadReview bounds a stalled feedback request", async () => {
  let now = 0;
  const result = await stabilizeExactHeadReview({
    inspectFeedback: () => new Promise(() => {}),
    now: () => now,
    pollIntervalMs: 15,
    requestReview: async () => ({ headSha: "head-sha", settled: false }),
    timeoutMs: 30,
    waitMs: async (milliseconds) => {
      now += milliseconds;
    },
  });

  assert.equal(now, 0);
  assert.equal(result.state, ReviewStabilizationState.TimedOut);
});

test("stabilizeExactHeadReview bounds a stalled review request", async () => {
  let now = 0;
  const result = await stabilizeExactHeadReview({
    inspectFeedback: async () => cleanFeedback,
    now: () => now,
    pollIntervalMs: 15,
    requestReview: () => new Promise(() => {}),
    timeoutMs: 30,
    waitMs: async (milliseconds) => {
      now += milliseconds;
    },
  });

  assert.equal(now, 0);
  assert.equal(result.state, ReviewStabilizationState.TimedOut);
});
