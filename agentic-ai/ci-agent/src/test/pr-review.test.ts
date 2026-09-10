import { assertSuccess, assertAsyncFailure } from "./result-assertions.js";
import { ok, err } from "neverthrow";
import { CiFailureKind } from "../main/failure.js";
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
  PullRequestReviewRequestExactHeadReviewWithCircuitBreaker,
  PullRequestReviewStabilizeExactHeadReview,
} from "../main/pr-review.js";

class PrReviewRequestInput {
  constructor(private readonly request: Partial<RequestInput> = {}) {}
  execute(): RequestInput {
    const overrides = this.request;

    return {
      inspectFeedback: async () => ok(cleanFeedback),
      now: () => Date.now(),
      readRevision: async () => ok(revision),
      requestReview: async () =>
        ok({
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
}

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
  unhandledComments: 0,
  unthreadedReviewFindings: 0,
  unresolvedThreads: 0,
};

const revision: PullRequestRevision = {
  baseRef: "main",
  baseSha: "base-sha",
  headSha: "head-sha",
};
type RequestInput = ConstructorParameters<
  typeof PullRequestReviewRequestExactHeadReviewWithCircuitBreaker
>[0];

test("review request honors the circuit breaker across all comments", async () => {
  let requests = 0;
  const result =
    await new PullRequestReviewRequestExactHeadReviewWithCircuitBreaker(
      new PrReviewRequestInput({
        inspectFeedback: async () =>
          ok({
            ...cleanFeedback,
            findingBatches: 3,
            substantiveComments: 1,
          }),
        requestReview: async () => {
          requests += 1;
          return ok({
            fallback: ExactHeadReviewFallback.None,
            headSha: revision.headSha,
            provider: ExactHeadReviewProvider.Codex,
            requested: true,
            settled: false,
          });
        },
      }).execute(),
    )
      .execute()
      .then(assertSuccess);
  assert.equal(result.state, ReviewRequestState.CircuitBreaker);
  assert.equal(requests, 0);
});

test("acknowledged stabilization permits a review request", async () => {
  let requests = 0;
  const result =
    await new PullRequestReviewRequestExactHeadReviewWithCircuitBreaker(
      new PrReviewRequestInput({
        circuitBreakerAcknowledged: true,
        inspectFeedback: async () =>
          ok({
            ...cleanFeedback,
            findingBatches: 3,
          }),
        requestReview: async () => {
          requests += 1;
          return ok({
            fallback: ExactHeadReviewFallback.None,
            headSha: revision.headSha,
            provider: ExactHeadReviewProvider.Codex,
            requested: true,
            settled: false,
          });
        },
      }).execute(),
    )
      .execute()
      .then(assertSuccess);

  assert.equal(result.state, ReviewRequestState.Requested);
  assert.equal(requests, 1);
});

test("provider unavailability remains not-requested", async () => {
  const result =
    await new PullRequestReviewRequestExactHeadReviewWithCircuitBreaker(
      new PrReviewRequestInput({
        requestReview: async () =>
          ok({
            fallback: ExactHeadReviewFallback.CodexUsageLimit,
            headSha: revision.headSha,
            provider: ExactHeadReviewProvider.Codex,
            requested: false,
            settled: false,
          }),
      }).execute(),
    )
      .execute()
      .then(assertSuccess);
  assert.equal(result.state, ReviewRequestState.NotRequested);
  assert.equal(result.requested, false);
});

test("review request detects revision drift after feedback inspection", async () => {
  let reads = 0;
  let requests = 0;
  await assertAsyncFailure(
    new PullRequestReviewRequestExactHeadReviewWithCircuitBreaker(
      new PrReviewRequestInput({
        readRevision: async () => {
          reads += 1;
          return ok(
            reads === 1 ? revision : { ...revision, headSha: "changed-head" },
          );
        },
        requestReview: async () => {
          requests += 1;
          return ok({
            fallback: ExactHeadReviewFallback.None,
            headSha: revision.headSha,
            provider: ExactHeadReviewProvider.Codex,
            requested: true,
            settled: false,
          });
        },
      }).execute(),
    ).execute(),
    /Pull request revision changed.*no review was requested/,
  );
  assert.equal(requests, 0);
});

test("review request bounds stalled feedback inspection", async () => {
  const signals: AbortSignal[] = [];
  let requests = 0;
  await assertAsyncFailure(
    new PullRequestReviewRequestExactHeadReviewWithCircuitBreaker(
      new PrReviewRequestInput({
        inspectFeedback: (_revision, signal) => {
          signals.push(signal);
          return new Promise(() => {});
        },
        requestReview: async () => {
          requests += 1;
          return ok({
            fallback: ExactHeadReviewFallback.None,
            headSha: revision.headSha,
            provider: ExactHeadReviewProvider.Codex,
            requested: true,
            settled: false,
          });
        },
        timeoutMs: 10,
      }).execute(),
    ).execute(),
    /feedback inspection did not complete.*without a confirmed review outcome/,
  );
  assert.equal(signals[0]?.aborted, true);
  assert.equal(requests, 0);
});

test("review request bounds stalled revision verification", async () => {
  const signals: AbortSignal[] = [];
  let reads = 0;
  await assertAsyncFailure(
    new PullRequestReviewRequestExactHeadReviewWithCircuitBreaker(
      new PrReviewRequestInput({
        readRevision: (signal) => {
          reads += 1;
          if (reads === 1) return Promise.resolve(ok(revision));
          signals.push(signal);
          return new Promise(() => {});
        },
        timeoutMs: 10,
      }).execute(),
    ).execute(),
    /revision verification did not complete.*without a confirmed review outcome/,
  );
  assert.equal(signals[0]?.aborted, true);
});

test("review request bounds a stalled provider request", async () => {
  const signals: AbortSignal[] = [];
  await assertAsyncFailure(
    new PullRequestReviewRequestExactHeadReviewWithCircuitBreaker(
      new PrReviewRequestInput({
        requestReview: (_revision, signal) => {
          signals.push(signal);
          return new Promise(() => {});
        },
        timeoutMs: 10,
      }).execute(),
    ).execute(),
    /review request did not complete.*without a confirmed review outcome/,
  );
  assert.equal(signals[0]?.aborted, true);
});

test("stabilizeExactHeadReview waits once and accepts clean feedback", async () => {
  let now = 0;
  let requests = 0;
  const result = await new PullRequestReviewStabilizeExactHeadReview({
    inspectFeedback: async () => ok(cleanFeedback),
    now: () => now,
    pollIntervalMs: 15,
    requestReview: async () => {
      requests += 1;
      return ok({ headSha: "head-sha", settled: requests > 1 });
    },
    timeoutMs: 60,
    waitMs: async (milliseconds) => {
      now += milliseconds;
    },
  }).execute();

  assert.equal(requests, 2);
  assert.equal(result.state, ReviewStabilizationState.Clean);
  assert.equal(result.headSha, "head-sha");
});

test("stabilizeExactHeadReview rejects settled actionable feedback", async () => {
  const result = await new PullRequestReviewStabilizeExactHeadReview({
    inspectFeedback: async () =>
      ok({
        ...cleanFeedback,
        substantiveReviews: 1,
        unresolvedThreads: 2,
      }),
    now: () => 0,
    pollIntervalMs: 15,
    requestReview: async () => ok({ headSha: "head-sha", settled: true }),
    timeoutMs: 60,
    waitMs: async () => {},
  }).execute();

  assert.equal(result.state, ReviewStabilizationState.Findings);
  assert.equal(result.feedback?.unresolvedThreads, 2);
});

test("stabilizeExactHeadReview opens the circuit after three finding batches", async () => {
  let requests = 0;
  const result = await new PullRequestReviewStabilizeExactHeadReview({
    inspectFeedback: async () =>
      ok({
        ...cleanFeedback,
        findingBatches: 3,
        unresolvedThreads: 1,
      }),
    now: () => 0,
    pollIntervalMs: 15,
    requestReview: async () => {
      requests += 1;
      return ok({ headSha: "head-sha", settled: true });
    },
    timeoutMs: 60,
    waitMs: async () => {},
  }).execute();

  assert.equal(result.state, ReviewStabilizationState.CircuitBreaker);
  assert.equal(requests, 0);
});

test("stabilizeExactHeadReview keeps the circuit open after findings are resolved", async () => {
  let requests = 0;
  const result = await new PullRequestReviewStabilizeExactHeadReview({
    inspectFeedback: async () =>
      ok({
        ...cleanFeedback,
        findingBatches: 3,
      }),
    now: () => 0,
    pollIntervalMs: 15,
    requestReview: async () => {
      requests += 1;
      return ok({ headSha: "head-sha", settled: true });
    },
    timeoutMs: 60,
    waitMs: async () => {},
  }).execute();

  assert.equal(result.state, ReviewStabilizationState.CircuitBreaker);
  assert.equal(requests, 0);
});

test("stabilizeExactHeadReview reopens after comprehensive stabilization", async () => {
  const result = await new PullRequestReviewStabilizeExactHeadReview({
    circuitBreakerAcknowledged: true,
    inspectFeedback: async () =>
      ok({
        ...cleanFeedback,
        findingBatches: 3,
      }),
    now: () => 0,
    pollIntervalMs: 15,
    requestReview: async () => ok({ headSha: "head-sha", settled: true }),
    timeoutMs: 60,
    waitMs: async () => {},
  }).execute();

  assert.equal(result.state, ReviewStabilizationState.Clean);
});

test("stabilizeExactHeadReview keeps acknowledged findings actionable", async () => {
  const result = await new PullRequestReviewStabilizeExactHeadReview({
    circuitBreakerAcknowledged: true,
    inspectFeedback: async () =>
      ok({
        ...cleanFeedback,
        findingBatches: 3,
        unresolvedThreads: 1,
      }),
    now: () => 0,
    pollIntervalMs: 15,
    requestReview: async () => ok({ headSha: "head-sha", settled: true }),
    timeoutMs: 60,
    waitMs: async () => {},
  }).execute();

  assert.equal(result.state, ReviewStabilizationState.Findings);
});

test("stabilizeExactHeadReview keeps old top-level comments actionable", async () => {
  const result = await new PullRequestReviewStabilizeExactHeadReview({
    inspectFeedback: async () =>
      ok({
        ...cleanFeedback,
        substantiveComments: 4,
        unhandledComments: 4,
      }),
    now: () => 0,
    pollIntervalMs: 15,
    requestReview: async () => ok({ headSha: "head-sha", settled: true }),
    timeoutMs: 60,
    waitMs: async () => {},
  }).execute();

  assert.equal(result.state, ReviewStabilizationState.Findings);
});

test("stabilizeExactHeadReview permits validation after the bounded timeout", async () => {
  let now = 0;
  let feedbackInspections = 0;
  const result = await new PullRequestReviewStabilizeExactHeadReview({
    inspectFeedback: async () => {
      feedbackInspections += 1;
      return ok(cleanFeedback);
    },
    now: () => now,
    pollIntervalMs: 15,
    requestReview: async () => ok({ headSha: "head-sha", settled: false }),
    timeoutMs: 30,
    waitMs: async (milliseconds) => {
      now += milliseconds;
    },
  }).execute();

  assert.equal(result.state, ReviewStabilizationState.TimedOut);
  assert.equal(feedbackInspections, 3);
});

test("stabilizeExactHeadReview stops on findings discovered at timeout", async () => {
  let now = 0;
  const result = await new PullRequestReviewStabilizeExactHeadReview({
    inspectFeedback: async () =>
      ok({
        ...cleanFeedback,
        unresolvedThreads: 1,
      }),
    now: () => now,
    pollIntervalMs: 15,
    requestReview: async () => ok({ headSha: "head-sha", settled: false }),
    timeoutMs: 0,
    waitMs: async (milliseconds) => {
      now += milliseconds;
    },
  }).execute();

  assert.equal(result.state, ReviewStabilizationState.Findings);
  assert.equal(result.feedback?.unresolvedThreads, 1);
});

test("stabilizeExactHeadReview reinspects a review settled at the deadline", async () => {
  let now = 30;
  let inspections = 0;
  const result = await new PullRequestReviewStabilizeExactHeadReview({
    inspectFeedback: async () => {
      inspections += 1;
      return ok(
        inspections === 1
          ? cleanFeedback
          : { ...cleanFeedback, unresolvedThreads: 1 },
      );
    },
    now: () => now,
    pollIntervalMs: 15,
    requestReview: async () => {
      now = 31;
      return ok({ headSha: "head-sha", settled: true });
    },
    timeoutMs: 1,
    waitMs: async () => {},
  }).execute();

  assert.equal(result.state, ReviewStabilizationState.Findings);
  assert.equal(result.feedback?.unresolvedThreads, 1);
  assert.equal(inspections, 2);
});

test("stabilizeExactHeadReview preserves a bounded zero-wait feedback snapshot", async () => {
  const result = await new PullRequestReviewStabilizeExactHeadReview({
    inspectFeedback: () =>
      new Promise((resolve) => {
        setTimeout(
          () => resolve(ok({ ...cleanFeedback, unresolvedThreads: 1 })),
          5,
        );
      }),
    now: () => 0,
    pollIntervalMs: 15,
    requestReview: async () => ok({ headSha: "head-sha", settled: false }),
    timeoutMs: 0,
    waitMs: async () => {},
  }).execute();

  assert.equal(result.state, ReviewStabilizationState.Findings);
  assert.equal(result.feedback?.unresolvedThreads, 1);
});

test("stabilizeExactHeadReview does not dispatch a zero-wait review request", async () => {
  let requests = 0;
  const result = await new PullRequestReviewStabilizeExactHeadReview({
    inspectFeedback: async () => ok(cleanFeedback),
    now: () => 0,
    pollIntervalMs: 15,
    requestReview: async () => {
      requests += 1;
      return ok({ headSha: "head-sha", settled: false });
    },
    timeoutMs: 0,
    waitMs: async () => {},
  }).execute();

  assert.equal(requests, 0);
  assert.equal(result.state, ReviewStabilizationState.Clean);
});

test("stabilizeExactHeadReview performs one zero-wait feedback inspection", async () => {
  let inspections = 0;
  const result = await new PullRequestReviewStabilizeExactHeadReview({
    inspectFeedback: async () => {
      inspections += 1;
      return ok(cleanFeedback);
    },
    now: () => 0,
    pollIntervalMs: 15,
    requestReview: async () => ok({ headSha: "head-sha", settled: false }),
    timeoutMs: 0,
    waitMs: async () => {},
  }).execute();

  assert.equal(result.state, ReviewStabilizationState.Clean);
  assert.equal(inspections, 1);
});

test("stabilizeExactHeadReview confirms clean settlement after thread indexing", async () => {
  let inspections = 0;
  let now = 0;
  const result = await new PullRequestReviewStabilizeExactHeadReview({
    inspectFeedback: async () => {
      inspections += 1;
      return ok(
        inspections < 3
          ? cleanFeedback
          : { ...cleanFeedback, unresolvedThreads: 1 },
      );
    },
    now: () => now,
    pollIntervalMs: 15,
    requestReview: async () => ok({ headSha: "head-sha", settled: true }),
    timeoutMs: 60,
    waitMs: async (milliseconds) => {
      now += milliseconds;
    },
  }).execute();

  assert.equal(inspections, 3);
  assert.equal(result.state, ReviewStabilizationState.Findings);
});

test("stabilizeExactHeadReview stops waiting after an explicit usage limit", async () => {
  let inspections = 0;
  let requests = 0;
  const result = await new PullRequestReviewStabilizeExactHeadReview({
    inspectFeedback: async () => {
      inspections += 1;
      return ok({
        ...cleanFeedback,
        codexReview: { ...cleanFeedback.codexReview, settled: false },
      });
    },
    now: () => 0,
    pollIntervalMs: 15,
    requestReview: async () => {
      requests += 1;
      return ok({
        fallback: ExactHeadReviewFallback.CodexUsageLimit,
        headSha: "head-sha",
        settled: false,
      });
    },
    timeoutMs: 600_000,
    waitMs: async () => {},
  }).execute();

  assert.equal(inspections, 2);
  assert.equal(requests, 1);
  assert.equal(result.state, ReviewStabilizationState.TimedOut);
});

test("stabilizeExactHeadReview bounds transient request errors", async () => {
  let now = 0;
  let requests = 0;
  const result = await new PullRequestReviewStabilizeExactHeadReview({
    inspectFeedback: async () => ok(cleanFeedback),
    now: () => now,
    pollIntervalMs: 15,
    requestReview: async () => {
      requests += 1;
      return err({
        kind: CiFailureKind.Github,
        message: "transient GitHub failure",
      });
    },
    timeoutMs: 30,
    waitMs: async (milliseconds) => {
      now += milliseconds;
    },
  }).execute();

  assert.equal(requests, 2);
  assert.equal(result.state, ReviewStabilizationState.TimedOut);
  assert.equal(result.headSha, "");
});

test("stabilizeExactHeadReview bounds feedback errors after review settles", async () => {
  let now = 0;
  let feedbackInspections = 0;
  const result = await new PullRequestReviewStabilizeExactHeadReview({
    inspectFeedback: async () => {
      feedbackInspections += 1;
      return err({
        kind: CiFailureKind.Github,
        message: "review threads unavailable",
      });
    },
    now: () => now,
    pollIntervalMs: 15,
    requestReview: async () => ok({ headSha: "head-sha", settled: true }),
    timeoutMs: 30,
    waitMs: async (milliseconds) => {
      now += milliseconds;
    },
  }).execute();

  assert.equal(result.state, ReviewStabilizationState.TimedOut);
  assert.equal(feedbackInspections, 4);
});

test("stabilizeExactHeadReview waits for feedback to observe settlement", async () => {
  let inspections = 0;
  const unsettledFeedback: PrFeedbackSummary = {
    ...cleanFeedback,
    codexReview: { ...cleanFeedback.codexReview, settled: false },
  };
  const result = await new PullRequestReviewStabilizeExactHeadReview({
    inspectFeedback: async () => {
      inspections += 1;
      return ok(
        inspections < 3
          ? unsettledFeedback
          : { ...unsettledFeedback, unresolvedThreads: 1 },
      );
    },
    now: () => 0,
    pollIntervalMs: 15,
    requestReview: async () => ok({ headSha: "head-sha", settled: true }),
    timeoutMs: 60,
    waitMs: async () => {},
  }).execute();

  assert.equal(inspections, 3);
  assert.equal(result.state, ReviewStabilizationState.Findings);
});

test("stabilizeExactHeadReview bounds a stalled feedback request", async () => {
  let now = 0;
  const signals: AbortSignal[] = [];
  const result = await new PullRequestReviewStabilizeExactHeadReview({
    inspectFeedback: (signal) => {
      signals.push(signal);
      return new Promise(() => {});
    },
    now: () => now,
    pollIntervalMs: 15,
    requestReview: async () => ok({ headSha: "head-sha", settled: false }),
    timeoutMs: 30,
    waitMs: async (milliseconds) => {
      now += milliseconds;
    },
  }).execute();

  assert.equal(now, 0);
  assert.equal(signals[0]?.aborted, true);
  assert.equal(result.state, ReviewStabilizationState.TimedOut);
});

test("stabilizeExactHeadReview bounds a stalled review request", async () => {
  let now = 0;
  let requests = 0;
  const signals: AbortSignal[] = [];
  const result = await new PullRequestReviewStabilizeExactHeadReview({
    inspectFeedback: async () => ok(cleanFeedback),
    now: () => now,
    pollIntervalMs: 15,
    requestReview: (signal) => {
      requests += 1;
      signals.push(signal);
      return new Promise(() => {});
    },
    timeoutMs: 30,
    waitMs: async (milliseconds) => {
      now += milliseconds;
    },
  }).execute();

  assert.equal(now, 0);
  assert.equal(requests, 1);
  assert.equal(signals[0]?.aborted, true);
  assert.equal(result.state, ReviewStabilizationState.TimedOut);
});
