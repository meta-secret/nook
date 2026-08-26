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

let fixture: GitFixture | undefined;
const workspaces: ModuleWorktreeHandle[] = [];

afterEach(() => {
  if (fixture) {
    for (const workspace of workspaces.splice(0)) {
      const cleanupRequest: CleanupModuleWorktreeRequest = { workspace };
      try {
        cleanupModuleWorktree(cleanupRequest);
      } catch {
        // Rejection tests can intentionally invalidate the workspace.
      }
    }
    disposeGitFixture(fixture);
    fixture = undefined;
  }
});

function prepared(request: PrepareModuleWorktreeRequest): ModuleWorktreeHandle {
  const workspace = prepareModuleWorktree(request);
  workspaces.push(workspace);
  return workspace;
}

describe('prepareModuleWorktree', () => {
  test('prepares a clean detached direct child at the exact baseline', () => {
    fixture = createGitFixture();
    const marker = installCheckoutHook(fixture);
    const request = prepareRequest(fixture);
    const workspace = prepared(request);
    const git = worktreeGit(workspace);

    expect(workspace.baselineCommit).toBe(fixture.baselineCommit);
    expect(workspace.worktreePath.startsWith(`${fixture.workspaceRoot}/`)).toBe(
      true,
    );
    expect(git(['rev-parse', 'HEAD'])).toBe(fixture.baselineCommit);
    expect(git(['status', '--porcelain=v1'])).toBe('');
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('HEAD');
    expect(existsSync(marker)).toBe(false);
  });

  test('uses distinct generated worktrees for retry attempts', () => {
    fixture = createGitFixture();
    const firstRequest = prepareRequest(fixture);
    const first = prepared(firstRequest);
    const secondRequest: PrepareModuleWorktreeRequest = {
      ...firstRequest,
      attempt: 2,
    };
    const second = prepared(secondRequest);
    expect(second.worktreePath).not.toBe(first.worktreePath);
    expect(second.worktreeId).not.toBe(first.worktreeId);
  });

  test('rejects nonexact commits, Git environment poisoning, and overlapping roots', () => {
    fixture = createGitFixture();
    const base = prepareRequest(fixture);
    const shortCommitRequest: PrepareModuleWorktreeRequest = {
      ...base,
      baselineCommit: fixture.baselineCommit.slice(0, 12),
    };
    expect(() => prepareModuleWorktree(shortCommitRequest)).toThrow(
      'exact lowercase 40-hex',
    );

    const previousGitDirectory = process.env.GIT_DIR;
    process.env.GIT_DIR = join(fixture.root, 'does-not-exist');
    const scrubbed = prepared(base);
    expect(scrubbed.baselineCommit).toBe(fixture.baselineCommit);
    if (previousGitDirectory === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = previousGitDirectory;

    const nestedRoot = join(fixture.sourceRoot, 'nested-workspaces');
    mkdirSync(nestedRoot);
    const nestedRequest: PrepareModuleWorktreeRequest = {
      ...base,
      workspaceRoot: nestedRoot,
    };
    expect(() => prepareModuleWorktree(nestedRequest)).toThrow('disjoint');
  });

  test('rejects symlink roots before creating a registration', () => {
    fixture = createGitFixture();
    const linkedRoot = join(fixture.root, 'linked-workspaces');
    symlinkSync(fixture.workspaceRoot, linkedRoot);
    const request: PrepareModuleWorktreeRequest = {
      ...prepareRequest(fixture),
      workspaceRoot: linkedRoot,
    };
    expect(() => prepareModuleWorktree(request)).toThrow('real directory');
    expect(
      fixtureGit(fixture)(['worktree', 'list', '--porcelain']),
    ).not.toContain(linkedRoot);
  });

  test('ignores inherited global Git configuration during preparation', () => {
    fixture = createGitFixture();
    const marker = join(fixture.root, 'fsmonitor-ran');
    const monitor = join(fixture.root, 'fsmonitor.sh');
    const globalConfig = join(fixture.root, 'poisoned.gitconfig');
    writeFileSync(monitor, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`);
    chmodSync(monitor, 0o755);
    writeFileSync(globalConfig, `[core]\n\tfsmonitor = ${monitor}\n`);
    const previousConfig = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL = globalConfig;
    try {
      prepared(prepareRequest(fixture));
    } finally {
      if (previousConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = previousConfig;
    }
    expect(existsSync(marker)).toBe(false);
  });
});
