import { afterEach, describe, expect, test } from 'bun:test';

import {
  chmodSync,
  existsSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';

import { join } from 'node:path';

import { ModuleWorktree } from '../../src/module-delivery/index.ts';

import { ModuleRepositoryGit } from '../../src/module-delivery/git-command.ts';

import { ModuleDeliveryWorktreeTestSupportScenario } from './worktree-test-support.ts';

import type {
  CleanupModuleWorktreeRequest,
  ModuleWorktreeHandle,
  PrepareModuleWorktreeRequest,
} from '../../src/module-delivery/index.ts';

import type { GitFixture } from './worktree-test-support.ts';

export class ModuleDeliveryWorktreePrepareScenario {
  private constructor(private readonly request: PrepareModuleWorktreeRequest) {}

  static createTrackedFixture(): GitFixture {
    const fixture =
      ModuleDeliveryWorktreeTestSupportScenario.createGitFixture();
    fixtures.push(fixture);
    return fixture;
  }

  static prepared(request: PrepareModuleWorktreeRequest): ModuleWorktreeHandle {
    return new ModuleDeliveryWorktreePrepareScenario(request).execute();
  }

  private execute(): ModuleWorktreeHandle {
    const request = this.request;
    const workspace = ModuleWorktree.prepareModuleWorktree(request);
    workspaces.push(workspace);
    return workspace;
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
      // Rejection tests can intentionally invalidate the workspace.
    }
  }
  for (const fixture of fixtures.splice(0)) {
    ModuleDeliveryWorktreeTestSupportScenario.disposeGitFixture(fixture);
  }
});

