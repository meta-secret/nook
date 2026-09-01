import {
  DEFAULT_REVIEW_CLOCK,
  ExactHeadReviewFallback,
  ExactHeadReviewRevisionState,
  requestExactHeadReview,
  type ExactHeadReviewRequestResult,
} from "./github-review.js";
import {
  assertPullRequestRevision,
  createOctokit,
  inspectPrFeedback,
  parseRepository,
  readPullRequestRevision,
  type PullRequestRevision,
  type PrFeedbackSummary,
} from "./github.js";
import { prettyJson } from "./json.js";

const DEFAULT_STABILIZATION_WAIT_SECONDS = 600;
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

type BoundedAttempt<T> =
  | { completed: true; value: T }
  | { completed: false };

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

export async function runPrReviewRequest(): Promise<void> {
  const { prNumber, repository } = readReviewContext();
  const octokit = createOctokit();
  const repoRef = parseRepository(repository);
  const result = await requestExactHeadReviewWithCircuitBreaker({
    circuitBreakerAcknowledged: readCircuitBreakerAcknowledgement(),
    inspectFeedback: (revision, signal) =>
      inspectPrFeedback(octokit, repoRef, prNumber, {
        expectedRevision: revision,
        signal,
      }),
    now: () => Date.now(),
    readRevision: (signal) =>
      readPullRequestRevision(octokit, repoRef, prNumber, signal),
    requestReview: (revision, signal) =>
      requestExactHeadReview(octokit, repoRef, prNumber, {
        revision: {
          revision,
          state: ExactHeadReviewRevisionState.Bound,
        },
        signal,
      }),
    timeoutMs: REVIEW_REQUEST_TIMEOUT_MS,
  });
  console.log(prettyJson({ number: prNumber, repository, ...result }));
  if (result.state === ReviewRequestState.CircuitBreaker) {
    throw new Error(
      `PR #${prNumber} has reached three Cloud-review finding batches; no new review was requested before comprehensive stabilization`,
    );
  }
}

export async function requestExactHeadReviewWithCircuitBreaker(
  input: ReviewRequestInput,
): Promise<ReviewRequestResult> {
  const deadline = input.now() + input.timeoutMs;
  const revision = await requireBeforeDeadline({
    deadline,
    input,
    operation: input.readRevision,
    phase: "initial revision inspection",
  });
  const feedback = await requireBeforeDeadline({
    deadline,
    input,
    operation: (signal) => input.inspectFeedback(revision, signal),
    phase: "feedback inspection",
  });
  if (
    classifyFeedbackState(
      feedback,
      input.circuitBreakerAcknowledged ?? false,
    ) === FeedbackClassificationState.CircuitBreaker
  ) {
    return { feedback, state: ReviewRequestState.CircuitBreaker };
  }
  const currentRevision = await requireBeforeDeadline({
    deadline,
    input,
    operation: input.readRevision,
    phase: "revision verification",
  });
  assertPullRequestRevision(revision, currentRevision);
  const result = await requireBeforeDeadline({
    deadline,
    input,
    operation: (signal) => input.requestReview(revision, signal),
    phase: "review request",
  });
  if (!result.requested) {
    return {
      ...result,
      requested: false,
      state: ReviewRequestState.NotRequested,
    };
  }
  return { ...result, requested: true, state: ReviewRequestState.Requested };
}

async function requireBeforeDeadline<T>(input: {
  deadline: number;
  input: ReviewRequestInput;
  operation: (signal: AbortSignal) => Promise<T>;
  phase: string;
}): Promise<T> {
  const attempt = await attemptBeforeDeadline({
    deadline: input.deadline,
    now: input.input.now,
    operation: input.operation,
  });
  if (!attempt.completed) {
    throw new Error(
      `Exact-head ${input.phase} did not complete within the ${input.input.timeoutMs}ms transaction; validation continues without a confirmed review outcome`,
    );
  }
  return attempt.value;
}

export async function runPrReviewStabilization(): Promise<void> {
  const { prNumber, repository } = readReviewContext();
  const waitSeconds = readWaitSeconds();
  const octokit = createOctokit();
  const repoRef = parseRepository(repository);
  const result = await stabilizeExactHeadReview({
    circuitBreakerAcknowledged: readCircuitBreakerAcknowledgement(),
    inspectFeedback: (signal) =>
      inspectPrFeedback(octokit, repoRef, prNumber, { signal }),
    now: () => Date.now(),
    pollIntervalMs: STABILIZATION_POLL_INTERVAL_MS,
    requestReview: (signal) =>
      requestExactHeadReview(octokit, repoRef, prNumber, { signal }),
    timeoutMs: waitSeconds * 1000,
    waitMs: DEFAULT_REVIEW_CLOCK.waitMs,
  });
  console.log(
    prettyJson({ number: prNumber, repository, waitSeconds, ...result }),
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
    console.log(
      `::warning::Exact-head review did not settle within ${waitSeconds}s; hosted validation remains independent of review availability.`,
    );
  }
}

