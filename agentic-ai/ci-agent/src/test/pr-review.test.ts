import assert from "node:assert/strict";
import test from "node:test";

import {
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
  findingBatches: 0,
  substantiveComments: 0,
  substantiveReviews: 0,
  unresolvedThreads: 0,
};

const revision: PullRequestRevision = {
  baseRef: "main",
  baseSha: "base-sha",
  headSha: "head-sha",
};
type RequestInput = Parameters<
  typeof requestExactHeadReviewWithCircuitBreaker
>[0];

function requestInput(overrides: Partial<RequestInput> = {}): RequestInput {
  return {
    inspectFeedback: async () => cleanFeedback,
    now: () => Date.now(),
    readRevision: async () => revision,
    requestReview: async () => ({
      fallback: ExactHeadReviewFallback.None,
      headSha: revision.headSha,
      provider: ExactHeadReviewProvider.Codex,
      requested: true,
      settled: false,
    }),
    timeoutMs: 50,
    ...overrides,
  };
}

test("review request honors the circuit breaker across all comments", async () => {
  let requests = 0;
  const result = await requestExactHeadReviewWithCircuitBreaker(
    requestInput({
      inspectFeedback: async () => ({
        ...cleanFeedback,
        findingBatches: 3,
        substantiveComments: 1,
      }),
      requestReview: async () => {
        requests += 1;
        return {
          fallback: ExactHeadReviewFallback.None,
          headSha: revision.headSha,
          provider: ExactHeadReviewProvider.Codex,
          requested: true,
          settled: false,
        };
      },
    }),
  );
  assert.equal(result.state, ReviewRequestState.CircuitBreaker);
  assert.equal(requests, 0);
});

test("acknowledged stabilization permits a review request", async () => {
  let requests = 0;
  const result = await requestExactHeadReviewWithCircuitBreaker(
    requestInput({
      circuitBreakerAcknowledged: true,
      inspectFeedback: async () => ({
        ...cleanFeedback,
        findingBatches: 3,
      }),
      requestReview: async () => {
        requests += 1;
        return {
          fallback: ExactHeadReviewFallback.None,
          headSha: revision.headSha,
          provider: ExactHeadReviewProvider.Codex,
          requested: true,
          settled: false,
        };
      },
    }),
  );

  assert.equal(result.state, ReviewRequestState.Requested);
  assert.equal(requests, 1);
});

test("provider unavailability remains not-requested", async () => {
  const result = await requestExactHeadReviewWithCircuitBreaker(
    requestInput({
      requestReview: async () => ({
        fallback: ExactHeadReviewFallback.CodexUsageLimit,
        headSha: revision.headSha,
        provider: ExactHeadReviewProvider.Codex,
        requested: false,
        settled: false,
      }),
    }),
  );
  assert.equal(result.state, ReviewRequestState.NotRequested);
  assert.equal(result.requested, false);
});

test("review request detects revision drift after feedback inspection", async () => {
  let reads = 0;
  let requests = 0;
  await assert.rejects(
    requestExactHeadReviewWithCircuitBreaker(
      requestInput({
        readRevision: async () => {
          reads += 1;
          return reads === 1 ? revision : { ...revision, headSha: "changed-head" };
        },
        requestReview: async () => {
          requests += 1;
          return {
            fallback: ExactHeadReviewFallback.None,
            headSha: revision.headSha,
            provider: ExactHeadReviewProvider.Codex,
            requested: true,
            settled: false,
          };
        },
      }),
    ),
    /Pull request revision changed.*no review was requested/,
  );
  assert.equal(requests, 0);
});

test("review request bounds stalled feedback inspection", async () => {
  const signals: AbortSignal[] = [];
  let requests = 0;
  await assert.rejects(
    requestExactHeadReviewWithCircuitBreaker(
      requestInput({
        inspectFeedback: (_revision, signal) => {
          signals.push(signal);
          return new Promise(() => {});
        },
        requestReview: async () => {
          requests += 1;
          return {
            fallback: ExactHeadReviewFallback.None,
            headSha: revision.headSha,
            provider: ExactHeadReviewProvider.Codex,
            requested: true,
            settled: false,
          };
        },
        timeoutMs: 10,
      }),
    ),
    /feedback inspection did not complete.*without a confirmed review outcome/,
  );
  assert.equal(signals[0]?.aborted, true);
  assert.equal(requests, 0);
});

test("review request bounds stalled revision verification", async () => {
  const signals: AbortSignal[] = [];
  let reads = 0;
  await assert.rejects(
    requestExactHeadReviewWithCircuitBreaker(
      requestInput({
        readRevision: (signal) => {
          reads += 1;
          if (reads === 1) return Promise.resolve(revision);
          signals.push(signal);
          return new Promise(() => {});
        },
        timeoutMs: 10,
      }),
    ),
    /revision verification did not complete.*without a confirmed review outcome/,
  );
  assert.equal(signals[0]?.aborted, true);
});

test("review request bounds a stalled provider request", async () => {
  const signals: AbortSignal[] = [];
  await assert.rejects(
    requestExactHeadReviewWithCircuitBreaker(
      requestInput({
        requestReview: (_revision, signal) => {
          signals.push(signal);
          return new Promise(() => {});
        },
        timeoutMs: 10,
      }),
    ),
    /review request did not complete.*without a confirmed review outcome/,
  );
  assert.equal(signals[0]?.aborted, true);
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

test("stabilizeExactHeadReview keeps old top-level comments actionable", async () => {
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

  assert.equal(result.state, ReviewStabilizationState.Findings);
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
