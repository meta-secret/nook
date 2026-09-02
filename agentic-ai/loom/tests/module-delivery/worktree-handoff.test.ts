import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

import {
  cleanupModuleWorktree,
  prepareModuleWorktree,
  verifyModuleCommitHandoff,
} from '../../src/module-delivery/index.ts';
import {
  createGitFixture,
  disposeGitFixture,
  fixtureGit,
  prepareRequest,
  worktreeFileWriter,
  worktreeGit,
} from './worktree-test-support.ts';

import type {
  CleanupModuleWorktreeRequest,
  ModuleWorktreeHandle,
  PrepareModuleWorktreeRequest,
  VerifyModuleCommitHandoffRequest,
} from '../../src/module-delivery/index.ts';
import type { GitFixture } from './worktree-test-support.ts';

const fixtures: GitFixture[] = [];
const workspaces: ModuleWorktreeHandle[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    const cleanupRequest: CleanupModuleWorktreeRequest = { workspace };
    try {
      cleanupModuleWorktree(cleanupRequest);
    } catch {
      // Rejection tests may intentionally invalidate the worktree.
    }
  }
  for (const fixture of fixtures.splice(0)) disposeGitFixture(fixture);
});

function createWorkspace(taskId = 'module-task'): ModuleWorktreeHandle {
  const fixture = createGitFixture();
  fixtures.push(fixture);
  const request: PrepareModuleWorktreeRequest = {
    ...prepareRequest(fixture),
    taskId,
  };
  const workspace = prepareModuleWorktree(request);
  workspaces.push(workspace);
  return workspace;
}

function currentFixture(): GitFixture {
  const fixture = fixtures.at(-1);
  if (!fixture) throw new Error('Git fixture was not prepared.');
  return fixture;
}

function verificationRequest(
  active: ModuleWorktreeHandle,
): VerifyModuleCommitHandoffRequest {
  return {
    workspace: active,
    baselineCommit: active.baselineCommit,
    allowedWriteClaims: ['module/**'],
  };
}

function commitPath(active: ModuleWorktreeHandle): void {
  worktreeFileWriter(active)(['module/feature.ts', 'change\n']);
  const git = worktreeGit(active);
  git(['add', '--all']);
  git(['commit', '--quiet', '-m', 'feature']);
}

