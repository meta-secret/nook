import type { Octokit } from "@octokit/rest";

import {
  createOctokit,
  inspectPrFeedbackSnapshot,
  parseRepository,
  requestCodexReview,
  type PrFeedbackSummary,
  type RepoRef,
} from "./github.js";
import { prettyJson } from "./json.js";

export enum CodexReviewConvergenceOutcome {
  Clean = "clean",
  Feedback = "feedback",
  HeadChanged = "head-changed",
  Timeout = "timeout",
}

export type CodexReviewSnapshot = {
  feedback: PrFeedbackSummary;
  headSha: string;
  stable: boolean;
};

export type CodexReviewRequestResult = {
  headSha: string;
  requested: boolean;
  settled: boolean;
};

export type ReviewConvergenceClock = {
  nowMilliseconds: () => number;
  sleepMilliseconds: (delayMilliseconds: number) => Promise<void>;
};

export type CodexReviewConvergenceInput = {
  automaticGraceSeconds: number;
  clock: ReviewConvergenceClock;
  expectedHeadSha: string;
  pollSeconds: number;
  readSnapshot: () => Promise<CodexReviewSnapshot>;
  requestReview: () => Promise<CodexReviewRequestResult>;
  timeoutSeconds: number;
};

export type CodexReviewConvergenceResult = {
  feedback: PrFeedbackSummary;
  headSha: string;
  manualRequestCreated: boolean;
  outcome: CodexReviewConvergenceOutcome;
  waitedSeconds: number;
};

const EMPTY_FEEDBACK: PrFeedbackSummary = {
  codexReview: {
    approvalReaction: false,
    cleanComment: false,
    currentHeadReview: false,
    requested: false,
    settled: false,
  },
  substantiveComments: 0,
  substantiveReviews: 0,
  unresolvedThreads: 0,
};

export async function convergeCodexReview(
  input: CodexReviewConvergenceInput,
): Promise<CodexReviewConvergenceResult> {
  const startedAt = input.clock.nowMilliseconds();
  const graceAt = startedAt + input.automaticGraceSeconds * 1_000;
  const timeoutAt = startedAt + input.timeoutSeconds * 1_000;
  let latestFeedback = EMPTY_FEEDBACK;
  let manualRequestAttempted = false;
  let manualRequestCreated = false;
  let settlementConfirmationPending = false;

  while (true) {
    const snapshot = await input.readSnapshot();
    latestFeedback = snapshot.feedback;
    if (!snapshot.stable || snapshot.headSha !== input.expectedHeadSha) {
      return resultFor({
        feedback: latestFeedback,
        headSha: snapshot.headSha,
        manualRequestCreated,
        outcome: CodexReviewConvergenceOutcome.HeadChanged,
        startedAt,
        clock: input.clock,
      });
    }
    if (hasActionableFeedback(snapshot.feedback)) {
      return resultFor({
        feedback: latestFeedback,
        headSha: snapshot.headSha,
        manualRequestCreated,
        outcome: CodexReviewConvergenceOutcome.Feedback,
        startedAt,
        clock: input.clock,
      });
    }
    if (snapshot.feedback.codexReview.settled) {
      if (settlementConfirmationPending) {
        return resultFor({
          feedback: latestFeedback,
          headSha: snapshot.headSha,
          manualRequestCreated,
          outcome: CodexReviewConvergenceOutcome.Clean,
          startedAt,
          clock: input.clock,
        });
      }
    }

    const now = input.clock.nowMilliseconds();
    if (now >= timeoutAt) {
      return resultFor({
        feedback: latestFeedback,
        headSha: snapshot.headSha,
        manualRequestCreated,
        outcome: CodexReviewConvergenceOutcome.Timeout,
        startedAt,
        clock: input.clock,
      });
    }
    if (snapshot.feedback.codexReview.settled) {
      settlementConfirmationPending = true;
      const confirmationDelayMilliseconds = Math.max(
        1,
        Math.min(input.pollSeconds * 1_000, timeoutAt - now),
      );
      await input.clock.sleepMilliseconds(confirmationDelayMilliseconds);
      continue;
    }
    settlementConfirmationPending = false;
    if (!manualRequestAttempted && now >= graceAt) {
      manualRequestAttempted = true;
      const request = await input.requestReview();
      manualRequestCreated = request.requested;
      if (request.headSha !== input.expectedHeadSha) {
        return resultFor({
          feedback: latestFeedback,
          headSha: request.headSha,
          manualRequestCreated,
          outcome: CodexReviewConvergenceOutcome.HeadChanged,
          startedAt,
          clock: input.clock,
        });
      }
      continue;
    }

    const nextBoundary = manualRequestAttempted
      ? timeoutAt
      : Math.min(graceAt, timeoutAt);
    const pollMilliseconds = input.pollSeconds * 1_000;
    const delayMilliseconds = Math.max(
      1,
      Math.min(pollMilliseconds, nextBoundary - now),
    );
    await input.clock.sleepMilliseconds(delayMilliseconds);
  }
}

