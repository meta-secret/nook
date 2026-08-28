import { randomUUID } from "node:crypto";

import type { Octokit } from "@octokit/rest";

import {
  parseRepository,
  resolveGitHubToken,
  type RepoRef,
} from "./github.js";

const DEFAULT_REPOSITORY = "meta-secret/nook";
const DEFAULT_POLL_SECONDS = 15;
const MINIMUM_POLL_SECONDS = 5;
const MAXIMUM_POLL_SECONDS = 300;
const MAXIMUM_BACKOFF_MS = 60_000;
const DEGRADED_AFTER_FAILURES = 3;

export enum ReviewFeedbackSurface {
  InlineReviewComment = "inline-review-comment",
  PrConversationComment = "pr-conversation-comment",
  SubmittedReview = "submitted-review",
}

export enum PullRequestWatchState {
  Open = "open",
  Closed = "closed",
}

export enum WatchStopReason {
  PrNotOpen = "pr-not-open",
  Signal = "signal",
}

export enum ReviewCommentWatchEventKind {
  Degraded = "review-feedback-watch-degraded",
  Observed = "review-feedback-observed",
  ResyncRequired = "review-feedback-resync-required",
  Stopped = "review-feedback-watch-stopped",
}

enum ReviewCommentWatchBootstrapKind {
  Ready = "ready",
  Stopped = "stopped",
}

export enum OptionalNumberKind {
  Missing = "missing",
  Present = "present",
}

export enum OptionalTextKind {
  Missing = "missing",
  Present = "present",
}

export type OptionalNumber =
  | { readonly kind: OptionalNumberKind.Missing }
  | { readonly kind: OptionalNumberKind.Present; readonly value: number };

export type OptionalText =
  | { readonly kind: OptionalTextKind.Missing }
  | { readonly kind: OptionalTextKind.Present; readonly value: string };

type ReviewFeedbackCommon = {
  readonly authorLogin: OptionalText;
  readonly createdAt: OptionalText;
  readonly githubId: number;
  readonly nodeId: string;
  readonly url: string;
};

export type InlineReviewCommentReference = ReviewFeedbackCommon & {
  readonly commitId: string;
  readonly line: OptionalNumber;
  readonly path: string;
  readonly replyToId: OptionalNumber;
  readonly reviewId: OptionalNumber;
  readonly surface: ReviewFeedbackSurface.InlineReviewComment;
};

export type SubmittedReviewReference = ReviewFeedbackCommon & {
  readonly commitId: OptionalText;
  readonly state: string;
  readonly surface: ReviewFeedbackSurface.SubmittedReview;
};

export type PrConversationCommentReference = ReviewFeedbackCommon & {
  readonly surface: ReviewFeedbackSurface.PrConversationComment;
};

export type ReviewFeedbackReference =
  | InlineReviewCommentReference
  | PrConversationCommentReference
  | SubmittedReviewReference;

export type ReviewFeedbackSnapshot = {
  readonly headSha: string;
  readonly items: readonly ReviewFeedbackReference[];
  readonly state: PullRequestWatchState;
};

type WatchEventCommon = {
  readonly headShaAtObservation: OptionalText;
  readonly observedAt: string;
  readonly prNumber: number;
  readonly repository: string;
  readonly schemaVersion: 1;
  readonly sequence: number;
  readonly watchId: string;
};

export type ReviewFeedbackResyncRequired = WatchEventCommon & {
  readonly itemCount: number;
  readonly kind: ReviewCommentWatchEventKind.ResyncRequired;
};

export type ReviewFeedbackObserved = WatchEventCommon & {
  readonly items: readonly ReviewFeedbackReference[];
  readonly kind: ReviewCommentWatchEventKind.Observed;
};

export type ReviewFeedbackWatchDegraded = WatchEventCommon & {
  readonly consecutiveFailures: number;
  readonly kind: ReviewCommentWatchEventKind.Degraded;
};

export type ReviewFeedbackWatchStopped = WatchEventCommon & {
  readonly kind: ReviewCommentWatchEventKind.Stopped;
  readonly reason: WatchStopReason;
};

export type ReviewCommentWatchEvent =
  | ReviewFeedbackObserved
  | ReviewFeedbackResyncRequired
  | ReviewFeedbackWatchDegraded
  | ReviewFeedbackWatchStopped;

export type ReviewCommentWatchTransport = {
  readonly readSnapshot: (
    input: ReviewCommentWatchTarget,
  ) => Promise<ReviewFeedbackSnapshot>;
};

export type ReviewCommentWatchClock = {
  readonly now: () => string;
  readonly sleep: (input: ReviewCommentWatchSleep) => Promise<void>;
};

