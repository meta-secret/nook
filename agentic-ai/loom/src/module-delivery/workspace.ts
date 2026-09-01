import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

import { gitText, runModuleDeliveryGit } from './git-command.ts';
import {
  CANONICAL_TASK_ID,
  EXACT_GIT_COMMIT,
  EXACT_PLAN_DIGEST,
  canonicalDirectory,
} from './workspace-paths.ts';

import type { GitCommandRequest } from './git-command.ts';

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

function git(request: GitCommandRequest): string {
  return gitText(runModuleDeliveryGit(request));
}

function validateRequest(request: PrepareModuleWorktreeRequest): void {
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

function validateHandle(workspace: ModuleWorktreeHandle): void {
  validateRequest({
    repositoryRoot: workspace.sourceRepositoryRoot,
    workspaceRoot: workspace.ownedWorkspaceRoot,
    planDigest: workspace.planDigest,
    taskId: workspace.taskId,
    attempt: workspace.attempt,
    baselineCommit: workspace.baselineCommit,
  });
  const root = canonicalDirectory({
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
    git({ cwd: root, args: ['rev-parse', '--show-toplevel'] }),
  );
  const common = realpathSync(
    resolve(
      git({
        cwd: root,
        args: ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      }),
    ),
  );
  const admin = realpathSync(
    resolve(
      git({
        cwd: root,
        args: ['rev-parse', '--path-format=absolute', '--git-dir'],
      }),
    ),
  );
  if (
    top !== root ||
    workspace.gitCommonDirectory !== common ||
    workspace.worktreeAdminDirectory !== admin
  )
    throw new Error(
      'Module workspace identity does not match the shared checkout.',
    );
  if (
    git({
      cwd: root,
      args: ['rev-parse', '--verify', `${workspace.baselineCommit}^{commit}`],
    }) !== workspace.baselineCommit
  )
    throw new Error(
      'Module baseline does not resolve to the requested commit.',
    );
}

export function prepareModuleWorktree(
  request: PrepareModuleWorktreeRequest,
): ModuleWorktreeHandle {
  validateRequest(request);
  const sourceRepositoryRoot = canonicalDirectory({
    path: request.repositoryRoot,
    label: 'Shared repository root',
  });
  const top = resolve(
    git({
      cwd: sourceRepositoryRoot,
      args: ['rev-parse', '--show-toplevel'],
    }),
  );
  if (top !== sourceRepositoryRoot)
    throw new Error('Shared repository root is not the Git top level.');
  const branch = runModuleDeliveryGit({
    cwd: sourceRepositoryRoot,
    args: ['symbolic-ref', '--quiet', 'HEAD'],
    allowFailure: true,
  });
  if (branch.exitCode !== 0 || !gitText(branch).startsWith('refs/heads/'))
    throw new Error('Shared module checkout must be on a branch.');
  const head = git({
    cwd: sourceRepositoryRoot,
    args: ['rev-parse', '--verify', 'HEAD^{commit}'],
  });
  if (head !== request.baselineCommit)
    throw new Error('Shared module checkout HEAD must equal its baseline.');
  if (
    runModuleDeliveryGit({
      cwd: sourceRepositoryRoot,
      args: ['status', '--porcelain=v1', '-z'],
    }).stdout.length !== 0
  )
    throw new Error('Shared module checkout must be clean before dispatch.');
  const gitCommonDirectory = realpathSync(
    resolve(
      git({
        cwd: sourceRepositoryRoot,
        args: ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      }),
    ),
  );
  const worktreeAdminDirectory = realpathSync(
    resolve(
      git({
        cwd: sourceRepositoryRoot,
        args: ['rev-parse', '--path-format=absolute', '--git-dir'],
      }),
    ),
  );
  const handle: ModuleWorktreeHandle = Object.freeze({
    sourceRepositoryRoot,
    ownedWorkspaceRoot: sourceRepositoryRoot,
    worktreePath: sourceRepositoryRoot,
    worktreeAdminDirectory,
    gitCommonDirectory,
    worktreeId: 'shared-checkout',
    planDigest: request.planDigest,
    taskId: request.taskId,
    attempt: request.attempt,
    baselineCommit: request.baselineCommit,
  });
  validateHandle(handle);
  return handle;
}

export function cleanupModuleWorktree(
  request: CleanupModuleWorktreeRequest,
): CleanupModuleWorktreeResult {
  validateHandle(request.workspace);
  return { removed: false };
}

export function assertPreparedModuleWorktreeIdentity(
  workspace: ModuleWorktreeHandle,
): void {
  validateHandle(workspace);
}

export function assertModuleWorktreeClean(
  workspace: ModuleWorktreeHandle,
): void {
  validateHandle(workspace);
  if (
    runModuleDeliveryGit({
      cwd: workspace.sourceRepositoryRoot,
      args: ['status', '--porcelain=v1', '-z'],
    }).stdout.length !== 0
  )
    throw new Error('Shared module checkout must be clean.');
}
