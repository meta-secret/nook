import { err, ok, type Result } from 'neverthrow';

import { DevDeliveryWorkspace } from './dev-workspace.ts';
import {
  CanonicalFeatureBranchContract,
  type CanonicalFeatureBranch,
} from '../lib/base-evidence.ts';
import {
  Ancestry,
  BranchName,
  DevFailureKind,
  ManagedBranch,
  RemoteBranchPresence,
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
  readonly featureBranch: BranchName;
}

interface LandingDevelopment {
  readonly head: CommitSha;
  readonly path: string;
  readonly exists: boolean;
}

/** Owns the feature-to-local-dev admission and short serialized merge. */
export class DevLandCommand {
  constructor(private readonly workspace: DevDeliveryWorkspace) {}

  execute(request: DevLandRequest): Result<DevLandOutcome, DevFailure> {
    const packet = this.validatePacket(request);
    if (packet.isErr()) return err(packet.error);

    const lease = this.workspace.localLock();
    if (lease.isErr()) return err(lease.error);
    const result = this.landInsideLock(packet.value);
    const released = lease.value.release();
    if (released.isErr()) return err(released.error);
    return result;
  }

  private landInsideLock(
    request: BranchAuthoritativeLandRequest,
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

    let featureHead = this.workspace.git.resolveFeatureBranchHead(
      request.featureBranch,
    );
    if (featureHead.isErr()) return err(featureHead.error);

    const development = this.validateBase(featureHead.value);
    if (development.isErr()) return err(development.error);

    const proof = this.verifyBuildProof(request.featureBranch, featureHead.value);
    if (proof.isErr()) return err(proof.error);

    const ancestry = this.workspace.git.ancestry({
      ancestor: featureHead.value,
      descendant: development.value.head,
      workingDirectory: development.value.path,
    });
    if (ancestry.isErr()) return err(ancestry.error);
    if (
      development.value.exists &&
      ancestry.value === Ancestry.Ancestor
    ) {
      return ok({
        mode: DevLandMode.AlreadyPresent,
        featureSha: featureHead.value,
        devSha: development.value.head,
        message: `Feature ${featureHead.value.value()} is already present in local dev; no merge was needed`,
      });
    }

    // Refresh and resolve again at the landing edge. If the branch advanced
    // while the lock was held, bind fresh build evidence to its new head.
    const landingRefresh = this.workspace.git.refreshManagedRefs({
      prune: true,
    });
    if (landingRefresh.isErr()) return err(landingRefresh.error);
    const landingFeatureHead = this.workspace.git.resolveFeatureBranchHead(
      request.featureBranch,
    );
    if (landingFeatureHead.isErr()) return err(landingFeatureHead.error);
    if (!landingFeatureHead.value.equals(featureHead.value)) {
      const landingProof = this.verifyBuildProof(
        request.featureBranch,
        landingFeatureHead.value,
      );
      if (landingProof.isErr()) return err(landingProof.error);
      featureHead = landingFeatureHead;
    }

    const latestDevelopment = this.validateBase(featureHead.value);
    if (latestDevelopment.isErr()) return err(latestDevelopment.error);
    const latestAncestry = this.workspace.git.ancestry({
      ancestor: featureHead.value,
      descendant: latestDevelopment.value.head,
      workingDirectory: latestDevelopment.value.path,
    });
    if (latestAncestry.isErr()) return err(latestAncestry.error);
    if (
      latestDevelopment.value.exists &&
      latestAncestry.value === Ancestry.Ancestor
    ) {
      return ok({
        mode: DevLandMode.AlreadyPresent,
        featureSha: featureHead.value,
        devSha: latestDevelopment.value.head,
        message: `Feature ${featureHead.value.value()} is already present in local dev; no merge was needed`,
      });
    }

    // The merge boundary repeats mutable identity checks immediately before
    // mutation. A branch move in that window remains typed as BranchAdvanced.
    const merged = this.workspace.git.mergeInto({
      featureHead: featureHead.value,
      featureBranch: request.featureBranch,
    });
    if (merged.isErr()) return err(merged.error);
    return ok({
      mode: DevLandMode.Merged,
      featureSha: featureHead.value,
      devSha: merged.value,
      message: `Landed ${featureHead.value.value()} into local dev at ${merged.value.value()}`,
    });
  }

  private verifyBuildProof(
    ...[branch, featureHead]: [branch: BranchName, featureHead: CommitSha]
  ): Result<void, DevFailure> {
    const proof = this.workspace.github.buildProof({
      branch,
      sha: featureHead,
    });
    if (proof.isErr()) return err(proof.error);
    if (!proof.value.sha.equals(featureHead)) {
      return err({
        kind: DevFailureKind.Evidence,
        message:
          'The successful build:compile evidence did not describe the observed feature branch head',
      });
    }
    return ok();
  }