type ReviewConvergenceResultInput = {
  clock: ReviewConvergenceClock;
  feedback: PrFeedbackSummary;
  headSha: string;
  manualRequestCreated: boolean;
  outcome: CodexReviewConvergenceOutcome;
  startedAt: number;
};

function resultFor(
  input: ReviewConvergenceResultInput,
): CodexReviewConvergenceResult {
  return {
    feedback: input.feedback,
    headSha: input.headSha,
    manualRequestCreated: input.manualRequestCreated,
    outcome: input.outcome,
    waitedSeconds: Math.max(
      0,
      Math.round((input.clock.nowMilliseconds() - input.startedAt) / 1_000),
    ),
  };
}

function hasActionableFeedback(feedback: PrFeedbackSummary): boolean {
  return (
    feedback.substantiveComments > 0 ||
    feedback.substantiveReviews > 0 ||
    feedback.unresolvedThreads > 0
  );
}

type GithubReviewConvergenceContext = {
  octokit: Octokit;
  prNumber: number;
  repoRef: RepoRef;
};

async function readGithubSnapshot(
  context: GithubReviewConvergenceContext,
): Promise<CodexReviewSnapshot> {
  return inspectPrFeedbackSnapshot(
    context.octokit,
    context.repoRef,
    context.prNumber,
  );
}

export async function runPrReviewConvergence(): Promise<void> {
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  if (!repository) {
    throw new Error("GITHUB_REPOSITORY is required");
  }
  const prNumber = positiveIntegerFromEnvironment({ name: "PR_NUMBER" });
  const automaticGraceSeconds = positiveIntegerFromEnvironment({
    fallback: 120,
    name: "CODEX_REVIEW_AUTOMATIC_GRACE_SECONDS",
  });
  const timeoutSeconds = positiveIntegerFromEnvironment({
    fallback: 900,
    name: "CODEX_REVIEW_TIMEOUT_SECONDS",
  });
  const pollSeconds = positiveIntegerFromEnvironment({
    fallback: 30,
    name: "CODEX_REVIEW_POLL_SECONDS",
  });
  const expectedHeadSha = process.env.CODEX_REVIEW_EXPECTED_HEAD_SHA?.trim();
  if (!expectedHeadSha || !/^[0-9a-f]{40}$/.test(expectedHeadSha)) {
    throw new Error(
      "CODEX_REVIEW_EXPECTED_HEAD_SHA must be a full lowercase Git SHA",
    );
  }
  const octokit = createOctokit();
  const repoRef = parseRepository(repository);
  const context = { octokit, prNumber, repoRef };
  const result = await convergeCodexReview({
    automaticGraceSeconds,
    clock: {
      nowMilliseconds: () => Date.now(),
      sleepMilliseconds: async (delayMilliseconds) => {
        await new Promise((resolve) => setTimeout(resolve, delayMilliseconds));
      },
    },
    expectedHeadSha,
    pollSeconds,
    readSnapshot: async () => readGithubSnapshot(context),
    requestReview: async () => requestCodexReview(octokit, repoRef, prNumber),
    timeoutSeconds,
  });
  console.log(prettyJson({ number: prNumber, repository, ...result }));
  if (result.outcome === CodexReviewConvergenceOutcome.Feedback) {
    throw new Error(`PR #${prNumber} has actionable review feedback`);
  }
  if (result.outcome === CodexReviewConvergenceOutcome.HeadChanged) {
    throw new Error(`PR #${prNumber} changed head during review convergence`);
  }
}

type PositiveIntegerEnvironmentInput = {
  fallback?: number;
  name: string;
};

function positiveIntegerFromEnvironment(
  input: PositiveIntegerEnvironmentInput,
): number {
  const { fallback = 0, name } = input;
  const rawValue = process.env[name]?.trim() ?? "";
  if (rawValue.length === 0 && fallback > 0) {
    return fallback;
  }
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `${name} must be a positive integer (received ${rawValue || "empty"})`,
    );
  }
  return value;
}
