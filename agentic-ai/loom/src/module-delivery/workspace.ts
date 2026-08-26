import { lstatSync, mkdtempSync, realpathSync, rmdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { gitText, runModuleDeliveryGit } from './git-command.ts';
import {
  CANONICAL_TASK_ID,
  EXACT_GIT_COMMIT,
  EXACT_PLAN_DIGEST,
  canonicalDirectory,
  isStrictDirectChild,
  pathExists,
  pathsAreDisjoint,
} from './workspace-paths.ts';

import type { GitCommandRequest } from './git-command.ts';
import type {
  CanonicalDirectoryRequest,
  DisjointPathsRequest,
  StrictChildPathRequest,
} from './workspace-paths.ts';

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

type RegisteredWorktree = {
  readonly path: string;
  readonly locked: boolean;
};

type WorkspaceIdentityInspection = {
  readonly workspace: ModuleWorktreeHandle;
  readonly requirePath: boolean;
};

type ModuleGitInvocation = {
  readonly cwd: string;
  readonly args: readonly string[];
  readonly allowFailure?: boolean;
};

enum AbsoluteGitDirectoryOption {
  Common = '--git-common-dir',
  Worktree = '--git-dir',
}

type AbsoluteGitDirectoryRequest = {
  readonly cwd: string;
  readonly option: AbsoluteGitDirectoryOption;
};

enum WorktreeRegistrationPresence {
  Absent = 'absent',
  Present = 'present',
}

type WorktreeRegistrationLookup =
  | { readonly presence: WorktreeRegistrationPresence.Absent }
  | {
      readonly presence: WorktreeRegistrationPresence.Present;
      readonly registration: RegisteredWorktree;
    };

type BaselineCommitInspection = {
  readonly repositoryRoot: string;
  readonly baselineCommit: string;
};

function gitRequest(invocation: ModuleGitInvocation): GitCommandRequest {
  return !('allowFailure' in invocation)
    ? { cwd: invocation.cwd, args: invocation.args }
    : {
        cwd: invocation.cwd,
        args: invocation.args,
        allowFailure: invocation.allowFailure,
      };
}

function validatePrepareRequest(request: PrepareModuleWorktreeRequest): void {
  if (!EXACT_GIT_COMMIT.test(request.baselineCommit)) {
    throw new Error(
      'Module baseline must be an exact lowercase 40-hex commit.',
    );
  }
  if (!EXACT_PLAN_DIGEST.test(request.planDigest)) {
    throw new Error(
      'Module plan digest must be an exact lowercase SHA-256 digest.',
    );
  }
  if (!CANONICAL_TASK_ID.test(request.taskId) || request.taskId.length > 80) {
    throw new Error('Module task id is noncanonical.');
  }
  if (!Number.isSafeInteger(request.attempt) || request.attempt < 1) {
    throw new Error('Module attempt must be a positive safe integer.');
  }
}

function absoluteGitDirectory(request: AbsoluteGitDirectoryRequest): string {
  const invocation: ModuleGitInvocation = {
    cwd: request.cwd,
    args: ['rev-parse', '--path-format=absolute', request.option],
  };
  return resolve(gitText(runModuleDeliveryGit(gitRequest(invocation))));
}

function assertRepositoryRoot(repositoryRoot: string): string {
  const rootRequest: CanonicalDirectoryRequest = {
    path: repositoryRoot,
    label: 'Source repository root',
  };
  const canonicalRoot = canonicalDirectory(rootRequest);
  const invocation: ModuleGitInvocation = {
    cwd: canonicalRoot,
    args: ['rev-parse', '--path-format=absolute', '--show-toplevel'],
  };
  if (
    resolve(gitText(runModuleDeliveryGit(gitRequest(invocation)))) !==
    canonicalRoot
  ) {
    throw new Error('Source repository root is not the Git top level.');
  }
  return canonicalRoot;
}

function assertBaselineCommit(inspection: BaselineCommitInspection): void {
  const invocation: ModuleGitInvocation = {
    cwd: inspection.repositoryRoot,
    args: ['rev-parse', '--verify', `${inspection.baselineCommit}^{commit}`],
  };
  if (
    gitText(runModuleDeliveryGit(gitRequest(invocation))) !==
    inspection.baselineCommit
  ) {
    throw new Error(
      'Module baseline does not resolve to the requested commit.',
    );
  }
}

function assertCleanWorkspace(worktreePath: string): void {
  const invocation: ModuleGitInvocation = {
    cwd: worktreePath,
    args: ['status', '--porcelain=v1', '-z'],
  };
  if (runModuleDeliveryGit(gitRequest(invocation)).stdout.length !== 0) {
    throw new Error('Module worktree must be clean.');
  }
}

function inspectWorkspaceIdentity(
  inspection: WorkspaceIdentityInspection,
): void {
  validateHandleShape(inspection.workspace);
  if (!pathExists(inspection.workspace.worktreePath)) {
    if (inspection.requirePath)
      throw new Error('Module worktree path is missing.');
    return;
  }
  const pathRequest: CanonicalDirectoryRequest = {
    path: inspection.workspace.worktreePath,
    label: 'Module worktree path',
  };
  const canonicalPath = canonicalDirectory(pathRequest);
  const topInvocation: ModuleGitInvocation = {
    cwd: canonicalPath,
    args: ['rev-parse', '--path-format=absolute', '--show-toplevel'],
  };
  const topLevel = resolve(
    gitText(runModuleDeliveryGit(gitRequest(topInvocation))),
  );
  const commonRequest: AbsoluteGitDirectoryRequest = {
    cwd: canonicalPath,
    option: AbsoluteGitDirectoryOption.Common,
  };
  const commonDirectory = realpathSync(absoluteGitDirectory(commonRequest));
  const adminRequest: AbsoluteGitDirectoryRequest = {
    cwd: canonicalPath,
    option: AbsoluteGitDirectoryOption.Worktree,
  };
  const adminDirectory = realpathSync(absoluteGitDirectory(adminRequest));
  if (
    topLevel !== inspection.workspace.worktreePath ||
    commonDirectory !== inspection.workspace.gitCommonDirectory ||
    adminDirectory !== inspection.workspace.worktreeAdminDirectory
  ) {
    throw new Error(
      'Module worktree identity does not match its prepared handle.',
    );
  }
  const childRequest: StrictChildPathRequest = {
    parent: join(commonDirectory, 'worktrees'),
    child: adminDirectory,
  };
  if (
    !isStrictDirectChild(childRequest) ||
    basename(adminDirectory) !== inspection.workspace.worktreeId
  ) {
    throw new Error('Module worktree administrative identity is invalid.');
  }
}

function validateHandleShape(workspace: ModuleWorktreeHandle): void {
  if (
    !EXACT_GIT_COMMIT.test(workspace.baselineCommit) ||
    !EXACT_PLAN_DIGEST.test(workspace.planDigest) ||
    !CANONICAL_TASK_ID.test(workspace.taskId) ||
    !Number.isSafeInteger(workspace.attempt) ||
    workspace.attempt < 1
  ) {
    throw new Error('Module worktree handle is malformed.');
  }
  const ownedChildRequest: StrictChildPathRequest = {
    parent: workspace.ownedWorkspaceRoot,
    child: workspace.worktreePath,
  };
  if (!isStrictDirectChild(ownedChildRequest)) {
    throw new Error('Module worktree is not a direct child of its owned root.');
  }
}

function worktreeRegistrations(
  repositoryRoot: string,
): readonly RegisteredWorktree[] {
  const invocation: ModuleGitInvocation = {
    cwd: repositoryRoot,
    args: ['worktree', 'list', '--porcelain', '-z'],
  };
  const bytes = runModuleDeliveryGit(gitRequest(invocation)).stdout;
  const fields = bytes.toString('utf8').split('\0');
  const registrations: RegisteredWorktree[] = [];
  let path = '';
  let locked = false;
  for (const field of fields) {
    if (field === '') {
      if (path.length > 0) {
        const registration: RegisteredWorktree = {
          path: resolve(path),
          locked,
        };
        registrations.push(registration);
      }
      path = '';
      locked = false;
    } else if (field.startsWith('worktree ')) {
      path = field.slice('worktree '.length);
    } else if (field === 'locked' || field.startsWith('locked ')) {
      locked = true;
    }
  }
  return registrations;
}

function registrationForPath(
  workspace: ModuleWorktreeHandle,
): WorktreeRegistrationLookup {
  const registration = worktreeRegistrations(
    workspace.sourceRepositoryRoot,
  ).find((registration) => registration.path === workspace.worktreePath);
  return registration
    ? { presence: WorktreeRegistrationPresence.Present, registration }
    : { presence: WorktreeRegistrationPresence.Absent };
}

export function prepareModuleWorktree(
  request: PrepareModuleWorktreeRequest,
): ModuleWorktreeHandle {
  validatePrepareRequest(request);
  const sourceRepositoryRoot = assertRepositoryRoot(request.repositoryRoot);
  const ownedRootRequest: CanonicalDirectoryRequest = {
    path: request.workspaceRoot,
    label: 'Owned workspace root',
  };
  const ownedWorkspaceRoot = canonicalDirectory(ownedRootRequest);
  const commonRequest: AbsoluteGitDirectoryRequest = {
    cwd: sourceRepositoryRoot,
    option: AbsoluteGitDirectoryOption.Common,
  };
  const gitCommonDirectory = realpathSync(absoluteGitDirectory(commonRequest));
  const sourcePair: DisjointPathsRequest = {
    first: sourceRepositoryRoot,
    second: ownedWorkspaceRoot,
    labels: 'Source repository and owned workspace root',
  };
  pathsAreDisjoint(sourcePair);
  const commonPair: DisjointPathsRequest = {
    first: gitCommonDirectory,
    second: ownedWorkspaceRoot,
    labels: 'Git common directory and owned workspace root',
  };
  pathsAreDisjoint(commonPair);
  const baselineInspection: BaselineCommitInspection = {
    repositoryRoot: sourceRepositoryRoot,
    baselineCommit: request.baselineCommit,
  };
  assertBaselineCommit(baselineInspection);

  const prefix = join(
    ownedWorkspaceRoot,
    `${request.taskId}-attempt-${request.attempt}-`,
  );
  const worktreePath = mkdtempSync(prefix);
  rmdirSync(worktreePath);
  try {
    const addInvocation: ModuleGitInvocation = {
      cwd: sourceRepositoryRoot,
      args: [
        'worktree',
        'add',
        '--detach',
        '--no-checkout',
        worktreePath,
        request.baselineCommit,
      ],
    };
    runModuleDeliveryGit(gitRequest(addInvocation));
    const resetInvocation: ModuleGitInvocation = {
      cwd: worktreePath,
      args: ['reset', '--hard', request.baselineCommit],
    };
    runModuleDeliveryGit(gitRequest(resetInvocation));
    const canonicalWorktreePath = realpathSync(worktreePath);
    const adminRequest: AbsoluteGitDirectoryRequest = {
      cwd: canonicalWorktreePath,
      option: AbsoluteGitDirectoryOption.Worktree,
    };
    const worktreeAdminDirectory = realpathSync(
      absoluteGitDirectory(adminRequest),
    );
    const handle: ModuleWorktreeHandle = {
      sourceRepositoryRoot,
      ownedWorkspaceRoot,
      worktreePath: canonicalWorktreePath,
      worktreeAdminDirectory,
      gitCommonDirectory,
      worktreeId: basename(worktreeAdminDirectory),
      planDigest: request.planDigest,
      taskId: request.taskId,
      attempt: request.attempt,
      baselineCommit: request.baselineCommit,
    };
    const identityInspection: WorkspaceIdentityInspection = {
      workspace: handle,
      requirePath: true,
    };
    inspectWorkspaceIdentity(identityInspection);
    const headInvocation: ModuleGitInvocation = {
      cwd: canonicalWorktreePath,
      args: ['rev-parse', 'HEAD'],
    };
    if (
      gitText(runModuleDeliveryGit(gitRequest(headInvocation))) !==
      request.baselineCommit
    ) {
      throw new Error('Prepared module worktree has the wrong baseline.');
    }
    const branchInvocation: ModuleGitInvocation = {
      cwd: canonicalWorktreePath,
      args: ['symbolic-ref', '--quiet', 'HEAD'],
      allowFailure: true,
    };
    if (runModuleDeliveryGit(gitRequest(branchInvocation)).exitCode === 0) {
      throw new Error('Prepared module worktree must have detached HEAD.');
    }
    assertCleanWorkspace(canonicalWorktreePath);
    return handle;
  } catch (error) {
    const removeInvocation: ModuleGitInvocation = {
      cwd: sourceRepositoryRoot,
      args: ['worktree', 'remove', '--force', worktreePath],
      allowFailure: true,
    };
    runModuleDeliveryGit(gitRequest(removeInvocation));
    throw error;
  }
}

export function cleanupModuleWorktree(
  request: CleanupModuleWorktreeRequest,
): CleanupModuleWorktreeResult {
  validateHandleShape(request.workspace);
  const sourceRepositoryRoot = assertRepositoryRoot(
    request.workspace.sourceRepositoryRoot,
  );
  const ownedRootRequest: CanonicalDirectoryRequest = {
    path: request.workspace.ownedWorkspaceRoot,
    label: 'Owned workspace root',
  };
  canonicalDirectory(ownedRootRequest);
  const registrationLookup = registrationForPath(request.workspace);
  const exists = pathExists(request.workspace.worktreePath);
  if (
    !exists &&
    registrationLookup.presence === WorktreeRegistrationPresence.Absent
  ) {
    return { removed: false };
  }
  if (
    !exists ||
    registrationLookup.presence === WorktreeRegistrationPresence.Absent
  ) {
    throw new Error('Module worktree path and registration are asymmetric.');
  }
  if (registrationLookup.registration.locked) {
    throw new Error('Locked module worktrees cannot be cleaned up.');
  }
  const identityInspection: WorkspaceIdentityInspection = {
    workspace: request.workspace,
    requirePath: true,
  };
  inspectWorkspaceIdentity(identityInspection);
  const lockedPath = join(request.workspace.worktreeAdminDirectory, 'locked');
  if (pathExists(lockedPath)) {
    throw new Error('Locked module worktrees cannot be cleaned up.');
  }
  const removeInvocation: ModuleGitInvocation = {
    cwd: sourceRepositoryRoot,
    args: ['worktree', 'remove', '--force', request.workspace.worktreePath],
  };
  runModuleDeliveryGit(gitRequest(removeInvocation));
  if (
    pathExists(request.workspace.worktreePath) ||
    registrationForPath(request.workspace).presence ===
      WorktreeRegistrationPresence.Present
  ) {
    throw new Error(
      'Module worktree cleanup did not remove path and registration.',
    );
  }
  return { removed: true };
}

export function assertPreparedModuleWorktreeIdentity(
  workspace: ModuleWorktreeHandle,
): void {
  const inspection: WorkspaceIdentityInspection = {
    workspace,
    requirePath: true,
  };
  inspectWorkspaceIdentity(inspection);
}

export function assertModuleWorktreeClean(
  workspace: ModuleWorktreeHandle,
): void {
  assertCleanWorkspace(workspace.worktreePath);
}
