import { DEFAULT_REVIEW_CLOCK, requestExactHeadReview } from "./github-review.js";
import {
  createOctokit,
  inspectPrFeedback,
  parseRepository,
  type PrFeedbackSummary,
} from "./github.js";
import { prettyJson } from "./json.js";

const DEFAULT_STABILIZATION_WAIT_SECONDS = 600;
const STABILIZATION_POLL_INTERVAL_MS = 15_000;
const ZERO_WAIT_FEEDBACK_SNAPSHOT_TIMEOUT_MS = 15_000;

type ReviewStabilizationRequest = () => Promise<{
  headSha: string;
  settled: boolean;
}>;

type ReviewStabilizationInput = {
  circuitBreakerAcknowledged?: boolean;
  inspectFeedback: () => Promise<PrFeedbackSummary>;
  now: () => number;
  pollIntervalMs: number;
  requestReview: ReviewStabilizationRequest;
  timeoutMs: number;
  waitMs: (milliseconds: number) => Promise<void>;
};

type BoundedAttempt<T> =
  | { completed: true; value: T }
  | { completed: false };

type BoundedAttemptInput<T> = {
  deadline: number;
  now: () => number;
  operation: () => Promise<T>;
};

export enum ReviewStabilizationState {
  CircuitBreaker = "circuit-breaker",
  Clean = "clean",
  Findings = "findings",
  TimedOut = "timed-out",
}

enum FeedbackClassificationState {
  CircuitBreaker = "circuit-breaker",
  Clean = "clean",
  Findings = "findings",
  PendingHeadTransition = "pending-head-transition",
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

export async function runPrReviewRequest(): Promise<void> {
  const { prNumber, repository } = readReviewContext();

  const result = await requestExactHeadReview(
    createOctokit(),
    parseRepository(repository),
    prNumber,
  );
  console.log(prettyJson({ number: prNumber, repository, ...result }));
}

export async function runPrReviewStabilization(): Promise<void> {
  const { prNumber, repository } = readReviewContext();
  const waitSeconds = readWaitSeconds();
  const octokit = createOctokit();
  const repoRef = parseRepository(repository);
  const result = await stabilizeExactHeadReview({
    circuitBreakerAcknowledged: readCircuitBreakerAcknowledgement(),
    inspectFeedback: () => inspectPrFeedback(octokit, repoRef, prNumber),
    now: () => Date.now(),
    pollIntervalMs: STABILIZATION_POLL_INTERVAL_MS,
    requestReview: () => requestExactHeadReview(octokit, repoRef, prNumber),
    timeoutMs: waitSeconds * 1000,
    waitMs: DEFAULT_REVIEW_CLOCK.waitMs,
  });
  console.log(
    prettyJson({ number: prNumber, repository, waitSeconds, ...result }),
  );
  if (result.state === ReviewStabilizationState.Findings) {
    throw new Error(
      `PR #${prNumber} has current-head review findings; address them as one coherent batch before validation`,
    );
  }
  if (result.state === ReviewStabilizationState.CircuitBreaker) {
    throw new Error(
      `PR #${prNumber} has reached three Cloud-review finding batches; stop the rerun loop and perform comprehensive stabilization before another complete validation`,
    );
  }
  if (result.state === ReviewStabilizationState.TimedOut) {
    console.log(
      `::warning::Exact-head review did not settle within ${waitSeconds}s; continuing with validation so review availability cannot deadlock delivery.`,
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
      } catch {
        // A transient GitHub or provider error is bounded by the same deadline
        // as review availability. It must not turn review into an unbounded gate.
      }
    }
    if (settledAfterRequest) {
      try {
        const settledInspectionDeadline = Math.max(
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
        if (
          findingState === FeedbackClassificationState.Clean &&
          feedback.codexReview.settled
        ) {
          return { feedback, headSha, state: ReviewStabilizationState.Clean };
        }
      } catch {
        // A settled provider response proves review state changed after the
        // first inspection. Retry its classification through the same bounded
        // deadline when GitHub's feedback endpoints are temporarily split.
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
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => resolve({ completed: false }),
      remainingMs,
    );
    Promise.resolve()
      .then(input.operation)
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
    feedback.currentIterationComments > 0 ||
    feedback.substantiveReviews > 0 ||
    feedback.unresolvedThreads > 0;
  if (hasFindings) return FeedbackClassificationState.Findings;
  if (!feedback.headTransitionObserved) {
    return FeedbackClassificationState.PendingHeadTransition;
  }
  return FeedbackClassificationState.Clean;
}

type DeadlineFinalizationInput = {
  feedback: LatestFeedback;
  headSha: string;
};

function finalizeAtDeadline(
  input: DeadlineFinalizationInput,
): ReviewStabilizationResult {
  if (
    input.feedback.state === LatestFeedbackState.Present &&
    !input.feedback.value.headTransitionObserved &&
    input.feedback.value.substantiveComments > 0
  ) {
    return {
      feedback: input.feedback.value,
      headSha: input.headSha,
      state: ReviewStabilizationState.Findings,
    };
  }
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
