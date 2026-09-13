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
    const beforeDevRef = this.verifyMergeInputs(request);
    if (beforeDevRef.isErr()) return err(beforeDevRef.error);

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

    // merge-tree is read-only; revalidate every identity immediately before
    // mutating the assigned local-dev worktree.
    const finalDevRef = this.verifyMergeInputs(request);
    if (finalDevRef.isErr()) return err(finalDevRef.error);
    if (!finalDevRef.value.equals(beforeDevRef.value)) {
      return err({
        kind: DevFailureKind.Race,
        message:
          `refs/heads/dev changed after merge-tree and before the feature merge: expected ${beforeDevRef.value.value()}, found ${finalDevRef.value.value()}`,
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

    const repository = this.dependencies.repository;
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
    if (afterAssigned.isErr()) {
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
    if (!afterHead.value.equals(afterDevRef.value)) {
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

  /** Revalidates mutable packet identities before any local-dev mutation. */
  private verifyMergeInputs(
    request: MergeRequest,
  ): Result<CommitSha, DevFailure> {
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
    const devBranch = repository.branchAt(request.devPath);
    if (devBranch.isErr()) {
      return err({
        kind: DevFailureKind.Race,
        message:
          `Assigned development worktree became detached while landing was being prepared: ${request.devPath}`,
      });
    }
    if (devBranch.value.value() !== ManagedBranch.Dev) {
      return err({
        kind: DevFailureKind.Race,
        message:
          `Assigned development worktree changed from dev while landing was being prepared: ${request.devPath}`,
      });
    }
    const devHead = repository.headAt(request.devPath);
    if (devHead.isErr()) return err(devHead.error);
    const devRef = this.dependencies.branchHeadAt(
      request.devPath,
      ManagedBranch.Dev,
    );
    if (devRef.isErr()) return err(devRef.error);
    if (!devHead.value.equals(devRef.value)) {
      return err({
        kind: DevFailureKind.Race,
        message:
          `Assigned development checkout and refs/heads/dev disagree while landing was being prepared: checkout ${devHead.value.value()}, ref ${devRef.value.value()}`,
      });
    }
    if (!devHead.value.equals(request.expectedDevHead)) {
      return err({
        kind: DevFailureKind.Race,
        message:
          `Local dev changed while landing was being prepared: expected ${request.expectedDevHead.value()}, found ${devHead.value.value()}`,
      });
    }
    if (!devRef.value.equals(request.expectedDevHead)) {
      return err({
        kind: DevFailureKind.Race,
        message:
          `refs/heads/dev changed while landing was being prepared: expected ${request.expectedDevHead.value()}, found ${devRef.value.value()}`,
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
    return ok(devRef.value);
  }
}
