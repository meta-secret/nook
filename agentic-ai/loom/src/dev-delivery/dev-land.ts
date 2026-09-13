import { err, ok, type Result } from 'neverthrow';

import { DevDeliveryWorkspace } from './dev-workspace.ts';
import { branchAdvancedFailure } from './dev-git-merge.ts';
import {
  CanonicalFeatureBranchContract,
  type CanonicalFeatureBranch,
} from '../lib/base-evidence.ts';
import {
  Ancestry,
  DevFailureKind,
  ManagedBranch,
  RemoteBranchPresence,
  type BranchName,
  type CommitSha,
  type DevFailure,
  type DevLandRequest,
  WorktreeState,
} from './dev-types.ts';

export { BranchAdvanced, isBranchAdvancedFailure } from './dev-git-merge.ts';
export type { BranchAdvancedFailure } from './dev-git-merge.ts';

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

interface BranchAuthoritativeLandRequest {
  readonly devPath: string;
  readonly featureBranch: BranchName;
  readonly originMainSha: CommitSha;
  readonly pinnedLocalDevSha: CommitSha;
}

interface LandInsideLockRequest extends BranchAuthoritativeLandRequest {
  /** Remote feature head that was verified by build:compile. */
  readonly featureHead: CommitSha;
}

/** Owns the feature-to-local-dev admission and short serialized merge. */
export class DevLandCommand {
  constructor(private readonly workspace: DevDeliveryWorkspace) {}

  execute(request: DevLandRequest): Result<DevLandOutcome, DevFailure> {
    const packet = this.validatePacket(request);
    if (packet.isErr()) return err(packet.error);

    // Refresh first, then make the fetched remote feature branch the only
    // feature-head authority for this landing attempt.
    const refreshed = this.workspace.git.refreshManagedRefs({ prune: true });
    if (refreshed.isErr()) return err(refreshed.error);

    const currentFeature = this.workspace.git.currentBranch();
    if (currentFeature.isErr()) return err(currentFeature.error);
    if (!currentFeature.value.equals(packet.value.featureBranch)) {
      return err({
        kind: DevFailureKind.Race,
        message:
          `The feature worktree is on ${currentFeature.value.value()}, but the authorized branch is ${packet.value.featureBranch.value()}`,
      });
    }

    const featureHead = this.workspace.git.resolveFeatureBranchHead(
      packet.value.featureBranch,
    );
    if (featureHead.isErr()) return err(featureHead.error);

    const base = this.validateBase(packet.value, featureHead.value);
    if (base.isErr()) return err(base.error);

    // Build evidence is bound to the committed head observed after the
    // initial fetch, not to either legacy packet feature-SHA field.
    const proof = this.workspace.github.buildProof({
      branch: packet.value.featureBranch,
      sha: featureHead.value,
    });
    if (proof.isErr()) return err(proof.error);
    if (!proof.value.sha.equals(featureHead.value)) {
      return err({
        kind: DevFailureKind.Evidence,
        message:
          'The successful build:compile evidence did not describe the observed feature branch head',
      });
    }

    const lease = this.workspace.localLock();
    if (lease.isErr()) return err(lease.error);
    const result = this.landInsideLock({
      ...packet.value,
      featureHead: featureHead.value,
    });
    const released = lease.value.release();
    if (released.isErr()) return err(released.error);
    return result;
  }

  private landInsideLock(
    request: LandInsideLockRequest,
  ): Result<DevLandOutcome, DevFailure> {
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

    const currentFeatureHead = this.workspace.git.resolveFeatureBranchHead(
      request.featureBranch,
    );
    if (currentFeatureHead.isErr()) return err(currentFeatureHead.error);
    if (!currentFeatureHead.value.equals(request.featureHead)) {
      return err(
        branchAdvancedFailure(request.featureBranch, currentFeatureHead.value),
      );
    }

    const developmentHead = this.validateBase(
      request,
      currentFeatureHead.value,
    );
    if (developmentHead.isErr()) return err(developmentHead.error);

    const ancestry = this.workspace.git.ancestry({
      ancestor: currentFeatureHead.value,
      descendant: developmentHead.value,
      workingDirectory: request.devPath,
    });
    if (ancestry.isErr()) return err(ancestry.error);
    if (ancestry.value === Ancestry.Ancestor) {
      return ok({
        mode: DevLandMode.AlreadyPresent,
        featureSha: currentFeatureHead.value,
        devSha: developmentHead.value,
        message: `Feature ${currentFeatureHead.value.value()} is already present in local dev; no merge was needed`,
      });
    }

    // Refresh and resolve again at the landing edge. The merge boundary has
    // one final read-only race guard for a move in the remaining tiny window.
    const landingRefresh = this.workspace.git.refreshManagedRefs({
      prune: true,
    });
    if (landingRefresh.isErr()) return err(landingRefresh.error);
    const landingFeatureHead = this.workspace.git.resolveFeatureBranchHead(
      request.featureBranch,
    );
    if (landingFeatureHead.isErr()) return err(landingFeatureHead.error);
    if (!landingFeatureHead.value.equals(request.featureHead)) {
      return err(
        branchAdvancedFailure(request.featureBranch, landingFeatureHead.value),
      );
    }

    // The merge boundary repeats mutable identity checks immediately before
    // mutation. A branch move in that window remains typed as BranchAdvanced.
    const merged = this.workspace.git.mergeInto({
      devPath: request.devPath,
      expectedDevHead: developmentHead.value,
      featureHead: currentFeatureHead.value,
      featureBranch: request.featureBranch,
      originMainSha: request.originMainSha,
    });
    if (merged.isErr()) return err(merged.error);
    return ok({
      mode: DevLandMode.Merged,
      featureSha: currentFeatureHead.value,
      devSha: merged.value,
      message: `Landed ${currentFeatureHead.value.value()} into local dev at ${merged.value.value()}`,
    });
  }