export async function stabilizeExactHeadReview(
  input: ReviewStabilizationInput,
): Promise<ReviewStabilizationResult> {
  const deadline = input.now() + input.timeoutMs;
  const initialFeedbackDeadline =
    input.timeoutMs === 0
      ? deadline + ZERO_WAIT_FEEDBACK_SNAPSHOT_TIMEOUT_MS
      : deadline;
  let headSha = "";
  let latestFeedback: LatestFeedback = { state: LatestFeedbackState.Missing };
  let settled = false;
  while (true) {
    try {
      const inspection = await attemptBeforeDeadline({
        deadline: initialFeedbackDeadline,
        now: input.now,
        operation: input.inspectFeedback,
      });
      if (!inspection.completed) {
        return { headSha, state: ReviewStabilizationState.TimedOut };
      }
      const feedback = inspection.value;
      latestFeedback = { state: LatestFeedbackState.Present, value: feedback };
      const findingState = classifyFeedbackState(
        feedback,
        input.circuitBreakerAcknowledged ?? false,
      );
      if (findingState === FeedbackClassificationState.CircuitBreaker) {
        return {
          feedback,
          headSha,
          state: ReviewStabilizationState.CircuitBreaker,
        };
      }
      if (findingState === FeedbackClassificationState.Findings) {
        return { feedback, headSha, state: ReviewStabilizationState.Findings };
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
        return finalizeAtDeadline({
          feedback: { state: LatestFeedbackState.Present, value: feedback },
          headSha,
        });
      }
    } catch {
      // Retry feedback inspection until the bounded deadline. If GitHub remains
      // unavailable, validation may continue only through the timed-out state.
    }
    let settledAfterRequest = false;
    let unavailableAfterRequest = false;
    if (!settled) {
      try {
        const request = await attemptBeforeDeadline({
          deadline:
            input.timeoutMs === 0
              ? input.now() + ZERO_WAIT_FEEDBACK_SNAPSHOT_TIMEOUT_MS
              : deadline,
          now: input.now,
          operation: input.requestReview,
        });
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
        const inspection = await attemptBeforeDeadline({
          deadline: settledInspectionDeadline,
          now: input.now,
          operation: input.inspectFeedback,
        });
        if (!inspection.completed) {
          return { headSha, state: ReviewStabilizationState.TimedOut };
        }
        const feedback = inspection.value;
        latestFeedback = {
          state: LatestFeedbackState.Present,
          value: feedback,
        };
        const findingState = classifyFeedbackState(
          feedback,
          input.circuitBreakerAcknowledged ?? false,
        );
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
          return finalizeAtDeadline({ feedback: latestFeedback, headSha });
        }
      } catch {
        // A settled provider response proves review state changed after the
        // first inspection. Retry its classification through the same bounded
        // deadline when GitHub's feedback endpoints are temporarily split.
        if (unavailableAfterRequest) {
          return finalizeAtDeadline({ feedback: latestFeedback, headSha });
        }
      }
    }
    if (input.now() >= deadline) {
      return finalizeAtDeadline({ feedback: latestFeedback, headSha });
    }
    const remainingMs = deadline - input.now();
    await input.waitMs(Math.min(input.pollIntervalMs, remainingMs));
  }
}

async function attemptBeforeDeadline<T>(
  input: BoundedAttemptInput<T>,
): Promise<BoundedAttempt<T>> {
  const remainingMs = Math.max(0, input.deadline - input.now());
  const controller = new AbortController();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => {
        controller.abort();
        resolve({ completed: false });
      },
      remainingMs,
    );
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

function classifyFeedbackState(
  feedback: PrFeedbackSummary,
  circuitBreakerAcknowledged: boolean,
): FeedbackClassificationState {
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

type DeadlineFinalizationInput = {
  feedback: LatestFeedback;
  headSha: string;
};

function finalizeAtDeadline(
  input: DeadlineFinalizationInput,
): ReviewStabilizationResult {
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

function readCircuitBreakerAcknowledgement(): boolean {
  const value = process.env.REVIEW_CIRCUIT_BREAKER_ACKNOWLEDGED?.trim() ?? "0";
  if (value !== "0" && value !== "1") {
    throw new Error(
      `REVIEW_CIRCUIT_BREAKER_ACKNOWLEDGED must be 0 or 1 (received ${value})`,
    );
  }
  return value === "1";
}

function readReviewContext(): { prNumber: number; repository: string } {
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  if (!repository) {
    throw new Error("GITHUB_REPOSITORY is required");
  }
  const rawPrNumber = process.env.PR_NUMBER?.trim() ?? "";
  const prNumber = Number(rawPrNumber);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new Error(
      `PR_NUMBER must be a positive integer (received ${rawPrNumber || "empty"})`,
    );
  }
  return { prNumber, repository };
}

function readWaitSeconds(): number {
  const rawWaitSeconds =
    process.env.REVIEW_WAIT_SECONDS?.trim() ||
    String(DEFAULT_STABILIZATION_WAIT_SECONDS);
  const waitSeconds = Number(rawWaitSeconds);
  if (!Number.isInteger(waitSeconds) || waitSeconds < 0 || waitSeconds > 3600) {
    throw new Error(
      `REVIEW_WAIT_SECONDS must be an integer from 0 through 3600 (received ${rawWaitSeconds})`,
    );
  }
  return waitSeconds;
}
