import {
  DEFAULT_REVIEW_CLOCK,
  ExactHeadReviewFallback,
  ExactHeadReviewRevisionState,
  GitHubReviewClient,
  type ExactHeadReviewRequestResult,
} from "./github-review.js";
import {
  PullRequestRevisionConstraint,
  GitHubEnvironment,
  GitHubClient,
  GitHubRepositoryName,
  type PullRequestRevision,
  type PrFeedbackSummary,
} from "./github.js";
import { JsonDocument } from "./json.js";
export class ReviewCommandEnvironment {
  constructor(private readonly environment: NodeJS.ProcessEnv) {}
  async runPrReviewRequest(): Promise<void> {
    const { prNumber, repository } = this.readReviewContext();
    const octokit = new GitHubEnvironment(process.env).createOctokit();
    const repoRef = new GitHubRepositoryName(repository).parse();
    const result =
      await new PullRequestReviewRequestExactHeadReviewWithCircuitBreaker({
        circuitBreakerAcknowledged: this.readCircuitBreakerAcknowledgement(),
        inspectFeedback: (revision, signal) =>
          new GitHubClient(octokit).inspectPrFeedback({
            repoRef: repoRef,
            prNumber: prNumber,
            options: {
              expectedRevision: revision,
              signal,
            },
          }),
        now: () => Date.now(),
        readRevision: (signal) =>
          new GitHubClient(octokit).readPullRequestRevision({
            repoRef: repoRef,
            prNumber: prNumber,
            signal: signal,
          }),
        requestReview: (revision, signal) =>
          new GitHubReviewClient(octokit).requestExactHeadReview({
            repoRef: repoRef,
            prNumber: prNumber,
            options: {
              revision: {
                revision,
                state: ExactHeadReviewRevisionState.Bound,
              },
              signal,
            },
          }),
        timeoutMs: REVIEW_REQUEST_TIMEOUT_MS,
      }).execute();
    console.log(
      new JsonDocument({
        number: prNumber,
        repository,
        ...result,
      }).format(),
    );
    if (result.state === ReviewRequestState.CircuitBreaker) {
      throw new Error(
        `PR #${prNumber} has reached three Cloud-review finding batches; no new review was requested before comprehensive stabilization`,
      );
    }
  }

  async runPrReviewStabilization(): Promise<void> {
    const { prNumber, repository } = this.readReviewContext();
    const waitSeconds = this.readWaitSeconds();
    const octokit = new GitHubEnvironment(process.env).createOctokit();
    const repoRef = new GitHubRepositoryName(repository).parse();
    const result = await new PullRequestReviewStabilizeExactHeadReview({
      circuitBreakerAcknowledged: this.readCircuitBreakerAcknowledgement(),
      inspectFeedback: (signal) =>
        new GitHubClient(octokit).inspectPrFeedback({
          repoRef: repoRef,
          prNumber: prNumber,
          options: { signal },
        }),
      now: () => Date.now(),
      pollIntervalMs: STABILIZATION_POLL_INTERVAL_MS,
      requestReview: (signal) =>
        new GitHubReviewClient(octokit).requestExactHeadReview({
          repoRef: repoRef,
          prNumber: prNumber,
          options: { signal },
        }),
      timeoutMs: waitSeconds * 1000,
      waitMs: DEFAULT_REVIEW_CLOCK.waitMs,
    }).execute();
    console.log(
      new JsonDocument({
        number: prNumber,
        repository,
        waitSeconds,
        ...result,
      }).format(),
    );
    if (result.state === ReviewStabilizationState.Findings) {
      throw new Error(
        `PR #${prNumber} has current-head review findings; batch them with hosted validation failures`,
      );
    }
    if (result.state === ReviewStabilizationState.CircuitBreaker) {
      throw new Error(
        `PR #${prNumber} has reached three Cloud-review finding batches; stop the review rerun loop and perform comprehensive stabilization before another review request`,
      );
    }
    if (result.state === ReviewStabilizationState.TimedOut) {
      if (waitSeconds === 0) {
        console.log(
          "::notice::Exact-head review is not settled in the bounded feedback snapshot; pr:ready remains the final feedback authority.",
        );
        return;
      }
      console.log(
        `::warning::Exact-head review did not settle within ${waitSeconds}s; hosted validation remains independent of review availability.`,
      );
    }
  }

