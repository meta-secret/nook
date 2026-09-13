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
  type RemoteBranchSnapshot,
  WorktreeState,
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
    const packet = this.validatePacket(request);
    if (packet.isErr()) return err(packet.error);
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

    const development = this.workspace.git.managedWorktreeAt(
      request.devPath,
      ManagedBranch.Dev,
    );
    if (development.isErr()) return err(development.error);
    if (development.value.path !== request.devPath) {
      return err({
        kind: DevFailureKind.Configuration,
        message:
          `The landing packet must name the canonical managed dev worktree path; received ${request.devPath}`,
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
      ...request,
      featureBranch: featureBranch.value,
      initialRemoteFeature: remoteFeature.value,
      devPath: development.value.path,
    });
    const released = lease.value.release();
    if (released.isErr()) return err(released.error);
    return result;
  }

  private landInsideLock(request: {
    readonly originMainSha: CommitSha;
    readonly pinnedLocalDevSha: CommitSha;
    readonly featureHeadSha: CommitSha;
    readonly featureBranch: BranchName;
    readonly expectedFeatureSha: CommitSha;
    readonly initialRemoteFeature: RemoteBranchSnapshot;
    readonly devPath: string;
  }): Result<DevLandOutcome, DevFailure> {
    const refreshed = this.workspace.git.refreshManagedRefs({ prune: true });
    if (refreshed.isErr()) return err(refreshed.error);

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
      !remoteFeature.value.sha.equals(request.expectedFeatureSha) ||
      !this.sameRemoteSnapshot(
        remoteFeature.value,
        request.initialRemoteFeature,
      )
    ) {
      return err({
        kind: DevFailureKind.Race,
        message: 'The pushed feature branch changed before its local landing',
      });
    }

    const development = this.workspace.git.managedWorktreeAt(
      request.devPath,
      ManagedBranch.Dev,
    );
    if (development.isErr()) return err(development.error);
    if (development.value.path !== request.devPath) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'The assigned canonical development worktree changed while landing was queued',
      });
    }
    const guard = new DevWorkspaceGuard(this.workspace).requireClean(
      request.devPath,
    );
    if (guard.isErr()) return err(guard.error);
    const branch = this.workspace.git.branchAt(request.devPath);
    if (branch.isErr()) return err(branch.error);
    if (branch.value.value() !== ManagedBranch.Dev) {
      return err({
        kind: DevFailureKind.Configuration,
        message: `Selected development worktree is not on dev: ${request.devPath}`,
      });
    }
    const developmentHead = this.workspace.git.headAt(request.devPath);
    if (developmentHead.isErr()) return err(developmentHead.error);
    const main = this.workspace.git.remoteBranch(ManagedBranch.Main);
    if (main.isErr()) return err(main.error);
    if (main.value.presence !== RemoteBranchPresence.Present) {
      return err({
        kind: DevFailureKind.Configuration,
        message: 'origin/main must exist before landing a feature into dev',
      });
    }
    if (!main.value.sha.equals(request.originMainSha)) {
      return err({
        kind: DevFailureKind.Race,
        message:
          `Live origin/main is at ${main.value.sha.value()}, but the landing packet requires ${request.originMainSha.value()}`,
      });
    }
    const pinnedFromMain = this.workspace.git.ancestry({
      ancestor: request.originMainSha,
      descendant: request.pinnedLocalDevSha,
      workingDirectory: request.devPath,
    });
    if (pinnedFromMain.isErr()) return err(pinnedFromMain.error);
    if (pinnedFromMain.value !== Ancestry.Ancestor) {
      return err({
        kind: DevFailureKind.Conflict,
        message:
          'The pinned local-dev baseline is not descended from the packet origin/main SHA',
      });
    }
    const featureFromPinned = this.workspace.git.ancestry({
      ancestor: request.pinnedLocalDevSha,
      descendant: request.featureHeadSha,
      workingDirectory: request.devPath,
    });
    if (featureFromPinned.isErr()) return err(featureFromPinned.error);
    if (featureFromPinned.value !== Ancestry.Ancestor) {
      return err({
        kind: DevFailureKind.Conflict,
        message:
          'The canonical feature head is not descended from the pinned local-dev baseline',
      });
    }
    const devFromPinned = this.workspace.git.ancestry({
      ancestor: request.pinnedLocalDevSha,
      descendant: developmentHead.value,
      workingDirectory: request.devPath,
    });
    if (devFromPinned.isErr()) return err(devFromPinned.error);
    if (devFromPinned.value !== Ancestry.Ancestor) {
      return err({
        kind: DevFailureKind.Conflict,
        message:
          'Canonical local dev does not start from or contain the pinned local-dev baseline',
      });
    }
    const mainAncestry = this.workspace.git.ancestry({
      ancestor: main.value.sha,
      descendant: developmentHead.value,
      workingDirectory: request.devPath,
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
      workingDirectory: request.devPath,
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
      !beforeMergeRemoteFeature.value.sha.equals(request.expectedFeatureSha) ||
      !beforeMergeRemoteFeature.value.sha.equals(request.featureHeadSha) ||
      !this.sameRemoteSnapshot(
        beforeMergeRemoteFeature.value,
        request.initialRemoteFeature,
      )
    ) {
      return err({
        kind: DevFailureKind.Race,
        message: 'The pushed feature branch changed before its local landing',
      });
    }
    const beforeMergeDevelopment = this.workspace.git.managedWorktreeAt(
      request.devPath,
      ManagedBranch.Dev,
    );
    if (beforeMergeDevelopment.isErr()) {
      return err({
        kind: DevFailureKind.Race,
        message:
          `The assigned canonical development worktree changed before its feature merge could begin: ${request.devPath}`,
      });
    }
    if (beforeMergeDevelopment.value.path !== development.value.path) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'The canonical development worktree changed before its feature merge could begin',
      });
    }
    const beforeMergeDevelopmentBranch = this.workspace.git.branchAt(
      request.devPath,
    );
    if (beforeMergeDevelopmentBranch.isErr()) {
      return err({
        kind: DevFailureKind.Race,
        message:
          `The assigned development worktree became detached before its feature merge could begin: ${request.devPath}`,
      });
    }
    if (beforeMergeDevelopmentBranch.value.value() !== ManagedBranch.Dev) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'The selected development worktree branch changed before its local landing',
      });
    }
    const beforeMergeDevelopmentState = this.workspace.git.stateAt(
      request.devPath,
    );
    if (beforeMergeDevelopmentState.isErr())
      return err(beforeMergeDevelopmentState.error);
    if (beforeMergeDevelopmentState.value !== WorktreeState.Clean) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'The selected development worktree became dirty before its local landing',
      });
    }
    const beforeMergeDevelopmentHead = this.workspace.git.headAt(
      request.devPath,
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
      !beforeMergeMain.value.sha.equals(request.originMainSha)
    ) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'origin/main changed before the feature could land in local dev',
      });
    }

    const finalPinnedFromMain = this.workspace.git.ancestry({
      ancestor: request.originMainSha,
      descendant: request.pinnedLocalDevSha,
      workingDirectory: request.devPath,
    });
    if (finalPinnedFromMain.isErr()) return err(finalPinnedFromMain.error);
    if (finalPinnedFromMain.value !== Ancestry.Ancestor) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'The pinned local-dev baseline no longer descends from live origin/main',
      });
    }
    const finalFeatureFromPinned = this.workspace.git.ancestry({
      ancestor: request.pinnedLocalDevSha,
      descendant: request.featureHeadSha,
      workingDirectory: request.devPath,
    });
    if (finalFeatureFromPinned.isErr())
      return err(finalFeatureFromPinned.error);
    if (finalFeatureFromPinned.value !== Ancestry.Ancestor) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'The feature head changed its provenance from the pinned local-dev baseline',
      });
    }
    const finalDevFromPinned = this.workspace.git.ancestry({
      ancestor: request.pinnedLocalDevSha,
      descendant: beforeMergeDevelopmentHead.value,
      workingDirectory: request.devPath,
    });
    if (finalDevFromPinned.isErr()) return err(finalDevFromPinned.error);
    if (finalDevFromPinned.value !== Ancestry.Ancestor) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'Canonical local dev changed to a head outside the pinned local-dev baseline',
      });
    }

    const merged = this.workspace.git.mergeInto({
      devPath: request.devPath,
      expectedDevHead: developmentHead.value,
      featureHead: request.expectedFeatureSha,
      featureBranch: request.featureBranch,
      originMainSha: request.originMainSha,
    });
    if (merged.isErr()) return err(merged.error);
    const included = this.workspace.git.ancestry({
      ancestor: request.expectedFeatureSha,
      descendant: merged.value,
      workingDirectory: request.devPath,
    });
    if (included.isErr()) return err(included.error);
    if (included.value !== Ancestry.Ancestor) {
      return err({
        kind: DevFailureKind.Conflict,
        message:
          'The local dev merge completed without retaining the feature commit',
      });
    }
    if (merged.value.equals(developmentHead.value)) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'The local dev ref did not advance after merging the expected feature',
      });
    }
    const resultingBranch = this.workspace.git.branchAt(request.devPath);
    if (resultingBranch.isErr()) {
      return err({
        kind: DevFailureKind.Race,
        message:
          `The assigned development worktree became detached after its feature merge: ${request.devPath}`,
      });
    }
    if (resultingBranch.value.value() !== ManagedBranch.Dev) {
      return err({
        kind: DevFailureKind.Race,
        message:
          `The assigned development worktree changed from dev after its feature merge: ${request.devPath}`,
      });
    }
    const resultingState = this.workspace.git.stateAt(request.devPath);
    if (resultingState.isErr()) return err(resultingState.error);
    if (resultingState.value !== WorktreeState.Clean) {
      return err({
        kind: DevFailureKind.DirtyWorktree,
        message:
          `The local merge left the assigned dev worktree dirty; no cleanup was attempted: ${request.devPath}`,
      });
    }
    const resultingHead = this.workspace.git.headAt(request.devPath);
    if (resultingHead.isErr()) return err(resultingHead.error);
    if (!resultingHead.value.equals(merged.value)) {
      return err({
        kind: DevFailureKind.Race,
        message:
          `The local dev ref changed after the feature merge: expected ${merged.value.value()}, found ${resultingHead.value.value()}`,
      });
    }
    return ok({
      mode: DevLandMode.Merged,
      featureSha: request.expectedFeatureSha,
      devSha: resultingHead.value,
      message: `Landed ${request.expectedFeatureSha.value()} into local dev at ${resultingHead.value.value()}`,
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

  private validatePacket(request: DevLandRequest): Result<void, DevFailure> {
    if (
      !request ||
      typeof request.originMainSha?.equals !== 'function' ||
      typeof request.pinnedLocalDevSha?.equals !== 'function' ||
      typeof request.featureHeadSha?.equals !== 'function' ||
      typeof request.expectedFeatureSha?.equals !== 'function' ||
      typeof request.devPath !== 'string' ||
      request.devPath.length === 0
    ) {
      return err({
        kind: DevFailureKind.Configuration,
        message:
          'The landing packet must include originMainSha, pinnedLocalDevSha, featureHeadSha, expectedFeatureSha, and devPath',
      });
    }
    if (!request.featureHeadSha.equals(request.expectedFeatureSha)) {
      return err({
        kind: DevFailureKind.Configuration,
        message:
          `The landing packet featureHeadSha ${request.featureHeadSha.value()} does not match its published expectedFeatureSha ${request.expectedFeatureSha.value()}`,
      });
    }
    return ok();
  }

  private sameRemoteSnapshot(
    left: RemoteBranchSnapshot,
    right: RemoteBranchSnapshot,
  ): boolean {
    if (left.presence !== right.presence) return false;
    if (left.presence === RemoteBranchPresence.Absent) return true;
    if (right.presence !== RemoteBranchPresence.Present) return false;
    return left.sha.equals(right.sha);
  }
}
