import { afterEach, describe, expect, test } from 'bun:test';

import { mkdirSync, symlinkSync } from 'node:fs';

import { join } from 'node:path';

import {
  ModuleWorktree,
  ModuleCommitHandoff,
} from '../../src/module-delivery/index.ts';

import { ModuleDeliveryWorktreeTestSupportScenario } from './worktree-test-support.ts';

import type {
  CleanupModuleWorktreeRequest,
  ModuleWorktreeHandle,
  PrepareModuleWorktreeRequest,
  VerifyModuleCommitHandoffRequest,
} from '../../src/module-delivery/index.ts';

import type { GitFixture } from './worktree-test-support.ts';

export class ModuleDeliveryWorktreeHandoffScenario {
  private constructor(private readonly request: ModuleWorktreeHandle) {}

  static createWorkspace(taskId = 'module-task'): ModuleWorktreeHandle {
    const fixture =
      ModuleDeliveryWorktreeTestSupportScenario.createGitFixture();
    fixtures.push(fixture);
    const request: PrepareModuleWorktreeRequest = {
      ...ModuleDeliveryWorktreeTestSupportScenario.prepareRequest(fixture),
      taskId,
    };
    const workspace = ModuleWorktree.prepareModuleWorktree(request);
    workspaces.push(workspace);
    return workspace;
  }

  static currentFixture(): GitFixture {
    const fixture = fixtures.at(-1);
    if (!fixture) throw new Error('Git fixture was not prepared.');
    return fixture;
  }

  static verificationRequest(
    active: ModuleWorktreeHandle,
  ): VerifyModuleCommitHandoffRequest {
    return new ModuleDeliveryWorktreeHandoffScenario(active).execute();
  }

  private execute(): VerifyModuleCommitHandoffRequest {
    const active = this.request;
    return {
      workspace: active,
      baselineCommit: active.baselineCommit,
      allowedWriteClaims: ['module/**'],
    };
  }

  static commitPath(active: ModuleWorktreeHandle): void {
    ModuleDeliveryWorktreeTestSupportScenario.worktreeFileWriter(active)([
      'module/feature.ts',
      'change\n',
    ]);
    const git = ModuleDeliveryWorktreeTestSupportScenario.worktreeGit(active);
    git(['add', '--all']);
    git(['commit', '--quiet', '-m', 'feature']);
  }
}

const fixtures: GitFixture[] = [];

const workspaces: ModuleWorktreeHandle[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    const cleanupRequest: CleanupModuleWorktreeRequest = { workspace };
    try {
      ModuleWorktree.cleanupModuleWorktree(cleanupRequest);
    } catch {
      // Rejection tests may intentionally invalidate the worktree.
    }
  }
  for (const fixture of fixtures.splice(0))
    ModuleDeliveryWorktreeTestSupportScenario.disposeGitFixture(fixture);
});

