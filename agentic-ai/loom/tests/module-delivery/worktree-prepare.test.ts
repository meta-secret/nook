import { afterEach, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  cleanupModuleWorktree,
  prepareModuleWorktree,
} from '../../src/module-delivery/index.ts';
import {
  gitText,
  runModuleDeliveryGit,
} from '../../src/module-delivery/git-command.ts';
import {
  createGitFixture,
  disposeGitFixture,
  fixtureGit,
  installCheckoutHook,
  prepareRequest,
  worktreeGit,
} from './worktree-test-support.ts';

import type {
  CleanupModuleWorktreeRequest,
  ModuleWorktreeHandle,
  PrepareModuleWorktreeRequest,
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
      // Rejection tests can intentionally invalidate the workspace.
    }
  }
  for (const fixture of fixtures.splice(0)) {
    disposeGitFixture(fixture);
  }
});

function createTrackedFixture(): GitFixture {
  const fixture = createGitFixture();
  fixtures.push(fixture);
  return fixture;
}

function prepared(request: PrepareModuleWorktreeRequest): ModuleWorktreeHandle {
  const workspace = prepareModuleWorktree(request);
  workspaces.push(workspace);
  return workspace;
}

describe('prepareModuleWorktree', () => {
  test('identifies the current shared checkout at the exact baseline', () => {
    const fixture = createTrackedFixture();
    const marker = installCheckoutHook(fixture);
    const request = prepareRequest(fixture);
    const workspace = prepared(request);
    const git = worktreeGit(workspace);

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
    const fixture = createTrackedFixture();
    const firstRequest = prepareRequest(fixture);
    const first = prepared(firstRequest);
    const secondRequest: PrepareModuleWorktreeRequest = {
      ...firstRequest,
      attempt: 2,
    };
    const second = prepared(secondRequest);
    expect(second.worktreePath).toBe(first.worktreePath);
    expect(second.worktreeId).toBe(first.worktreeId);
    expect(second.attempt).toBe(2);
  });

  test('rejects a dirty or stale shared checkout before dispatch', () => {
    const fixture = createTrackedFixture();
    const request = prepareRequest(fixture);
    writeFileSync(join(fixture.sourceRoot, 'dirty.ts'), 'dirty\n');
    expect(() => prepareModuleWorktree(request)).toThrow(
      'must be clean before dispatch',
    );
    fixtureGit(fixture)(['clean', '-fd']);
    writeFileSync(join(fixture.sourceRoot, 'later.ts'), 'later\n');
    fixtureGit(fixture)(['add', 'later.ts']);
    fixtureGit(fixture)(['commit', '--quiet', '-m', 'later']);
    expect(() => prepareModuleWorktree(request)).toThrow(
      'HEAD must match its baseline',
    );
  });

  test('rejects a detached shared checkout before dispatch', () => {
    const fixture = createTrackedFixture();
    fixtureGit(fixture)(['checkout', '--quiet', '--detach']);
    expect(() => prepareModuleWorktree(prepareRequest(fixture))).toThrow();
  });

  test('rejects nonexact commits and ignores obsolete workspace roots', () => {
    const fixture = createTrackedFixture();
    const base = prepareRequest(fixture);
    const shortCommitRequest: PrepareModuleWorktreeRequest = {
      ...base,
      baselineCommit: fixture.baselineCommit.slice(0, 12),
    };
    expect(() => prepareModuleWorktree(shortCommitRequest)).toThrow(
      'exact lowercase 40-hex',
    );

    const hadGitDirectory = 'GIT_DIR' in process.env;
    const previousGitDirectory = process.env.GIT_DIR ?? '';
    process.env.GIT_DIR = join(fixture.root, 'does-not-exist');
    const scrubbed = prepared(base);
    expect(scrubbed.baselineCommit).toBe(fixture.baselineCommit);
    if (hadGitDirectory) process.env.GIT_DIR = previousGitDirectory;
    else delete process.env.GIT_DIR;

    const nestedRoot = join(fixture.sourceRoot, 'nested-workspaces');
    mkdirSync(nestedRoot);
    const nestedRequest: PrepareModuleWorktreeRequest = {
      ...base,
      workspaceRoot: nestedRoot,
    };
    expect(prepareModuleWorktree(nestedRequest).worktreePath).toBe(
      fixture.sourceRoot,
    );
  });

  test('does not create a worktree registration', () => {
    const fixture = createTrackedFixture();
    const linkedRoot = join(fixture.root, 'linked-workspaces');
    symlinkSync(fixture.workspaceRoot, linkedRoot);
    const request: PrepareModuleWorktreeRequest = {
      ...prepareRequest(fixture),
      workspaceRoot: linkedRoot,
    };
    expect(prepareModuleWorktree(request).worktreePath).toBe(
      fixture.sourceRoot,
    );
    expect(
      fixtureGit(fixture)(['worktree', 'list', '--porcelain']),
    ).not.toContain(linkedRoot);
  });

  test('ignores inherited global Git configuration during preparation', () => {
    const fixture = createTrackedFixture();
    const marker = join(fixture.root, 'fsmonitor-ran');
    const monitor = join(fixture.root, 'fsmonitor.sh');
    const globalConfig = join(fixture.root, 'poisoned.gitconfig');
    writeFileSync(monitor, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`);
    chmodSync(monitor, 0o755);
    writeFileSync(globalConfig, `[core]\n\tfsmonitor = ${monitor}\n`);
    const hadGlobalConfig = 'GIT_CONFIG_GLOBAL' in process.env;
    const previousConfig = process.env.GIT_CONFIG_GLOBAL ?? '';
    process.env.GIT_CONFIG_GLOBAL = globalConfig;
    try {
      prepared(prepareRequest(fixture));
    } finally {
      if (hadGlobalConfig) process.env.GIT_CONFIG_GLOBAL = previousConfig;
      else delete process.env.GIT_CONFIG_GLOBAL;
    }
    expect(existsSync(marker)).toBe(false);
  });

  test('does not inherit ambient process environment in Git commands', () => {
    const fixture = createTrackedFixture();
    const hadEmail = 'EMAIL' in process.env;
    const previousEmail = process.env.EMAIL ?? '';
    process.env.EMAIL = 'ambient-authority@nook.invalid';
    try {
      const result = runModuleDeliveryGit({
        cwd: fixture.sourceRoot,
        args: ['var', 'GIT_AUTHOR_IDENT'],
      });
      expect(gitText(result)).not.toContain('ambient-authority@nook.invalid');
    } finally {
      if (hadEmail) process.env.EMAIL = previousEmail;
      else delete process.env.EMAIL;
    }
  });

  test('validates executable search paths for the host platform', () => {
    const fixture = createTrackedFixture();
    const hadPath = 'PATH' in process.env;
    const previousPath = process.env.PATH ?? '';
    try {
      process.env.PATH = `relative-bin:${previousPath || '/usr/bin'}`;
      expect(() =>
        runModuleDeliveryGit({
          cwd: fixture.sourceRoot,
          args: ['status', '--short'],
        }),
      ).toThrow('search path must contain absolute paths');
      process.env.PATH = '\\\\server\\git';
      let message = '';
      try {
        runModuleDeliveryGit({
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
    const fixture = createTrackedFixture();
    const exact = runModuleDeliveryGit({
      cwd: fixture.sourceRoot,
      args: ['rev-parse', '--verify', 'HEAD'],
    });
    expect(gitText(exact)).toBe(fixture.baselineCommit);
    expect(() =>
      runModuleDeliveryGit({
        cwd: fixture.sourceRoot,
        args: Array.from({ length: 1025 }, () => 'status'),
      }),
    ).toThrow('arguments exceed bounded input');
    expect(() =>
      runModuleDeliveryGit({
        cwd: fixture.sourceRoot,
        args: ['x'.repeat(1024 * 1024 + 1)],
      }),
    ).toThrow('arguments exceed bounded input');
  });
});
