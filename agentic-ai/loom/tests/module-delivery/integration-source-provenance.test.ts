import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync } from 'node:fs';
import { join } from 'node:path';

import {
  assertSourceSnapshot,
  captureSourceSnapshot,
} from '../../src/module-delivery/integration-provenance.ts';
import {
  createGitFixture,
  disposeGitFixture,
  fixtureGit,
} from './worktree-test-support.ts';

import type { SourceSnapshotExpectation } from '../../src/module-delivery/integration-provenance.ts';
import type { GitFixture } from './worktree-test-support.ts';

const fixtures: GitFixture[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0).reverse())
    disposeGitFixture(fixture);
});

function trackedFixture(): GitFixture {
  const fixture = createGitFixture();
  fixtures.push(fixture);
  return fixture;
}

function sourceExpectation(fixture: GitFixture): SourceSnapshotExpectation {
  return {
    repositoryRoot: fixture.sourceRoot,
    expected: captureSourceSnapshot(fixture.sourceRoot),
  };
}

describe('module delivery source provenance', () => {
  test('rejects drift in a custom ref outside private namespaces', () => {
    const fixture = trackedFixture();
    const expectation = sourceExpectation(fixture);
    fixtureGit(fixture)([
      'update-ref',
      'refs/custom/module-delivery-drift',
      'HEAD',
    ]);

    expect(() => assertSourceSnapshot(expectation)).toThrow(
      'Source repository changed',
    );
  });

  test('rejects a custom symbolic ref retargeted between equal commits', () => {
    const fixture = trackedFixture();
    const sourceGit = fixtureGit(fixture);
    sourceGit(['branch', 'symbolic-a', 'HEAD']);
    sourceGit(['branch', 'symbolic-b', 'HEAD']);
    sourceGit([
      'symbolic-ref',
      'refs/custom/module-pointer',
      'refs/heads/symbolic-a',
    ]);
    const expectation = sourceExpectation(fixture);
    sourceGit([
      'symbolic-ref',
      'refs/custom/module-pointer',
      'refs/heads/symbolic-b',
    ]);
    expect(sourceGit(['rev-parse', 'refs/heads/symbolic-a'])).toBe(
      sourceGit(['rev-parse', 'refs/heads/symbolic-b']),
    );

    expect(() => assertSourceSnapshot(expectation)).toThrow(
      'Source repository changed',
    );
  });

  test('rejects source mode drift at a metadata-only checkpoint', () => {
    const fixture = trackedFixture();
    const expectation = sourceExpectation(fixture);
    chmodSync(join(fixture.sourceRoot, 'module/seed.txt'), 0o755);

    expect(() => assertSourceSnapshot(expectation)).toThrow(
      'Source repository changed',
    );
  });
});