  readCircuitBreakerAcknowledgement(): boolean {
    const [value = "0"] = [
      this.environment.REVIEW_CIRCUIT_BREAKER_ACKNOWLEDGED?.trim(),
    ];
    if (value !== "0" && value !== "1") {
      throw new Error(
        `REVIEW_CIRCUIT_BREAKER_ACKNOWLEDGED must be 0 or 1 (received ${value})`,
      );
    }
    return value === "1";
  }

  readReviewContext(): { prNumber: number; repository: string } {
    const repository = this.environment.GITHUB_REPOSITORY?.trim();
    if (!repository) {
      throw new Error("GITHUB_REPOSITORY is required");
    }
    const [rawPrNumber = ""] = [this.environment.PR_NUMBER?.trim()];
    const prNumber = Number(rawPrNumber);
    if (!Number.isInteger(prNumber) || prNumber <= 0) {
      throw new Error(
        `PR_NUMBER must be a positive integer (received ${rawPrNumber || "empty"})`,
      );
    }
    return { prNumber, repository };
  }

  readWaitSeconds(): number {
    const rawWaitSeconds =
      this.environment.REVIEW_WAIT_SECONDS?.trim() ||
      String(DEFAULT_STABILIZATION_WAIT_SECONDS);
    const waitSeconds = Number(rawWaitSeconds);
    if (
      !Number.isInteger(waitSeconds) ||
      waitSeconds < 0 ||
      waitSeconds > 3600
    ) {
      throw new Error(
        `REVIEW_WAIT_SECONDS must be an integer from 0 through 3600 (received ${rawWaitSeconds})`,
      );
    }
    return waitSeconds;
  }
}

export class PullRequestReviewRequestExactHeadReviewWithCircuitBreaker {
  constructor(private readonly request: ReviewRequestInput) {}
  async execute(): Promise<ReviewRequestResult> {
    const input = this.request;

    const deadline = input.now() + input.timeoutMs;
    const revision = await new PullRequestReviewRequireBeforeDeadline({
      deadline,
      input,
      operation: input.readRevision,
      phase: "initial revision inspection",
    }).execute();
    const feedback = await new PullRequestReviewRequireBeforeDeadline({
      deadline,
      input,
      operation: (signal) => input.inspectFeedback(revision, signal),
      phase: "feedback inspection",
    }).execute();
    const [defaulted1 = false] = [input.circuitBreakerAcknowledged];
    if (
      new PullRequestReviewClassifyFeedbackState({
        feedback: feedback,
        circuitBreakerAcknowledged: defaulted1,
      }).execute() === FeedbackClassificationState.CircuitBreaker
    ) {
      return { feedback, state: ReviewRequestState.CircuitBreaker };
    }
    const currentRevision = await new PullRequestReviewRequireBeforeDeadline({
      deadline,
      input,
      operation: input.readRevision,
      phase: "revision verification",
    }).execute();
    new PullRequestRevisionConstraint({
      expected: revision,
      actual: currentRevision,
    }).enforce();
    const result = await new PullRequestReviewRequireBeforeDeadline({
      deadline,
      input,
      operation: (signal) => input.requestReview(revision, signal),
      phase: "review request",
    }).execute();
    if (!result.requested) {
      return {
        ...result,
        requested: false,
        state: ReviewRequestState.NotRequested,
      };
    }
    return { ...result, requested: true, state: ReviewRequestState.Requested };
  }
}

class PullRequestReviewRequireBeforeDeadline<T> {
  constructor(
    private readonly request: {
      deadline: number;
      input: ReviewRequestInput;
      operation: (signal: AbortSignal) => Promise<T>;
      phase: string;
    },
  ) {}
  async execute(): Promise<T> {
    const input = this.request;

    const attempt = await new PullRequestReviewAttemptBeforeDeadline({
      deadline: input.deadline,
      now: input.input.now,
      operation: input.operation,
    }).execute();
    if (!attempt.completed) {
      throw new Error(
        `Exact-head ${input.phase} did not complete within the ${input.input.timeoutMs}ms transaction; validation continues without a confirmed review outcome`,
      );
    }
    return attempt.value;
  }
}

