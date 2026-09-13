import { err, ok, type Result } from 'neverthrow';

import { CommandFailureMessage } from './dev-command.ts';
import { type DevGitRepository } from './dev-git.ts';
import {
  Ancestry,
  BranchName,
  DevFailureKind,
  ManagedBranch,
  type CommandOutput,
  type CommitSha,
  type DevFailure,
  RemoteBranchPresence,
  WorktreeState,
} from './dev-types.ts';

export interface MergeRequest {
  readonly devPath: string;
  readonly expectedDevHead: CommitSha;
  readonly featureHead: CommitSha;
  readonly featureBranch: BranchName;
  readonly originMainSha: CommitSha;
}

interface GitInvocation {
  readonly args: readonly string[];
  readonly workingDirectory: string;
}

interface MergeBoundaryDependencies {
  readonly repository: DevGitRepository;
  readonly featurePath: string;
  readonly execute: (
    request: GitInvocation,
  ) => Result<CommandOutput, DevFailure>;
  readonly branchHeadAt: (
    path: string,
    branch: ManagedBranch,
  ) => Result<CommitSha, DevFailure>;
}

/** Owns the final guarded feature-to-dev mutation boundary. */
export class DevGitMergeBoundary {
  constructor(private readonly dependencies: MergeBoundaryDependencies) {}

