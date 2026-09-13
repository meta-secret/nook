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

/** Stable discriminator for a feature branch that moved after compilation. */
export const BranchAdvanced = 'branch-advanced' as const;

export interface BranchAdvancedFailure extends DevFailure {
  readonly kind: DevFailureKind.Race;
  readonly code: typeof BranchAdvanced;
  readonly branch: BranchName;
  readonly currentHead: CommitSha;
}

export function branchAdvancedFailure(
  branch: BranchName,
  currentHead: CommitSha,
): BranchAdvancedFailure {
  return {
    kind: DevFailureKind.Race,
    code: BranchAdvanced,
    branch,
    currentHead,
    message:
      `The canonical feature branch ${branch.value()} advanced to ${currentHead.value()} after build:compile evidence; rerun build:compile before landing`,
  };
}

export function isBranchAdvancedFailure(
  failure: DevFailure,
): failure is BranchAdvancedFailure {
  return (
    failure.kind === DevFailureKind.Race &&
    'code' in failure &&
    failure.code === BranchAdvanced &&
    'currentHead' in failure &&
    typeof failure.currentHead === 'object'
  );
}

export interface MergeRequest {
  readonly featureHead: CommitSha;
  readonly featureBranch: BranchName;
}

interface MergeInputs {
  readonly devHead: CommitSha;
  readonly devExists: boolean;
  readonly devPath: string | undefined;
  readonly originMainSha: CommitSha;
  readonly localMainSha: CommitSha;
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
}

/** Owns the final guarded feature-to-dev fast-forward mutation boundary. */
export class DevGitMergeBoundary {
  constructor(private readonly dependencies: MergeBoundaryDependencies) {}

