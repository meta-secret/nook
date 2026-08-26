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
    waitMs: async () => undefined,
  });

  assert.equal(result.state, ReviewStabilizationState.Findings);
  assert.equal(result.feedback?.unresolvedThreads, 2);
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
    waitMs: async () => undefined,
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
  assert.equal(feedbackInspections, 0);
});
