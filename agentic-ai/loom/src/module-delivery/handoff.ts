import { ModuleRepositoryGit } from './git-command.ts';

import { ModuleWriteClaim } from './resource-claims.ts';

import {
  CANONICAL_GIT_PATH,
  EXACT_GIT_COMMIT,
  CanonicalGitPath,
} from './workspace-paths.ts';

import { ModuleWorktree } from './workspace.ts';

import type { GitCommandRequest } from './git-command.ts';

import type { ResourcePathMatchRequest } from './resource-claims.ts';

import type { ModuleWorktreeHandle } from './workspace.ts';

export class ModuleCommitHandoff {
  private constructor(
    private readonly request: VerifyModuleCommitHandoffRequest,
  ) {}

  private static gitRequest(
    invocation: ModuleGitInvocation,
  ): GitCommandRequest {
    return { cwd: invocation.cwd, args: invocation.args };
  }

  private static decodeNullSeparatedGitPaths(bytes: Buffer): readonly string[] {
    const paths: string[] = [];
    let start = 0;
    for (let index = 0; index < bytes.length; index += 1) {
      if (bytes[index] !== 0) continue;
      const encoded = bytes.subarray(start, index);
      if (encoded.length > 0) {
        const path = encoded.toString('utf8');
        if (!Buffer.from(path, 'utf8').equals(encoded)) {
          throw new Error('Changed Git path is not valid UTF-8.');
        }
        CanonicalGitPath.resolve(path);
        paths.push(path);
      }
      start = index + 1;
    }
    if (start !== bytes.length) {
      throw new Error('Changed Git paths require NUL termination.');
    }
    return paths;
  }

  private static assertSafeTreeEntry(inspection: TreeEntryInspection): void {
    const invocation: ModuleGitInvocation = {
      cwd: inspection.workspacePath,
      args: ['ls-tree', '-z', inspection.commit, '--', inspection.path],
    };
    const entry = ModuleRepositoryGit.runModuleDeliveryGit(
      ModuleCommitHandoff.gitRequest(invocation),
    ).stdout;
    if (entry.length === 0) return;
    const firstSpace = entry.indexOf(0x20);
    const mode =
      firstSpace === -1 ? '' : entry.subarray(0, firstSpace).toString('ascii');
    if (mode === '120000') {
      throw new Error(
        `Commit handoff cannot write symlink ${inspection.path}.`,
      );
    }
    if (mode === '160000') {
      throw new Error(
        `Commit handoff cannot write gitlink ${inspection.path}.`,
      );
    }
  }

  private static parseRecursiveTree(bytes: Buffer): readonly ParsedTreeEntry[] {
    const entries: ParsedTreeEntry[] = [];
    let start = 0;
    for (let index = 0; index < bytes.length; index += 1) {
      if (bytes[index] !== 0) continue;
      const encoded = bytes.subarray(start, index);
      const tab = encoded.indexOf(0x09);
      const firstSpace = encoded.indexOf(0x20);
      if (encoded.length === 0 || tab < 0 || firstSpace < 0) {
        throw new Error('Baseline tree contains malformed entry data.');
      }
      const encodedPath = encoded.subarray(tab + 1);
      const path = encodedPath.toString('utf8');
      if (!Buffer.from(path, 'utf8').equals(encodedPath)) {
        throw new Error('Baseline Git path is not valid UTF-8.');
      }
      CanonicalGitPath.resolve(path);
      const entry: ParsedTreeEntry = {
        mode: encoded.subarray(0, firstSpace).toString('ascii'),
        path,
      };
      entries.push(entry);
      start = index + 1;
    }
    if (start !== bytes.length) {
      throw new Error('Baseline tree entries require NUL termination.');
    }
    return entries;
  }

  private static assertBaselineClaimsSafe(
    request: VerifyModuleCommitHandoffRequest,
  ): void {
    const invocation: ModuleGitInvocation = {
      cwd: request.workspace.worktreePath,
      args: ['ls-tree', '-r', '-z', request.baselineCommit, '--'],
    };
    const entries = ModuleCommitHandoff.parseRecursiveTree(
      ModuleRepositoryGit.runModuleDeliveryGit(
        ModuleCommitHandoff.gitRequest(invocation),
      ).stdout,
    );
    for (const entry of entries) {
      const claimed = request.allowedWriteClaims.some((claim) => {
        const matchRequest: ResourcePathMatchRequest = {
          claim,
          path: entry.path,
        };
        return ModuleWriteClaim.resourceClaimMatchesPath(matchRequest);
      });
      if (!claimed) continue;
      if (entry.mode === '120000') {
        throw new Error(
          `Writable baseline cannot contain symlink ${entry.path}.`,
        );
      }
      if (entry.mode === '160000') {
        throw new Error(
          `Writable baseline cannot contain gitlink ${entry.path}.`,
        );
      }
    }
  }

