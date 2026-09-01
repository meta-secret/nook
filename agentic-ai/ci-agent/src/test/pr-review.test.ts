import assert from "node:assert/strict";
import test from "node:test";

import {
  HeadTransitionObservationState,
  type PrFeedbackSummary,
  type PullRequestRevision,
} from "../main/github.js";
import {
  ExactHeadReviewFallback,
  ExactHeadReviewProvider,
} from "../main/github-review.js";
import {
  ReviewRequestState,
  ReviewStabilizationState,
  requestExactHeadReviewWithCircuitBreaker,
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
  headTransitionObserved: true,
  substantiveComments: 0,
  substantiveReviews: 0,
  unresolvedThreads: 0,
};

const revision: PullRequestRevision = {
  baseRef: "main",
  baseSha: "base-sha",
  headSha: "head-sha",
};
const observedBoundary = {
  state: HeadTransitionObservationState.Observed,
} as const;
const missingBoundary = {
  state: HeadTransitionObservationState.Missing,
} as const;

test("non-waiting review request honors the circuit breaker", async () => {
  const operations: string[] = [];
  let now = 0;
  let requests = 0;
  const result = await requestExactHeadReviewWithCircuitBreaker({
    ensureHeadTransition: async () => {
      operations.push("head-transition");
    },
    inspectFeedback: async () => {
      operations.push("feedback");
      return { ...cleanFeedback, findingBatches: 3 };
    },
    now: () => now,
    observeHeadTransition: async () => {
      operations.push("boundary");
      return observedBoundary;
    },
    pollIntervalMs: 5,
    readRevision: async () => revision,
    requestReview: async () => {
      operations.push("review");
      requests += 1;
      return {
        fallback: ExactHeadReviewFallback.None,
        headSha: "head-sha",
        provider: ExactHeadReviewProvider.Codex,
        requested: true,
        settled: false,
      };
    },
    timeoutMs: 20,
    waitMs: async (milliseconds) => {
      now += milliseconds;
    },
  });

  assert.equal(result.state, ReviewRequestState.CircuitBreaker);
  assert.equal(requests, 0);
  assert.deepEqual(operations, ["boundary", "feedback"]);
});

test("acknowledged stabilization permits a non-waiting review request", async () => {
  let now = 0;
  let requests = 0;
  const result = await requestExactHeadReviewWithCircuitBreaker({
    circuitBreakerAcknowledged: true,
    ensureHeadTransition: async () => {},
    inspectFeedback: async () => ({
      ...cleanFeedback,
      findingBatches: 3,
    }),
    now: () => now,
    observeHeadTransition: async () => observedBoundary,
    pollIntervalMs: 5,
    readRevision: async () => revision,
    requestReview: async () => {
      requests += 1;
      return {
        fallback: ExactHeadReviewFallback.None,
        headSha: "head-sha",
        provider: ExactHeadReviewProvider.Codex,
        requested: true,
        settled: false,
      };
    },
    timeoutMs: 20,
    waitMs: async (milliseconds) => {
      now += milliseconds;
    },
  });

  assert.equal(result.state, ReviewRequestState.Requested);
  assert.equal(requests, 1);
});

test("provider unavailability remains not-requested", async () => {
  const operations: string[] = [];
  let now = 0;
  const result = await requestExactHeadReviewWithCircuitBreaker({
    ensureHeadTransition: async () => {
      operations.push("head-transition");
    },
    inspectFeedback: async () => {
      operations.push("feedback");
      return cleanFeedback;
    },
    now: () => now,
    observeHeadTransition: async () => {
      operations.push("boundary");
      return observedBoundary;
    },
    pollIntervalMs: 5,
    readRevision: async () => revision,
    requestReview: async () => {
      operations.push("review");
      return {
        fallback: ExactHeadReviewFallback.CodexUsageLimit,
        headSha: "head-sha",
        provider: ExactHeadReviewProvider.Codex,
        requested: false,
        settled: false,
      };
    },
    timeoutMs: 20,
    waitMs: async (milliseconds) => {
      now += milliseconds;
    },
  });

  assert.equal(result.state, ReviewRequestState.NotRequested);
  assert.equal(result.requested, false);
  assert.deepEqual(operations, [
    "boundary",
    "feedback",
    "review",
  ]);
});

