import {
  CODEX_AVAILABILITY_PROBE,
  DEFAULT_REVIEW_CLOCK,
  requestExactHeadReview,
} from "./github-review.js";
import {
  createOctokit,
  inspectPrFeedback,
  parseRepository,
  type PrFeedbackSummary,
} from "./github.js";
import { prettyJson } from "./json.js";

const DEFAULT_STABILIZATION_WAIT_SECONDS = 600;
const STABILIZATION_POLL_INTERVAL_MS = 15_000;

type ReviewStabilizationRequest = () => Promise<{
  headSha: string;
  settled: boolean;
}>;

type ReviewStabilizationInput = {
  inspectFeedback: () => Promise<PrFeedbackSummary>;
  now: () => number;
  pollIntervalMs: number;
  requestReview: ReviewStabilizationRequest;
  timeoutMs: number;
  waitMs: (milliseconds: number) => Promise<void>;
};

export enum ReviewStabilizationState {
  CircuitBreaker = "circuit-breaker",
  Clean = "clean",
  Findings = "findings",
  TimedOut = "timed-out",
}

export type ReviewStabilizationResult = {
  feedback?: PrFeedbackSummary;
  headSha: string;
  state: ReviewStabilizationState;
};

export async function runPrReviewRequest(): Promise<void> {
  const { prNumber, repository } = readReviewContext();

  const availability = {
    clock: DEFAULT_REVIEW_CLOCK,
    probe: CODEX_AVAILABILITY_PROBE,
  };
  const result = await requestExactHeadReview(
    createOctokit(),
    parseRepository(repository),
    prNumber,
    availability,
  );
  console.log(prettyJson({ number: prNumber, repository, ...result }));
}

export async function runPrReviewStabilization(): Promise<void> {
  const { prNumber, repository } = readReviewContext();
  const waitSeconds = readWaitSeconds();
  const octokit = createOctokit();
  const repoRef = parseRepository(repository);
  const result = await stabilizeExactHeadReview({
    inspectFeedback: () => inspectPrFeedback(octokit, repoRef, prNumber),
    now: () => Date.now(),
    pollIntervalMs: STABILIZATION_POLL_INTERVAL_MS,
    requestReview: () =>
      requestExactHeadReview(octokit, repoRef, prNumber, {
        clock: DEFAULT_REVIEW_CLOCK,
        probe: CODEX_AVAILABILITY_PROBE,
      }),
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
  let review = await input.requestReview();
  while (!review.settled && input.now() < deadline) {
    const remainingMs = deadline - input.now();
    await input.waitMs(Math.min(input.pollIntervalMs, remainingMs));
    review = await input.requestReview();
  }
  if (!review.settled) {
    return {
      headSha: review.headSha,
      state: ReviewStabilizationState.TimedOut,
    };
  }
  const feedback = await input.inspectFeedback();
  const hasFindings =
    feedback.substantiveReviews > 0 ||
    feedback.unresolvedThreads > 0;
  return {
    feedback,
    headSha: review.headSha,
    state:
      hasFindings && feedback.findingBatches >= 3
        ? ReviewStabilizationState.CircuitBreaker
        : hasFindings
          ? ReviewStabilizationState.Findings
          : ReviewStabilizationState.Clean,
  };
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
