import { err, ok, type Result } from "neverthrow";

import { DevGitHubGateway } from "./dev-github.ts";
import { DevGitRepository, DevelopmentWorktreeSelection } from "./dev-git.ts";
import { DevLock, DevLockName, type DevLockLease } from "./dev-lock.ts";
import {
  DevFailureKind,
  type CommandRunner,
  type DevFailure,
  type WorktreeRecord,
  WorktreeState,
} from "./dev-types.ts";

/** Owns the bounded dependency wiring shared by the three manual commands. */
export class DevDeliveryWorkspace {
  readonly git: DevGitRepository;
  readonly github: DevGitHubGateway;

  constructor(
    readonly root: string,
    runner: CommandRunner,
  ) {
    this.git = new DevGitRepository({ root, runner });
    this.github = new DevGitHubGateway({
      runner,
      workingDirectory: root,
    });
  }

  localLock(): Result<DevLockLease, DevFailure> {
    return this.lock(DevLockName.LocalLanding);
  }

  publicationLock(): Result<DevLockLease, DevFailure> {
    return this.lock(DevLockName.Publication);
  }

  developmentWorktree(): Result<WorktreeRecord, DevFailure> {
    const inventory = this.git.worktrees();
    if (inventory.isErr()) return err(inventory.error);
    return new DevelopmentWorktreeSelection().select(inventory.value);
  }

  private lock(name: DevLockName): Result<DevLockLease, DevFailure> {
    const commonDirectory = this.git.commonDirectory();
    if (commonDirectory.isErr()) return err(commonDirectory.error);
    return new DevLock({
      commonDirectory: commonDirectory.value,
      name,
    }).acquire();
  }
}

export class DevCommandReport {
  constructor(readonly message: string) {}
}

export class DevWorkspaceGuard {
  constructor(private readonly workspace: DevDeliveryWorkspace) {}

  requireClean(path: string): Result<void, DevFailure> {
    const state = this.workspace.git.stateAt(path);
    if (state.isErr()) return err(state.error);
    if (state.value !== WorktreeState.Clean) {
      return err({
        kind: DevFailureKind.DirtyWorktree,
        message: `Worktree is dirty; refusing to change it: ${path}`,
      });
    }
    return ok();
  }
}