export class PullRequestReviewStabilizeExactHeadReview {
  constructor(private readonly request: ReviewStabilizationInput) {}
  async execute(): Promise<ReviewStabilizationResult> {
    const input = this.request;

    if (input.timeoutMs === 0) {
      return new PullRequestReviewInspectReviewSnapshot(input).execute();
    }
    const deadline = input.now() + input.timeoutMs;
    let headSha = "";
    let latestFeedback: LatestFeedback = { state: LatestFeedbackState.Missing };
    let settled = false;
    while (true) {
      try {
        const inspection = await new PullRequestReviewAttemptBeforeDeadline({
          deadline,
          now: input.now,
          operation: input.inspectFeedback,
        }).execute();
        if (!inspection.completed) {
          return { headSha, state: ReviewStabilizationState.TimedOut };
        }
        const feedback = inspection.value;
        latestFeedback = {
          state: LatestFeedbackState.Present,
          value: feedback,
        };
        const [defaulted2 = false] = [input.circuitBreakerAcknowledged];
        const findingState = new PullRequestReviewClassifyFeedbackState({
          feedback: feedback,
          circuitBreakerAcknowledged: defaulted2,
        }).execute();
        if (findingState === FeedbackClassificationState.CircuitBreaker) {
          return {
            feedback,
            headSha,
            state: ReviewStabilizationState.CircuitBreaker,
          };
        }
        if (findingState === FeedbackClassificationState.Findings) {
          return {
            feedback,
            headSha,
            state: ReviewStabilizationState.Findings,
          };
        }
        if (
          findingState === FeedbackClassificationState.Clean &&
          settled &&
          feedback.codexReview.settled
        ) {
          return {
            feedback,
            headSha,
            state: ReviewStabilizationState.Clean,
          };
        }
        if (input.timeoutMs > 0 && input.now() >= deadline) {
          return new PullRequestReviewFinalizeAtDeadline({
            feedback: { state: LatestFeedbackState.Present, value: feedback },
            headSha,
          }).execute();
        }
      } catch {
        // Retry feedback inspection until the bounded deadline. If GitHub remains
        // unavailable, validation may continue only through the timed-out state.
      }
      let settledAfterRequest = false;
      let unavailableAfterRequest = false;
      if (!settled) {
        try {
          const request = await new PullRequestReviewAttemptBeforeDeadline({
            deadline,
            now: input.now,
            operation: input.requestReview,
          }).execute();
          if (!request.completed) {
            return { headSha, state: ReviewStabilizationState.TimedOut };
          }
          const review = request.value;
          headSha = review.headSha;
          settled = review.settled;
          settledAfterRequest = review.settled;
          unavailableAfterRequest =
            review.fallback === ExactHeadReviewFallback.CodexUsageLimit;
        } catch {
          // A transient GitHub or provider error is bounded by the same deadline
          // as review availability. It must not turn review into an unbounded gate.
        }
      }
      if (settledAfterRequest || unavailableAfterRequest) {
        try {
          const settledInspectionDeadline = unavailableAfterRequest
            ? input.now() + ZERO_WAIT_FEEDBACK_SNAPSHOT_TIMEOUT_MS
            : Math.max(
                deadline,
                input.now() + ZERO_WAIT_FEEDBACK_SNAPSHOT_TIMEOUT_MS,
              );
          const inspection = await new PullRequestReviewAttemptBeforeDeadline({
            deadline: settledInspectionDeadline,
            now: input.now,
            operation: input.inspectFeedback,
          }).execute();
          if (!inspection.completed) {
            return { headSha, state: ReviewStabilizationState.TimedOut };
          }
          const feedback = inspection.value;
          latestFeedback = {
            state: LatestFeedbackState.Present,
            value: feedback,
          };
          const [defaulted3 = false] = [input.circuitBreakerAcknowledged];
          const findingState = new PullRequestReviewClassifyFeedbackState({
            feedback: feedback,
            circuitBreakerAcknowledged: defaulted3,
          }).execute();
          if (findingState === FeedbackClassificationState.CircuitBreaker) {
            return {
              feedback,
              headSha,
              state: ReviewStabilizationState.CircuitBreaker,
            };
          }
          if (findingState === FeedbackClassificationState.Findings) {
            return {
              feedback,
              headSha,
              state: ReviewStabilizationState.Findings,
            };
          }
          // A submitted review can appear before its inline threads are indexed.
          // Require the next ordinary poll to confirm a clean settled snapshot.
          if (unavailableAfterRequest) {
            return new PullRequestReviewFinalizeAtDeadline({
              feedback: latestFeedback,
              headSha,
            }).execute();
          }
        } catch {
          // A settled provider response proves review state changed after the
          // first inspection. Retry its classification through the same bounded
          // deadline when GitHub's feedback endpoints are temporarily split.
          if (unavailableAfterRequest) {
            return new PullRequestReviewFinalizeAtDeadline({
              feedback: latestFeedback,
              headSha,
            }).execute();
          }
        }
      }
      if (input.now() >= deadline) {
        return new PullRequestReviewFinalizeAtDeadline({
          feedback: latestFeedback,
          headSha,
        }).execute();
      }
      const remainingMs = deadline - input.now();
      await input.waitMs(Math.min(input.pollIntervalMs, remainingMs));
    }
  }
}