export type ReviewCommentWatchTarget = {
  readonly prNumber: number;
  readonly repoRef: RepoRef;
};

export type ReviewCommentWatchSleep = {
  readonly milliseconds: number;
  readonly signal: AbortSignal;
};

export type WatchReviewCommentsInput = {
  readonly clock: ReviewCommentWatchClock;
  readonly emit: (event: ReviewCommentWatchEvent) => void;
  readonly pollMilliseconds: number;
  readonly random: () => number;
  readonly repository: string;
  readonly signal: AbortSignal;
  readonly target: ReviewCommentWatchTarget;
  readonly transport: ReviewCommentWatchTransport;
  readonly watchId: string;
};

type ReviewCommentWatchOptions = {
  readonly pollMilliseconds: number;
  readonly repository: string;
  readonly target: ReviewCommentWatchTarget;
};

type ReviewCommentWatchEventWithoutSequence =
  | Omit<ReviewFeedbackObserved, "sequence">
  | Omit<ReviewFeedbackResyncRequired, "sequence">
  | Omit<ReviewFeedbackWatchDegraded, "sequence">
  | Omit<ReviewFeedbackWatchStopped, "sequence">;

type EventWriter = {
  readonly emit: (event: ReviewCommentWatchEventWithoutSequence) => void;
};

type ReviewCommentWatchBootstrap =
  | {
      readonly kind: ReviewCommentWatchBootstrapKind.Ready;
      readonly snapshot: ReviewFeedbackSnapshot;
    }
  | { readonly kind: ReviewCommentWatchBootstrapKind.Stopped };

function optionalText(value: unknown): OptionalText {
  return typeof value === "string" && value.length > 0
    ? { kind: OptionalTextKind.Present, value }
    : { kind: OptionalTextKind.Missing };
}

function optionalNumber(value: unknown): OptionalNumber {
  return typeof value === "number"
    ? { kind: OptionalNumberKind.Present, value }
    : { kind: OptionalNumberKind.Missing };
}

function feedbackKey(item: ReviewFeedbackReference): string {
  return `${item.surface}:${item.githubId}`;
}

function knownFeedback(snapshot: ReviewFeedbackSnapshot): Set<string> {
  return new Set(snapshot.items.map(feedbackKey));
}

function newFeedback(
  snapshot: ReviewFeedbackSnapshot,
  known: ReadonlySet<string>,
): readonly ReviewFeedbackReference[] {
  return snapshot.items.filter((item) => !known.has(feedbackKey(item)));
}

function replaceKnownFeedback(
  known: Set<string>,
  snapshot: ReviewFeedbackSnapshot,
): void {
  for (const item of snapshot.items) {
    known.add(feedbackKey(item));
  }
}

function jitteredMilliseconds(
  milliseconds: number,
  random: () => number,
): number {
  const multiplier = 0.9 + Math.min(1, Math.max(0, random())) * 0.2;
  return Math.max(1, Math.round(milliseconds * multiplier));
}

function retryMilliseconds(
  pollMilliseconds: number,
  consecutiveFailures: number,
): number {
  const exponent = Math.min(6, Math.max(0, consecutiveFailures - 1));
  return Math.min(MAXIMUM_BACKOFF_MS, pollMilliseconds * 2 ** exponent);
}

function eventWriter(input: WatchReviewCommentsInput): EventWriter {
  let sequence = 0;
  return {
    emit(event): void {
      sequence += 1;
      input.emit({ ...event, sequence } as ReviewCommentWatchEvent);
    },
  };
}

function commonEvent(
  input: WatchReviewCommentsInput,
  headShaAtObservation: OptionalText,
): Omit<WatchEventCommon, "sequence"> {
  return {
    headShaAtObservation,
    observedAt: input.clock.now(),
    prNumber: input.target.prNumber,
    repository: input.repository,
    schemaVersion: 1,
    watchId: input.watchId,
  };
}

function observedHead(snapshot: ReviewFeedbackSnapshot): OptionalText {
  return { kind: OptionalTextKind.Present, value: snapshot.headSha };
}

async function bootstrapReviewCommentWatch(
  input: WatchReviewCommentsInput,
  writer: EventWriter,
): Promise<ReviewCommentWatchBootstrap> {
  let consecutiveFailures = 0;
  let degradedEmitted = false;
  while (!input.signal.aborted) {
    try {
      const snapshot = await input.transport.readSnapshot(input.target);
      return { kind: ReviewCommentWatchBootstrapKind.Ready, snapshot };
    } catch {
      consecutiveFailures += 1;
      if (
        consecutiveFailures >= DEGRADED_AFTER_FAILURES &&
        !degradedEmitted
      ) {
        writer.emit({
          ...commonEvent(input, { kind: OptionalTextKind.Missing }),
          consecutiveFailures,
          kind: ReviewCommentWatchEventKind.Degraded,
        });
        degradedEmitted = true;
      }
      await input.clock.sleep({
        milliseconds: jitteredMilliseconds(
          retryMilliseconds(input.pollMilliseconds, consecutiveFailures),
          input.random,
        ),
        signal: input.signal,
      });
    }
  }
  return { kind: ReviewCommentWatchBootstrapKind.Stopped };
}