  /**
   * Validates the Prime-created base and the assigned canonical dev checkout.
   * The feature SHA is supplied by the fetched remote branch, never by a
   * duplicate packet field.
   */
  private validateBase(
    request: BranchAuthoritativeLandRequest,
    featureHead: CommitSha,
  ): Result<CommitSha, DevFailure> {
    const development = this.workspace.git.managedWorktreeAt(
      request.devPath,
      ManagedBranch.Dev,
    );
    if (development.isErr()) return err(development.error);
    const guard = this.workspace.git.stateAt(request.devPath);
    if (guard.isErr()) return err(guard.error);
    if (guard.value !== WorktreeState.Clean) {
      return err({
        kind: DevFailureKind.DirtyWorktree,
        message: `Worktree is dirty; refusing to change it: ${request.devPath}`,
      });
    }
    const developmentHead = this.workspace.git.headAt(request.devPath);
    if (developmentHead.isErr()) return err(developmentHead.error);
    if (!development.value.head.equals(developmentHead.value)) {
      return err({
        kind: DevFailureKind.Race,
        message: `Assigned development worktree changed while landing was queued: ${request.devPath}`,
      });
    }

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
      descendant: featureHead,
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
    return ok(developmentHead.value);
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

  private validatePacket(
    request: DevLandRequest,
  ): Result<BranchAuthoritativeLandRequest, DevFailure> {
    if (
      !request ||
      typeof request.originMainSha?.equals !== 'function' ||
      typeof request.pinnedLocalDevSha?.equals !== 'function' ||
      typeof request.devPath !== 'string' ||
      request.devPath.length === 0
    ) {
      return err({
        kind: DevFailureKind.Configuration,
        message:
          'The landing packet must include featureBranch, originMainSha, pinnedLocalDevSha, and devPath',
      });
    }

    // The sibling CLI/type contract carries featureBranch. Keep this runtime
    // boundary source-compatible with the pre-contract type until integration.
    const featureBranch = (
      request as DevLandRequest & { readonly featureBranch?: unknown }
    ).featureBranch;
    if (
      !featureBranch ||
      typeof featureBranch !== 'object' ||
      typeof (featureBranch as { readonly equals?: unknown }).equals !==
        'function' ||
      typeof (featureBranch as { readonly value?: unknown }).value !==
        'function'
    ) {
      return err({
        kind: DevFailureKind.Configuration,
        message:
          'The landing packet must include featureBranch, originMainSha, pinnedLocalDevSha, and devPath',
      });
    }
    let branchValue: unknown;
    try {
      branchValue = (
        featureBranch as { readonly value: () => unknown }
      ).value();
    } catch {
      return err({
        kind: DevFailureKind.Configuration,
        message: 'The landing packet must include a canonical feature branch',
      });
    }
    if (typeof branchValue !== 'string') {
      return err({
        kind: DevFailureKind.Configuration,
        message: 'The landing packet must include a canonical feature branch',
      });
    }
    let canonicalBranch: CanonicalFeatureBranch;
    try {
      canonicalBranch = CanonicalFeatureBranchContract.parse(branchValue);
    } catch (error) {
      return err({
        kind: DevFailureKind.Configuration,
        message:
          error instanceof Error
            ? error.message
            : 'The landing packet must include a canonical feature branch',
      });
    }
    const parsedBranch = BranchName.parseFeature(canonicalBranch);
    if (parsedBranch.isErr()) return err(parsedBranch.error);
    const branchGuard = this.requireFeatureBranch(parsedBranch.value);
    if (branchGuard.isErr()) return err(branchGuard.error);
    return ok({
      devPath: request.devPath,
      featureBranch: parsedBranch.value,
      originMainSha: request.originMainSha,
      pinnedLocalDevSha: request.pinnedLocalDevSha,
    });
  }
}