  mergeInto(request: MergeRequest): Result<CommitSha, DevFailure> {
    const repository = this.dependencies.repository;
    const assigned = repository.managedWorktreeAt(
      request.devPath,
      ManagedBranch.Dev,
    );
    if (assigned.isErr()) {
      return err({
        kind: DevFailureKind.Race,
        message:
          `Assigned development worktree is not a unique managed worktree in this repository: ${request.devPath}`,
      });
    }

    const featureBranch = repository.currentBranch();
    if (featureBranch.isErr()) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'The feature worktree became detached before its feature merge could begin',
      });
    }
    if (!featureBranch.value.equals(request.featureBranch)) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'The feature worktree branch changed before its feature merge could begin',
      });
    }
    const featureState = repository.stateAt(this.dependencies.featurePath);
    if (featureState.isErr()) return err(featureState.error);
    if (featureState.value !== WorktreeState.Clean) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'The feature worktree became dirty before its feature merge could begin',
      });
    }
    const featureHead = repository.head();
    if (featureHead.isErr()) return err(featureHead.error);
    if (!featureHead.value.equals(request.featureHead)) {
      return err({
        kind: DevFailureKind.Race,
        message:
          `The feature worktree commit changed before its feature merge could begin: expected ${request.featureHead.value()}, found ${featureHead.value.value()}`,
      });
    }
    const remoteFeature = repository.remoteBranch(request.featureBranch);
    if (remoteFeature.isErr()) return err(remoteFeature.error);
    if (
      remoteFeature.value.presence !== RemoteBranchPresence.Present ||
      !remoteFeature.value.sha.equals(request.featureHead)
    ) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'The pushed feature branch changed before its feature merge could begin',
      });
    }
    const originMain = repository.remoteBranch(ManagedBranch.Main);
    if (originMain.isErr()) return err(originMain.error);
    if (
      originMain.value.presence !== RemoteBranchPresence.Present ||
      !originMain.value.sha.equals(request.originMainSha)
    ) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'origin/main changed before the feature could land in local dev',
      });
    }
    const current = repository.headAt(request.devPath);
    if (current.isErr()) return err(current.error);
    if (!current.value.equals(request.expectedDevHead)) {
      return err({
        kind: DevFailureKind.Race,
        message: 'Local dev changed while landing was being prepared',
      });
    }
    const beforeDevRef = this.dependencies.branchHeadAt(
      request.devPath,
      ManagedBranch.Dev,
    );
    if (beforeDevRef.isErr()) return err(beforeDevRef.error);
    if (!beforeDevRef.value.equals(request.expectedDevHead)) {
      return err({
        kind: DevFailureKind.Race,
        message:
          `refs/heads/dev changed while landing was being prepared: expected ${request.expectedDevHead.value()}, found ${beforeDevRef.value.value()}`,
      });
    }
    const state = repository.stateAt(request.devPath);
    if (state.isErr()) return err(state.error);
    if (state.value !== WorktreeState.Clean) {
      return err({
        kind: DevFailureKind.DirtyWorktree,
        message: `Local dev is dirty; refusing to alter it: ${request.devPath}`,
      });
    }
    const preview = this.dependencies.execute({
      args: [
        'merge-tree',
        '--write-tree',
        request.expectedDevHead.value(),
        request.featureHead.value(),
      ],
      workingDirectory: request.devPath,
    });
    if (preview.isErr()) return err(preview.error);
    if (preview.value.exitCode !== 0) {
      return err({
        kind: DevFailureKind.Conflict,
        message:
          'Feature cannot merge cleanly into local dev; merge latest local dev into FEATURE, rebuild it remotely, and retry',
      });
    }

    // merge-tree is read-only. Revalidate the assigned path, checkout, and
    // branch ref after it so a replaced worktree or ref cannot be mutated.
    const finalFeatureBranch = repository.currentBranch();
    if (finalFeatureBranch.isErr()) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'The feature worktree became detached before its feature merge could begin',
      });
    }
    if (!finalFeatureBranch.value.equals(request.featureBranch)) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'The feature worktree branch changed before its feature merge could begin',
      });
    }
    const finalFeatureState = repository.stateAt(this.dependencies.featurePath);
    if (finalFeatureState.isErr()) return err(finalFeatureState.error);
    if (finalFeatureState.value !== WorktreeState.Clean) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'The feature worktree became dirty before its feature merge could begin',
      });
    }
    const finalFeatureHead = repository.head();
    if (finalFeatureHead.isErr()) return err(finalFeatureHead.error);
    if (!finalFeatureHead.value.equals(request.featureHead)) {
      return err({
        kind: DevFailureKind.Race,
        message:
          `The feature worktree commit changed before its feature merge could begin: expected ${request.featureHead.value()}, found ${finalFeatureHead.value.value()}`,
      });
    }
    const finalRemoteFeature = repository.remoteBranch(request.featureBranch);
    if (finalRemoteFeature.isErr()) return err(finalRemoteFeature.error);
    if (
      finalRemoteFeature.value.presence !== RemoteBranchPresence.Present ||
      !finalRemoteFeature.value.sha.equals(request.featureHead)
    ) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'The pushed feature branch changed before its feature merge could begin',
      });
    }
    const finalOriginMain = repository.remoteBranch(ManagedBranch.Main);
    if (finalOriginMain.isErr()) return err(finalOriginMain.error);
    if (
      finalOriginMain.value.presence !== RemoteBranchPresence.Present ||
      !finalOriginMain.value.sha.equals(request.originMainSha)
    ) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'origin/main changed before the feature could land in local dev',
      });
    }
    const finalDevHead = repository.headAt(request.devPath);
    if (finalDevHead.isErr()) return err(finalDevHead.error);
    if (!finalDevHead.value.equals(request.expectedDevHead)) {
      return err({
        kind: DevFailureKind.Race,
        message:
          `Local dev changed while landing was being prepared: expected ${request.expectedDevHead.value()}, found ${finalDevHead.value.value()}`,
      });
    }
    const finalDevState = repository.stateAt(request.devPath);
    if (finalDevState.isErr()) return err(finalDevState.error);
    if (finalDevState.value !== WorktreeState.Clean) {
      return err({
        kind: DevFailureKind.Race,
        message:
          `Local dev became dirty before its feature merge: ${request.devPath}`,
      });
    }
    const finalAssigned = repository.managedWorktreeAt(
      request.devPath,
      ManagedBranch.Dev,
    );
    if (finalAssigned.isErr() || finalAssigned.value.path !== request.devPath) {
      return err({
        kind: DevFailureKind.Race,
        message:
          `Assigned development worktree was replaced or is no longer uniquely managed before its feature merge: ${request.devPath}`,
      });
    }
    if (!finalAssigned.value.head.equals(finalDevHead.value)) {
      return err({
        kind: DevFailureKind.Race,
        message:
          `Assigned development worktree head changed before its feature merge: expected ${finalDevHead.value.value()}, found ${finalAssigned.value.head.value()}`,
      });
    }
    const finalDevRef = this.dependencies.branchHeadAt(
      request.devPath,
      ManagedBranch.Dev,
    );
    if (finalDevRef.isErr()) return err(finalDevRef.error);
    if (!finalDevRef.value.equals(beforeDevRef.value)) {
      return err({
        kind: DevFailureKind.Race,
        message:
          `refs/heads/dev changed after merge-tree and before the feature merge: expected ${beforeDevRef.value.value()}, found ${finalDevRef.value.value()}`,
      });
    }
    if (!finalDevRef.value.equals(finalDevHead.value)) {
      return err({
        kind: DevFailureKind.Race,
        message:
          `Assigned development checkout and refs/heads/dev disagree before the feature merge: checkout ${finalDevHead.value()}, ref ${finalDevRef.value.value()}`,
      });
    }

    const merge = this.dependencies.execute({
      args: ['merge', '--no-edit', request.featureHead.value()],
      workingDirectory: request.devPath,
    });
    if (merge.isErr()) return err(merge.error);
    if (merge.value.exitCode !== 0) {
      const abort = this.dependencies.execute({
        args: ['merge', '--abort'],
        workingDirectory: request.devPath,
      });
      const abortMessage =
        abort.isErr() || abort.value.exitCode !== 0
          ? ' Git merge abort also failed; inspect the shared dev worktree without discarding changes.'
          : '';
      return err({
        kind: DevFailureKind.Conflict,
        message: `Feature merge into local dev failed: ${new CommandFailureMessage(merge.value).text()}.${abortMessage}`,
      });
    }
    const after = repository.stateAt(request.devPath);
    if (after.isErr()) return err(after.error);
    if (after.value !== WorktreeState.Clean) {
      return err({
        kind: DevFailureKind.DirtyWorktree,
        message:
          'The local merge left dev dirty; no cleanup was attempted so foreign changes remain intact',
      });
    }
    const afterAssigned = repository.managedWorktreeAt(
      request.devPath,
      ManagedBranch.Dev,
    );
    if (afterAssigned.isErr() || afterAssigned.value.path !== request.devPath) {
      return err({
        kind: DevFailureKind.Race,
        message:
          `Assigned development worktree was replaced after its feature merge: ${request.devPath}`,
      });
    }
    const afterBranch = repository.branchAt(request.devPath);
    if (afterBranch.isErr()) {
      return err({
        kind: DevFailureKind.Race,
        message:
          `Assigned development worktree became detached after its feature merge: ${request.devPath}`,
      });
    }
    if (afterBranch.value.value() !== ManagedBranch.Dev) {
      return err({
        kind: DevFailureKind.Race,
        message:
          `Assigned development worktree changed from dev after its feature merge: ${request.devPath}`,
      });
    }
    const afterHead = repository.headAt(request.devPath);
    if (afterHead.isErr()) return err(afterHead.error);
    const afterDevRef = this.dependencies.branchHeadAt(
      request.devPath,
      ManagedBranch.Dev,
    );
    if (afterDevRef.isErr()) return err(afterDevRef.error);
    if (!afterDevRef.value.equals(afterHead.value)) {
      return err({
        kind: DevFailureKind.Race,
        message:
          `Assigned development checkout and refs/heads/dev disagree after the feature merge: checkout ${afterHead.value.value()}, ref ${afterDevRef.value.value()}`,
      });
    }
    if (afterDevRef.value.equals(beforeDevRef.value)) {
      return err({
        kind: DevFailureKind.Race,
        message:
          `Local dev did not advance after merging ${request.featureHead.value()}: ${request.devPath}`,
      });
    }
    const retained = repository.ancestry({
      ancestor: beforeDevRef.value,
      descendant: afterDevRef.value,
      workingDirectory: request.devPath,
    });
    if (retained.isErr()) return err(retained.error);
    if (retained.value !== Ancestry.Ancestor) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'The local dev merge rewound or dropped commits from the prior refs/heads/dev head',
      });
    }
    const included = repository.ancestry({
      ancestor: request.featureHead,
      descendant: afterDevRef.value,
      workingDirectory: request.devPath,
    });
    if (included.isErr()) return err(included.error);
    if (included.value !== Ancestry.Ancestor) {
      return err({
        kind: DevFailureKind.Conflict,
        message:
          'The local dev merge completed without retaining the expected feature commit',
      });
    }
    return ok(afterHead.value);
  }
}
