import { ModuleCommitHandoff } from './handoff.ts';

import { ModuleResourceContainment } from './resource-claim-containment.ts';

import { ModuleWriteClaim } from './resource-claims.ts';

import { ModuleRepositoryGit } from './git-command.ts';

import {
  CANONICAL_GIT_PATH,
  CANONICAL_TASK_ID,
  EXACT_GIT_COMMIT,
} from './workspace-paths.ts';

import { ModuleWorktree } from './workspace.ts';

import type { ModuleWorktreeHandle } from './workspace.ts';

export class ModuleWaveTree {
  private constructor(private readonly request: ApplyModuleWaveTreeRequest) {}

  private static git(request: GitInvocation): string {
    return ModuleRepositoryGit.gitText(
      ModuleRepositoryGit.runModuleDeliveryGit(request),
    );
  }

  private static assertSafeTreeEntry(request: SafeTreeEntryRequest): void {
    const entry = ModuleRepositoryGit.runModuleDeliveryGit({
      cwd: request.workspacePath,
      args: ['ls-tree', '-z', request.commit, '--', request.path],
    }).stdout;
    if (entry.length === 0) return;
    const firstSpace = entry.indexOf(0x20);
    if (firstSpace < 1)
      throw new Error(`Tree integration entry is malformed: ${request.path}.`);
    const mode = entry.subarray(0, firstSpace).toString('ascii');
    if (mode === '120000')
      throw new Error(`Tree integration cannot write symlink ${request.path}.`);
    if (mode === '160000')
      throw new Error(`Tree integration cannot write gitlink ${request.path}.`);
  }

  private static assertDirectCommit(
    request: DirectCommitRequest,
  ): readonly string[] {
    const workspace = request.workspace;
    const handoff = request.handoff;
    const workspacePath = workspace.worktreePath;
    if (
      !CANONICAL_TASK_ID.test(handoff.taskId) ||
      !EXACT_GIT_COMMIT.test(handoff.baselineCommit) ||
      !EXACT_GIT_COMMIT.test(handoff.commit)
    )
      throw new Error('Tree integration handoff metadata is noncanonical.');
    const commitAndParents = ModuleWaveTree.git({
      cwd: workspacePath,
      args: ['rev-list', '--parents', '-n', '1', handoff.commit],
    }).split(' ');
    if (
      commitAndParents.length !== 2 ||
      commitAndParents[0] !== handoff.commit ||
      commitAndParents[1] !== handoff.baselineCommit
    )
      throw new Error(
        `Child worktree handoff ${handoff.taskId} is not one direct non-merge commit.`,
      );
    const ancestry = ModuleRepositoryGit.runModuleDeliveryGit({
      cwd: workspacePath,
      args: [
        'merge-base',
        '--is-ancestor',
        handoff.baselineCommit,
        handoff.commit,
      ],
      allowFailure: true,
    });
    if (ancestry.exitCode !== 0)
      throw new Error(
        `Child worktree handoff ${handoff.taskId} is unrelated to its baseline.`,
      );
    const count = ModuleWaveTree.git({
      cwd: workspacePath,
      args: [
        'rev-list',
        '--count',
        `${handoff.baselineCommit}..${handoff.commit}`,
      ],
    });
    if (count !== '1')
      throw new Error(
        `Child worktree handoff ${handoff.taskId} contains more than one commit.`,
      );
    const changedPaths = ModuleCommitHandoff.moduleCommitChangedPaths({
      workspace,
      baselineCommit: handoff.baselineCommit,
      commit: handoff.commit,
    });
    if (changedPaths.length === 0)
      throw new Error(`Child worktree handoff ${handoff.taskId} is empty.`);
    for (const path of changedPaths) {
      if (!CANONICAL_GIT_PATH.test(path))
        throw new Error(`Tree integration path is noncanonical: ${path}.`);
      const matched = handoff.allowedWriteClaims.some((claim) =>
        ModuleWriteClaim.resourceClaimMatchesPath({ claim, path }),
      );
      if (!matched)
        throw new Error(
          `Child worktree handoff ${handoff.taskId} is outside its write claims: ${path}.`,
        );
      ModuleWaveTree.assertSafeTreeEntry({
        workspacePath,
        commit: handoff.baselineCommit,
        path,
      });
      ModuleWaveTree.assertSafeTreeEntry({
        workspacePath,
        commit: handoff.commit,
        path,
      });
    }
    return changedPaths;
  }