describe('verifyModuleCommitHandoff', () => {
  test('accepts an underscore write-task through worktree handoff', () => {
    const active = ModuleDeliveryWorktreeHandoffScenario.createWorkspace(
      'writer_with_underscore',
    );
    ModuleDeliveryWorktreeHandoffScenario.commitPath(active);
    const request =
      ModuleDeliveryWorktreeHandoffScenario.verificationRequest(active);
    const handoff = ModuleCommitHandoff.verifyModuleCommitHandoff(request);
    expect(handoff.changedPaths).toEqual(['module/feature.ts']);
    expect(handoff.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(handoff.taskId).toBe('writer_with_underscore');
  });

  test('rejects a handoff committed on a different branch', () => {
    const active = ModuleDeliveryWorktreeHandoffScenario.createWorkspace();
    ModuleDeliveryWorktreeTestSupportScenario.worktreeGit(active)([
      'switch',
      '--quiet',
      '-c',
      'other',
    ]);
    ModuleDeliveryWorktreeHandoffScenario.commitPath(active);
    expect(() =>
      ModuleCommitHandoff.verifyModuleCommitHandoff(
        ModuleDeliveryWorktreeHandoffScenario.verificationRequest(active),
      ),
    ).toThrow('identity does not match');
  });

  test('rejects dirty and out-of-scope handoffs', () => {
    const active = ModuleDeliveryWorktreeHandoffScenario.createWorkspace();
    const write =
      ModuleDeliveryWorktreeTestSupportScenario.worktreeFileWriter(active);
    const git = ModuleDeliveryWorktreeTestSupportScenario.worktreeGit(active);
    write(['module/dirty.ts', 'dirty\n']);
    const dirtyRequest =
      ModuleDeliveryWorktreeHandoffScenario.verificationRequest(active);
    expect(() =>
      ModuleCommitHandoff.verifyModuleCommitHandoff(dirtyRequest),
    ).toThrow('clean');
    git(['reset', '--hard', 'HEAD']);
    write(['outside.ts', 'outside\n']);
    git(['add', '--all']);
    git(['commit', '--quiet', '-m', 'outside']);
    const outsideRequest =
      ModuleDeliveryWorktreeHandoffScenario.verificationRequest(active);
    expect(() =>
      ModuleCommitHandoff.verifyModuleCommitHandoff(outsideRequest),
    ).toThrow('outside allowed write claims');
  });

  test('ignores replacement refs while validating the handed-off commit', () => {
    const active = ModuleDeliveryWorktreeHandoffScenario.createWorkspace();
    const git = ModuleDeliveryWorktreeTestSupportScenario.worktreeGit(active);
    const write =
      ModuleDeliveryWorktreeTestSupportScenario.worktreeFileWriter(active);
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

    const request =
      ModuleDeliveryWorktreeHandoffScenario.verificationRequest(active);
    expect(() =>
      ModuleCommitHandoff.verifyModuleCommitHandoff(request),
    ).toThrow('outside allowed write claims');
  });

  test('recursive basename claims match only the final path component', () => {
    const active = ModuleDeliveryWorktreeHandoffScenario.createWorkspace();
    const git = ModuleDeliveryWorktreeTestSupportScenario.worktreeGit(active);
    ModuleDeliveryWorktreeTestSupportScenario.worktreeFileWriter(active)([
      'owned.ts/escape.bin',
      'escape\n',
    ]);
    git(['add', '--all']);
    git(['commit', '--quiet', '-m', 'directory escape']);
    const request: VerifyModuleCommitHandoffRequest = {
      workspace: active,
      baselineCommit: active.baselineCommit,
      allowedWriteClaims: ['**/*.ts'],
    };
    expect(() =>
      ModuleCommitHandoff.verifyModuleCommitHandoff(request),
    ).toThrow('outside allowed write claims');
  });

  test('rejects empty, multi-commit, and noncanonical handoffs', () => {
    const active = ModuleDeliveryWorktreeHandoffScenario.createWorkspace();
    const git = ModuleDeliveryWorktreeTestSupportScenario.worktreeGit(active);
    git(['commit', '--quiet', '--allow-empty', '-m', 'empty']);
    const emptyRequest =
      ModuleDeliveryWorktreeHandoffScenario.verificationRequest(active);
    expect(() =>
      ModuleCommitHandoff.verifyModuleCommitHandoff(emptyRequest),
    ).toThrow('nonempty');
    ModuleDeliveryWorktreeTestSupportScenario.worktreeFileWriter(active)([
      'module/one.ts',
      'one\n',
    ]);
    git(['add', '--all']);
    git(['commit', '--quiet', '-m', 'second']);
    const multipleRequest =
      ModuleDeliveryWorktreeHandoffScenario.verificationRequest(active);
    expect(() =>
      ModuleCommitHandoff.verifyModuleCommitHandoff(multipleRequest),
    ).toThrow('directly after its baseline');
    git(['reset', '--hard', active.baselineCommit]);
    ModuleDeliveryWorktreeTestSupportScenario.worktreeFileWriter(active)([
      'module/bad name.ts',
      'bad\n',
    ]);
    git(['add', '--all']);
    git(['commit', '--quiet', '-m', 'bad name']);
    const nameRequest =
      ModuleDeliveryWorktreeHandoffScenario.verificationRequest(active);
    expect(() =>
      ModuleCommitHandoff.verifyModuleCommitHandoff(nameRequest),
    ).toThrow('noncanonical');
  });

  test('rejects added and baseline symlinks', () => {
    const active = ModuleDeliveryWorktreeHandoffScenario.createWorkspace();
    const git = ModuleDeliveryWorktreeTestSupportScenario.worktreeGit(active);
    symlinkSync('seed.txt', join(active.worktreePath, 'module', 'link.ts'));
    git(['add', '--all']);
    git(['commit', '--quiet', '-m', 'link']);
    const addedRequest =
      ModuleDeliveryWorktreeHandoffScenario.verificationRequest(active);
    expect(() =>
      ModuleCommitHandoff.verifyModuleCommitHandoff(addedRequest),
    ).toThrow('symlink');

    const cleanupRequest: CleanupModuleWorktreeRequest = { workspace: active };
    ModuleWorktree.cleanupModuleWorktree(cleanupRequest);
    const fixture = ModuleDeliveryWorktreeHandoffScenario.currentFixture();
    const sourceGit =
      ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(fixture);
    symlinkSync(
      'seed.txt',
      join(fixture.sourceRoot, 'module', 'baseline-link'),
    );
    sourceGit(['add', '--all']);
    sourceGit(['commit', '--quiet', '-m', 'baseline link']);
    const baselineCommit = sourceGit(['rev-parse', 'HEAD']);
    const baseRequest =
      ModuleDeliveryWorktreeTestSupportScenario.prepareRequest(fixture);
    const linkedRequest: PrepareModuleWorktreeRequest = {
      ...baseRequest,
      baselineCommit,
    };
    const workspace = ModuleWorktree.prepareModuleWorktree(linkedRequest);
    workspaces.push(workspace);
    const linkedGit =
      ModuleDeliveryWorktreeTestSupportScenario.worktreeGit(workspace);
    ModuleDeliveryWorktreeTestSupportScenario.worktreeFileWriter(workspace)([
      'module/feature.ts',
      'change\n',
    ]);
    linkedGit(['add', '--all']);
    linkedGit(['commit', '--quiet', '-m', 'leave baseline link untouched']);
    const removalRequest =
      ModuleDeliveryWorktreeHandoffScenario.verificationRequest(workspace);
    expect(() =>
      ModuleCommitHandoff.verifyModuleCommitHandoff(removalRequest),
    ).toThrow('Writable baseline cannot contain symlink');
  });

  test('rejects a gitlink inside an allowed write claim', () => {
    const active = ModuleDeliveryWorktreeHandoffScenario.createWorkspace();
    const dependencyPath = join(active.worktreePath, 'module', 'dependency');
    mkdirSync(dependencyPath);
    const git = ModuleDeliveryWorktreeTestSupportScenario.worktreeGit(active);
    git([
      'update-index',
      '--add',
      '--cacheinfo',
      `160000,${active.baselineCommit},module/dependency`,
    ]);
    git(['commit', '--quiet', '-m', 'gitlink']);
    const request =
      ModuleDeliveryWorktreeHandoffScenario.verificationRequest(active);
    expect(() =>
      ModuleCommitHandoff.verifyModuleCommitHandoff(request),
    ).toThrow('gitlink');
  });
});
