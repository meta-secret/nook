import { err, ok, type Result } from 'neverthrow';

import {
  DevelopmentPullRequestLookupKind,
  type DevelopmentPullRequestLookup,
} from './dev-github.ts';
import { DevDeliveryWorkspace, DevWorkspaceGuard } from './dev-workspace.ts';
import {
  Ancestry,
  DevFailureKind,
  ManagedBranch,
  RemoteBranchPresence,
  type DevelopmentPullRequest,
  type CommitSha,
  type DevFailure,
  type DevPublishRequest,
  type DevSnapshot,
  type RemoteBranchSnapshot,
} from './dev-types.ts';

export interface DevPublishOutcome {
  readonly devSha: CommitSha;
  readonly message: string;
}

/** Owns the manager-only local-dev snapshot and exact origin/dev publication. */
export class DevPublishCommand {
  constructor(private readonly workspace: DevDeliveryWorkspace) {}

  execute(request: DevPublishRequest): Result<DevPublishOutcome, DevFailure> {
    const publicationLease = this.workspace.publicationLock();
    if (publicationLease.isErr()) return err(publicationLease.error);
    const localLease = this.workspace.localLock();
    if (localLease.isErr()) {
      const released = publicationLease.value.release();
      return released.isErr() ? err(released.error) : err(localLease.error);
    }
    const snapshot = this.snapshotLocalDev(request.expectedSha);
    if (snapshot.isErr()) {
      const localReleased = localLease.value.release();
      const publicationReleased = publicationLease.value.release();
      if (localReleased.isErr()) return err(localReleased.error);
      return publicationReleased.isErr()
        ? err(publicationReleased.error)
        : err(snapshot.error);
    }
    const result = this.publishInsideLocks({
      devPath: snapshot.value.devPath,
      expectedSha: request.expectedSha,
    });
    const localReleased = localLease.value.release();
    if (localReleased.isErr()) return err(localReleased.error);
    const publicationReleased = publicationLease.value.release();
    if (publicationReleased.isErr()) return err(publicationReleased.error);
    return result;
  }

  private snapshotLocalDev(
    expectedSha: CommitSha,
  ): Result<DevSnapshot, DevFailure> {
    const development = this.workspace.developmentWorktree();
    if (development.isErr()) return err(development.error);
    const guard = new DevWorkspaceGuard(this.workspace).requireClean(
      development.value.path,
    );
    if (guard.isErr()) return err(guard.error);
    const branch = this.workspace.git.branchAt(development.value.path);
    if (branch.isErr()) return err(branch.error);
    if (branch.value.value() !== ManagedBranch.Dev) {
      return err({
        kind: DevFailureKind.Configuration,
        message: `Selected development worktree is not on dev: ${development.value.path}`,
      });
    }
    const devSha = this.workspace.git.headAt(development.value.path);
    if (devSha.isErr()) return err(devSha.error);
    if (!devSha.value.equals(expectedSha)) {
      return err({
        kind: DevFailureKind.Race,
        message: `Local dev is at ${devSha.value.value()}, but the publication packet requires ${expectedSha.value()}`,
      });
    }
    return ok({ devPath: development.value.path, devSha: devSha.value });
  }