  static moduleCommitChangedPaths(
    request: ModuleCommitPathRequest,
  ): readonly string[] {
    if (
      !EXACT_GIT_COMMIT.test(request.baselineCommit) ||
      !EXACT_GIT_COMMIT.test(request.commit)
    ) {
      throw new Error('Commit path inspection requires exact Git commits.');
    }
    const invocation: ModuleGitInvocation = {
      cwd: request.workspace.worktreePath,
      args: [
        'diff',
        '--name-only',
        '-z',
        '--no-renames',
        request.baselineCommit,
        request.commit,
        '--',
      ],
    };
    return ModuleCommitHandoff.decodeNullSeparatedGitPaths(
      ModuleRepositoryGit.runModuleDeliveryGit(
        ModuleCommitHandoff.gitRequest(invocation),
      ).stdout,
    );
  }

  static verifyModuleCommitHandoff(
    request: VerifyModuleCommitHandoffRequest,
  ): VerifiedModuleCommitHandoff {
    return new ModuleCommitHandoff(request).execute();
  }

  private execute(): VerifiedModuleCommitHandoff {
    const request = this.request;
    if (
      !EXACT_GIT_COMMIT.test(request.baselineCommit) ||
      request.baselineCommit !== request.workspace.baselineCommit
    ) {
      throw new Error('Commit handoff baseline does not match its workspace.');
    }
    ModuleWriteClaim.validateModuleWriteClaims(request.allowedWriteClaims);
    ModuleWorktree.assertPreparedModuleWorktreeIdentity(request.workspace);
    ModuleWorktree.assertModuleWorktreeClean(request.workspace);
    ModuleCommitHandoff.assertBaselineClaimsSafe(request);

    const headInvocation: ModuleGitInvocation = {
      cwd: request.workspace.worktreePath,
      args: ['rev-parse', '--verify', 'HEAD^{commit}'],
    };
    const commit = ModuleRepositoryGit.gitText(
      ModuleRepositoryGit.runModuleDeliveryGit(
        ModuleCommitHandoff.gitRequest(headInvocation),
      ),
    );
    if (!EXACT_GIT_COMMIT.test(commit) || commit === request.baselineCommit) {
      throw new Error(
        'Commit handoff requires a non-baseline child worktree commit.',
      );
    }
    const parentInvocation: ModuleGitInvocation = {
      cwd: request.workspace.worktreePath,
      args: ['rev-list', '--parents', '-n', '1', commit],
    };
    const commitAndParents = ModuleRepositoryGit.gitText(
      ModuleRepositoryGit.runModuleDeliveryGit(
        ModuleCommitHandoff.gitRequest(parentInvocation),
      ),
    ).split(' ');
    if (
      commitAndParents.length !== 2 ||
      commitAndParents[0] !== commit ||
      commitAndParents[1] !== request.baselineCommit
    ) {
      throw new Error(
        'Commit handoff requires one non-merge commit directly after its baseline.',
      );
    }
    const pathRequest: ModuleCommitPathRequest = {
      workspace: request.workspace,
      baselineCommit: request.baselineCommit,
      commit,
    };
    const changedPaths =
      ModuleCommitHandoff.moduleCommitChangedPaths(pathRequest);
    if (changedPaths.length === 0) {
      throw new Error('Commit handoff range must be nonempty.');
    }
    for (const path of changedPaths) {
      if (!CANONICAL_GIT_PATH.test(path)) {
        throw new Error(`Commit handoff path is noncanonical: ${path}.`);
      }
      const matched = request.allowedWriteClaims.some((claim) => {
        const matchRequest: ResourcePathMatchRequest = { claim, path };
        return ModuleWriteClaim.resourceClaimMatchesPath(matchRequest);
      });
      if (!matched) {
        throw new Error(
          `Commit handoff path is outside allowed write claims: ${path}.`,
        );
      }
      const baselineInspection: TreeEntryInspection = {
        workspacePath: request.workspace.worktreePath,
        commit: request.baselineCommit,
        path,
      };
      ModuleCommitHandoff.assertSafeTreeEntry(baselineInspection);
      const handoffInspection: TreeEntryInspection = {
        workspacePath: request.workspace.worktreePath,
        commit,
        path,
      };
      ModuleCommitHandoff.assertSafeTreeEntry(handoffInspection);
    }
    return {
      taskId: request.workspace.taskId,
      attempt: request.workspace.attempt,
      planDigest: request.workspace.planDigest,
      baselineCommit: request.baselineCommit,
      commit,
      changedPaths,
    };
  }
}

export type VerifyModuleCommitHandoffRequest = {
  readonly workspace: ModuleWorktreeHandle;
  readonly baselineCommit: string;
  readonly allowedWriteClaims: readonly string[];
};

export type VerifiedModuleCommitHandoff = {
  readonly taskId: string;
  readonly attempt: number;
  readonly planDigest: string;
  readonly baselineCommit: string;
  readonly commit: string;
  readonly changedPaths: readonly string[];
};

export type ModuleCommitPathRequest = {
  readonly workspace: ModuleWorktreeHandle;
  readonly baselineCommit: string;
  readonly commit: string;
};

type TreeEntryInspection = {
  readonly workspacePath: string;
  readonly commit: string;
  readonly path: string;
};

type ParsedTreeEntry = {
  readonly mode: string;
  readonly path: string;
};

type ModuleGitInvocation = {
  readonly cwd: string;
  readonly args: readonly string[];
};
