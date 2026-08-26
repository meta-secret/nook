import { mkdtempSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { gitText, runModuleDeliveryGit } from './git-command.ts';

import type { GitCommandRequest } from './git-command.ts';
import type { ModuleWorktreeHandle } from './workspace.ts';

export type TreeHandoff = {
  readonly taskId: string;
  readonly baselineCommit: string;
  readonly commit: string;
};

export type ApplyModuleWaveTreeRequest = {
  readonly workspace: ModuleWorktreeHandle;
  readonly currentHead: string;
  readonly handoffs: readonly TreeHandoff[];
};

type ModuleGitInvocation = {
  readonly cwd: string;
  readonly args: readonly string[];
  readonly indexFile?: string;
  readonly commitTimestamp?: string;
};

type TemporaryIndex = {
  readonly directory: string;
  readonly path: string;
};

type TreeBuildRequest = {
  readonly request: ApplyModuleWaveTreeRequest;
  readonly index: TemporaryIndex;
};

type IntegrationCommitRequest = {
  readonly request: ApplyModuleWaveTreeRequest;
  readonly tree: string;
};

function gitRequest(invocation: ModuleGitInvocation): GitCommandRequest {
  const request: GitCommandRequest = {
    cwd: invocation.cwd,
    args: invocation.args,
    ...('indexFile' in invocation ? { indexFile: invocation.indexFile } : {}),
    ...('commitTimestamp' in invocation
      ? { commitTimestamp: invocation.commitTimestamp }
      : {}),
  };
  return request;
}

function gitInvocation(invocation: ModuleGitInvocation): string {
  return gitText(runModuleDeliveryGit(gitRequest(invocation)));
}

function temporaryIndex(workspace: ModuleWorktreeHandle): TemporaryIndex {
  const prefix = join(
    workspace.ownedWorkspaceRoot,
    '.module-integration-index-',
  );
  const directory = resolve(mkdtempSync(prefix));
  const fromRoot = relative(workspace.ownedWorkspaceRoot, directory);
  if (
    fromRoot === '' ||
    fromRoot.startsWith('..') ||
    isAbsolute(fromRoot) ||
    dirname(directory) !== workspace.ownedWorkspaceRoot
  ) {
    throw new Error(
      'Temporary module integration index escaped its owned root.',
    );
  }
  return { directory, path: join(directory, 'index') };
}

function buildTree(build: TreeBuildRequest): string {
  let tree = build.request.currentHead;
  for (const handoff of build.request.handoffs) {
    const mergeInvocation: ModuleGitInvocation = {
      cwd: build.request.workspace.worktreePath,
      args: [
        'read-tree',
        '-i',
        '--no-sparse-checkout',
        '--no-recurse-submodules',
        '--trivial',
        '-m',
        handoff.baselineCommit,
        tree,
        handoff.commit,
      ],
      indexFile: build.index.path,
    };
    runModuleDeliveryGit(gitRequest(mergeInvocation));
    const unresolvedInvocation: ModuleGitInvocation = {
      cwd: build.request.workspace.worktreePath,
      args: ['ls-files', '-u'],
      indexFile: build.index.path,
    };
    if (
      runModuleDeliveryGit(gitRequest(unresolvedInvocation)).stdout.length > 0
    ) {
      throw new Error('Module integration tree contains unresolved entries.');
    }
    const writeInvocation: ModuleGitInvocation = {
      cwd: build.request.workspace.worktreePath,
      args: ['write-tree'],
      indexFile: build.index.path,
    };
    tree = gitInvocation(writeInvocation);
  }
  return tree;
}

function createIntegrationCommit(commit: IntegrationCommitRequest): string {
  const taskIds = commit.request.handoffs.map((handoff) => handoff.taskId);
  const invocation: ModuleGitInvocation = {
    cwd: commit.request.workspace.worktreePath,
    args: [
      '-c',
      'user.name=Nook Module Delivery',
      '-c',
      'user.email=module-delivery@nook.invalid',
      'commit-tree',
      commit.tree,
      '-p',
      commit.request.currentHead,
      '-m',
      `Integrate module delivery wave: ${taskIds.join(', ')}`,
    ],
    commitTimestamp: '@0 +0000',
  };
  return gitInvocation(invocation);
}

export function applyModuleWaveTree(
  request: ApplyModuleWaveTreeRequest,
): string {
  const index = temporaryIndex(request.workspace);
  try {
    const build: TreeBuildRequest = { request, index };
    const tree = buildTree(build);
    const commit: IntegrationCommitRequest = { request, tree };
    return createIntegrationCommit(commit);
  } finally {
    const removalOptions = { force: true, recursive: true } as const;
    rmSync(index.directory, removalOptions);
  }
}
