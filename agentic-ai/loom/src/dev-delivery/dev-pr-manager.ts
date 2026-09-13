import { err, ok, type Result } from 'neverthrow';

import { DevDeliveryWorkspace } from './dev-workspace.ts';
import { DevelopmentPullRequestLookupKind } from './dev-github.ts';
import {
  Ancestry,
  DevFailureKind,
  ManagedBranch,
  RemoteBranchPresence,
  type CommitSha,
  type DevFailure,
  WorktreeState,
} from './dev-types.ts';

export interface DevPrManagerOutcome {
  readonly devSha: CommitSha;
  readonly pullRequestUrl: string;
  readonly message: string;
}

export interface DevPrManagerRequest {
  readonly workspace: DevDeliveryWorkspace;
  readonly expectedSha: CommitSha;
}

/** Creates or updates the one manager-owned dev-to-main pull request. */
export class DevPrManagerCommand {
  constructor(private readonly request: DevPrManagerRequest) {}

  execute(): Result<DevPrManagerOutcome, DevFailure> {
    const publicationLease = this.request.workspace.publicationLock();
    if (publicationLease.isErr()) return err(publicationLease.error);
    const localLease = this.request.workspace.localLock();
    if (localLease.isErr()) {
      const released = publicationLease.value.release();
      return released.isErr() ? err(released.error) : err(localLease.error);
    }

    const result = this.manageInsideLocks();
    const localReleased = localLease.value.release();
    if (localReleased.isErr()) return err(localReleased.error);
    const publicationReleased = publicationLease.value.release();
    if (publicationReleased.isErr()) return err(publicationReleased.error);
    return result;
  }

  private manageInsideLocks(): Result<DevPrManagerOutcome, DevFailure> {
    const workspace = this.request.workspace;
    const refreshed = workspace.git.refreshManagedRefs();
    if (refreshed.isErr()) {
      return err(refreshed.error);
    }
    const development = workspace.developmentWorktree();
    if (development.isErr()) return err(development.error);
    const developmentState = workspace.git.stateAt(development.value.path);
    if (developmentState.isErr()) return err(developmentState.error);
    if (developmentState.value !== WorktreeState.Clean) {
      return err({
        kind: DevFailureKind.DirtyWorktree,
        message: `Local dev is dirty; refusing to manage the selected SHA: ${development.value.path}`,
      });
    }
    const developmentBranch = workspace.git.branchAt(
      development.value.path,
    );
    if (developmentBranch.isErr()) return err(developmentBranch.error);
    if (developmentBranch.value.value() !== ManagedBranch.Dev) {
      return err({
        kind: DevFailureKind.Configuration,
        message: `Selected development worktree is not on dev: ${development.value.path}`,
      });
    }
    const localDevSha = workspace.git.headAt(development.value.path);
    if (localDevSha.isErr()) return err(localDevSha.error);
    if (
      !development.value.head.equals(localDevSha.value) ||
      !localDevSha.value.equals(this.request.expectedSha)
    ) {
      return err({
        kind: DevFailureKind.Race,
        message: `Local dev changed before manager PR mutation: expected ${this.request.expectedSha.value()}, found ${localDevSha.value.value()}`,
      });
    }

    const remote = workspace.git.remoteBranch(ManagedBranch.Dev);
    if (remote.isErr()) {
      return err(remote.error);
    }
    if (remote.value.presence !== RemoteBranchPresence.Present) {
      return err({
        kind: DevFailureKind.Configuration,
        message: 'origin/dev must exist before the dev PR manager can run',
      });
    }
    if (!remote.value.sha.equals(this.request.expectedSha)) {
      return err({
        kind: DevFailureKind.Race,
        message: `origin/dev is not the expected selected commit ${this.request.expectedSha.value()}`,
      });
    }
    const main = workspace.git.remoteBranch(ManagedBranch.Main);
    if (main.isErr()) {
      return err(main.error);
    }
    if (main.value.presence !== RemoteBranchPresence.Present) {
      return err({
        kind: DevFailureKind.Configuration,
        message: 'origin/main must exist before the dev PR manager can run',
      });
    }
    const ancestry = workspace.git.ancestry({
      ancestor: main.value.sha,
      descendant: this.request.expectedSha,
      workingDirectory: workspace.root,
    });
    if (ancestry.isErr()) return err(ancestry.error);
    if (ancestry.value !== Ancestry.Ancestor) {
      return err({
        kind: DevFailureKind.Conflict,
        message:
          'origin/main is not an ancestor of origin/dev; reconcile main through the feature path before creating its PR',
      });
    }

    const existingPullRequest = workspace.github.findDevelopmentPullRequest({
      workingDirectory: workspace.root,
    });
    if (existingPullRequest.isErr()) return err(existingPullRequest.error);
    if (
      existingPullRequest.value.kind ===
      DevelopmentPullRequestLookupKind.Found
    ) {
      const existing = existingPullRequest.value.pullRequest;
      if (
        !existing.headSha.equals(this.request.expectedSha) ||
        !existing.baseSha.equals(main.value.sha)
      ) {
        return err({
          kind: DevFailureKind.Race,
          message:
            'The existing dev-to-main pull request does not describe the expected selected origin/dev and origin/main snapshots; refusing to mutate it',
        });
      }
    }

    const pullRequest = workspace.github.ensureDevelopmentPullRequest({
      expectedSha: this.request.expectedSha,
      workingDirectory: workspace.root,
    });
    if (pullRequest.isErr()) return err(pullRequest.error);

    const remoteAfter = workspace.git.remoteBranch(ManagedBranch.Dev);
    if (remoteAfter.isErr()) return err(remoteAfter.error);
    const mainAfter = workspace.git.remoteBranch(ManagedBranch.Main);
    if (mainAfter.isErr()) return err(mainAfter.error);
    const localAfter = workspace.git.headAt(development.value.path);
    if (localAfter.isErr()) return err(localAfter.error);
    if (
      remoteAfter.value.presence !== RemoteBranchPresence.Present ||
      !remoteAfter.value.sha.equals(this.request.expectedSha) ||
      mainAfter.value.presence !== RemoteBranchPresence.Present ||
      !mainAfter.value.sha.equals(main.value.sha) ||
      !localAfter.value.equals(this.request.expectedSha) ||
      !pullRequest.value.headSha.equals(this.request.expectedSha) ||
      !pullRequest.value.baseSha.equals(main.value.sha)
    ) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'Local dev, remote branches, or the dev-to-main pull request changed while the manager PR operation was running',
      });
    }
    return ok({
      devSha: this.request.expectedSha,
      pullRequestUrl: pullRequest.value.url,
      message: `Manager PR ${pullRequest.value.url} now records origin/dev at ${this.request.expectedSha.value()}`,
    });
  }
}