class PullRequestReviewInspectReviewSnapshot {
  constructor(private readonly request: ReviewStabilizationInput) {}
  async execute(): Promise<ReviewStabilizationResult> {
    const input = this.request;

    try {
      const inspection = await new PullRequestReviewAttemptBeforeDeadline({
        deadline: input.now() + ZERO_WAIT_FEEDBACK_SNAPSHOT_TIMEOUT_MS,
        now: input.now,
        operation: input.inspectFeedback,
      }).execute();
      if (!inspection.completed) {
        return { headSha: "", state: ReviewStabilizationState.TimedOut };
      }
      const feedback = inspection.value;
      const [circuitBreakerAcknowledged = false] = [
        input.circuitBreakerAcknowledged,
      ];
      const feedbackState = new PullRequestReviewClassifyFeedbackState({
        feedback: feedback,
        circuitBreakerAcknowledged: circuitBreakerAcknowledged,
      }).execute();
      if (feedbackState === FeedbackClassificationState.CircuitBreaker) {
        return {
          feedback,
          headSha: "",
          state: ReviewStabilizationState.CircuitBreaker,
        };
      }
      if (feedbackState === FeedbackClassificationState.Findings) {
        return {
          feedback,
          headSha: "",
          state: ReviewStabilizationState.Findings,
        };
      }
      return {
        feedback,
        headSha: "",
        state: feedback.codexReview.settled
          ? ReviewStabilizationState.Clean
          : ReviewStabilizationState.TimedOut,
      };
    } catch {
      return { headSha: "", state: ReviewStabilizationState.TimedOut };
    }
  }
}

class PullRequestReviewAttemptBeforeDeadline<T> {
  constructor(private readonly request: BoundedAttemptInput<T>) {}
  async execute(): Promise<BoundedAttempt<T>> {
    const input = this.request;

    const remainingMs = Math.max(0, input.deadline - input.now());
    const controller = new AbortController();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        controller.abort();
        resolve({ completed: false });
      }, remainingMs);
      Promise.resolve()
        .then(() => input.operation(controller.signal))
        .then((value) => {
          clearTimeout(timer);
          resolve({ completed: true, value });
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }
}

interface PullRequestReviewClassifyFeedbackStateRequest {
  readonly feedback: PrFeedbackSummary;
  readonly circuitBreakerAcknowledged: boolean;
}

