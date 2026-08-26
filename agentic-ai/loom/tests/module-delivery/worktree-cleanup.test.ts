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

let fixture: GitFixture | undefined;
let workspace: ModuleWorktreeHandle | undefined;

afterEach(() => {
  if (fixture) {
    disposeGitFixture(fixture);
    fixture = undefined;
    workspace = undefined;
  }
});

function createWorkspace(): ModuleWorktreeHandle {
  fixture = createGitFixture();
  workspace = prepareModuleWorktree(prepareRequest(fixture));
  return workspace;
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
    fixtureGit(fixture!)([
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
    fixtureGit(fixture!)([
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
    fixtureGit(fixture!)([
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