export async function watchReviewComments(
  input: WatchReviewCommentsInput,
): Promise<void> {
  const writer = eventWriter(input);
  const bootstrap = await bootstrapReviewCommentWatch(input, writer);
  if (bootstrap.kind === ReviewCommentWatchBootstrapKind.Stopped) {
    writer.emit({
      ...commonEvent(input, { kind: OptionalTextKind.Missing }),
      kind: ReviewCommentWatchEventKind.Stopped,
      reason: WatchStopReason.Signal,
    });
    return;
  }
  let snapshot = bootstrap.snapshot;
  const known = knownFeedback(snapshot);
  writer.emit({
    ...commonEvent(input, observedHead(snapshot)),
    itemCount: snapshot.items.length,
    kind: ReviewCommentWatchEventKind.ResyncRequired,
  });

  if (snapshot.state === PullRequestWatchState.Closed) {
    writer.emit({
      ...commonEvent(input, observedHead(snapshot)),
      kind: ReviewCommentWatchEventKind.Stopped,
      reason: WatchStopReason.PrNotOpen,
    });
    return;
  }

  let consecutiveFailures = 0;
  let degradedEmitted = false;
  while (!input.signal.aborted) {
    const delay =
      consecutiveFailures === 0
        ? input.pollMilliseconds
        : retryMilliseconds(input.pollMilliseconds, consecutiveFailures);
    await input.clock.sleep({
      milliseconds: jitteredMilliseconds(delay, input.random),
      signal: input.signal,
    });
    if (input.signal.aborted) break;

    try {
      snapshot = await input.transport.readSnapshot(input.target);
      const items = newFeedback(snapshot, known);
      if (items.length > 0) {
        writer.emit({
          ...commonEvent(input, observedHead(snapshot)),
          items,
          kind: ReviewCommentWatchEventKind.Observed,
        });
      }
      replaceKnownFeedback(known, snapshot);
      consecutiveFailures = 0;
      degradedEmitted = false;
    } catch {
      consecutiveFailures += 1;
      if (
        consecutiveFailures >= DEGRADED_AFTER_FAILURES &&
        !degradedEmitted
      ) {
        writer.emit({
          ...commonEvent(input, observedHead(snapshot)),
          consecutiveFailures,
          kind: ReviewCommentWatchEventKind.Degraded,
        });
        degradedEmitted = true;
      }
      continue;
    }

    if (snapshot.state === PullRequestWatchState.Closed) {
      writer.emit({
        ...commonEvent(input, observedHead(snapshot)),
        kind: ReviewCommentWatchEventKind.Stopped,
        reason: WatchStopReason.PrNotOpen,
      });
      return;
    }
  }

  writer.emit({
    ...commonEvent(input, observedHead(snapshot)),
    kind: ReviewCommentWatchEventKind.Stopped,
    reason: WatchStopReason.Signal,
  });
}

function createDefaultClock(): ReviewCommentWatchClock {
  return {
    now: () => new Date().toISOString(),
    sleep(input): Promise<void> {
      if (input.signal.aborted) return Promise.resolve();
      return new Promise((resolve) => {
        const complete = (): void => {
          clearTimeout(timeout);
          input.signal.removeEventListener("abort", complete);
          resolve();
        };
        const timeout = setTimeout(complete, input.milliseconds);
        input.signal.addEventListener("abort", complete, { once: true });
      });
    },
  };
}

function createGitHubTransport(token: string): ReviewCommentWatchTransport {
  const octokitPromise = import("@octokit/rest").then(
    ({ Octokit }) => new Octokit({ auth: token }),
  );
  return {
    async readSnapshot(target): Promise<ReviewFeedbackSnapshot> {
      const octokit = await octokitPromise;
      return readGitHubSnapshot(octokit, target);
    },
  };
}

