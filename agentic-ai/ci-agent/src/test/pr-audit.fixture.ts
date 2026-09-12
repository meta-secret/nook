import type { RepoRef } from "../main/github.js";

export const repoRef = { owner: "meta-secret", repo: "nook" };

export enum MockCodexReview {
  CleanComment = "clean-comment",
  Dismissed = "dismissed",
  DuplicateReaction = "duplicate-reaction",
  Impostor = "impostor",
  ImpostorCleanComment = "impostor-clean-comment",
  Missing = "missing",
  Reaction = "reaction",
  Review = "review",
  ReviewDetailsFinding = "review-details-finding",
  ReviewFinding = "review-finding",
  StaleCleanComment = "stale-clean-comment",
}

export enum MockCursorReview {
  Finding = "finding",
  Missing = "missing",
  Stale = "stale",
}

export enum MockRunStatus {
  Completed = "completed",
  InProgress = "in_progress",
}

export enum MockJobConclusion {
  Failure = "failure",
  Success = "success",
  Skipped = "skipped",
}

export enum MockAgentHandoff {
  Excluded = "excluded",
  Included = "included",
}

export type MockOptions = {
  laterNoopRun?: boolean;
  agentHandoff: MockAgentHandoff;
  behindBy?: number;
  codexReview?: MockCodexReview;
  currentHeadFinding?: boolean;
  cursorReview?: MockCursorReview;
  deletedCommentIds?: number[];
  dismissedThreads?: number;
  handledHistoricalFinding?: boolean;
  historicalFinding?: boolean;
  legacyAutomationComment?: boolean;
  legacyAutomationDeletionFails?: boolean;
  mergeable?: boolean;
  workflowBaseBranch?: string;
  headRepository?: RepoRef;
  nativeConclusion?: MockJobConclusion;
  omitNativeJob?: boolean;
  runStatus?: MockRunStatus;
  resolvedInlineReviewFinding?: boolean;
  staleBaseRun?: boolean;
  unresolvedThreads?: number;
};

export type MockOverrides = Omit<MockOptions, "agentHandoff">;