describe('verifyModuleCommitHandoff', () => {
  test('accepts an underscore write-task through worktree handoff', () => {
    const active = createWorkspace('writer_with_underscore');
    commitPath(active);
    const request = verificationRequest(active);
    const handoff = verifyModuleCommitHandoff(request);
    expect(handoff.changedPaths).toEqual(['module/feature.ts']);
    expect(handoff.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(handoff.taskId).toBe('writer_with_underscore');
  });

  test('rejects dirty and out-of-scope handoffs', () => {
    const active = createWorkspace();
    const write = worktreeFileWriter(active);
    const git = worktreeGit(active);
    write(['module/dirty.ts', 'dirty\n']);
    const dirtyRequest = verificationRequest(active);
    expect(() => verifyModuleCommitHandoff(dirtyRequest)).toThrow('clean');
    git(['reset', '--hard', 'HEAD']);
    write(['outside.ts', 'outside\n']);
    git(['add', '--all']);
    git(['commit', '--quiet', '-m', 'outside']);
    const outsideRequest = verificationRequest(active);
    expect(() => verifyModuleCommitHandoff(outsideRequest)).toThrow(
      'outside allowed write claims',
    );
  });

  test('ignores replacement refs while validating the handed-off commit', () => {
    const active = createWorkspace();
    const git = worktreeGit(active);
    const write = worktreeFileWriter(active);
    write(['outside.ts', 'unsafe\n']);
    git(['add', '--all']);
    git(['commit', '--quiet', '-m', 'unsafe handoff']);
    const unsafeCommit = git(['rev-parse', 'HEAD']);
    git(['reset', '--hard', active.baselineCommit]);
    write(['module/safe.ts', 'safe\n']);
    git(['add', '--all']);
    git(['commit', '--quiet', '-m', 'replacement']);
    const replacementCommit = git(['rev-parse', 'HEAD']);
    git(['reset', '--hard', unsafeCommit]);
    git(['replace', unsafeCommit, replacementCommit]);

    const request = verificationRequest(active);
    expect(() => verifyModuleCommitHandoff(request)).toThrow(
      'outside allowed write claims',
    );
  });

  test('recursive basename claims match only the final path component', () => {
    const active = createWorkspace();
    const git = worktreeGit(active);
    worktreeFileWriter(active)(['owned.ts/escape.bin', 'escape\n']);
    git(['add', '--all']);
    git(['commit', '--quiet', '-m', 'directory escape']);
    const request: VerifyModuleCommitHandoffRequest = {
      workspace: active,
      baselineCommit: active.baselineCommit,
      allowedWriteClaims: ['**/*.ts'],
    };
    expect(() => verifyModuleCommitHandoff(request)).toThrow(
      'outside allowed write claims',
    );
  });

  test('rejects empty, multi-commit, and noncanonical handoffs', () => {
    const active = createWorkspace();
    const git = worktreeGit(active);
    git(['commit', '--quiet', '--allow-empty', '-m', 'empty']);
    const emptyRequest = verificationRequest(active);
    expect(() => verifyModuleCommitHandoff(emptyRequest)).toThrow('nonempty');
    worktreeFileWriter(active)(['module/one.ts', 'one\n']);
    git(['add', '--all']);
    git(['commit', '--quiet', '-m', 'second']);
    const multipleRequest = verificationRequest(active);
    expect(() => verifyModuleCommitHandoff(multipleRequest)).toThrow(
      'directly after its baseline',
    );
    git(['reset', '--hard', active.baselineCommit]);
    worktreeFileWriter(active)(['module/bad name.ts', 'bad\n']);
    git(['add', '--all']);
    git(['commit', '--quiet', '-m', 'bad name']);
    const nameRequest = verificationRequest(active);
    expect(() => verifyModuleCommitHandoff(nameRequest)).toThrow(
      'noncanonical',
    );
  });

  test('rejects added and baseline symlinks', () => {
    const active = createWorkspace();
    const git = worktreeGit(active);
    symlinkSync('seed.txt', join(active.worktreePath, 'module', 'link.ts'));
    git(['add', '--all']);
    git(['commit', '--quiet', '-m', 'link']);
    const addedRequest = verificationRequest(active);
    expect(() => verifyModuleCommitHandoff(addedRequest)).toThrow('symlink');

    const cleanupRequest: CleanupModuleWorktreeRequest = { workspace: active };
    cleanupModuleWorktree(cleanupRequest);
    const fixture = currentFixture();
    const sourceGit = fixtureGit(fixture);
    symlinkSync(
      'seed.txt',
      join(fixture.sourceRoot, 'module', 'baseline-link'),
    );
    sourceGit(['add', '--all']);
    sourceGit(['commit', '--quiet', '-m', 'baseline link']);
    const baselineCommit = sourceGit(['rev-parse', 'HEAD']);
    const baseRequest = prepareRequest(fixture);
    const linkedRequest: PrepareModuleWorktreeRequest = {
      ...baseRequest,
      baselineCommit,
    };
    const workspace = prepareModuleWorktree(linkedRequest);
    workspaces.push(workspace);
    const linkedGit = worktreeGit(workspace);
    worktreeFileWriter(workspace)(['module/feature.ts', 'change\n']);
    linkedGit(['add', '--all']);
    linkedGit(['commit', '--quiet', '-m', 'leave baseline link untouched']);
    const removalRequest = verificationRequest(workspace);
    expect(() => verifyModuleCommitHandoff(removalRequest)).toThrow(
      'Writable baseline cannot contain symlink',
    );
  });

  test('rejects a gitlink inside an allowed write claim', () => {
    const active = createWorkspace();
    const dependencyPath = join(active.worktreePath, 'module', 'dependency');
    mkdirSync(dependencyPath);
    const git = worktreeGit(active);
    git([
      'update-index',
      '--add',
      '--cacheinfo',
      `160000,${active.baselineCommit},module/dependency`,
    ]);
    git(['commit', '--quiet', '-m', 'gitlink']);
    const request = verificationRequest(active);
    expect(() => verifyModuleCommitHandoff(request)).toThrow('gitlink');
  });
});
