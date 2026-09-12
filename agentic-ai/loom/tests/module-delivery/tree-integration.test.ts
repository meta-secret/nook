import { afterEach, describe, expect, test } from 'bun:test';

import { existsSync } from 'node:fs';

import { join } from 'node:path';

import {
  ModuleWaveTree,
  ModuleWorktree,
} from '../../src/module-delivery/index.ts';

import { ModuleDeliveryWorktreeTestSupportScenario } from './worktree-test-support.ts';

import type {
  ModuleWorktreeHandle,
  PrepareModuleWorktreeRequest,
} from '../../src/module-delivery/index.ts';

import type { GitFixture } from './worktree-test-support.ts';

const fixtures: GitFixture[] = [];

const workspaces: ModuleWorktreeHandle[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    try {
      ModuleWorktree.cleanupModuleWorktree({ workspace });
    } catch {
      // Failed-validation cases can intentionally invalidate a child.
    }
  }
  for (const fixture of fixtures.splice(0))
    ModuleDeliveryWorktreeTestSupportScenario.disposeGitFixture(fixture);
});

describe('ModuleWaveTree', () => {
  test('sequentially cherry-picks isolated sibling commits into the parent', () => {
    const fixture =
      ModuleDeliveryWorktreeTestSupportScenario.createGitFixture();
    fixtures.push(fixture);
    const base =
      ModuleDeliveryWorktreeTestSupportScenario.prepareRequest(fixture);
    const parent = ModuleWorktree.prepareSharedIntegrationWorkspace({
      ...base,
      taskId: 'module-delivery-integration',
    });
    const first = ModuleWorktree.prepareModuleWorktree({
      ...base,
      taskId: 'first-sibling',
    });
    const second = ModuleWorktree.prepareModuleWorktree({
      ...base,
      taskId: 'second-sibling',
    });
    workspaces.push(first, second);
    const firstGit =
      ModuleDeliveryWorktreeTestSupportScenario.worktreeGit(first);
    const secondGit =
      ModuleDeliveryWorktreeTestSupportScenario.worktreeGit(second);
    ModuleDeliveryWorktreeTestSupportScenario.worktreeFileWriter(first)([
      'module/first.ts',
      'first\n',
    ]);
    firstGit(['add', '--all']);
    firstGit(['commit', '--quiet', '-m', 'first sibling']);
    ModuleDeliveryWorktreeTestSupportScenario.worktreeFileWriter(second)([
      'module/second.ts',
      'second\n',
    ]);
    secondGit(['add', '--all']);
    secondGit(['commit', '--quiet', '-m', 'second sibling']);
    const firstCommit = firstGit(['rev-parse', 'HEAD']);
    const secondCommit = secondGit(['rev-parse', 'HEAD']);
    const integratedHead = ModuleWaveTree.apply({
      workspace: parent,
      currentHead: fixture.baselineCommit,
      handoffs: [
        {
          taskId: 'first-sibling',
          baselineCommit: fixture.baselineCommit,
          commit: firstCommit,
          allowedWriteClaims: ['module/first.ts'],
        },
        {
          taskId: 'second-sibling',
          baselineCommit: fixture.baselineCommit,
          commit: secondCommit,
          allowedWriteClaims: ['module/second.ts'],
        },
      ],
    });
    const parentGit =
      ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(fixture);
    expect(integratedHead).toBe(parentGit(['rev-parse', 'HEAD']));
    expect(integratedHead).not.toBe(fixture.baselineCommit);
    expect(existsSync(join(fixture.sourceRoot, 'module/first.ts'))).toBe(true);
    expect(existsSync(join(fixture.sourceRoot, 'module/second.ts'))).toBe(true);
    expect(firstGit(['rev-parse', 'HEAD'])).toBe(firstCommit);
    expect(secondGit(['rev-parse', 'HEAD'])).toBe(secondCommit);
    expect(firstGit(['status', '--porcelain=v1'])).toBe('');
    expect(secondGit(['status', '--porcelain=v1'])).toBe('');
  });

  test('rejects overlapping sibling claims without changing the parent', () => {
    const fixture =
      ModuleDeliveryWorktreeTestSupportScenario.createGitFixture();
    fixtures.push(fixture);
    const base =
      ModuleDeliveryWorktreeTestSupportScenario.prepareRequest(fixture);
    const parent = ModuleWorktree.prepareSharedIntegrationWorkspace({
      ...base,
      taskId: 'module-delivery-integration',
    });
    const child = ModuleWorktree.prepareModuleWorktree({
      ...base,
      taskId: 'overlap-one',
    });
    const sibling = ModuleWorktree.prepareModuleWorktree({
      ...base,
      taskId: 'overlap-two',
    });
    workspaces.push(child, sibling);
    const childGit =
      ModuleDeliveryWorktreeTestSupportScenario.worktreeGit(child);
    ModuleDeliveryWorktreeTestSupportScenario.worktreeFileWriter(child)([
      'module/overlap-one.ts',
      'one\n',
    ]);
    childGit(['add', '--all']);
    childGit(['commit', '--quiet', '-m', 'overlap one']);
    const siblingGit =
      ModuleDeliveryWorktreeTestSupportScenario.worktreeGit(sibling);
    ModuleDeliveryWorktreeTestSupportScenario.worktreeFileWriter(sibling)([
      'module/overlap-two.ts',
      'two\n',
    ]);
    siblingGit(['add', '--all']);
    siblingGit(['commit', '--quiet', '-m', 'overlap two']);
    expect(() =>
      ModuleWaveTree.apply({
        workspace: parent,
        currentHead: fixture.baselineCommit,
        handoffs: [
          {
            taskId: 'overlap-one',
            baselineCommit: fixture.baselineCommit,
            commit: childGit(['rev-parse', 'HEAD']),
            allowedWriteClaims: ['module/**'],
          },
          {
            taskId: 'overlap-two',
            baselineCommit: fixture.baselineCommit,
            commit: siblingGit(['rev-parse', 'HEAD']),
            allowedWriteClaims: ['module/overlap-two.ts'],
          },
        ],
      }),
    ).toThrow('overlaps');
    expect(
      ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(fixture)([
        'rev-parse',
        'HEAD',
      ]),
    ).toBe(fixture.baselineCommit);
  });

  test('accepts sibling handoffs sequentially from the same wave baseline', () => {
    const fixture =
      ModuleDeliveryWorktreeTestSupportScenario.createGitFixture();
    fixtures.push(fixture);
    const base =
      ModuleDeliveryWorktreeTestSupportScenario.prepareRequest(fixture);
    const parent = ModuleWorktree.prepareSharedIntegrationWorkspace({
      ...base,
      taskId: 'module-delivery-integration',
    });
    const first = ModuleWorktree.prepareModuleWorktree({
      ...base,
      taskId: 'sequential-first',
    });
    const second = ModuleWorktree.prepareModuleWorktree({
      ...base,
      taskId: 'sequential-second',
    });
    workspaces.push(first, second);
    const firstGit =
      ModuleDeliveryWorktreeTestSupportScenario.worktreeGit(first);
    const secondGit =
      ModuleDeliveryWorktreeTestSupportScenario.worktreeGit(second);
    ModuleDeliveryWorktreeTestSupportScenario.worktreeFileWriter(first)([
      'module/sequential-first.ts',
      'first\n',
    ]);
    firstGit(['add', '--all']);
    firstGit(['commit', '--quiet', '-m', 'sequential first']);
    ModuleDeliveryWorktreeTestSupportScenario.worktreeFileWriter(second)([
      'module/sequential-second.ts',
      'second\n',
    ]);
    secondGit(['add', '--all']);
    secondGit(['commit', '--quiet', '-m', 'sequential second']);

    const firstHead = ModuleWaveTree.apply({
      workspace: parent,
      currentHead: fixture.baselineCommit,
      handoffs: [
        {
          taskId: 'sequential-first',
          baselineCommit: fixture.baselineCommit,
          commit: firstGit(['rev-parse', 'HEAD']),
          allowedWriteClaims: ['module/sequential-first.ts'],
        },
      ],
    });
    const secondHead = ModuleWaveTree.apply({
      workspace: parent,
      currentHead: firstHead,
      handoffs: [
        {
          taskId: 'sequential-second',
          baselineCommit: fixture.baselineCommit,
          commit: secondGit(['rev-parse', 'HEAD']),
          allowedWriteClaims: ['module/sequential-second.ts'],
        },
      ],
    });

    expect(secondHead).not.toBe(firstHead);
    expect(
      ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(fixture)([
        'rev-parse',
        'HEAD',
      ]),
    ).toBe(secondHead);
    expect(
      existsSync(join(fixture.sourceRoot, 'module/sequential-first.ts')),
    ).toBe(true);
    expect(
      existsSync(join(fixture.sourceRoot, 'module/sequential-second.ts')),
    ).toBe(true);
  });

  test('restores the exact parent frontier after a post-apply failure', () => {
    const fixture =
      ModuleDeliveryWorktreeTestSupportScenario.createGitFixture();
    fixtures.push(fixture);
    const base =
      ModuleDeliveryWorktreeTestSupportScenario.prepareRequest(fixture);
    const parent = ModuleWorktree.prepareSharedIntegrationWorkspace({
      ...base,
      taskId: 'module-delivery-integration',
    });
    const child = ModuleWorktree.prepareModuleWorktree({
      ...base,
      taskId: 'rollback-child',
    });
    workspaces.push(child);
    const childGit =
      ModuleDeliveryWorktreeTestSupportScenario.worktreeGit(child);
    ModuleDeliveryWorktreeTestSupportScenario.worktreeFileWriter(child)([
      'module/rollback.ts',
      'rollback\n',
    ]);
    childGit(['add', '--all']);
    childGit(['commit', '--quiet', '-m', 'rollback child']);
    const appliedHead = ModuleWaveTree.apply({
      workspace: parent,
      currentHead: fixture.baselineCommit,
      handoffs: [
        {
          taskId: 'rollback-child',
          baselineCommit: fixture.baselineCommit,
          commit: childGit(['rev-parse', 'HEAD']),
          allowedWriteClaims: ['module/rollback.ts'],
        },
      ],
    });

    ModuleWaveTree.restore({
      workspace: parent,
      originalHead: fixture.baselineCommit,
      appliedHead,
    });

    expect(
      ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(fixture)([
        'rev-parse',
        'HEAD',
      ]),
    ).toBe(fixture.baselineCommit);
    expect(existsSync(join(fixture.sourceRoot, 'module/rollback.ts'))).toBe(
      false,
    );
  });
});
