import { err, ok, type Result } from "neverthrow";

import { DevDeliveryWorkspace, DevWorkspaceGuard } from "./dev-workspace.ts";
import {
  Ancestry,
  DevFailureKind,
  ManagedBranch,
  RemoteBranchPresence,
  type BranchName,
  type CommitSha,
  type DevFailure,
} from "./dev-types.ts";

export enum DevLandMode {
  Merged = "merged",
  AlreadyPresent = "already-present",
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

  execute(): Result<DevLandOutcome, DevFailure> {
    const featureBranch = this.workspace.git.currentBranch();
    if (featureBranch.isErr()) return err(featureBranch.error);
    const branchGuard = this.requireFeatureBranch(featureBranch.value);
    if (branchGuard.isErr()) return err(branchGuard.error);
    const featureSha = this.workspace.git.head();
    if (featureSha.isErr()) return err(featureSha.error);
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
          "The feature branch is not pushed at its exact current commit; push the feature branch before landing",
      });
    }

    const proof = this.workspace.github.buildProof({
      branch: featureBranch.value,
      sha: featureSha.value,
    });
    if (proof.isErr()) return err(proof.error);

    const lease = this.workspace.localLock();
    if (lease.isErr()) return err(lease.error);
    const result = this.landInsideLock({
      featureBranch: featureBranch.value,
      featureSha: featureSha.value,
    });
    const released = lease.value.release();
    if (released.isErr()) return err(released.error);
    return result;
  }

  private landInsideLock(request: {
    readonly featureBranch: BranchName;
    readonly featureSha: CommitSha;
  }): Result<DevLandOutcome, DevFailure> {
    const currentFeature = this.workspace.git.currentBranch();
    if (currentFeature.isErr()) return err(currentFeature.error);
    if (!currentFeature.value.equals(request.featureBranch)) {
      return err({
        kind: DevFailureKind.Race,
        message: "The feature worktree branch changed while landing was queued",
      });
    }
    const currentSha = this.workspace.git.head();
    if (currentSha.isErr()) return err(currentSha.error);
    if (!currentSha.value.equals(request.featureSha)) {
      return err({
        kind: DevFailureKind.Race,
        message: "The feature worktree commit changed while landing was queued",
      });
    }
    const cleanFeature = new DevWorkspaceGuard(this.workspace).requireClean(
      this.workspace.root,
    );
    if (cleanFeature.isErr()) return err(cleanFeature.error);
    const remoteFeature = this.workspace.git.remoteBranch(request.featureBranch);
    if (remoteFeature.isErr()) return err(remoteFeature.error);
    if (
      remoteFeature.value.presence !== RemoteBranchPresence.Present ||
      !remoteFeature.value.sha.equals(request.featureSha)
    ) {
      return err({
        kind: DevFailureKind.Race,
        message: "The pushed feature branch changed before its local landing",
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
    const ancestry = this.workspace.git.ancestry({
      ancestor: request.featureSha,
      descendant: developmentHead.value,
      workingDirectory: development.value.path,
    });
    if (ancestry.isErr()) return err(ancestry.error);
    if (ancestry.value === Ancestry.Ancestor) {
      return ok({
        mode: DevLandMode.AlreadyPresent,
        featureSha: request.featureSha,
        devSha: developmentHead.value,
        message: `Feature ${request.featureSha.value()} is already present in local dev; no merge was needed`,
      });
    }

    const merged = this.workspace.git.mergeInto({
      devPath: development.value.path,
      expectedDevHead: developmentHead.value,
      featureHead: request.featureSha,
    });
    if (merged.isErr()) return err(merged.error);
    const included = this.workspace.git.ancestry({
      ancestor: request.featureSha,
      descendant: merged.value,
      workingDirectory: development.value.path,
    });
    if (included.isErr()) return err(included.error);
    if (included.value !== Ancestry.Ancestor) {
      return err({
        kind: DevFailureKind.Conflict,
        message: "The local dev merge completed without retaining the feature commit",
      });
    }
    return ok({
      mode: DevLandMode.Merged,
      featureSha: request.featureSha,
      devSha: merged.value,
      message: `Landed ${request.featureSha.value()} into local dev at ${merged.value.value()}`,
    });
  }

  private requireFeatureBranch(branch: BranchName): Result<void, DevFailure> {
    if (
      branch.value() === ManagedBranch.Main ||
      branch.value() === ManagedBranch.Dev
    ) {
      return err({
        kind: DevFailureKind.Configuration,
        message: "dev:land requires a feature branch; managed main/dev branches are not callable features",
      });
    }
    return ok();
  }
}