class PullRequestReviewClassifyFeedbackState {
  constructor(
    private readonly request: PullRequestReviewClassifyFeedbackStateRequest,
  ) {}
  execute(): FeedbackClassificationState {
    const { feedback, circuitBreakerAcknowledged } = this.request;

    if (feedback.findingBatches >= 3 && !circuitBreakerAcknowledged) {
      return FeedbackClassificationState.CircuitBreaker;
    }
    const hasFindings =
      feedback.unhandledComments > 0 ||
      feedback.unthreadedReviewFindings > 0 ||
      feedback.unresolvedThreads > 0;
    if (hasFindings) return FeedbackClassificationState.Findings;
    return FeedbackClassificationState.Clean;
  }
}

class PullRequestReviewFinalizeAtDeadline {
  constructor(private readonly request: DeadlineFinalizationInput) {}
  execute(): ReviewStabilizationResult {
    const input = this.request;

    if (input.feedback.state === LatestFeedbackState.Present) {
      return {
        feedback: input.feedback.value,
        headSha: input.headSha,
        state: ReviewStabilizationState.TimedOut,
      };
    }
    return {
      headSha: input.headSha,
      state: ReviewStabilizationState.TimedOut,
    };
  }
}

const DEFAULT_STABILIZATION_WAIT_SECONDS = 0;
const STABILIZATION_POLL_INTERVAL_MS = 15_000;
const ZERO_WAIT_FEEDBACK_SNAPSHOT_TIMEOUT_MS = 15_000;
const REVIEW_REQUEST_TIMEOUT_MS = 45_000;

type ReviewStabilizationRequest = (signal: AbortSignal) => Promise<{
  fallback?: ExactHeadReviewFallback;
  headSha: string;
  settled: boolean;
}>;

type ReviewStabilizationInput = {
  circuitBreakerAcknowledged?: boolean;
  inspectFeedback: (signal: AbortSignal) => Promise<PrFeedbackSummary>;
  now: () => number;
  pollIntervalMs: number;
  requestReview: ReviewStabilizationRequest;
  timeoutMs: number;
  waitMs: (milliseconds: number) => Promise<void>;
};

type ReviewRequestInput = {
  circuitBreakerAcknowledged?: boolean;
  inspectFeedback: (
    revision: PullRequestRevision,
    signal: AbortSignal,
  ) => Promise<PrFeedbackSummary>;
  now: () => number;
  readRevision: (signal: AbortSignal) => Promise<PullRequestRevision>;
  requestReview: (
    revision: PullRequestRevision,
    signal: AbortSignal,
  ) => Promise<ExactHeadReviewRequestResult>;
  timeoutMs: number;
};

type BoundedAttempt<T> = { completed: true; value: T } | { completed: false };

type BoundedAttemptInput<T> = {
  deadline: number;
  now: () => number;
  operation: (signal: AbortSignal) => Promise<T>;
};

export enum ReviewStabilizationState {
  CircuitBreaker = "circuit-breaker",
  Clean = "clean",
  Findings = "findings",
  TimedOut = "timed-out",
}

export enum ReviewRequestState {
  CircuitBreaker = "circuit-breaker",
  NotRequested = "not-requested",
  Requested = "requested",
}

enum FeedbackClassificationState {
  CircuitBreaker = "circuit-breaker",
  Clean = "clean",
  Findings = "findings",
}

enum LatestFeedbackState {
  Missing = "missing",
  Present = "present",
}

type LatestFeedback =
  | { state: LatestFeedbackState.Missing }
  | { state: LatestFeedbackState.Present; value: PrFeedbackSummary };

export type ReviewStabilizationResult = {
  feedback?: PrFeedbackSummary;
  headSha: string;
  state: ReviewStabilizationState;
};

export type ReviewRequestResult =
  | {
      feedback: PrFeedbackSummary;
      state: ReviewRequestState.CircuitBreaker;
    }
  | {
      fallback: ExactHeadReviewFallback;
      headSha: string;
      provider: ExactHeadReviewRequestResult["provider"];
      requested: false;
      settled: boolean;
      state: ReviewRequestState.NotRequested;
    }
  | {
      fallback: ExactHeadReviewFallback;
      headSha: string;
      provider: ExactHeadReviewRequestResult["provider"];
      requested: true;
      settled: boolean;
      state: ReviewRequestState.Requested;
    };

type DeadlineFinalizationInput = {
  feedback: LatestFeedback;
  headSha: string;
};
