import { afterEach, describe, expect, test } from 'bun:test';

import { chmodSync } from 'node:fs';

import { join } from 'node:path';

import { ModuleIntegrationProvenanceRegistry } from '../../src/module-delivery/integration-provenance.ts';

import { ModuleDeliveryWorktreeTestSupportScenario } from './worktree-test-support.ts';

import type { SourceSnapshotExpectation } from '../../src/module-delivery/integration-provenance.ts';

import type { GitFixture } from './worktree-test-support.ts';

export class ModuleDeliveryIntegrationSourceProvenanceScenario {
  private constructor(private readonly request: GitFixture) {}

  static trackedFixture(): GitFixture {
    const fixture =
      ModuleDeliveryWorktreeTestSupportScenario.createGitFixture();
    fixtures.push(fixture);
    return fixture;
  }

  static sourceExpectation(fixture: GitFixture): SourceSnapshotExpectation {
    return new ModuleDeliveryIntegrationSourceProvenanceScenario(
      fixture,
    ).execute();
  }

  private execute(): SourceSnapshotExpectation {
    const fixture = this.request;
    return {
      repositoryRoot: fixture.sourceRoot,
      expected: ModuleIntegrationProvenanceRegistry.captureSourceSnapshot(
        fixture.sourceRoot,
      ),
    };
  }
}

const fixtures: GitFixture[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0).reverse())
    ModuleDeliveryWorktreeTestSupportScenario.disposeGitFixture(fixture);
});

describe('module delivery source provenance', () => {
  test('rejects drift in a custom ref outside private namespaces', () => {
    const fixture =
      ModuleDeliveryIntegrationSourceProvenanceScenario.trackedFixture();
    const expectation =
      ModuleDeliveryIntegrationSourceProvenanceScenario.sourceExpectation(
        fixture,
      );
    ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(fixture)([
      'update-ref',
      'refs/custom/module-delivery-drift',
      'HEAD',
    ]);

    expect(() =>
      ModuleIntegrationProvenanceRegistry.assertSourceSnapshot(expectation),
    ).toThrow('Source repository changed');
  });

  test('rejects a custom symbolic ref retargeted between equal commits', () => {
    const fixture =
      ModuleDeliveryIntegrationSourceProvenanceScenario.trackedFixture();
    const sourceGit =
      ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(fixture);
    sourceGit(['branch', 'symbolic-a', 'HEAD']);
    sourceGit(['branch', 'symbolic-b', 'HEAD']);
    sourceGit([
      'symbolic-ref',
      'refs/custom/module-pointer',
      'refs/heads/symbolic-a',
    ]);
    const expectation =
      ModuleDeliveryIntegrationSourceProvenanceScenario.sourceExpectation(
        fixture,
      );
    sourceGit([
      'symbolic-ref',
      'refs/custom/module-pointer',
      'refs/heads/symbolic-b',
    ]);
    expect(sourceGit(['rev-parse', 'refs/heads/symbolic-a'])).toBe(
      sourceGit(['rev-parse', 'refs/heads/symbolic-b']),
    );

    expect(() =>
      ModuleIntegrationProvenanceRegistry.assertSourceSnapshot(expectation),
    ).toThrow('Source repository changed');
  });

  test('rejects source mode drift at a metadata-only checkpoint', () => {
    const fixture =
      ModuleDeliveryIntegrationSourceProvenanceScenario.trackedFixture();
    const expectation =
      ModuleDeliveryIntegrationSourceProvenanceScenario.sourceExpectation(
        fixture,
      );
    chmodSync(join(fixture.sourceRoot, 'module/seed.txt'), 0o755);

    expect(() =>
      ModuleIntegrationProvenanceRegistry.assertSourceSnapshot(expectation),
    ).toThrow('Source repository changed');
  });
});