  private publishInsideLocks(
    request: DevPublishRequest & { readonly devPath: string },
  ): Result<DevPublishOutcome, DevFailure> {
    const current = this.snapshotLocalDev(request.expectedSha);
    if (current.isErr()) return err(current.error);
    if (
      current.value.devPath !== request.devPath ||
      !current.value.devSha.equals(request.expectedSha)
    ) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'Local dev changed before its manager snapshot could be published',
      });
    }

    const refreshed = this.workspace.git.refreshManagedRefs();
    if (refreshed.isErr()) return err(refreshed.error);
    const remote = this.workspace.git.remoteBranch(ManagedBranch.Dev);
    if (remote.isErr()) return err(remote.error);
    const main = this.workspace.git.remoteBranch(ManagedBranch.Main);
    if (main.isErr()) return err(main.error);
    if (main.value.presence !== RemoteBranchPresence.Present) {
      return err({
        kind: DevFailureKind.Configuration,
        message: 'origin/main must exist before publishing origin/dev',
      });
    }
    const mainAncestry = this.workspace.git.ancestry({
      ancestor: main.value.sha,
      descendant: request.expectedSha,
      workingDirectory: request.devPath,
    });
    if (mainAncestry.isErr()) return err(mainAncestry.error);
    if (mainAncestry.value !== Ancestry.Ancestor) {
      return err({
        kind: DevFailureKind.Conflict,
        message:
          'origin/main is not an ancestor of local dev; reconcile main through the feature path before publishing origin/dev',
      });
    }
    const priorPullRequest = this.workspace.github.findDevelopmentPullRequest({
      workingDirectory: this.workspace.root,
    });
    if (priorPullRequest.isErr()) return err(priorPullRequest.error);
    if (
      priorPullRequest.value.kind === DevelopmentPullRequestLookupKind.Found
    ) {
      const priorPullRequestValue = priorPullRequest.value.pullRequest;
      if (
        remote.value.presence === RemoteBranchPresence.Present &&
        !priorPullRequestValue.headSha.equals(remote.value.sha)
      ) {
        return err({
          kind: DevFailureKind.Race,
          message:
            'The existing dev-to-main pull request head differs from origin/dev; refusing to change either snapshot',
        });
      }
      const replacement = !priorPullRequestValue.headSha.equals(
        request.expectedSha,
      );
      if (replacement) {
        const priorCi = this.workspace.github.requireDevelopmentCiTerminal({
          sha: priorPullRequestValue.headSha,
          workingDirectory: this.workspace.root,
          replacement,
        });
        if (priorCi.isErr()) return err(priorCi.error);
      }
    }
    if (remote.value.presence === RemoteBranchPresence.Present) {
      const ancestry = this.workspace.git.ancestry({
        ancestor: remote.value.sha,
        descendant: request.expectedSha,
        workingDirectory: request.devPath,
      });
      if (ancestry.isErr()) return err(ancestry.error);
      if (ancestry.value !== Ancestry.Ancestor) {
        return err({
          kind: DevFailureKind.Conflict,
          message:
            'origin/dev is ahead of local dev; local dev was preserved and must be reconciled before publishing',
        });
      }
    }

    // Re-read every mutation boundary immediately before publishing. The
    // locks serialize cooperating tasks, while these observations reject a
    // stale packet if an external actor changed the selected checkout or ref.
    const beforePushLocal = this.snapshotLocalDev(request.expectedSha);
    if (beforePushLocal.isErr()) return err(beforePushLocal.error);
    if (beforePushLocal.value.devPath !== request.devPath) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'The selected local dev worktree changed before its snapshot could be published',
      });
    }
    const beforePushRemote = this.workspace.git.remoteBranch(ManagedBranch.Dev);
    if (beforePushRemote.isErr()) return err(beforePushRemote.error);
    if (!this.sameRemote(beforePushRemote.value, remote.value)) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'origin/dev changed while the manager snapshot was being prepared for publication',
      });
    }
    const beforePushMain = this.workspace.git.remoteBranch(ManagedBranch.Main);
    if (beforePushMain.isErr()) return err(beforePushMain.error);
    if (!this.sameRemote(beforePushMain.value, main.value)) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'origin/main changed while the manager snapshot was being prepared for publication',
      });
    }

    const beforePushPullRequest =
      this.workspace.github.findDevelopmentPullRequest({
        workingDirectory: this.workspace.root,
      });
    if (beforePushPullRequest.isErr()) return err(beforePushPullRequest.error);
    if (
      !this.samePullRequest(priorPullRequest.value, beforePushPullRequest.value)
    ) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'The dev-to-main pull request appeared or changed while the manager snapshot was being prepared for publication',
      });
    }
    if (
      priorPullRequest.value.kind === DevelopmentPullRequestLookupKind.Found &&
      !priorPullRequest.value.pullRequest.headSha.equals(request.expectedSha)
    ) {
      const beforePushCi = this.workspace.github.requireDevelopmentCiTerminal({
        sha: priorPullRequest.value.pullRequest.headSha,
        workingDirectory: this.workspace.root,
        replacement: true,
      });
      if (beforePushCi.isErr()) return err(beforePushCi.error);
    }

    const pushed = this.workspace.git.pushExact({
      target: ManagedBranch.Dev,
      sha: request.expectedSha,
      workingDirectory: request.devPath,
    });
    if (pushed.isErr()) return err(pushed.error);
    const remoteAfter = this.workspace.git.remoteBranch(ManagedBranch.Dev);
    if (remoteAfter.isErr()) return err(remoteAfter.error);
    if (
      remoteAfter.value.presence !== RemoteBranchPresence.Present ||
      !remoteAfter.value.sha.equals(request.expectedSha)
    ) {
      return err({
        kind: DevFailureKind.Race,
        message: 'origin/dev did not finish at the exact manager snapshot',
      });
    }
    return ok({
      devSha: request.expectedSha,
      message: `Published local dev ${request.expectedSha.value()} to origin/dev; run the manager-only dev:pr-manager task to create or update the dev-to-main pull request`,
    });
  }

  private sameRemote(
    ...[left, right]: [left: RemoteBranchSnapshot, right: RemoteBranchSnapshot]
  ): boolean {
    if (left.presence !== right.presence) return false;
    if (left.presence === RemoteBranchPresence.Absent) return true;
    return (
      right.presence === RemoteBranchPresence.Present &&
      left.sha.equals(right.sha)
    );
  }

  private samePullRequest(
    ...[left, right]: [
      left: DevelopmentPullRequestLookup,
      right: DevelopmentPullRequestLookup,
    ]
  ): boolean {
    if (left.kind !== right.kind) return false;
    if (left.kind === DevelopmentPullRequestLookupKind.Absent) return true;
    if (right.kind === DevelopmentPullRequestLookupKind.Absent) return true;
    return this.samePullRequestDetails(left.pullRequest, right.pullRequest);
  }

  private samePullRequestDetails(
    ...[left, right]: [
      left: DevelopmentPullRequest,
      right: DevelopmentPullRequest,
    ]
  ): boolean {
    return (
      left.number.value() === right.number.value() &&
      left.headSha.equals(right.headSha) &&
      left.baseSha.equals(right.baseSha) &&
      left.url === right.url &&
      left.isDraft === right.isDraft &&
      left.reviewDecision === right.reviewDecision
    );
  }
}
