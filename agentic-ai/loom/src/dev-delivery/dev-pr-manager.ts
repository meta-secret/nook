import { err, ok, type Result } from 'neverthrow';

import { DevDeliveryWorkspace } from './dev-workspace.ts';
import {
  Ancestry,
  DevFailureKind,
  ManagedBranch,
  RemoteBranchPresence,
  type CommitSha,
  type DevFailure,
} from './dev-types.ts';

export interface DevPrManagerOutcome {
  readonly devSha: CommitSha;
  readonly pullRequestUrl: string;
  readonly message: string;
}

/** Creates or updates the one manager-owned dev-to-main pull request. */
export class DevPrManagerCommand {
  constructor(private readonly workspace: DevDeliveryWorkspace) {}

  execute(): Result<DevPrManagerOutcome, DevFailure> {
    const lease = this.workspace.publicationLock();
    if (lease.isErr()) return err(lease.error);

    const refreshed = this.workspace.git.refreshManagedRefs();
    if (refreshed.isErr()) {
      const released = lease.value.release();
      return released.isErr() ? err(released.error) : err(refreshed.error);
    }
    const remote = this.workspace.git.remoteBranch(ManagedBranch.Dev);
    if (remote.isErr()) {
      const released = lease.value.release();
      return released.isErr() ? err(released.error) : err(remote.error);
    }
    if (remote.value.presence !== RemoteBranchPresence.Present) {
      const released = lease.value.release();
      const failure: DevFailure = {
        kind: DevFailureKind.Configuration,
        message: 'origin/dev must exist before the dev PR manager can run',
      };
      return released.isErr() ? err(released.error) : err(failure);
    }
    const main = this.workspace.git.remoteBranch(ManagedBranch.Main);
    if (main.isErr()) {
      const released = lease.value.release();
      return released.isErr() ? err(released.error) : err(main.error);
    }
    if (main.value.presence !== RemoteBranchPresence.Present) {
      const released = lease.value.release();
      const failure: DevFailure = {
        kind: DevFailureKind.Configuration,
        message: 'origin/main must exist before the dev PR manager can run',
      };
      return released.isErr() ? err(released.error) : err(failure);
    }
    const ancestry = this.workspace.git.ancestry({
      ancestor: main.value.sha,
      descendant: remote.value.sha,
      workingDirectory: this.workspace.root,
    });
    if (ancestry.isErr()) {
      const released = lease.value.release();
      return released.isErr() ? err(released.error) : err(ancestry.error);
    }
    if (ancestry.value !== Ancestry.Ancestor) {
      const released = lease.value.release();
      const failure: DevFailure = {
        kind: DevFailureKind.Conflict,
        message:
          'origin/main is not an ancestor of origin/dev; reconcile main through the feature path before creating its PR',
      };
      return released.isErr() ? err(released.error) : err(failure);
    }

    const pullRequest = this.workspace.github.ensureDevelopmentPullRequest({
      expectedSha: remote.value.sha,
      workingDirectory: this.workspace.root,
    });
    const released = lease.value.release();
    if (released.isErr()) return err(released.error);
    if (pullRequest.isErr()) return err(pullRequest.error);
    return ok({
      devSha: remote.value.sha,
      pullRequestUrl: pullRequest.value.url,
      message: `Manager PR ${pullRequest.value.url} now records origin/dev at ${remote.value.sha.value()}`,
    });
  }
}
