import { realpathSync } from 'node:fs';

import { resolve } from 'node:path';

import { ModuleRepositoryGit } from './git-command.ts';

import {
  CANONICAL_TASK_ID,
  EXACT_GIT_COMMIT,
  EXACT_PLAN_DIGEST,
  CanonicalDirectory,
} from './workspace-paths.ts';

import type { GitCommandRequest } from './git-command.ts';

export class ModuleWorktree {
  private constructor(private readonly request: PrepareModuleWorktreeRequest) {}

  private static git(request: GitCommandRequest): string {
    return ModuleRepositoryGit.gitText(
      ModuleRepositoryGit.runModuleDeliveryGit(request),
    );
  }

  private static validateRequest(request: PrepareModuleWorktreeRequest): void {
    if (!EXACT_GIT_COMMIT.test(request.baselineCommit))
      throw new Error(
        'Module baseline must be an exact lowercase 40-hex commit.',
      );
    if (!EXACT_PLAN_DIGEST.test(request.planDigest))
      throw new Error(
        'Module plan digest must be an exact lowercase SHA-256 digest.',
      );
    if (!CANONICAL_TASK_ID.test(request.taskId))
      throw new Error('Module task id is noncanonical.');
    if (!Number.isSafeInteger(request.attempt) || request.attempt < 1)
      throw new Error('Module attempt must be a positive safe integer.');
  }

  private static validateHandle(workspace: ModuleWorktreeHandle): void {
    ModuleWorktree.validateRequest({
      repositoryRoot: workspace.sourceRepositoryRoot,
      workspaceRoot: workspace.ownedWorkspaceRoot,
      planDigest: workspace.planDigest,
      taskId: workspace.taskId,
      attempt: workspace.attempt,
      baselineCommit: workspace.baselineCommit,
    });
    const root = CanonicalDirectory.resolve({
      path: workspace.sourceRepositoryRoot,
      label: 'Shared repository root',
    });
    if (
      workspace.worktreePath !== root ||
      workspace.ownedWorkspaceRoot !== root ||
      workspace.worktreeId !== 'shared-checkout'
    )
      throw new Error('Module workspace must identify the shared checkout.');
    const top = resolve(
      ModuleWorktree.git({ cwd: root, args: ['rev-parse', '--show-toplevel'] }),
    );
    const common = realpathSync(
      resolve(
        ModuleWorktree.git({
          cwd: root,
          args: ['rev-parse', '--path-format=absolute', '--git-common-dir'],
        }),
      ),
    );
    const admin = realpathSync(
      resolve(
        ModuleWorktree.git({
          cwd: root,
          args: ['rev-parse', '--path-format=absolute', '--git-dir'],
        }),
      ),
    );
    if (
      top !== root ||
      workspace.gitCommonDirectory !== common ||
      workspace.worktreeAdminDirectory !== admin ||
      ModuleWorktree.git({
        cwd: root,
        args: ['symbolic-ref', '--quiet', 'HEAD'],
      }) !== workspace.branchName
    )
      throw new Error(
        'Module workspace identity does not match the shared checkout.',
      );
    if (
      ModuleWorktree.git({
        cwd: root,
        args: ['rev-parse', '--verify', `${workspace.baselineCommit}^{commit}`],
      }) !== workspace.baselineCommit
    )
      throw new Error(
        'Module baseline does not resolve to the requested commit.',
      );
  }

  static prepareModuleWorktree(
    request: PrepareModuleWorktreeRequest,
  ): ModuleWorktreeHandle {
    return new ModuleWorktree(request).execute();
  }

  private execute(): ModuleWorktreeHandle {
    const request = this.request;
    ModuleWorktree.validateRequest(request);
    const sourceRepositoryRoot = CanonicalDirectory.resolve({
      path: request.repositoryRoot,
      label: 'Shared repository root',
    });
    const top = resolve(
      ModuleWorktree.git({
        cwd: sourceRepositoryRoot,
        args: ['rev-parse', '--show-toplevel'],
      }),
    );
    if (top !== sourceRepositoryRoot)
      throw new Error('Shared repository root is not the Git top level.');
    if (
      ModuleWorktree.git({
        cwd: sourceRepositoryRoot,
        args: ['rev-parse', '--verify', 'HEAD^{commit}'],
      }) !== request.baselineCommit
    )
      throw new Error('Shared module checkout HEAD must match its baseline.');
    if (
      ModuleRepositoryGit.runModuleDeliveryGit({
        cwd: sourceRepositoryRoot,
        args: ['status', '--porcelain=v1', '-z'],
      }).stdout.length !== 0
    )
      throw new Error('Shared module checkout must be clean before dispatch.');
    const gitCommonDirectory = realpathSync(
      resolve(
        ModuleWorktree.git({
          cwd: sourceRepositoryRoot,
          args: ['rev-parse', '--path-format=absolute', '--git-common-dir'],
        }),
      ),
    );
    const worktreeAdminDirectory = realpathSync(
      resolve(
        ModuleWorktree.git({
          cwd: sourceRepositoryRoot,
          args: ['rev-parse', '--path-format=absolute', '--git-dir'],
        }),
      ),
    );
    const branchName = ModuleWorktree.git({
      cwd: sourceRepositoryRoot,
      args: ['symbolic-ref', '--quiet', 'HEAD'],
    });
    const handle: ModuleWorktreeHandle = Object.freeze({
      sourceRepositoryRoot,
      ownedWorkspaceRoot: sourceRepositoryRoot,
      worktreePath: sourceRepositoryRoot,
      worktreeAdminDirectory,
      gitCommonDirectory,
      worktreeId: 'shared-checkout',
      branchName,
      planDigest: request.planDigest,
      taskId: request.taskId,
      attempt: request.attempt,
      baselineCommit: request.baselineCommit,
    });
    ModuleWorktree.validateHandle(handle);
    return handle;
  }

  static cleanupModuleWorktree(
    request: CleanupModuleWorktreeRequest,
  ): CleanupModuleWorktreeResult {
    ModuleWorktree.validateHandle(request.workspace);
    return { removed: false };
  }

  static assertPreparedModuleWorktreeIdentity(
    workspace: ModuleWorktreeHandle,
  ): void {
    ModuleWorktree.validateHandle(workspace);
  }

  static assertModuleWorktreeClean(workspace: ModuleWorktreeHandle): void {
    ModuleWorktree.validateHandle(workspace);
    if (
      ModuleRepositoryGit.runModuleDeliveryGit({
        cwd: workspace.sourceRepositoryRoot,
        args: ['status', '--porcelain=v1', '-z'],
      }).stdout.length !== 0
    )
      throw new Error('Shared module checkout must be clean.');
  }
}

export type PrepareModuleWorktreeRequest = {
  readonly repositoryRoot: string;
  readonly workspaceRoot: string;
  readonly planDigest: string;
  readonly taskId: string;
  readonly attempt: number;
  readonly baselineCommit: string;
};

export type ModuleWorktreeHandle = {
  readonly sourceRepositoryRoot: string;
  readonly ownedWorkspaceRoot: string;
  readonly worktreePath: string;
  readonly worktreeAdminDirectory: string;
  readonly gitCommonDirectory: string;
  readonly worktreeId: string;
  readonly branchName: string;
  readonly planDigest: string;
  readonly taskId: string;
  readonly attempt: number;
  readonly baselineCommit: string;
};

export type CleanupModuleWorktreeRequest = {
  readonly workspace: ModuleWorktreeHandle;
};

export type CleanupModuleWorktreeResult = {
  readonly removed: boolean;
};