  private static assertBaselineInParentFrontier(
    request: ParentFrontierRequest,
  ): void {
    if (request.baselineCommit === request.currentHead) return;
    const ancestry = ModuleRepositoryGit.runModuleDeliveryGit({
      cwd: request.workspacePath,
      args: [
        'merge-base',
        '--is-ancestor',
        request.baselineCommit,
        request.currentHead,
      ],
      allowFailure: true,
    });
    if (ancestry.exitCode !== 0)
      throw new Error(
        `Child worktree handoff ${request.taskId} has a stale baseline.`,
      );
  }

  private static assertNoParentChangesInClaims(
    request: ParentChangesRequest,
  ): void {
    const changedPaths = ModuleCommitHandoff.moduleCommitChangedPaths({
      workspace: request.workspace,
      baselineCommit: request.baselineCommit,
      commit: request.currentHead,
    });
    for (const path of changedPaths)
      if (
        request.allowedWriteClaims.some((claim) =>
          ModuleWriteClaim.resourceClaimMatchesPath({ claim, path }),
        )
      )
        throw new Error(
          `Child worktree handoff ${request.taskId} overlaps integrated parent changes: ${path}.`,
        );
  }

  private static assertNoActiveGitOperation(workspacePath: string): void {
    for (const head of ['CHERRY_PICK_HEAD', 'MERGE_HEAD', 'REVERT_HEAD']) {
      if (
        ModuleRepositoryGit.runModuleDeliveryGit({
          cwd: workspacePath,
          args: ['rev-parse', '--verify', head],
          allowFailure: true,
        }).exitCode === 0
      )
        throw new Error('Integration parent has an active Git operation.');
    }
  }

  private static rollback(request: RollbackRequest): void {
    const workspace = request.workspace;
    const originalHead = request.originalHead;
    const workspacePath = workspace.worktreePath;
    const abort = ModuleRepositoryGit.runModuleDeliveryGit({
      cwd: workspacePath,
      args: ['cherry-pick', '--abort'],
      allowFailure: true,
    });
    if (abort.exitCode !== 0) {
      const operation = ModuleRepositoryGit.runModuleDeliveryGit({
        cwd: workspacePath,
        args: ['rev-parse', '--verify', 'CHERRY_PICK_HEAD'],
        allowFailure: true,
      });
      if (operation.exitCode === 0)
        throw new Error('Integration parent cherry-pick could not be aborted.');
    }
    const head = ModuleWaveTree.git({
      cwd: workspacePath,
      args: ['rev-parse', '--verify', 'HEAD^{commit}'],
    });
    if (head !== originalHead)
      ModuleRepositoryGit.runModuleDeliveryGit({
        cwd: workspacePath,
        args: ['reset', '--hard', originalHead],
      });
    ModuleWorktree.assertModuleWorktreeClean(workspace);
  }

  static apply(request: ApplyModuleWaveTreeRequest): string {
    return new ModuleWaveTree(request).execute();
  }

  static restore(request: RestoreModuleWaveTreeRequest): void {
    if (
      !EXACT_GIT_COMMIT.test(request.originalHead) ||
      !EXACT_GIT_COMMIT.test(request.appliedHead)
    )
      throw new Error('Tree integration rollback requires exact Git commits.');
    ModuleWorktree.assertIntegrationWorkspaceIdentity(request.workspace);
    ModuleWaveTree.assertNoActiveGitOperation(request.workspace.worktreePath);
    ModuleWorktree.assertModuleWorktreeClean(request.workspace);
    const actualHead = ModuleWaveTree.git({
      cwd: request.workspace.worktreePath,
      args: ['rev-parse', '--verify', 'HEAD^{commit}'],
    });
    if (actualHead === request.originalHead) return;
    if (actualHead !== request.appliedHead)
      throw new Error(
        'Integration parent changed outside the active tree integration.',
      );
    ModuleRepositoryGit.runModuleDeliveryGit({
      cwd: request.workspace.worktreePath,
      args: ['reset', '--hard', request.originalHead],
    });
    const restoredHead = ModuleWaveTree.git({
      cwd: request.workspace.worktreePath,
      args: ['rev-parse', '--verify', 'HEAD^{commit}'],
    });
    if (restoredHead !== request.originalHead)
      throw new Error(
        'Integration parent rollback did not restore its frontier.',
      );
    ModuleWorktree.assertModuleWorktreeClean(request.workspace);
  }

