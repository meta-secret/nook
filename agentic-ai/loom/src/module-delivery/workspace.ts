import { mkdirSync, realpathSync, rmdirSync } from 'node:fs';

import { basename, join, resolve } from 'node:path';

import { ModuleRepositoryGit } from './git-command.ts';

import {
  CANONICAL_TASK_ID,
  EXACT_GIT_COMMIT,
  EXACT_PLAN_DIGEST,
  CanonicalDirectory,
  DirectChildDirectory,
  DirectorySeparation,
  FilesystemPathPresence,
} from './workspace-paths.ts';

import type { GitCommandRequest } from './git-command.ts';

export enum ModuleWorktreeRole {
  Child = 'child',
  IntegrationParent = 'integration-parent',
}

enum ModuleWorktreeGitDirectoryOption {
  Common = '--git-common-dir',
  Admin = '--git-dir',
}

enum RegisteredWorktreeBranchKind {
  Branch = 'branch',
  Detached = 'detached',
}

type RegisteredWorktreeBranch =
  | {
      readonly kind: RegisteredWorktreeBranchKind.Branch;
      readonly name: string;
    }
  | { readonly kind: RegisteredWorktreeBranchKind.Detached };

enum WorktreeRegistrationLookupKind {
  Found = 'found',
  Missing = 'missing',
}

type WorktreeRegistrationLookup =
  | {
      readonly kind: WorktreeRegistrationLookupKind.Found;
      readonly registration: RegisteredWorktree;
    }
  | { readonly kind: WorktreeRegistrationLookupKind.Missing };

export class ModuleWorktree {
  private constructor(private readonly request: PrepareModuleWorktreeRequest) {}

  private static readonly CHILD_BRANCH_PREFIX = 'nook/module-delivery';

  private static readonly INTEGRATION_WORKTREE_ID = 'integration-parent';

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

  private static canonicalRoots(
    request: PrepareModuleWorktreeRequest,
  ): readonly [sourceRepositoryRoot: string, workspaceRoot: string] {
    const sourceRepositoryRoot = CanonicalDirectory.resolve({
      path: request.repositoryRoot,
      label: 'Source repository root',
    });
    const workspaceRoot = CanonicalDirectory.resolve({
      path: request.workspaceRoot,
      label: 'Owned workspace root',
    });
    DirectorySeparation.matches({
      first: sourceRepositoryRoot,
      second: workspaceRoot,
      labels: 'Source repository and owned workspace root',
    });
    return [sourceRepositoryRoot, workspaceRoot];
  }

  private static absoluteGitDirectory(
    request: AbsoluteGitDirectoryRequest,
  ): string {
    return realpathSync(
      resolve(
        ModuleWorktree.git({
          cwd: request.cwd,
          args: ['rev-parse', '--path-format=absolute', request.option],
        }),
      ),
    );
  }

  private static assertRepositoryTopLevel(repositoryRoot: string): void {
    const top = resolve(
      ModuleWorktree.git({
        cwd: repositoryRoot,
        args: ['rev-parse', '--path-format=absolute', '--show-toplevel'],
      }),
    );
    if (top !== repositoryRoot)
      throw new Error('Source repository root is not the Git top level.');
  }

  private static assertBaselineCommit(request: BaselineCommitRequest): void {
    if (
      ModuleWorktree.git({
        cwd: request.repositoryRoot,
        args: ['rev-parse', '--verify', `${request.baselineCommit}^{commit}`],
      }) !== request.baselineCommit
    )
      throw new Error(
        'Module baseline does not resolve to the requested commit.',
      );
  }

  private static assertClean(repositoryRoot: string): void {
    if (
      ModuleRepositoryGit.runModuleDeliveryGit({
        cwd: repositoryRoot,
        args: ['status', '--porcelain=v1', '--ignored', '-z'],
      }).stdout.length !== 0
    )
      throw new Error('Module worktree must be clean before dispatch.');
  }