test("non-waiting review request waits only for the trusted boundary", async () => {
  const operations: string[] = [];
  let now = 0;
  let observations = 0;
  const result = await requestExactHeadReviewWithCircuitBreaker({
    ensureHeadTransition: async () => {
      operations.push("head-transition");
    },
    inspectFeedback: async () => {
      operations.push("feedback");
      return cleanFeedback;
    },
    now: () => now,
    observeHeadTransition: async () => {
      operations.push("boundary");
      observations += 1;
      return observations === 2 ? observedBoundary : missingBoundary;
    },
    pollIntervalMs: 5,
    readRevision: async () => revision,
    requestReview: async () => {
      operations.push("review");
      return {
        fallback: ExactHeadReviewFallback.None,
        headSha: "head-sha",
        provider: ExactHeadReviewProvider.Codex,
        requested: true,
        settled: false,
      };
    },
    timeoutMs: 20,
    waitMs: async (milliseconds) => {
      operations.push("wait");
      now += milliseconds;
    },
  });

  assert.equal(result.state, ReviewRequestState.Requested);
  assert.deepEqual(operations, [
    "boundary",
    "head-transition",
    "wait",
    "boundary",
    "feedback",
    "review",
  ]);
});

test("non-waiting review request fails truthfully when the trusted boundary is absent", async () => {
  let feedbackInspections = 0;
  let now = 0;
  let reviewRequests = 0;

  await assert.rejects(
    requestExactHeadReviewWithCircuitBreaker({
      ensureHeadTransition: async () => {},
      inspectFeedback: async () => {
        feedbackInspections += 1;
        return cleanFeedback;
      },
      now: () => now,
      observeHeadTransition: async () => missingBoundary,
      pollIntervalMs: 5,
      readRevision: async () => revision,
      requestReview: async () => {
        reviewRequests += 1;
        return {
          fallback: ExactHeadReviewFallback.None,
          headSha: "head-sha",
          provider: ExactHeadReviewProvider.Codex,
          requested: true,
          settled: false,
        };
      },
      timeoutMs: 10,
      waitMs: async (milliseconds) => {
        now += milliseconds;
      },
    }),
    /no feedback was inspected and no review was requested/,
  );
  assert.equal(feedbackInspections, 0);
  assert.equal(reviewRequests, 0);
});

test("non-waiting review request bounds a stalled boundary observation", async () => {
  let feedbackInspections = 0;
  let reviewRequests = 0;

  await assert.rejects(
    requestExactHeadReviewWithCircuitBreaker({
      ensureHeadTransition: async () => {},
      inspectFeedback: async () => {
        feedbackInspections += 1;
        return cleanFeedback;
      },
      now: () => Date.now(),
      observeHeadTransition: () => new Promise(() => {}),
      pollIntervalMs: 5,
      readRevision: async () => revision,
      requestReview: async () => {
        reviewRequests += 1;
        return {
          fallback: ExactHeadReviewFallback.None,
          headSha: "head-sha",
          provider: ExactHeadReviewProvider.Codex,
          requested: true,
          settled: false,
        };
      },
      timeoutMs: 10,
      waitMs: async () => {},
    }),
    /no feedback was inspected and no review was requested/,
  );
  assert.equal(feedbackInspections, 0);
  assert.equal(reviewRequests, 0);
});

test("non-waiting review request bounds a stalled boundary dispatch", async () => {
  let feedbackInspections = 0;
  let reviewRequests = 0;

  await assert.rejects(
    requestExactHeadReviewWithCircuitBreaker({
      ensureHeadTransition: () => new Promise(() => {}),
      inspectFeedback: async () => {
        feedbackInspections += 1;
        return cleanFeedback;
      },
      now: () => Date.now(),
      observeHeadTransition: async () => missingBoundary,
      pollIntervalMs: 5,
      readRevision: async () => revision,
      requestReview: async () => {
        reviewRequests += 1;
        return {
          fallback: ExactHeadReviewFallback.None,
          headSha: "head-sha",
          provider: ExactHeadReviewProvider.Codex,
          requested: true,
          settled: false,
        };
      },
      timeoutMs: 10,
      waitMs: async () => {},
    }),
    /backfill did not complete.*no feedback was inspected and no review was requested/,
  );
  assert.equal(feedbackInspections, 0);
  assert.equal(reviewRequests, 0);
});

test("non-waiting review request detects a revision change after feedback inspection", async () => {
  const changedRevision = { ...revision, headSha: "changed-head" };
  let reads = 0;
  let reviewRequests = 0;

  await assert.rejects(
    requestExactHeadReviewWithCircuitBreaker({
      ensureHeadTransition: async () => {},
      inspectFeedback: async () => cleanFeedback,
      now: () => 0,
      observeHeadTransition: async () => observedBoundary,
      pollIntervalMs: 5,
      readRevision: async () => {
        reads += 1;
        return reads === 1 ? revision : changedRevision;
      },
      requestReview: async () => {
        reviewRequests += 1;
        return {
          fallback: ExactHeadReviewFallback.None,
          headSha: "head-sha",
          provider: ExactHeadReviewProvider.Codex,
          requested: true,
          settled: false,
        };
      },
      timeoutMs: 20,
      waitMs: async () => {},
    }),
    /Pull request revision changed.*no review was requested/,
  );
  assert.equal(reviewRequests, 0);
});