describe('prepareModuleWorktree', () => {
  test('identifies the current shared checkout at the exact baseline', () => {
    const fixture =
      ModuleDeliveryWorktreePrepareScenario.createTrackedFixture();
    const marker =
      ModuleDeliveryWorktreeTestSupportScenario.installCheckoutHook(fixture);
    const request =
      ModuleDeliveryWorktreeTestSupportScenario.prepareRequest(fixture);
    const workspace = ModuleDeliveryWorktreePrepareScenario.prepared(request);
    const git =
      ModuleDeliveryWorktreeTestSupportScenario.worktreeGit(workspace);

    expect(workspace.baselineCommit).toBe(fixture.baselineCommit);
    expect(workspace.worktreePath).toBe(fixture.sourceRoot);
    expect(workspace.ownedWorkspaceRoot).toBe(fixture.sourceRoot);
    expect(workspace.worktreeId).toBe('shared-checkout');
    expect(workspace.branchName).toMatch(/^refs\/heads\/.+$/);
    expect(git(['rev-parse', 'HEAD'])).toBe(fixture.baselineCommit);
    expect(git(['status', '--porcelain=v1'])).toBe('');
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'])).not.toBe('HEAD');
    expect(existsSync(marker)).toBe(false);
  });

  test('reuses the shared checkout for retry attempts', () => {
    const fixture =
      ModuleDeliveryWorktreePrepareScenario.createTrackedFixture();
    const firstRequest =
      ModuleDeliveryWorktreeTestSupportScenario.prepareRequest(fixture);
    const first = ModuleDeliveryWorktreePrepareScenario.prepared(firstRequest);
    const secondRequest: PrepareModuleWorktreeRequest = {
      ...firstRequest,
      attempt: 2,
    };
    const second =
      ModuleDeliveryWorktreePrepareScenario.prepared(secondRequest);
    expect(second.worktreePath).toBe(first.worktreePath);
    expect(second.worktreeId).toBe(first.worktreeId);
    expect(second.attempt).toBe(2);
  });

  test('rejects a dirty or stale shared checkout before dispatch', () => {
    const fixture =
      ModuleDeliveryWorktreePrepareScenario.createTrackedFixture();
    const request =
      ModuleDeliveryWorktreeTestSupportScenario.prepareRequest(fixture);
    writeFileSync(join(fixture.sourceRoot, 'dirty.ts'), 'dirty\n');
    expect(() => ModuleWorktree.prepareModuleWorktree(request)).toThrow(
      'must be clean before dispatch',
    );
    ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(fixture)([
      'clean',
      '-fd',
    ]);
    writeFileSync(join(fixture.sourceRoot, 'later.ts'), 'later\n');
    ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(fixture)([
      'add',
      'later.ts',
    ]);
    ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(fixture)([
      'commit',
      '--quiet',
      '-m',
      'later',
    ]);
    expect(() => ModuleWorktree.prepareModuleWorktree(request)).toThrow(
      'HEAD must match its baseline',
    );
  });

  test('rejects a detached shared checkout before dispatch', () => {
    const fixture =
      ModuleDeliveryWorktreePrepareScenario.createTrackedFixture();
    ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(fixture)([
      'checkout',
      '--quiet',
      '--detach',
    ]);
    expect(() =>
      ModuleWorktree.prepareModuleWorktree(
        ModuleDeliveryWorktreeTestSupportScenario.prepareRequest(fixture),
      ),
    ).toThrow();
  });

  test('rejects nonexact commits and ignores obsolete workspace roots', () => {
    const fixture =
      ModuleDeliveryWorktreePrepareScenario.createTrackedFixture();
    const base =
      ModuleDeliveryWorktreeTestSupportScenario.prepareRequest(fixture);
    const shortCommitRequest: PrepareModuleWorktreeRequest = {
      ...base,
      baselineCommit: fixture.baselineCommit.slice(0, 12),
    };
    expect(() =>
      ModuleWorktree.prepareModuleWorktree(shortCommitRequest),
    ).toThrow('exact lowercase 40-hex');

    const hadGitDirectory = 'GIT_DIR' in process.env;
    const [previousGitDirectory = ''] = [process.env.GIT_DIR];
    process.env.GIT_DIR = join(fixture.root, 'does-not-exist');
    const scrubbed = ModuleDeliveryWorktreePrepareScenario.prepared(base);
    expect(scrubbed.baselineCommit).toBe(fixture.baselineCommit);
    if (hadGitDirectory) process.env.GIT_DIR = previousGitDirectory;
    else delete process.env.GIT_DIR;

    const nestedRoot = join(fixture.sourceRoot, 'nested-workspaces');
    mkdirSync(nestedRoot);
    const nestedRequest: PrepareModuleWorktreeRequest = {
      ...base,
      workspaceRoot: nestedRoot,
    };
    expect(
      ModuleWorktree.prepareModuleWorktree(nestedRequest).worktreePath,
    ).toBe(fixture.sourceRoot);
  });

  test('does not create a worktree registration', () => {
    const fixture =
      ModuleDeliveryWorktreePrepareScenario.createTrackedFixture();
    const linkedRoot = join(fixture.root, 'linked-workspaces');
    symlinkSync(fixture.workspaceRoot, linkedRoot);
    const request: PrepareModuleWorktreeRequest = {
      ...ModuleDeliveryWorktreeTestSupportScenario.prepareRequest(fixture),
      workspaceRoot: linkedRoot,
    };
    expect(ModuleWorktree.prepareModuleWorktree(request).worktreePath).toBe(
      fixture.sourceRoot,
    );
    expect(
      ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(fixture)([
        'worktree',
        'list',
        '--porcelain',
      ]),
    ).not.toContain(linkedRoot);
  });

  test('ignores inherited global Git configuration during preparation', () => {
    const fixture =
      ModuleDeliveryWorktreePrepareScenario.createTrackedFixture();
    const marker = join(fixture.root, 'fsmonitor-ran');
    const monitor = join(fixture.root, 'fsmonitor.sh');
    const globalConfig = join(fixture.root, 'poisoned.gitconfig');
    writeFileSync(monitor, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`);
    chmodSync(monitor, 0o755);
    writeFileSync(globalConfig, `[core]\n\tfsmonitor = ${monitor}\n`);
    const hadGlobalConfig = 'GIT_CONFIG_GLOBAL' in process.env;
    const [previousConfig = ''] = [process.env.GIT_CONFIG_GLOBAL];
    process.env.GIT_CONFIG_GLOBAL = globalConfig;
    try {
      ModuleDeliveryWorktreePrepareScenario.prepared(
        ModuleDeliveryWorktreeTestSupportScenario.prepareRequest(fixture),
      );
    } finally {
      if (hadGlobalConfig) process.env.GIT_CONFIG_GLOBAL = previousConfig;
      else delete process.env.GIT_CONFIG_GLOBAL;
    }
    expect(existsSync(marker)).toBe(false);
  });

  test('does not inherit ambient process environment in Git commands', () => {
    const fixture =
      ModuleDeliveryWorktreePrepareScenario.createTrackedFixture();
    const hadEmail = 'EMAIL' in process.env;
    const [previousEmail = ''] = [process.env.EMAIL];
    process.env.EMAIL = 'ambient-authority@nook.invalid';
    try {
      const result = ModuleRepositoryGit.runModuleDeliveryGit({
        cwd: fixture.sourceRoot,
        args: ['var', 'GIT_AUTHOR_IDENT'],
      });
      expect(ModuleRepositoryGit.gitText(result)).not.toContain(
        'ambient-authority@nook.invalid',
      );
    } finally {
      if (hadEmail) process.env.EMAIL = previousEmail;
      else delete process.env.EMAIL;
    }
  });

  test('validates executable search paths for the host platform', () => {
    const fixture =
      ModuleDeliveryWorktreePrepareScenario.createTrackedFixture();
    const hadPath = 'PATH' in process.env;
    const [previousPath = ''] = [process.env.PATH];
    try {
      process.env.PATH = `relative-bin:${previousPath || '/usr/bin'}`;
      expect(() =>
        ModuleRepositoryGit.runModuleDeliveryGit({
          cwd: fixture.sourceRoot,
          args: ['status', '--short'],
        }),
      ).toThrow('search path must contain absolute paths');
      process.env.PATH = '\\\\server\\git';
      let message = '';
      try {
        ModuleRepositoryGit.runModuleDeliveryGit({
          cwd: fixture.sourceRoot,
          args: ['status', '--short'],
        });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      if (process.platform === 'win32')
        expect(message).not.toContain(
          'search path must contain absolute paths',
        );
      else expect(message).toContain('search path must contain absolute paths');
    } finally {
      if (hadPath) process.env.PATH = previousPath;
      else delete process.env.PATH;
    }
  });

  test('preserves trusted Git arguments within explicit input bounds', () => {
    const fixture =
      ModuleDeliveryWorktreePrepareScenario.createTrackedFixture();
    const exact = ModuleRepositoryGit.runModuleDeliveryGit({
      cwd: fixture.sourceRoot,
      args: ['rev-parse', '--verify', 'HEAD'],
    });
    expect(ModuleRepositoryGit.gitText(exact)).toBe(fixture.baselineCommit);
    expect(() =>
      ModuleRepositoryGit.runModuleDeliveryGit({
        cwd: fixture.sourceRoot,
        args: Array.from({ length: 1025 }, () => 'status'),
      }),
    ).toThrow('arguments exceed bounded input');
    expect(() =>
      ModuleRepositoryGit.runModuleDeliveryGit({
        cwd: fixture.sourceRoot,
        args: ['x'.repeat(1024 * 1024 + 1)],
      }),
    ).toThrow('arguments exceed bounded input');
  });
});