  private static assertParentReady(request: ParentReadyRequest): void {
    ModuleWorktree.assertRepositoryTopLevel(request.repositoryRoot);
    if (
      ModuleWorktree.git({
        cwd: request.repositoryRoot,
        args: ['rev-parse', '--verify', 'HEAD^{commit}'],
      }) !== request.baselineCommit
    )
      throw new Error('Shared module checkout HEAD must match its baseline.');
    ModuleWorktree.assertClean(request.repositoryRoot);
    const branch = ModuleRepositoryGit.runModuleDeliveryGit({
      cwd: request.repositoryRoot,
      args: ['symbolic-ref', '--quiet', 'HEAD'],
      allowFailure: true,
    });
    if (
      branch.exitCode !== 0 ||
      ModuleRepositoryGit.gitText(branch).length === 0
    )
      throw new Error('Shared module checkout must be on a branch.');
  }

  private static childWorktreeId(
    request: PrepareModuleWorktreeRequest,
  ): string {
    return `${request.taskId}-attempt-${request.attempt}`;
  }

  private static childBranchName(
    request: PrepareModuleWorktreeRequest,
  ): string {
    return `refs/heads/${ModuleWorktree.CHILD_BRANCH_PREFIX}/${request.planDigest}/${ModuleWorktree.childWorktreeId(request)}`;
  }

  private static branchArgument(branchName: string): string {
    return branchName.slice('refs/heads/'.length);
  }

  private static branchExists(request: BranchExistsRequest): boolean {
    return (
      ModuleRepositoryGit.runModuleDeliveryGit({
        cwd: request.repositoryRoot,
        args: ['show-ref', '--verify', '--quiet', request.branchName],
        allowFailure: true,
      }).exitCode === 0
    );
  }

  private static validateHandleShape(workspace: ModuleWorktreeHandle): void {
    ModuleWorktree.validateRequest({
      repositoryRoot: workspace.sourceRepositoryRoot,
      workspaceRoot: workspace.ownedWorkspaceRoot,
      planDigest: workspace.planDigest,
      taskId: workspace.taskId,
      attempt: workspace.attempt,
      baselineCommit: workspace.baselineCommit,
    });
    if (
      workspace.role !== ModuleWorktreeRole.Child &&
      workspace.role !== ModuleWorktreeRole.IntegrationParent
    )
      throw new Error('Module worktree handle has an invalid role.');
    if (workspace.role === ModuleWorktreeRole.Child) {
      const expectedWorktreeId = `${workspace.taskId}-attempt-${workspace.attempt}`;
      const expectedBranchName = `refs/heads/${ModuleWorktree.CHILD_BRANCH_PREFIX}/${workspace.planDigest}/${expectedWorktreeId}`;
      if (
        workspace.worktreeId !== expectedWorktreeId ||
        workspace.branchName !== expectedBranchName
      )
        throw new Error('Module child worktree identity is invalid.');
      if (
        !DirectChildDirectory.matches({
          parent: workspace.ownedWorkspaceRoot,
          child: workspace.worktreePath,
        })
      )
        throw new Error(
          'Module worktree is not a direct child of its owned root.',
        );
    } else if (
      workspace.worktreeId !== ModuleWorktree.INTEGRATION_WORKTREE_ID ||
      workspace.sourceRepositoryRoot !== workspace.worktreePath ||
      !/^refs\/heads\/[A-Za-z0-9._/-]+$/u.test(workspace.branchName)
    ) {
      throw new Error('Module integration workspace identity is invalid.');
    }
  }

  private static worktreeRegistrations(
    repositoryRoot: string,
  ): readonly RegisteredWorktree[] {
    const bytes = ModuleRepositoryGit.runModuleDeliveryGit({
      cwd: repositoryRoot,
      args: ['worktree', 'list', '--porcelain', '-z'],
    }).stdout;
    const registrations: RegisteredWorktree[] = [];
    let path = '';
    let headCommit = '';
    let branchName: RegisteredWorktreeBranch = {
      kind: RegisteredWorktreeBranchKind.Detached,
    };
    let locked = false;
    for (const field of bytes.toString('utf8').split('\0')) {
      if (field.length === 0) {
        if (path.length > 0) {
          registrations.push({
            path: resolve(path),
            headCommit,
            branchName,
            locked,
          });
        }
        path = '';
        headCommit = '';
        branchName = { kind: RegisteredWorktreeBranchKind.Detached };
        locked = false;
      } else if (field.startsWith('worktree ')) {
        path = field.slice('worktree '.length);
      } else if (field.startsWith('HEAD ')) {
        headCommit = field.slice('HEAD '.length);
      } else if (field.startsWith('branch ')) {
        branchName = {
          kind: RegisteredWorktreeBranchKind.Branch,
          name: field.slice('branch '.length),
        };
      } else if (field === 'locked' || field.startsWith('locked ')) {
        locked = true;
      }
    }
    return registrations;
  }

