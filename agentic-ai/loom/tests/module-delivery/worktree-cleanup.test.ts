import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';

import {
  cleanupModuleWorktree,
  prepareModuleWorktree,
} from '../../src/module-delivery/index.ts';
import {
  createGitFixture,
  disposeGitFixture,
  fixtureGit,
  prepareRequest,
  worktreeFileWriter,
} from './worktree-test-support.ts';

import type {
  CleanupModuleWorktreeRequest,
  ModuleWorktreeHandle,
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

function createWorkspace(): ModuleWorktreeHandle {
  const fixture = createGitFixture();
  fixtures.push(fixture);
  const workspace = prepareModuleWorktree(prepareRequest(fixture));
  workspaces.push(workspace);
  return workspace;
}

function currentFixture(): GitFixture {
  const fixture = fixtures.at(-1);
  if (!fixture) throw new Error('Git fixture was not prepared.');
  return fixture;
}

describe('cleanupModuleWorktree', () => {
  test('force-removes an owned dirty worktree and is idempotent', () => {
    const active = createWorkspace();
    worktreeFileWriter(active)(['module/uncommitted.ts', 'uncommitted\n']);
    const request: CleanupModuleWorktreeRequest = { workspace: active };
    expect(cleanupModuleWorktree(request).removed).toBe(true);
    expect(existsSync(active.worktreePath)).toBe(false);
    expect(cleanupModuleWorktree(request).removed).toBe(false);
  });

  test('rejects locked worktrees', () => {
    const active = createWorkspace();
    fixtureGit(currentFixture())([
      'worktree',
      'lock',
      '--reason',
      'test lock',
      active.worktreePath,
    ]);
    const request: CleanupModuleWorktreeRequest = { workspace: active };
    expect(() => cleanupModuleWorktree(request)).toThrow('Locked');
    expect(existsSync(active.worktreePath)).toBe(true);
  });

  test('rejects missing-path registration asymmetry', () => {
    const active = createWorkspace();
    const removalOptions = { recursive: true, force: true } as const;
    rmSync(active.worktreePath, removalOptions);
    const request: CleanupModuleWorktreeRequest = { workspace: active };
    expect(() => cleanupModuleWorktree(request)).toThrow('asymmetric');
  });

  test('rejects a replacement directory after external removal', () => {
    const active = createWorkspace();
    fixtureGit(currentFixture())([
      'worktree',
      'remove',
      '--force',
      active.worktreePath,
    ]);
    mkdirSync(active.worktreePath);
    const request: CleanupModuleWorktreeRequest = { workspace: active };
    expect(() => cleanupModuleWorktree(request)).toThrow('asymmetric');
  });

  test('rejects a dangling symlink after external removal', () => {
    const active = createWorkspace();
    fixtureGit(currentFixture())([
      'worktree',
      'remove',
      '--force',
      active.worktreePath,
    ]);
    symlinkSync('missing-worktree', active.worktreePath);
    const request: CleanupModuleWorktreeRequest = { workspace: active };
    expect(() => cleanupModuleWorktree(request)).toThrow('asymmetric');
  });

  test('rejects a forged path outside the owned direct-child root', () => {
    const active = createWorkspace();
    const forged: ModuleWorktreeHandle = {
      ...active,
      worktreePath: active.ownedWorkspaceRoot,
    };
    const request: CleanupModuleWorktreeRequest = { workspace: forged };
    expect(() => cleanupModuleWorktree(request)).toThrow('direct child');
  });
});