  private execute(): string {
    const request = this.request;
    if (!EXACT_GIT_COMMIT.test(request.currentHead))
      throw new Error('Tree integration requires an exact current head.');
    ModuleWorktree.assertIntegrationWorkspaceIdentity(request.workspace);
    ModuleWorktree.assertModuleWorktreeClean(request.workspace);
    ModuleWaveTree.assertNoActiveGitOperation(request.workspace.worktreePath);
    const actualHead = ModuleWaveTree.git({
      cwd: request.workspace.worktreePath,
      args: ['rev-parse', '--verify', 'HEAD^{commit}'],
    });
    if (actualHead !== request.currentHead)
      throw new Error('Integration parent head does not match its frontier.');
    let head = request.currentHead;
    let activeClaims: readonly string[] = [];
    const taskIds = new Set<string>();
    let applied = false;
    try {
      for (const handoff of request.handoffs) {
        if (taskIds.has(handoff.taskId))
          throw new Error(
            `Tree integration task is duplicated: ${handoff.taskId}.`,
          );
        taskIds.add(handoff.taskId);
        ModuleWriteClaim.validateModuleWriteClaims(handoff.allowedWriteClaims);
        const changedPaths = ModuleWaveTree.assertDirectCommit({
          workspace: request.workspace,
          handoff,
        });
        ModuleWaveTree.assertBaselineInParentFrontier({
          workspacePath: request.workspace.worktreePath,
          taskId: handoff.taskId,
          baselineCommit: handoff.baselineCommit,
          currentHead: head,
        });
        ModuleWaveTree.assertNoParentChangesInClaims({
          workspace: request.workspace,
          taskId: handoff.taskId,
          baselineCommit: handoff.baselineCommit,
          currentHead: head,
          allowedWriteClaims: handoff.allowedWriteClaims,
        });
        if (
          activeClaims.some((claim) =>
            handoff.allowedWriteClaims.some((nextClaim) =>
              ModuleResourceContainment.resourceClaimListsOverlap({
                first: [claim],
                second: [nextClaim],
              }),
            ),
          )
        )
          throw new Error(
            `Child worktree handoff ${handoff.taskId} overlaps a sibling write claim.`,
          );
        if (changedPaths.length === 0)
          throw new Error(`Child worktree handoff ${handoff.taskId} is empty.`);
        activeClaims = [...activeClaims, ...handoff.allowedWriteClaims];
        applied = true;
        ModuleRepositoryGit.runModuleDeliveryGit({
          cwd: request.workspace.worktreePath,
          args: ['cherry-pick', '--no-edit', handoff.commit],
        });
        ModuleWorktree.assertModuleWorktreeClean(request.workspace);
        head = ModuleWaveTree.git({
          cwd: request.workspace.worktreePath,
          args: ['rev-parse', '--verify', 'HEAD^{commit}'],
        });
      }
      return head;
    } catch (error) {
      if (applied)
        ModuleWaveTree.rollback({
          workspace: request.workspace,
          originalHead: request.currentHead,
        });
      throw error;
    }
  }
}

export type TreeHandoff = {
  readonly taskId: string;
  readonly baselineCommit: string;
  readonly commit: string;
  readonly allowedWriteClaims: readonly string[];
};

export type ApplyModuleWaveTreeRequest = {
  readonly workspace: ModuleWorktreeHandle;
  readonly currentHead: string;
  readonly handoffs: readonly TreeHandoff[];
};

export type RestoreModuleWaveTreeRequest = {
  readonly workspace: ModuleWorktreeHandle;
  readonly originalHead: string;
  readonly appliedHead: string;
};

type GitInvocation = {
  readonly cwd: string;
  readonly args: readonly string[];
  readonly allowFailure?: boolean;
};

type SafeTreeEntryRequest = {
  readonly workspacePath: string;
  readonly commit: string;
  readonly path: string;
};

type DirectCommitRequest = {
  readonly workspace: ModuleWorktreeHandle;
  readonly handoff: TreeHandoff;
};

type RollbackRequest = {
  readonly workspace: ModuleWorktreeHandle;
  readonly originalHead: string;
};

type ParentFrontierRequest = {
  readonly workspacePath: string;
  readonly taskId: string;
  readonly baselineCommit: string;
  readonly currentHead: string;
};

type ParentChangesRequest = {
  readonly workspace: ModuleWorktreeHandle;
  readonly taskId: string;
  readonly baselineCommit: string;
  readonly currentHead: string;
  readonly allowedWriteClaims: readonly string[];
};