  private static registrationForPath(
    workspace: ModuleWorktreeHandle,
  ): WorktreeRegistrationLookup {
    const registration = ModuleWorktree.worktreeRegistrations(
      workspace.sourceRepositoryRoot,
    ).find((candidate) => candidate.path === workspace.worktreePath);
    if (registration) {
      return {
        kind: WorktreeRegistrationLookupKind.Found,
        registration,
      };
    }
    return { kind: WorktreeRegistrationLookupKind.Missing };
  }

  private static validateHandle(workspace: ModuleWorktreeHandle): boolean {
    ModuleWorktree.validateHandleShape(workspace);
    const sourceRepositoryRoot = CanonicalDirectory.resolve({
      path: workspace.sourceRepositoryRoot,
      label: 'Source repository root',
    });
    const ownedWorkspaceRoot = CanonicalDirectory.resolve({
      path: workspace.ownedWorkspaceRoot,
      label: 'Owned workspace root',
    });
    if (
      sourceRepositoryRoot !== workspace.sourceRepositoryRoot ||
      ownedWorkspaceRoot !== workspace.ownedWorkspaceRoot
    )
      throw new Error('Module workspace roots must already be canonical.');
    ModuleWorktree.assertRepositoryTopLevel(sourceRepositoryRoot);
    DirectorySeparation.matches({
      first: sourceRepositoryRoot,
      second: ownedWorkspaceRoot,
      labels: 'Source repository and owned workspace root',
    });
    const commonDirectory = ModuleWorktree.absoluteGitDirectory({
      cwd: sourceRepositoryRoot,
      option: ModuleWorktreeGitDirectoryOption.Common,
    });
    DirectorySeparation.matches({
      first: commonDirectory,
      second: ownedWorkspaceRoot,
      labels: 'Git common directory and owned workspace root',
    });
    if (workspace.role === ModuleWorktreeRole.IntegrationParent) {
      const adminDirectory = ModuleWorktree.absoluteGitDirectory({
        cwd: sourceRepositoryRoot,
        option: ModuleWorktreeGitDirectoryOption.Admin,
      });
      if (
        adminDirectory !== workspace.worktreeAdminDirectory ||
        commonDirectory !== workspace.gitCommonDirectory ||
        ModuleWorktree.git({
          cwd: sourceRepositoryRoot,
          args: ['symbolic-ref', '--quiet', 'HEAD'],
        }) !== workspace.branchName
      )
        throw new Error(
          'Module integration workspace identity does not match the parent checkout.',
        );
      ModuleWorktree.assertBaselineCommit({
        repositoryRoot: sourceRepositoryRoot,
        baselineCommit: workspace.baselineCommit,
      });
      return true;
    }
    const exists = FilesystemPathPresence.exists(workspace.worktreePath);
    if (!exists) {
      throw new Error('Module worktree path is missing.');
    }
    const canonicalWorktreePath = CanonicalDirectory.resolve({
      path: workspace.worktreePath,
      label: 'Module worktree path',
    });
    if (canonicalWorktreePath !== workspace.worktreePath)
      throw new Error('Module worktree path must already be canonical.');
    DirectorySeparation.matches({
      first: sourceRepositoryRoot,
      second: canonicalWorktreePath,
      labels: 'Source repository and child worktree',
    });
    if (
      !DirectChildDirectory.matches({
        parent: ownedWorkspaceRoot,
        child: canonicalWorktreePath,
      })
    )
      throw new Error(
        'Module worktree is not a direct child of its owned root.',
      );
    const top = resolve(
      ModuleWorktree.git({
        cwd: canonicalWorktreePath,
        args: ['rev-parse', '--path-format=absolute', '--show-toplevel'],
      }),
    );
    const childCommonDirectory = ModuleWorktree.absoluteGitDirectory({
      cwd: canonicalWorktreePath,
      option: ModuleWorktreeGitDirectoryOption.Common,
    });
    const childAdminDirectory = ModuleWorktree.absoluteGitDirectory({
      cwd: canonicalWorktreePath,
      option: ModuleWorktreeGitDirectoryOption.Admin,
    });
    const registration = ModuleWorktree.registrationForPath(workspace);
    const childHead = ModuleWorktree.git({
      cwd: canonicalWorktreePath,
      args: ['rev-parse', '--verify', 'HEAD^{commit}'],
    });
    if (
      top !== canonicalWorktreePath ||
      childCommonDirectory !== commonDirectory ||
      childAdminDirectory !== workspace.worktreeAdminDirectory ||
      basename(childAdminDirectory) !== workspace.worktreeId ||
      !DirectChildDirectory.matches({
        parent: join(commonDirectory, 'worktrees'),
        child: childAdminDirectory,
      }) ||
      registration.kind !== WorktreeRegistrationLookupKind.Found ||
      registration.registration.branchName.kind !==
        RegisteredWorktreeBranchKind.Branch ||
      registration.registration.branchName.name !== workspace.branchName ||
      registration.registration.headCommit !== childHead
    )
      throw new Error(
        'Module workspace identity does not match its prepared child worktree.',
      );
    if (
      ModuleWorktree.git({
        cwd: canonicalWorktreePath,
        args: ['symbolic-ref', '--quiet', 'HEAD'],
      }) !== workspace.branchName
    )
      throw new Error('Module child worktree branch identity has drifted.');
    if (
      ModuleWorktree.git({
        cwd: sourceRepositoryRoot,
        args: ['rev-parse', '--verify', `${workspace.branchName}^{commit}`],
      }) !== childHead
    )
      throw new Error('Module child worktree branch ref has drifted.');
    ModuleWorktree.assertBaselineCommit({
      repositoryRoot: sourceRepositoryRoot,
      baselineCommit: workspace.baselineCommit,
    });
    return true;
  }

