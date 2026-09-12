import { err, ok, type Result } from "neverthrow";

import { DevDeliveryWorkspace } from "./dev-workspace.ts";
import {
  Ancestry,
  type CommitSha,
  DevFailureKind,
  ManagedBranch,
  RemoteBranchPresence,
  PullRequestState,
  PullRequestReviewDecision,
  type DevFailure,
  type DevelopmentPullRequest,
  type ManagedRemoteSnapshot,
} from "./dev-types.ts";

export interface DevPromoteOutcome {
  readonly expectedSha: CommitSha;
  readonly message: string;
}

/** Owns exact-head promotion after the live PR evidence gates settle. */
export class DevPromoteCommand {
  constructor(
    private readonly request: {
      readonly workspace: DevDeliveryWorkspace;
      readonly expectedSha: CommitSha;
    },
  ) {}

  execute(): Result<DevPromoteOutcome, DevFailure> {
    const lease = this.request.workspace.publicationLock();
    if (lease.isErr()) return err(lease.error);
    const result = this.promoteInsideLock();
    const released = lease.value.release();
    if (released.isErr()) return err(released.error);
    return result;
  }

  private promoteInsideLock(): Result<DevPromoteOutcome, DevFailure> {
    const workspace = this.request.workspace;
    const refreshed = workspace.git.refreshManagedRefs();
    if (refreshed.isErr()) return err(refreshed.error);
    const before = this.remoteManagedBranches();
    if (before.isErr()) return err(before.error);
    if (!before.value.dev.equals(this.request.expectedSha)) {
      return err({
        kind: DevFailureKind.Race,
        message: `origin/dev is not the expected tested commit ${this.request.expectedSha.value()}`,
      });
    }
    const mainAncestry = workspace.git.ancestry({
      ancestor: before.value.main,
      descendant: this.request.expectedSha,
      workingDirectory: workspace.root,
    });
    if (mainAncestry.isErr()) return err(mainAncestry.error);
    if (mainAncestry.value !== Ancestry.Ancestor) {
      return err({
        kind: DevFailureKind.Conflict,
        message:
          "origin/main is not an ancestor of the tested origin/dev commit; promotion would not be a fast-forward",
      });
    }

    const pullRequest = workspace.github.readDevelopmentPullRequest({
      workingDirectory: workspace.root,
    });
    if (pullRequest.isErr()) return err(pullRequest.error);
    const initialReview = this.requirePromotablePullRequest(pullRequest.value);
    if (initialReview.isErr()) return err(initialReview.error);
    if (
      !pullRequest.value.headSha.equals(this.request.expectedSha) ||
      !pullRequest.value.baseSha.equals(before.value.main)
    ) {
      return err({
        kind: DevFailureKind.Race,
        message: "The live dev-to-main pull request does not describe the tested remote snapshots",
      });
    }

    const evidence = workspace.github.requirePromotionEvidence({
      sha: this.request.expectedSha,
      pullRequest: pullRequest.value,
      workingDirectory: workspace.root,
    });
    if (evidence.isErr()) return err(evidence.error);

    const immediatelyBeforePush = this.remoteManagedBranches();
    if (immediatelyBeforePush.isErr()) return err(immediatelyBeforePush.error);
    if (
      !immediatelyBeforePush.value.dev.equals(before.value.dev) ||
      !immediatelyBeforePush.value.main.equals(before.value.main)
    ) {
      return err({
        kind: DevFailureKind.Race,
        message: "origin/main or origin/dev changed while promotion evidence was being collected",
      });
    }
    const livePullRequest = workspace.github.readDevelopmentPullRequest({
      workingDirectory: workspace.root,
    });
    if (livePullRequest.isErr()) return err(livePullRequest.error);
    const finalReview = this.requirePromotablePullRequest(livePullRequest.value);
    if (finalReview.isErr()) return err(finalReview.error);
    if (
      !livePullRequest.value.headSha.equals(this.request.expectedSha) ||
      !livePullRequest.value.baseSha.equals(immediatelyBeforePush.value.main)
    ) {
      return err({
        kind: DevFailureKind.Race,
        message: "The live dev-to-main pull request changed before promotion",
      });
    }

    if (!immediatelyBeforePush.value.main.equals(this.request.expectedSha)) {
      const finalAncestry = workspace.git.ancestry({
        ancestor: immediatelyBeforePush.value.main,
        descendant: this.request.expectedSha,
        workingDirectory: workspace.root,
      });
      if (finalAncestry.isErr()) return err(finalAncestry.error);
      if (finalAncestry.value !== Ancestry.Ancestor) {
        return err({
          kind: DevFailureKind.Conflict,
          message: "origin/main changed to a non-ancestor; refusing to rewrite it",
        });
      }
      const pushed = workspace.git.pushExact({
        target: ManagedBranch.Main,
        sha: this.request.expectedSha,
        workingDirectory: workspace.root,
      });
      if (pushed.isErr()) return err(pushed.error);
    }

    const after = this.remoteManagedBranches();
    if (after.isErr()) return err(after.error);
    if (!after.value.main.equals(this.request.expectedSha)) {
      return err({
        kind: DevFailureKind.Race,
        message: "origin/main did not finish at the exact tested commit",
      });
    }
    const status = workspace.github.readPullRequestStatus({
      number: pullRequest.value.number,
      workingDirectory: workspace.root,
    });
    if (status.isErr()) return err(status.error);
    if (!status.value.merged) {
      const detail =
        status.value.state === PullRequestState.Closed
          ? "closed without being merged"
          : status.value.state === PullRequestState.Open
            ? "still open"
            : "did not report a merged status";
      return err({
        kind: DevFailureKind.GitHub,
        message: `origin/main is at ${this.request.expectedSha.value()}, but the dev-to-main pull request is ${detail}; promotion is not reported as merged`,
      });
    }
    return ok({
      expectedSha: this.request.expectedSha,
      message: `Promoted tested origin/dev ${this.request.expectedSha.value()} to origin/main and verified the pull request as merged`,
    });
  }

  private remoteManagedBranches(): Result<
    ManagedRemoteSnapshot,
    DevFailure
  > {
    const main = this.request.workspace.git.remoteBranch(ManagedBranch.Main);
    if (main.isErr()) return err(main.error);
    const dev = this.request.workspace.git.remoteBranch(ManagedBranch.Dev);
    if (dev.isErr()) return err(dev.error);
    if (
      main.value.presence !== RemoteBranchPresence.Present ||
      dev.value.presence !== RemoteBranchPresence.Present
    ) {
      return err({
        kind: DevFailureKind.Configuration,
        message: "origin/main and origin/dev must both exist before promotion",
      });
    }
    return ok({ main: main.value.sha, dev: dev.value.sha });
  }

  private requirePromotablePullRequest(
    pullRequest: DevelopmentPullRequest,
  ): Result<void, DevFailure> {
    if (pullRequest.isDraft) {
      return err({
        kind: DevFailureKind.Reviews,
        message: "The dev-to-main pull request is still a draft",
      });
    }
    if (pullRequest.reviewDecision !== PullRequestReviewDecision.Approved) {
      return err({
        kind: DevFailureKind.Reviews,
        message: `The current dev-to-main review decision is ${pullRequest.reviewDecision}; promotion requires APPROVED`,
      });
    }
    return ok();
  }
}
