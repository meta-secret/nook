import { err, ok, type Result } from "neverthrow";

import { DevDeliveryWorkspace, DevWorkspaceGuard } from "./dev-workspace.ts";
import {
  Ancestry,
  DevFailureKind,
  ManagedBranch,
  RemoteBranchPresence,
  type CommitSha,
  type DevFailure,
  type DevPublishRequest,
  type DevSnapshot,
} from "./dev-types.ts";

export interface DevPublishOutcome {
  readonly devSha: CommitSha;
  readonly pullRequestUrl: string;
  readonly message: string;
}

/** Owns the manager-only local-dev snapshot, push, and PR publication. */
export class DevPublishCommand {
  constructor(private readonly workspace: DevDeliveryWorkspace) {}

  execute(): Result<DevPublishOutcome, DevFailure> {
    const publicationLease = this.workspace.publicationLock();
    if (publicationLease.isErr()) return err(publicationLease.error);
    const localLease = this.workspace.localLock();
    if (localLease.isErr()) {
      const released = publicationLease.value.release();
      return released.isErr() ? err(released.error) : err(localLease.error);
    }
    const snapshot = this.snapshotLocalDev();
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
      devSha: snapshot.value.devSha,
    });
    const localReleased = localLease.value.release();
    if (localReleased.isErr()) return err(localReleased.error);
    const publicationReleased = publicationLease.value.release();
    if (publicationReleased.isErr()) return err(publicationReleased.error);
    return result;
  }

  private snapshotLocalDev(): Result<
    DevSnapshot,
    DevFailure
  > {
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
    return ok({ devPath: development.value.path, devSha: devSha.value });
  }

  private publishInsideLocks(request: DevPublishRequest): Result<DevPublishOutcome, DevFailure> {
    const current = this.snapshotLocalDev();
    if (current.isErr()) return err(current.error);
    if (
      current.value.devPath !== request.devPath ||
      !current.value.devSha.equals(request.devSha)
    ) {
      return err({
        kind: DevFailureKind.Race,
        message: "Local dev changed before its manager snapshot could be published",
      });
    }

    const remote = this.workspace.git.remoteBranch(ManagedBranch.Dev);
    if (remote.isErr()) return err(remote.error);
    if (remote.value.presence === RemoteBranchPresence.Present) {
      const ancestry = this.workspace.git.ancestry({
        ancestor: remote.value.sha,
        descendant: request.devSha,
        workingDirectory: request.devPath,
      });
      if (ancestry.isErr()) return err(ancestry.error);
      if (ancestry.value !== Ancestry.Ancestor) {
        return err({
          kind: DevFailureKind.Conflict,
          message:
            "origin/dev is ahead of local dev; local dev was preserved and must be reconciled before publishing",
        });
      }
    }

    const pushed = this.workspace.git.pushExact({
      target: ManagedBranch.Dev,
      sha: request.devSha,
      workingDirectory: request.devPath,
    });
    if (pushed.isErr()) return err(pushed.error);
    const remoteAfter = this.workspace.git.remoteBranch(ManagedBranch.Dev);
    if (remoteAfter.isErr()) return err(remoteAfter.error);
    if (
      remoteAfter.value.presence !== RemoteBranchPresence.Present ||
      !remoteAfter.value.sha.equals(request.devSha)
    ) {
      return err({
        kind: DevFailureKind.Race,
        message: "origin/dev did not finish at the exact manager snapshot",
      });
    }
    const pullRequest = this.workspace.github.ensureDevelopmentPullRequest({
      expectedSha: request.devSha,
      workingDirectory: this.workspace.root,
    });
    if (pullRequest.isErr()) return err(pullRequest.error);
    return ok({
      devSha: request.devSha,
      pullRequestUrl: pullRequest.value.url,
      message: `Published local dev ${request.devSha.value()} to origin/dev and updated ${pullRequest.value.url}`,
    });
  }
}