  static prepareModuleWorktree(
    request: PrepareModuleWorktreeRequest,
  ): ModuleWorktreeHandle {
    return new ModuleWorktree(request).execute();
  }

  static prepareSharedIntegrationWorkspace(
    request: PrepareModuleWorktreeRequest,
  ): ModuleWorktreeHandle {
    ModuleWorktree.validateRequest(request);
    const [sourceRepositoryRoot, workspaceRoot] =
      ModuleWorktree.canonicalRoots(request);
    const commonDirectory = ModuleWorktree.absoluteGitDirectory({
      cwd: sourceRepositoryRoot,
      option: ModuleWorktreeGitDirectoryOption.Common,
    });
    DirectorySeparation.matches({
      first: commonDirectory,
      second: workspaceRoot,
      labels: 'Git common directory and owned workspace root',
    });
    ModuleWorktree.assertParentReady({
      repositoryRoot: sourceRepositoryRoot,
      baselineCommit: request.baselineCommit,
    });
    const worktreeAdminDirectory = ModuleWorktree.absoluteGitDirectory({
      cwd: sourceRepositoryRoot,
      option: ModuleWorktreeGitDirectoryOption.Admin,
    });
    const branchName = ModuleWorktree.git({
      cwd: sourceRepositoryRoot,
      args: ['symbolic-ref', '--quiet', 'HEAD'],
    });
    const handle: ModuleWorktreeHandle = Object.freeze({
      role: ModuleWorktreeRole.IntegrationParent,
      sourceRepositoryRoot,
      ownedWorkspaceRoot: workspaceRoot,
      worktreePath: sourceRepositoryRoot,
      worktreeAdminDirectory,
      gitCommonDirectory: commonDirectory,
      worktreeId: ModuleWorktree.INTEGRATION_WORKTREE_ID,
      branchName,
      planDigest: request.planDigest,
      taskId: request.taskId,
      attempt: request.attempt,
      baselineCommit: request.baselineCommit,
    });
    ModuleWorktree.validateHandle(handle);
    return handle;
  }