  mergeInto(request: MergeRequest): Result<CommitSha, DevFailure> {
    const refreshed = this.dependencies.repository.refreshManagedRefs({
      prune: true,
    });
    if (refreshed.isErr()) return err(refreshed.error);

    const before = this.verifyMergeInputs(request);
    if (before.isErr()) return err(before.error);

    const landingDirectory = before.value.devPath ?? this.dependencies.featurePath;
    const alreadyPresent = this.dependencies.repository.ancestry({
      ancestor: request.featureHead,
      descendant: before.value.devHead,
      workingDirectory: landingDirectory,
    });
    if (alreadyPresent.isErr()) return err(alreadyPresent.error);
    if (
      before.value.devExists &&
      alreadyPresent.value === Ancestry.Ancestor
    ) {
      return ok(before.value.devHead);
    }

    const final = this.verifyMergeInputs(request);
    if (final.isErr()) return err(final.error);
    if (!this.sameInputs(before.value, final.value)) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'The canonical feature, origin/main, local main, or local dev identity changed before the landing mutation',
      });
    }

    const fastForward = this.dependencies.repository.ancestry({
      ancestor: final.value.devHead,
      descendant: request.featureHead,
      workingDirectory: landingDirectory,
    });
    if (fastForward.isErr()) return err(fastForward.error);
    if (fastForward.value !== Ancestry.Ancestor) {
      return err({
        kind: DevFailureKind.Conflict,
        message:
          'The canonical feature head is not a fast-forward of local dev; merge local dev into FEATURE, rebuild it remotely, and retry',
      });
    }

    const mutation = final.value.devPath
      ? this.fastForwardCheckedWorktree(
          final.value.devPath,
          final.value.devHead,
          request.featureHead,
        )
      : this.updateLocalDevRef(
          request.featureHead,
          final.value.devHead,
          final.value.devExists,
        );
    if (mutation.isErr()) return err(mutation.error);

    const afterDev = this.dependencies.repository.localBranchHead(
      ManagedBranch.Dev,
    );
    if (afterDev.isErr()) return err(afterDev.error);
    if (afterDev.value === undefined) {
      return err({
        kind: DevFailureKind.Race,
        message: 'refs/heads/dev disappeared after the landing mutation',
      });
    }
    if (!afterDev.value.equals(request.featureHead)) {
      return err({
        kind: DevFailureKind.Race,
        message:
          `refs/heads/dev did not finish at the expected feature head: expected ${request.featureHead.value()}, found ${afterDev.value.value()}`,
      });
    }

    const afterMain = this.dependencies.repository.localBranchHead(
      ManagedBranch.Main,
    );
    if (afterMain.isErr()) return err(afterMain.error);
    if (
      afterMain.value === undefined ||
      !afterMain.value.equals(before.value.localMainSha)
    ) {
      return err({
        kind: DevFailureKind.Race,
        message: 'local main changed while landing feature into dev',
      });
    }

    const retained = this.dependencies.repository.ancestry({
      ancestor: before.value.devHead,
      descendant: afterDev.value,
      workingDirectory: landingDirectory,
    });
    if (retained.isErr()) return err(retained.error);
    if (retained.value !== Ancestry.Ancestor) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'The local dev landing rewound or dropped commits from its prior head',
      });
    }

    if (final.value.devPath !== undefined) {
      const afterAssigned = this.dependencies.repository.managedWorktreeAt(
        final.value.devPath,
        ManagedBranch.Dev,
      );
      if (afterAssigned.isErr()) {
        return err({
          kind: DevFailureKind.Race,
          message: 'The checked-out local dev worktree changed during landing',
        });
      }
      const afterBranch = this.dependencies.repository.branchAt(
        afterAssigned.value.path,
      );
      if (
        afterBranch.isErr() ||
        afterBranch.value.value() !== ManagedBranch.Dev
      ) {
        return err({
          kind: DevFailureKind.Race,
          message: 'The checked-out local dev worktree changed during landing',
        });
      }
      const afterState = this.dependencies.repository.stateAt(
        afterAssigned.value.path,
      );
      if (afterState.isErr()) return err(afterState.error);
      if (afterState.value !== WorktreeState.Clean) {
        return err({
          kind: DevFailureKind.DirtyWorktree,
          message:
            'The local dev fast-forward left its checked-out worktree dirty; no cleanup was attempted',
        });
      }
      const afterHead = this.dependencies.repository.headAt(
        afterAssigned.value.path,
      );
      if (afterHead.isErr()) return err(afterHead.error);
      if (!afterHead.value.equals(afterDev.value)) {
        return err({
          kind: DevFailureKind.Race,
          message:
            'The checked-out local dev worktree and refs/heads/dev disagree after landing',
        });
      }
    } else {
      const afterWorktree =
        this.dependencies.repository.developmentWorktreeForLanding();
      if (afterWorktree.isErr()) return err(afterWorktree.error);
      if (afterWorktree.value !== undefined) {
        return err({
          kind: DevFailureKind.Race,
          message: 'A checked-out local dev worktree appeared during landing',
        });
      }
    }

    return ok(afterDev.value);
  }

  private fastForwardCheckedWorktree(
    path: string,
    expectedDevHead: CommitSha,
    featureHead: CommitSha,
  ): Result<void, DevFailure> {
    const assigned = this.dependencies.repository.managedWorktreeAt(
      path,
      ManagedBranch.Dev,
    );
    if (assigned.isErr()) {
      return err({
        kind: DevFailureKind.Race,
        message: 'The checked-out local dev worktree changed before landing',
      });
    }
    const branch = this.dependencies.repository.branchAt(assigned.value.path);
    if (branch.isErr() || branch.value.value() !== ManagedBranch.Dev) {
      return err({
        kind: DevFailureKind.Race,
        message: 'The checked-out local dev worktree changed before landing',
      });
    }
    const state = this.dependencies.repository.stateAt(assigned.value.path);
    if (state.isErr()) return err(state.error);
    if (state.value !== WorktreeState.Clean) {
      return err({
        kind: DevFailureKind.DirtyWorktree,
        message: 'Local dev is dirty; refusing to alter it',
      });
    }
    const head = this.dependencies.repository.headAt(assigned.value.path);
    if (head.isErr()) return err(head.error);
    if (!head.value.equals(expectedDevHead)) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'Local dev changed before its fast-forward; no mutation was attempted',
      });
    }
    const merge = this.dependencies.execute({
      args: ['merge', '--ff-only', featureHead.value()],
      workingDirectory: assigned.value.path,
    });
    if (merge.isErr()) return err(merge.error);
    if (merge.value.exitCode !== 0) {
      return err({
        kind: DevFailureKind.Conflict,
        message: `Local dev fast-forward failed: ${new CommandFailureMessage(merge.value).text()}`,
      });
    }
    return ok();
  }

  private updateLocalDevRef(
    featureHead: CommitSha,
    expectedDevHead: CommitSha,
    devExists: boolean,
  ): Result<void, DevFailure> {
    const checkedOut =
      this.dependencies.repository.developmentWorktreeForLanding();
    if (checkedOut.isErr()) return err(checkedOut.error);
    if (checkedOut.value !== undefined) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'A checked-out local dev worktree appeared before its transactional fast-forward',
      });
    }
    const expected = devExists
      ? expectedDevHead.value()
      : '0000000000000000000000000000000000000000';
    const update = this.dependencies.execute({
      args: [
        'update-ref',
        `refs/heads/${ManagedBranch.Dev}`,
        featureHead.value(),
        expected,
      ],
      workingDirectory: this.dependencies.featurePath,
    });
    if (update.isErr()) return err(update.error);
    if (update.value.exitCode !== 0) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'Local dev changed before its transactional fast-forward; no force update was attempted',
      });
    }
    return ok();
  }

  /** Revalidates mutable packet and repository identities before mutation. */
  private verifyMergeInputs(
    request: MergeRequest,
  ): Result<MergeInputs, DevFailure> {
    const repository = this.dependencies.repository;
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
    const remoteFeature = repository.remoteBranch(request.featureBranch);
    if (remoteFeature.isErr()) return err(remoteFeature.error);
    if (remoteFeature.value.presence !== RemoteBranchPresence.Present) {
      return err({
        kind: DevFailureKind.Race,
        message:
          'The pushed feature branch changed before its feature merge could begin',
      });
    }
    if (!remoteFeature.value.sha.equals(request.featureHead)) {
      return err(
        branchAdvancedFailure(request.featureBranch, remoteFeature.value.sha),
      );
    }

    const originMain = repository.remoteBranch(ManagedBranch.Main);
    if (originMain.isErr()) return err(originMain.error);
    if (originMain.value.presence !== RemoteBranchPresence.Present) {
      return err({
        kind: DevFailureKind.Configuration,
        message:
          'origin/main must exist before the feature could land in local dev',
      });
    }
    const localMain = repository.localBranchHead(ManagedBranch.Main);
    if (localMain.isErr()) return err(localMain.error);
    if (localMain.value === undefined) {
      return err({
        kind: DevFailureKind.Configuration,
        message: 'Local refs/heads/main must exist before landing into dev',
      });
    }
    const originOnMain = repository.ancestry({
      ancestor: originMain.value.sha,
      descendant: localMain.value,
      workingDirectory: this.dependencies.featurePath,
    });
    if (originOnMain.isErr()) return err(originOnMain.error);
    if (originOnMain.value !== Ancestry.Ancestor) {
      return err({
        kind: DevFailureKind.Conflict,
        message: 'Local main is not descended from the current origin/main',
      });
    }

    const selectedDevelopment = repository.developmentWorktreeForLanding();
    if (selectedDevelopment.isErr()) return err(selectedDevelopment.error);

    let devHead: CommitSha;
    let devExists: boolean;
    let devPath: string | undefined;
    if (selectedDevelopment.value !== undefined) {
      const assigned = repository.managedWorktreeAt(
        selectedDevelopment.value.path,
        ManagedBranch.Dev,
      );
      if (assigned.isErr()) {
        return err({
          kind: DevFailureKind.Race,
          message:
            `The discovered development worktree is no longer uniquely managed: ${selectedDevelopment.value.path}`,
        });
      }
      const state = repository.stateAt(assigned.value.path);
      if (state.isErr()) return err(state.error);
      if (state.value !== WorktreeState.Clean) {
        return err({
          kind: DevFailureKind.DirtyWorktree,
          message: `Local dev is dirty; refusing to alter it: ${assigned.value.path}`,
        });
      }
      const branch = repository.branchAt(assigned.value.path);
      if (branch.isErr() || branch.value.value() !== ManagedBranch.Dev) {
        return err({
          kind: DevFailureKind.Race,
          message: 'The discovered local dev worktree changed branches',
        });
      }
      const head = repository.headAt(assigned.value.path);
      if (head.isErr()) return err(head.error);
      const ref = repository.localBranchHead(ManagedBranch.Dev);
      if (ref.isErr()) return err(ref.error);
      if (ref.value === undefined || !head.value.equals(ref.value)) {
        return err({
          kind: DevFailureKind.Race,
          message:
            'The checked-out local dev worktree and refs/heads/dev disagree before landing',
        });
      }
      devHead = ref.value;
      devExists = true;
      devPath = assigned.value.path;
    } else {
      const ref = repository.localBranchHead(ManagedBranch.Dev);
      if (ref.isErr()) return err(ref.error);
      devHead = ref.value ?? localMain.value;
      devExists = ref.value !== undefined;
    }

    const devFromOrigin = repository.ancestry({
      ancestor: originMain.value.sha,
      descendant: devHead,
      workingDirectory: devPath ?? this.dependencies.featurePath,
    });
    if (devFromOrigin.isErr()) return err(devFromOrigin.error);
    if (devFromOrigin.value !== Ancestry.Ancestor) {
      return err({
        kind: DevFailureKind.Conflict,
        message: 'Local dev is not descended from the current origin/main',
      });
    }
    const featureFromOrigin = repository.ancestry({
      ancestor: originMain.value.sha,
      descendant: request.featureHead,
      workingDirectory: devPath ?? this.dependencies.featurePath,
    });
    if (featureFromOrigin.isErr()) return err(featureFromOrigin.error);
    if (featureFromOrigin.value !== Ancestry.Ancestor) {
      return err({
        kind: DevFailureKind.Conflict,
        message:
          'The canonical feature head is not descended from the current origin/main',
      });
    }
    if (!devExists) {
      const featureFromLocalMain = repository.ancestry({
        ancestor: localMain.value,
        descendant: request.featureHead,
        workingDirectory: this.dependencies.featurePath,
      });
      if (featureFromLocalMain.isErr()) return err(featureFromLocalMain.error);
      if (featureFromLocalMain.value !== Ancestry.Ancestor) {
        return err({
          kind: DevFailureKind.Conflict,
          message:
            'The canonical feature head is not descended from current local main',
        });
      }
    }

    return ok({
      devHead,
      devExists,
      devPath,
      originMainSha: originMain.value.sha,
      localMainSha: localMain.value,
    });
  }

  private sameInputs(before: MergeInputs, after: MergeInputs): boolean {
    return (
      before.devExists === after.devExists &&
      before.devHead.equals(after.devHead) &&
      before.originMainSha.equals(after.originMainSha) &&
      before.localMainSha.equals(after.localMainSha) &&
      before.devPath === after.devPath
    );
  }
}
