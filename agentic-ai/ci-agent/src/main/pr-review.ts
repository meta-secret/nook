import { err, ok, type Result } from "neverthrow";
import { CiFailureKind, type CiFailure } from "./failure.js";
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
  async runPrReviewRequest(): Promise<Result<void, CiFailure>> {
    const context = this.readReviewContext();
    if (context.isErr()) return err(context.error);
    const { prNumber, repository } = context.value;
    const acknowledgement = this.readCircuitBreakerAcknowledgement();
    if (acknowledgement.isErr()) return err(acknowledgement.error);
    const client = new GitHubEnvironment(process.env).createOctokit();
    if (client.isErr()) return err(client.error);
    const octokit = client.value;
    const repositoryName = new GitHubRepositoryName(repository).parse();
    if (repositoryName.isErr()) return err(repositoryName.error);
    const repoRef = repositoryName.value;
    const requested =
      await new PullRequestReviewRequestExactHeadReviewWithCircuitBreaker({
        circuitBreakerAcknowledged: acknowledgement.value,
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
    if (requested.isErr()) return err(requested.error);
    const result = requested.value;
    const report = new JsonDocument({
      number: prNumber,
      repository,
      ...result,
    }).format();
    if (report.isErr()) return err(report.error);
    console.log(report.value);
    if (result.state === ReviewRequestState.CircuitBreaker) {
      return err({
        kind: CiFailureKind.Github,
        message: `PR #${prNumber} has reached three Cloud-review finding batches; no new review was requested before comprehensive stabilization`,
      });
    }
    return ok();
  }

  async runPrReviewStabilization(): Promise<Result<void, CiFailure>> {
    const context = this.readReviewContext();
    if (context.isErr()) return err(context.error);
    const { prNumber, repository } = context.value;
    const acknowledgement = this.readCircuitBreakerAcknowledgement();
    if (acknowledgement.isErr()) return err(acknowledgement.error);
    const duration = this.readWaitSeconds();
    if (duration.isErr()) return err(duration.error);
    const waitSeconds = duration.value;
    const client = new GitHubEnvironment(process.env).createOctokit();
    if (client.isErr()) return err(client.error);
    const octokit = client.value;
    const repositoryName = new GitHubRepositoryName(repository).parse();
    if (repositoryName.isErr()) return err(repositoryName.error);
    const repoRef = repositoryName.value;
    const result = await new PullRequestReviewStabilizeExactHeadReview({
      circuitBreakerAcknowledged: acknowledgement.value,
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
    const report = new JsonDocument({
      number: prNumber,
      repository,
      waitSeconds,
      ...result,
    }).format();
    if (report.isErr()) return err(report.error);
    console.log(report.value);
    if (result.state === ReviewStabilizationState.Findings) {
      return err({
        kind: CiFailureKind.Github,
        message: `PR #${prNumber} has current-head review findings; batch them with hosted validation failures`,
      });
    }
    if (result.state === ReviewStabilizationState.CircuitBreaker) {
      return err({
        kind: CiFailureKind.Github,
        message: `PR #${prNumber} has reached three Cloud-review finding batches; stop the review rerun loop and perform comprehensive stabilization before another review request`,
      });
    }
    if (result.state === ReviewStabilizationState.TimedOut) {
      if (waitSeconds === 0) {
        console.log(
          "::notice::Exact-head review is not settled in the bounded feedback snapshot; pr:ready remains the final feedback authority.",
        );
        return ok();
      }
      console.log(
        `::warning::Exact-head review did not settle within ${waitSeconds}s; hosted validation remains independent of review availability.`,
      );
    }
    return ok();
  }

  readCircuitBreakerAcknowledgement(): Result<boolean, CiFailure> {
    const [value = "0"] = [
      this.environment.REVIEW_CIRCUIT_BREAKER_ACKNOWLEDGED?.trim(),
    ];
    if (value !== "0" && value !== "1") {
      return err({
        kind: CiFailureKind.Github,
        message: `REVIEW_CIRCUIT_BREAKER_ACKNOWLEDGED must be 0 or 1 (received ${value})`,
      });
    }
    return ok(value === "1");
  }

  readReviewContext(): Result<
    { prNumber: number; repository: string },
    CiFailure
  > {
    const repository = this.environment.GITHUB_REPOSITORY?.trim();
    if (!repository) {
      return err({
        kind: CiFailureKind.Github,
        message: "GITHUB_REPOSITORY is required",
      });
    }
    const [rawPrNumber = ""] = [this.environment.PR_NUMBER?.trim()];
    const prNumber = Number(rawPrNumber);
    if (!Number.isInteger(prNumber) || prNumber <= 0) {
      return err({
        kind: CiFailureKind.Github,
        message: `PR_NUMBER must be a positive integer (received ${rawPrNumber || "empty"})`,
      });
    }
    return ok({ prNumber, repository });
  }

  readWaitSeconds(): Result<number, CiFailure> {
    const rawWaitSeconds =
      this.environment.REVIEW_WAIT_SECONDS?.trim() ||
      String(DEFAULT_STABILIZATION_WAIT_SECONDS);
    const waitSeconds = Number(rawWaitSeconds);
    if (
      !Number.isInteger(waitSeconds) ||
      waitSeconds < 0 ||
      waitSeconds > 3600
    ) {
      return err({
        kind: CiFailureKind.Github,
        message: `REVIEW_WAIT_SECONDS must be an integer from 0 through 3600 (received ${rawWaitSeconds})`,
      });
    }
    return ok(waitSeconds);
  }
}

export class PullRequestReviewRequestExactHeadReviewWithCircuitBreaker {
  constructor(private readonly request: ReviewRequestInput) {}
  async execute(): Promise<Result<ReviewRequestResult, CiFailure>> {
    const input = this.request;

    const deadline = input.now() + input.timeoutMs;
    const revisionOutcome = await new PullRequestReviewRequireBeforeDeadline({
      deadline,
      input,
      operation: input.readRevision,
      phase: "initial revision inspection",
    }).execute();
    if (revisionOutcome.isErr()) return err(revisionOutcome.error);
    const revision = revisionOutcome.value;
    const feedbackOutcome = await new PullRequestReviewRequireBeforeDeadline({
      deadline,
      input,
      operation: (signal) => input.inspectFeedback(revision, signal),
      phase: "feedback inspection",
    }).execute();
    if (feedbackOutcome.isErr()) return err(feedbackOutcome.error);
    const feedback = feedbackOutcome.value;
    const [defaulted1 = false] = [input.circuitBreakerAcknowledged];
    if (
      new PullRequestReviewClassifyFeedbackState({
        feedback: feedback,
        circuitBreakerAcknowledged: defaulted1,
      }).execute() === FeedbackClassificationState.CircuitBreaker
    ) {
      return ok({ feedback, state: ReviewRequestState.CircuitBreaker });
    }
    const currentRevisionOutcome =
      await new PullRequestReviewRequireBeforeDeadline({
        deadline,
        input,
        operation: input.readRevision,
        phase: "revision verification",
      }).execute();
    if (currentRevisionOutcome.isErr())
      return err(currentRevisionOutcome.error);
    const currentRevision = currentRevisionOutcome.value;
    const bound = new PullRequestRevisionConstraint({
      expected: revision,
      actual: currentRevision,
    }).enforce();
    if (bound.isErr()) return err(bound.error);
    const resultOutcome = await new PullRequestReviewRequireBeforeDeadline({
      deadline,
      input,
      operation: (signal) => input.requestReview(revision, signal),
      phase: "review request",
    }).execute();
    if (resultOutcome.isErr()) return err(resultOutcome.error);
    const result = resultOutcome.value;
    if (!result.requested) {
      return ok({
        ...result,
        requested: false,
        state: ReviewRequestState.NotRequested,
      });
    }
    return ok({
      ...result,
      requested: true,
      state: ReviewRequestState.Requested,
    });
  }
}

class PullRequestReviewRequireBeforeDeadline<T> {
  constructor(
    private readonly request: {
      deadline: number;
      input: ReviewRequestInput;
      operation: (signal: AbortSignal) => Promise<Result<T, CiFailure>>;
      phase: string;
    },
  ) {}
  async execute(): Promise<Result<T, CiFailure>> {
    const input = this.request;

    const attempt = await new PullRequestReviewAttemptBeforeDeadline({
      deadline: input.deadline,
      now: input.input.now,
      operation: input.operation,
    }).execute();
    if (!attempt.completed) {
      return err({
        kind: CiFailureKind.Github,
        message: `Exact-head ${input.phase} did not complete within the ${input.input.timeoutMs}ms transaction; validation continues without a confirmed review outcome`,
      });
    }
    return attempt.value;
  }
}

export class PullRequestReviewStabilizeExactHeadReview {
  constructor(private readonly request: ReviewStabilizationInput) {}
  async execute(): Promise<ReviewStabilizationResult> {
    const input = this.request;
    if (input.timeoutMs === 0)
      return new PullRequestReviewInspectReviewSnapshot(input).execute();
    const deadline = input.now() + input.timeoutMs;
    let headSha = "",
      settled = false;
    let latestFeedback: LatestFeedback = { state: LatestFeedbackState.Missing };
    const finalize = () =>
      new PullRequestReviewFinalizeAtDeadline({
        feedback: latestFeedback,
        headSha,
      }).execute();
    while (true) {
      const inspection = await new PullRequestReviewAttemptBeforeDeadline({
        deadline,
        now: input.now,
        operation: input.inspectFeedback,
      }).execute();
      if (!inspection.completed)
        return { headSha, state: ReviewStabilizationState.TimedOut };
      if (inspection.value.isOk()) {
        const feedback = inspection.value.value;
        latestFeedback = {
          state: LatestFeedbackState.Present,
          value: feedback,
        };
        const findingState = new PullRequestReviewClassifyFeedbackState({
          feedback,
          circuitBreakerAcknowledged: input.circuitBreakerAcknowledged || false,
        }).execute();
        if (findingState === FeedbackClassificationState.CircuitBreaker)
          return {
            feedback,
            headSha,
            state: ReviewStabilizationState.CircuitBreaker,
          };
        if (findingState === FeedbackClassificationState.Findings)
          return {
            feedback,
            headSha,
            state: ReviewStabilizationState.Findings,
          };
        if (
          findingState === FeedbackClassificationState.Clean &&
          settled &&
          feedback.codexReview.settled
        )
          return { feedback, headSha, state: ReviewStabilizationState.Clean };
        if (input.now() >= deadline) return finalize();
      }
      let settledAfterRequest = false,
        unavailableAfterRequest = false;
      if (!settled) {
        const request = await new PullRequestReviewAttemptBeforeDeadline({
          deadline,
          now: input.now,
          operation: input.requestReview,
        }).execute();
        if (!request.completed)
          return { headSha, state: ReviewStabilizationState.TimedOut };
        if (request.value.isOk()) {
          const review = request.value.value;
          headSha = review.headSha;
          settled = review.settled;
          settledAfterRequest = review.settled;
          unavailableAfterRequest =
            review.fallback === ExactHeadReviewFallback.CodexUsageLimit;
        }
      }
      if (settledAfterRequest || unavailableAfterRequest) {
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
        if (!inspection.completed)
          return { headSha, state: ReviewStabilizationState.TimedOut };
        if (inspection.value.isOk()) {
          const feedback = inspection.value.value;
          latestFeedback = {
            state: LatestFeedbackState.Present,
            value: feedback,
          };
          const findingState = new PullRequestReviewClassifyFeedbackState({
            feedback,
            circuitBreakerAcknowledged:
              input.circuitBreakerAcknowledged || false,
          }).execute();
          if (findingState === FeedbackClassificationState.CircuitBreaker)
            return {
              feedback,
              headSha,
              state: ReviewStabilizationState.CircuitBreaker,
            };
          if (findingState === FeedbackClassificationState.Findings)
            return {
              feedback,
              headSha,
              state: ReviewStabilizationState.Findings,
            };
        }
        // A provider response can precede indexing. Confirm clean results on the next ordinary poll.
        if (unavailableAfterRequest) return finalize();
      }
      if (input.now() >= deadline) return finalize();
      await input.waitMs(
        Math.min(input.pollIntervalMs, deadline - input.now()),
      );
    }
  }
}

class PullRequestReviewInspectReviewSnapshot {
  constructor(private readonly request: ReviewStabilizationInput) {}
  async execute(): Promise<ReviewStabilizationResult> {
    const input = this.request;

    const inspection = await new PullRequestReviewAttemptBeforeDeadline({
      deadline: input.now() + ZERO_WAIT_FEEDBACK_SNAPSHOT_TIMEOUT_MS,
      now: input.now,
      operation: input.inspectFeedback,
    }).execute();
    if (!inspection.completed) {
      return { headSha: "", state: ReviewStabilizationState.TimedOut };
    }
    if (inspection.value.isErr())
      return { headSha: "", state: ReviewStabilizationState.TimedOut };
    const feedback = inspection.value.value;
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
  }
}

class PullRequestReviewAttemptBeforeDeadline<T> {
  constructor(private readonly request: BoundedAttemptInput<T>) {}
  async execute(): Promise<BoundedAttempt<T>> {
    const input = this.request;

    const remainingMs = Math.max(0, input.deadline - input.now());
    const controller = new AbortController();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        controller.abort();
        resolve({ completed: false });
      }, remainingMs);
      Promise.resolve()
        .then(() => input.operation(controller.signal))
        .then(
          (value) => {
            clearTimeout(timer);
            resolve({ completed: true, value });
          },
          () => {
            clearTimeout(timer);
            resolve({
              completed: true,
              value: err({
                kind: CiFailureKind.Github,
                message:
                  'Exact-head review operation rejected before returning a typed outcome.',
              }),
            });
          },
        );
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

type ReviewStabilizationRequest = (signal: AbortSignal) => Promise<
  Result<
    {
      fallback?: ExactHeadReviewFallback;
      headSha: string;
      settled: boolean;
    },
    CiFailure
  >
>;

type ReviewStabilizationInput = {
  circuitBreakerAcknowledged?: boolean;
  inspectFeedback: (
    signal: AbortSignal,
  ) => Promise<Result<PrFeedbackSummary, CiFailure>>;
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
  ) => Promise<Result<PrFeedbackSummary, CiFailure>>;
  now: () => number;
  readRevision: (
    signal: AbortSignal,
  ) => Promise<Result<PullRequestRevision, CiFailure>>;
  requestReview: (
    revision: PullRequestRevision,
    signal: AbortSignal,
  ) => Promise<Result<ExactHeadReviewRequestResult, CiFailure>>;
  timeoutMs: number;
};

type BoundedAttempt<T> =
  { completed: true; value: Result<T, CiFailure> } | { completed: false };

type BoundedAttemptInput<T> = {
  deadline: number;
  now: () => number;
  operation: (signal: AbortSignal) => Promise<Result<T, CiFailure>>;
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