  private execute(): ModuleWorktreeHandle {
    const request = this.request;
    ModuleWorktree.validateRequest(request);
    const [sourceRepositoryRoot, ownedWorkspaceRoot] =
      ModuleWorktree.canonicalRoots(request);
    const commonDirectory = ModuleWorktree.absoluteGitDirectory({
      cwd: sourceRepositoryRoot,
      option: ModuleWorktreeGitDirectoryOption.Common,
    });
    DirectorySeparation.matches({
      first: commonDirectory,
      second: ownedWorkspaceRoot,
      labels: 'Git common directory and owned workspace root',
    });
    ModuleWorktree.assertParentReady({
      repositoryRoot: sourceRepositoryRoot,
      baselineCommit: request.baselineCommit,
    });
    ModuleWorktree.assertBaselineCommit({
      repositoryRoot: sourceRepositoryRoot,
      baselineCommit: request.baselineCommit,
    });
    const worktreeId = ModuleWorktree.childWorktreeId(request);
    const worktreePath = join(ownedWorkspaceRoot, worktreeId);
    if (
      !DirectChildDirectory.matches({
        parent: ownedWorkspaceRoot,
        child: worktreePath,
      })
    )
      throw new Error('Module child worktree path is not a direct child.');
    if (FilesystemPathPresence.exists(worktreePath))
      throw new Error('Module child worktree path already exists.');
    const branchName = ModuleWorktree.childBranchName(request);
    if (
      ModuleWorktree.branchExists({
        repositoryRoot: sourceRepositoryRoot,
        branchName,
      })
    )
      throw new Error('Module child worktree branch already exists.');
    let registered = false;
    let branchCreated = false;
    mkdirSync(worktreePath);
    try {
      ModuleRepositoryGit.runModuleDeliveryGit({
        cwd: sourceRepositoryRoot,
        args: [
          'worktree',
          'add',
          '--quiet',
          '--no-checkout',
          '-b',
          ModuleWorktree.branchArgument(branchName),
          worktreePath,
          request.baselineCommit,
        ],
      });
      registered = true;
      branchCreated = true;
      ModuleRepositoryGit.runModuleDeliveryGit({
        cwd: worktreePath,
        args: ['reset', '--hard', request.baselineCommit],
      });
      const canonicalWorktreePath = CanonicalDirectory.resolve({
        path: worktreePath,
        label: 'Module worktree path',
      });
      const worktreeAdminDirectory = ModuleWorktree.absoluteGitDirectory({
        cwd: canonicalWorktreePath,
        option: ModuleWorktreeGitDirectoryOption.Admin,
      });
      const handle: ModuleWorktreeHandle = Object.freeze({
        role: ModuleWorktreeRole.Child,
        sourceRepositoryRoot,
        ownedWorkspaceRoot,
        worktreePath: canonicalWorktreePath,
        worktreeAdminDirectory,
        gitCommonDirectory: commonDirectory,
        worktreeId,
        branchName,
        planDigest: request.planDigest,
        taskId: request.taskId,
        attempt: request.attempt,
        baselineCommit: request.baselineCommit,
      });
      ModuleWorktree.validateHandle(handle);
      if (
        ModuleWorktree.git({
          cwd: canonicalWorktreePath,
          args: ['rev-parse', '--verify', 'HEAD^{commit}'],
        }) !== request.baselineCommit
      )
        throw new Error('Prepared module worktree has the wrong baseline.');
      ModuleWorktree.assertClean(canonicalWorktreePath);
      return handle;
    } catch (error) {
      if (registered)
        ModuleRepositoryGit.runModuleDeliveryGit({
          cwd: sourceRepositoryRoot,
          args: ['worktree', 'remove', worktreePath],
          allowFailure: true,
        });
      if (branchCreated)
        ModuleRepositoryGit.runModuleDeliveryGit({
          cwd: sourceRepositoryRoot,
          args: [
            'branch',
            '-D',
            '--',
            ModuleWorktree.branchArgument(branchName),
          ],
          allowFailure: true,
        });
      if (FilesystemPathPresence.exists(worktreePath)) {
        try {
          rmdirSync(worktreePath);
        } catch {
          // Preserve the original preparation failure.
        }
      }
      throw error;
    }
  }

