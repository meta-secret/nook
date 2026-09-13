import { err, ok, type Result } from 'neverthrow';

import { DevDeliveryWorkspace, DevWorkspaceGuard } from './dev-workspace.ts';
import {
  Ancestry,
  DevFailureKind,
  ManagedBranch,
  RemoteBranchPresence,
  type BranchName,
  type CommitSha,
  type DevFailure,
  type DevLandRequest,
} from './dev-types.ts';

export enum DevLandMode {
  Merged = 'merged',
  AlreadyPresent = 'already-present',
}

export interface DevLandOutcome {
  readonly mode: DevLandMode;
  readonly featureSha: CommitSha;
  readonly devSha: CommitSha;
  readonly message: string;
}

/** Owns the feature-to-local-dev admission and short serialized merge. */
export class DevLandCommand {
  constructor(private readonly workspace: DevDeliveryWorkspace) {}

  execute(request: DevLandRequest): Result<DevLandOutcome, DevFailure> {
    const featureBranch = this.workspace.git.currentBranch();
    if (featureBranch.isErr()) return err(featureBranch.error);
    const branchGuard = this.requireFeatureBranch(featureBranch.value);
    if (branchGuard.isErr()) return err(branchGuard.error);
    const featureSha = this.workspace.git.head();
    if (featureSha.isErr()) return err(featureSha.error);
    if (!featureSha.value.equals(request.expectedFeatureSha)) {
      return err({
        kind: DevFailureKind.Race,
        message:
          `The feature branch is at ${featureSha.value.value()}, but the landing packet requires ${request.expectedFeatureSha.value()}`,
      });
    }
    const cleanFeature = new DevWorkspaceGuard(this.workspace).requireClean(
      this.workspace.root,
    );
    if (cleanFeature.isErr()) return err(cleanFeature.error);
    const remoteFeature = this.workspace.git.remoteBranch(featureBranch.value);
    if (remoteFeature.isErr()) return err(remoteFeature.error);
    if (
      remoteFeature.value.presence !== RemoteBranchPresence.Present ||
      !remoteFeature.value.sha.equals(featureSha.value)
    ) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'The feature branch is not pushed at its exact current commit; push the feature branch before landing',
      });
    }

    const proof = this.workspace.github.buildProof({
      branch: featureBranch.value,
      sha: request.expectedFeatureSha,
    });
    if (proof.isErr()) return err(proof.error);

    const lease = this.workspace.localLock();
    if (lease.isErr()) return err(lease.error);
    const result = this.landInsideLock({
      featureBranch: featureBranch.value,
      expectedFeatureSha: request.expectedFeatureSha,
    });
    const released = lease.value.release();
    if (released.isErr()) return err(released.error);
    return result;
  }

  private landInsideLock(request: {
    readonly featureBranch: BranchName;
    readonly expectedFeatureSha: CommitSha;
  }): Result<DevLandOutcome, DevFailure> {
    const currentFeature = this.workspace.git.currentBranch();
    if (currentFeature.isErr()) return err(currentFeature.error);
    if (!currentFeature.value.equals(request.featureBranch)) {
      return err({
        kind: DevFailureKind.Race,
        message: 'The feature worktree branch changed while landing was queued',
      });
    }
    const currentSha = this.workspace.git.head();
    if (currentSha.isErr()) return err(currentSha.error);
    if (!currentSha.value.equals(request.expectedFeatureSha)) {
      return err({
        kind: DevFailureKind.Race,
        message:
          `The feature worktree commit changed while landing was queued: expected ${request.expectedFeatureSha.value()}, found ${currentSha.value.value()}`,
      });
    }
    const cleanFeature = new DevWorkspaceGuard(this.workspace).requireClean(
      this.workspace.root,
    );
    if (cleanFeature.isErr()) return err(cleanFeature.error);
    const remoteFeature = this.workspace.git.remoteBranch(
      request.featureBranch,
    );
    if (remoteFeature.isErr()) return err(remoteFeature.error);
    if (
      remoteFeature.value.presence !== RemoteBranchPresence.Present ||
      !remoteFeature.value.sha.equals(request.expectedFeatureSha)
    ) {
      return err({
        kind: DevFailureKind.Race,
        message: 'The pushed feature branch changed before its local landing',
      });
    }

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
    const developmentHead = this.workspace.git.headAt(development.value.path);
    if (developmentHead.isErr()) return err(developmentHead.error);
    const main = this.workspace.git.remoteBranch(ManagedBranch.Main);
    if (main.isErr()) return err(main.error);
    if (main.value.presence !== RemoteBranchPresence.Present) {
      return err({
        kind: DevFailureKind.Configuration,
        message: 'origin/main must exist before landing a feature into dev',
      });
    }
    const mainAncestry = this.workspace.git.ancestry({
      ancestor: main.value.sha,
      descendant: developmentHead.value,
      workingDirectory: development.value.path,
    });
    if (mainAncestry.isErr()) return err(mainAncestry.error);
    if (mainAncestry.value !== Ancestry.Ancestor) {
      return err({
        kind: DevFailureKind.Conflict,
        message:
          'origin/main is not an ancestor of local dev; reconcile main through the feature path before landing another feature',
      });
    }
    const ancestry = this.workspace.git.ancestry({
      ancestor: request.expectedFeatureSha,
      descendant: developmentHead.value,
      workingDirectory: development.value.path,
    });
    if (ancestry.isErr()) return err(ancestry.error);
    if (ancestry.value === Ancestry.Ancestor) {
      return ok({
        mode: DevLandMode.AlreadyPresent,
        featureSha: request.expectedFeatureSha,
        devSha: developmentHead.value,
        message: `Feature ${request.expectedFeatureSha.value()} is already present in local dev; no merge was needed`,
      });
    }

    // Re-read the packet target and shared-dev evidence immediately before
    // the merge. The lock serializes cooperating landings; these checks also
    // reject a stale packet when an external actor moved a ref or checkout.
    const beforeMergeFeatureBranch = this.workspace.git.currentBranch();
    if (beforeMergeFeatureBranch.isErr())
      return err(beforeMergeFeatureBranch.error);
    if (!beforeMergeFeatureBranch.value.equals(request.featureBranch)) {
      return err({
        kind: DevFailureKind.Race,
        message: 'The feature worktree branch changed before its local landing',
      });
    }
    const beforeMergeFeature = this.workspace.git.head();
    if (beforeMergeFeature.isErr()) return err(beforeMergeFeature.error);
    if (!beforeMergeFeature.value.equals(request.expectedFeatureSha)) {
      return err({
        kind: DevFailureKind.Race,
        message:
          `The feature worktree commit changed before its local landing: expected ${request.expectedFeatureSha.value()}, found ${beforeMergeFeature.value.value()}`,
      });
    }
    const beforeMergeRemoteFeature = this.workspace.git.remoteBranch(
      request.featureBranch,
    );
    if (beforeMergeRemoteFeature.isErr())
      return err(beforeMergeRemoteFeature.error);
    if (
      beforeMergeRemoteFeature.value.presence !==
        RemoteBranchPresence.Present ||
      !beforeMergeRemoteFeature.value.sha.equals(request.expectedFeatureSha)
    ) {
      return err({
        kind: DevFailureKind.Race,
        message: 'The pushed feature branch changed before its local landing',
      });
    }
    const beforeMergeDevelopmentBranch = this.workspace.git.branchAt(
      development.value.path,
    );
    if (beforeMergeDevelopmentBranch.isErr())
      return err(beforeMergeDevelopmentBranch.error);
    if (beforeMergeDevelopmentBranch.value.value() !== ManagedBranch.Dev) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'The selected development worktree branch changed before its local landing',
      });
    }
    const beforeMergeDevelopmentHead = this.workspace.git.headAt(
      development.value.path,
    );
    if (beforeMergeDevelopmentHead.isErr())
      return err(beforeMergeDevelopmentHead.error);
    if (!beforeMergeDevelopmentHead.value.equals(developmentHead.value)) {
      return err({
        kind: DevFailureKind.Race,
        message: 'Local dev changed before its feature merge could begin',
      });
    }
    const beforeMergeMain = this.workspace.git.remoteBranch(
      ManagedBranch.Main,
    );
    if (beforeMergeMain.isErr()) return err(beforeMergeMain.error);
    if (
      beforeMergeMain.value.presence !== RemoteBranchPresence.Present ||
      !beforeMergeMain.value.sha.equals(main.value.sha)
    ) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'origin/main changed before the feature could land in local dev',
      });
    }

    const merged = this.workspace.git.mergeInto({
      devPath: development.value.path,
      expectedDevHead: developmentHead.value,
      featureHead: request.expectedFeatureSha,
    });
    if (merged.isErr()) return err(merged.error);
    const included = this.workspace.git.ancestry({
      ancestor: request.expectedFeatureSha,
      descendant: merged.value,
      workingDirectory: development.value.path,
    });
    if (included.isErr()) return err(included.error);
    if (included.value !== Ancestry.Ancestor) {
      return err({
        kind: DevFailureKind.Conflict,
        message:
          'The local dev merge completed without retaining the feature commit',
      });
    }
    return ok({
      mode: DevLandMode.Merged,
      featureSha: request.expectedFeatureSha,
      devSha: merged.value,
      message: `Landed ${request.expectedFeatureSha.value()} into local dev at ${merged.value.value()}`,
    });
  }

  private requireFeatureBranch(branch: BranchName): Result<void, DevFailure> {
    if (
      branch.value() === ManagedBranch.Main ||
      branch.value() === ManagedBranch.Dev
    ) {
      return err({
        kind: DevFailureKind.Configuration,
        message:
          'dev:land requires a feature branch; managed main/dev branches are not callable features',
      });
    }
    return ok();
  }
}