export async function readGitHubSnapshot(
  octokit: Octokit,
  target: ReviewCommentWatchTarget,
): Promise<ReviewFeedbackSnapshot> {
  const request = {
    owner: target.repoRef.owner,
    repo: target.repoRef.repo,
  };
  const [{ data: pr }, inlineComments, reviews, conversationComments] =
    await Promise.all([
      octokit.rest.pulls.get({
        ...request,
        pull_number: target.prNumber,
      }),
      octokit.paginate(octokit.rest.pulls.listReviewComments, {
        ...request,
        per_page: 100,
        pull_number: target.prNumber,
      }),
      octokit.paginate(octokit.rest.pulls.listReviews, {
        ...request,
        per_page: 100,
        pull_number: target.prNumber,
      }),
      octokit.paginate(octokit.rest.issues.listComments, {
        ...request,
        issue_number: target.prNumber,
        per_page: 100,
      }),
    ]);

  const inlineReferences: InlineReviewCommentReference[] = inlineComments.map(
    (comment) => ({
      authorLogin: optionalText(comment.user?.login),
      commitId: comment.commit_id,
      createdAt: optionalText(comment.created_at),
      githubId: comment.id,
      line: optionalNumber(comment.line),
      nodeId: comment.node_id,
      path: comment.path,
      replyToId: optionalNumber(comment.in_reply_to_id),
      reviewId: optionalNumber(comment.pull_request_review_id),
      surface: ReviewFeedbackSurface.InlineReviewComment,
      url: comment.html_url,
    }),
  );
  const reviewReferences: SubmittedReviewReference[] = reviews.flatMap(
    (review) => {
      const submittedAt = optionalText(review.submitted_at);
      if (submittedAt.kind === OptionalTextKind.Missing) return [];
      return [
        {
          authorLogin: optionalText(review.user?.login),
          commitId: optionalText(review.commit_id),
          createdAt: submittedAt,
          githubId: review.id,
          nodeId: review.node_id,
          state: review.state,
          surface: ReviewFeedbackSurface.SubmittedReview,
          url: review.html_url,
        },
      ];
    },
  );
  const conversationReferences: PrConversationCommentReference[] =
    conversationComments.map((comment) => ({
      authorLogin: optionalText(comment.user?.login),
      createdAt: optionalText(comment.created_at),
      githubId: comment.id,
      nodeId: comment.node_id,
      surface: ReviewFeedbackSurface.PrConversationComment,
      url: comment.html_url,
    }));
  return {
    headSha: pr.head.sha,
    items: [
      ...inlineReferences,
      ...reviewReferences,
      ...conversationReferences,
    ],
    state:
      pr.state === "open"
        ? PullRequestWatchState.Open
        : PullRequestWatchState.Closed,
  };
}

function positiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function argumentValue(args: readonly string[], name: string): string {
  const index = args.indexOf(name);
  if (index < 0) {
    throw new Error(`${name} is required`);
  }
  const value = args[index + 1];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function validateArguments(args: readonly string[]): void {
  const allowed = ["--pr", "--poll-seconds"];
  const seen: string[] = [];
  if (args.length % 2 !== 0) {
    throw new Error("watch arguments must be name-value pairs");
  }
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (typeof name !== "string" || !allowed.includes(name)) {
      throw new Error(`unknown watch argument at position ${index + 1}`);
    }
    if (seen.includes(name)) {
      throw new Error(`${name} may be provided only once`);
    }
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`${name} requires a value`);
    }
    seen.push(name);
  }
}

export function parseReviewCommentWatchOptions(
  args: readonly string[],
  repository = process.env.GITHUB_REPOSITORY?.trim() || DEFAULT_REPOSITORY,
): ReviewCommentWatchOptions {
  validateArguments(args);
  const prNumber = positiveInteger(argumentValue(args, "--pr"), "--pr");
  const pollValue = args.includes("--poll-seconds")
    ? argumentValue(args, "--poll-seconds")
    : String(DEFAULT_POLL_SECONDS);
  const pollSeconds = positiveInteger(pollValue, "--poll-seconds");
  if (
    pollSeconds < MINIMUM_POLL_SECONDS ||
    pollSeconds > MAXIMUM_POLL_SECONDS
  ) {
    throw new Error(
      `--poll-seconds must be between ${MINIMUM_POLL_SECONDS} and ${MAXIMUM_POLL_SECONDS}`,
    );
  }
  return {
    pollMilliseconds: pollSeconds * 1000,
    repository,
    target: { prNumber, repoRef: parseRepository(repository) },
  };
}

export async function runReviewCommentWatch(
  args: readonly string[],
): Promise<void> {
  const options = parseReviewCommentWatchOptions(args);
  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await watchReviewComments({
      clock: createDefaultClock(),
      emit: (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
      pollMilliseconds: options.pollMilliseconds,
      random: Math.random,
      repository: options.repository,
      signal: controller.signal,
      target: options.target,
      transport: createGitHubTransport(resolveGitHubToken()),
      watchId: randomUUID(),
    });
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}