  /** Resolves the live local refs and any existing checked-out dev worktree. */
  private validateBase(
    featureHead: CommitSha,
  ): Result<LandingDevelopment, DevFailure> {
    const selectedDevelopment =
      this.workspace.git.developmentWorktreeForLanding();
    if (selectedDevelopment.isErr()) return err(selectedDevelopment.error);

    let development: LandingDevelopment;
    if (selectedDevelopment.value !== undefined) {
      const checkedOut = this.workspace.git.managedWorktreeAt(
        selectedDevelopment.value.path,
        ManagedBranch.Dev,
      );
      if (checkedOut.isErr()) return err(checkedOut.error);
      const guard = this.workspace.git.stateAt(checkedOut.value.path);
      if (guard.isErr()) return err(guard.error);
      if (guard.value !== WorktreeState.Clean) {
        return err({
          kind: DevFailureKind.DirtyWorktree,
          message: `Worktree is dirty; refusing to change it: ${checkedOut.value.path}`,
        });
      }
      const developmentHead = this.workspace.git.headAt(checkedOut.value.path);
      if (developmentHead.isErr()) return err(developmentHead.error);
      if (!checkedOut.value.head.equals(developmentHead.value)) {
        return err({
          kind: DevFailureKind.Race,
          message: `Assigned development worktree changed while landing was queued: ${checkedOut.value.path}`,
        });
      }
      development = {
        head: developmentHead.value,
        path: checkedOut.value.path,
        exists: true,
      };
    } else {
      const localDev = this.workspace.git.localBranchHead(ManagedBranch.Dev);
      if (localDev.isErr()) return err(localDev.error);
      if (localDev.value !== undefined) {
        development = {
          head: localDev.value,
          path: this.workspace.root,
          exists: true,
        };
      } else {
        const localMain = this.workspace.git.localBranchHead(ManagedBranch.Main);
        if (localMain.isErr()) return err(localMain.error);
        if (localMain.value === undefined) {
          return err({
            kind: DevFailureKind.Configuration,
            message:
              'Local refs/heads/main must exist before creating dev for landing',
          });
        }
        development = {
          head: localMain.value,
          path: this.workspace.root,
          exists: false,
        };
      }
    }

    const featureState = this.workspace.git.stateAt(this.workspace.root);
    if (featureState.isErr()) return err(featureState.error);
    if (featureState.value !== WorktreeState.Clean) {
      return err({
        kind: DevFailureKind.DirtyWorktree,
        message: `Feature worktree is dirty; refusing to land it: ${this.workspace.root}`,
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
    const localMain = this.workspace.git.localBranchHead(ManagedBranch.Main);
    if (localMain.isErr()) return err(localMain.error);
    if (localMain.value === undefined) {
      return err({
        kind: DevFailureKind.Configuration,
        message: 'Local refs/heads/main must exist before landing into dev',
      });
    }
    const devFromMain = this.workspace.git.ancestry({
      ancestor: main.value.sha,
      descendant: development.head,
      workingDirectory: development.path,
    });
    if (devFromMain.isErr()) return err(devFromMain.error);
    if (devFromMain.value !== Ancestry.Ancestor) {
      return err({
        kind: DevFailureKind.Conflict,
        message:
          'Canonical local dev is not descended from the current origin/main',
      });
    }

    if (!development.exists) {
      const mainToFeature = this.workspace.git.ancestry({
        ancestor: localMain.value,
        descendant: featureHead,
        workingDirectory: this.workspace.root,
      });
      if (mainToFeature.isErr()) return err(mainToFeature.error);
      if (mainToFeature.value !== Ancestry.Ancestor) {
        return err({
          kind: DevFailureKind.Conflict,
          message:
            'The canonical feature head is not descended from current local main',
        });
      }
    } else {
      const devToFeature = this.workspace.git.ancestry({
        ancestor: development.head,
        descendant: featureHead,
        workingDirectory: development.path,
      });
      if (devToFeature.isErr()) return err(devToFeature.error);
      if (devToFeature.value !== Ancestry.Ancestor) {
        return err({
          kind: DevFailureKind.Conflict,
          message:
            'The canonical feature head is not a fast-forward of local dev',
        });
      }
    }

    const featureFromMain = this.workspace.git.ancestry({
      ancestor: main.value.sha,
      descendant: featureHead,
      workingDirectory: development.path,
    });
    if (featureFromMain.isErr()) return err(featureFromMain.error);
    if (featureFromMain.value !== Ancestry.Ancestor) {
      return err({
        kind: DevFailureKind.Conflict,
        message:
          'The canonical feature head is not descended from the current origin/main',
      });
    }
    return ok(development);
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
    if (!request || !request.featureBranch) {
      return err({
        kind: DevFailureKind.Configuration,
        message:
          'The landing packet must include featureBranch',
      });
    }

    // Validate the runtime boundary as well as the static request type.
    const featureBranch = request.featureBranch;
    if (
      !featureBranch ||
      typeof featureBranch !== 'object' ||
      typeof featureBranch.equals !== 'function' ||
      typeof featureBranch.value !== 'function'
    ) {
      return err({
        kind: DevFailureKind.Configuration,
        message:
          'The landing packet must include featureBranch',
      });
    }
    let branchValue: string;
    try {
      branchValue = featureBranch.value();
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
      featureBranch: parsedBranch.value,
    });
  }
}