test("non-waiting review request does not backfill an existing matching boundary", async () => {
  let backfills = 0;
  await requestExactHeadReviewWithCircuitBreaker({
    ensureHeadTransition: async () => {
      backfills += 1;
    },
    inspectFeedback: async () => cleanFeedback,
    now: () => 0,
    observeHeadTransition: async () => observedBoundary,
    pollIntervalMs: 5,
    readRevision: async () => revision,
    requestReview: async () => ({
      fallback: ExactHeadReviewFallback.None,
      headSha: "head-sha",
      provider: ExactHeadReviewProvider.Codex,
      requested: false,
      settled: true,
    }),
    timeoutMs: 20,
    waitMs: async () => {},
  });

  assert.equal(backfills, 0);
});

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

test("stabilizeExactHeadReview keeps the circuit open after findings are resolved", async () => {
  let requests = 0;
  const result = await stabilizeExactHeadReview({
    inspectFeedback: async () => ({
      ...cleanFeedback,
      findingBatches: 3,
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

test("stabilizeExactHeadReview reopens after comprehensive stabilization", async () => {
  const result = await stabilizeExactHeadReview({
    circuitBreakerAcknowledged: true,
    inspectFeedback: async () => ({
      ...cleanFeedback,
      findingBatches: 3,
    }),
    now: () => 0,
    pollIntervalMs: 15,
    requestReview: async () => ({ headSha: "head-sha", settled: true }),
    timeoutMs: 60,
    waitMs: async () => {},
  });

  assert.equal(result.state, ReviewStabilizationState.Clean);
});

test("stabilizeExactHeadReview keeps acknowledged findings actionable", async () => {
  const result = await stabilizeExactHeadReview({
    circuitBreakerAcknowledged: true,
    inspectFeedback: async () => ({
      ...cleanFeedback,
      findingBatches: 3,
      unresolvedThreads: 1,
    }),
    now: () => 0,
    pollIntervalMs: 15,
    requestReview: async () => ({ headSha: "head-sha", settled: true }),
    timeoutMs: 60,
    waitMs: async () => {},
  });

  assert.equal(result.state, ReviewStabilizationState.Findings);
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

test("stabilizeExactHeadReview still dispatches a zero-wait review request", async () => {
  let requests = 0;
  const result = await stabilizeExactHeadReview({
    inspectFeedback: async () => cleanFeedback,
    now: () => 0,
    pollIntervalMs: 15,
    requestReview: async () => {
      requests += 1;
      return { headSha: "head-sha", settled: false };
    },
    timeoutMs: 0,
    waitMs: async () => {},
  });

  assert.equal(requests, 1);
  assert.equal(result.state, ReviewStabilizationState.TimedOut);
});

test("stabilizeExactHeadReview classifies a review settled during zero-wait dispatch", async () => {
  let inspections = 0;
  const result = await stabilizeExactHeadReview({
    inspectFeedback: async () => {
      inspections += 1;
      return inspections === 1
        ? cleanFeedback
        : { ...cleanFeedback, unresolvedThreads: 1 };
    },
    now: () => 0,
    pollIntervalMs: 15,
    requestReview: async () => ({ headSha: "head-sha", settled: true }),
    timeoutMs: 0,
    waitMs: async () => {},
  });

  assert.equal(result.state, ReviewStabilizationState.Findings);
  assert.equal(result.feedback?.unresolvedThreads, 1);
  assert.equal(inspections, 2);
});

test("stabilizeExactHeadReview confirms clean settlement after thread indexing", async () => {
  let inspections = 0;
  let now = 0;
  const result = await stabilizeExactHeadReview({
    inspectFeedback: async () => {
      inspections += 1;
      return inspections < 3
        ? cleanFeedback
        : { ...cleanFeedback, unresolvedThreads: 1 };
    },
    now: () => now,
    pollIntervalMs: 15,
    requestReview: async () => ({ headSha: "head-sha", settled: true }),
    timeoutMs: 60,
    waitMs: async (milliseconds) => {
      now += milliseconds;
    },
  });

  assert.equal(inspections, 3);
  assert.equal(result.state, ReviewStabilizationState.Findings);
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

test("stabilizeExactHeadReview exposes pre-boundary actionable comments", async () => {
  let inspections = 0;
  let backfills = 0;
  const result = await stabilizeExactHeadReview({
    ensureHeadTransition: async () => {
      backfills += 1;
    },
    inspectFeedback: async () => {
      inspections += 1;
      return inspections === 1
        ? {
            ...cleanFeedback,
            headTransitionObserved: false,
            substantiveComments: 1,
          }
        : { ...cleanFeedback, currentIterationComments: 1 };
    },
    now: () => 0,
    pollIntervalMs: 15,
    requestReview: async () => ({ headSha: "head-sha", settled: true }),
    timeoutMs: 60,
    waitMs: async () => {},
  });

  assert.equal(inspections, 1);
  assert.equal(backfills, 0);
  assert.equal(result.state, ReviewStabilizationState.Findings);
});

test("stabilizeExactHeadReview backfills an existing open pull request once", async () => {
  let inspections = 0;
  let backfills = 0;
  const result = await stabilizeExactHeadReview({
    ensureHeadTransition: async () => {
      backfills += 1;
    },
    inspectFeedback: async () => {
      inspections += 1;
      return inspections === 1
        ? { ...cleanFeedback, headTransitionObserved: false }
        : cleanFeedback;
    },
    now: () => 0,
    pollIntervalMs: 15,
    requestReview: async () => ({ headSha: "head-sha", settled: true }),
    timeoutMs: 60,
    waitMs: async () => {},
  });

  assert.equal(backfills, 1);
  assert.equal(result.state, ReviewStabilizationState.Clean);
});

test("stabilizeExactHeadReview fails closed when comments cannot be assigned before timeout", async () => {
  let backfills = 0;
  const result = await stabilizeExactHeadReview({
    ensureHeadTransition: async () => {
      backfills += 1;
    },
    inspectFeedback: async () => ({
      ...cleanFeedback,
      headTransitionObserved: false,
      substantiveComments: 1,
    }),
    now: () => 0,
    pollIntervalMs: 15,
    requestReview: async () => ({ headSha: "head-sha", settled: false }),
    timeoutMs: 0,
    waitMs: async () => {},
  });

  assert.equal(result.state, ReviewStabilizationState.Findings);
  assert.equal(result.feedback?.substantiveComments, 1);
  assert.equal(backfills, 0);
});

test("stabilizeExactHeadReview permits a comment-free pending boundary to time out", async () => {
  const result = await stabilizeExactHeadReview({
    inspectFeedback: async () => ({
      ...cleanFeedback,
      headTransitionObserved: false,
    }),
    now: () => 0,
    pollIntervalMs: 15,
    requestReview: async () => ({ headSha: "head-sha", settled: false }),
    timeoutMs: 0,
    waitMs: async () => {},
  });

  assert.equal(result.state, ReviewStabilizationState.TimedOut);
});

test("stabilizeExactHeadReview stops waiting after an explicit usage limit", async () => {
  let inspections = 0;
  let requests = 0;
  const result = await stabilizeExactHeadReview({
    inspectFeedback: async () => {
      inspections += 1;
      return {
        ...cleanFeedback,
        codexReview: { ...cleanFeedback.codexReview, settled: false },
      };
    },
    now: () => 0,
    pollIntervalMs: 15,
    requestReview: async () => {
      requests += 1;
      return {
        fallback: ExactHeadReviewFallback.CodexUsageLimit,
        headSha: "head-sha",
        settled: false,
      };
    },
    timeoutMs: 600_000,
    waitMs: async () => {},
  });

  assert.equal(inspections, 2);
  assert.equal(requests, 1);
  assert.equal(result.state, ReviewStabilizationState.TimedOut);
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

test("stabilizeExactHeadReview waits for feedback to observe settlement", async () => {
  let inspections = 0;
  const unsettledFeedback: PrFeedbackSummary = {
    ...cleanFeedback,
    codexReview: { ...cleanFeedback.codexReview, settled: false },
  };
  const result = await stabilizeExactHeadReview({
    inspectFeedback: async () => {
      inspections += 1;
      return inspections < 3
        ? unsettledFeedback
        : { ...unsettledFeedback, unresolvedThreads: 1 };
    },
    now: () => 0,
    pollIntervalMs: 15,
    requestReview: async () => ({ headSha: "head-sha", settled: true }),
    timeoutMs: 60,
    waitMs: async () => {},
  });

  assert.equal(inspections, 3);
  assert.equal(result.state, ReviewStabilizationState.Findings);
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