  static cleanupModuleWorktree(
    request: CleanupModuleWorktreeRequest,
  ): CleanupModuleWorktreeResult {
    const workspace = request.workspace;
    ModuleWorktree.validateHandleShape(workspace);
    if (workspace.role !== ModuleWorktreeRole.Child)
      throw new Error('Only child module worktrees can be cleaned up here.');
    const sourceRepositoryRoot = CanonicalDirectory.resolve({
      path: workspace.sourceRepositoryRoot,
      label: 'Source repository root',
    });
    ModuleWorktree.assertRepositoryTopLevel(sourceRepositoryRoot);
    const registration = ModuleWorktree.registrationForPath(workspace);
    const exists = FilesystemPathPresence.exists(workspace.worktreePath);
    const branchExists = ModuleWorktree.branchExists({
      repositoryRoot: sourceRepositoryRoot,
      branchName: workspace.branchName,
    });
    const registrationPresent =
      registration.kind === WorktreeRegistrationLookupKind.Found;
    if (!exists && !registrationPresent && !branchExists)
      return { removed: false };
    if (exists !== registrationPresent)
      throw new Error('Module worktree path and registration are asymmetric.');
    if (
      registration.kind === WorktreeRegistrationLookupKind.Found &&
      registration.registration.locked
    )
      throw new Error('Locked module worktrees cannot be cleaned up.');
    if (exists) {
      ModuleWorktree.validateHandle(workspace);
      if (
        FilesystemPathPresence.exists(
          join(workspace.worktreeAdminDirectory, 'locked'),
        )
      )
        throw new Error('Locked module worktrees cannot be cleaned up.');
      ModuleWorktree.assertModuleWorktreeClean(workspace);
      const childHead = ModuleWorktree.git({
        cwd: workspace.worktreePath,
        args: ['rev-parse', '--verify', 'HEAD^{commit}'],
      });
      if (childHead !== workspace.baselineCommit)
        throw new Error(
          'Committed child handoff must be integrated or explicitly disposed before cleanup.',
        );
      ModuleRepositoryGit.runModuleDeliveryGit({
        cwd: sourceRepositoryRoot,
        args: ['worktree', 'remove', workspace.worktreePath],
      });
    }
    if (
      ModuleWorktree.branchExists({
        repositoryRoot: sourceRepositoryRoot,
        branchName: workspace.branchName,
      })
    )
      ModuleRepositoryGit.runModuleDeliveryGit({
        cwd: sourceRepositoryRoot,
        args: [
          'branch',
          '-D',
          '--',
          ModuleWorktree.branchArgument(workspace.branchName),
        ],
      });
    if (
      FilesystemPathPresence.exists(workspace.worktreePath) ||
      ModuleWorktree.registrationForPath(workspace).kind ===
        WorktreeRegistrationLookupKind.Found ||
      ModuleWorktree.branchExists({
        repositoryRoot: sourceRepositoryRoot,
        branchName: workspace.branchName,
      })
    )
      throw new Error(
        'Module child worktree cleanup did not remove path, registration, and branch.',
      );
    return { removed: true };
  }

  static cleanupSharedIntegrationWorkspace(
    request: CleanupModuleWorktreeRequest,
  ): CleanupModuleWorktreeResult {
    if (request.workspace.role !== ModuleWorktreeRole.IntegrationParent)
      throw new Error('Only the integration parent can use this cleanup path.');
    ModuleWorktree.validateHandle(request.workspace);
    return { removed: false };
  }

  static assertPreparedModuleWorktreeIdentity(
    workspace: ModuleWorktreeHandle,
  ): void {
    if (workspace.role !== ModuleWorktreeRole.Child)
      throw new Error('Provider handoffs require an isolated child worktree.');
    ModuleWorktree.validateHandle(workspace);
  }

  static assertIntegrationWorkspaceIdentity(
    workspace: ModuleWorktreeHandle,
  ): void {
    if (workspace.role !== ModuleWorktreeRole.IntegrationParent)
      throw new Error('Module integration requires its parent workspace.');
    ModuleWorktree.validateHandle(workspace);
  }

  static assertModuleWorktreeClean(workspace: ModuleWorktreeHandle): void {
    ModuleWorktree.validateHandle(workspace);
    if (
      ModuleRepositoryGit.runModuleDeliveryGit({
        cwd: workspace.worktreePath,
        args: ['status', '--porcelain=v1', '--ignored', '-z'],
      }).stdout.length !== 0
    )
      throw new Error('Module worktree must be clean.');
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
  readonly role: ModuleWorktreeRole;
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

type RegisteredWorktree = {
  readonly path: string;
  readonly headCommit: string;
  readonly branchName: RegisteredWorktreeBranch;
  readonly locked: boolean;
};

type AbsoluteGitDirectoryRequest = {
  readonly cwd: string;
  readonly option: ModuleWorktreeGitDirectoryOption;
};

type BaselineCommitRequest = {
  readonly repositoryRoot: string;
  readonly baselineCommit: string;
};

type ParentReadyRequest = BaselineCommitRequest;

type BranchExistsRequest = {
  readonly repositoryRoot: string;
  readonly branchName: string;
};
