import { afterEach, describe, expect, test } from 'bun:test';

import { chmodSync } from 'node:fs';

import { join } from 'node:path';

import { ModuleDeliveryEvidenceScenario } from './evidence-test-support.ts';

import {
  ModuleIntegrationPhase,
  ModuleIntegrationProvenanceRegistry,
} from '../../src/module-delivery/integration-provenance.ts';
import { ModuleWorktreeRole } from '../../src/module-delivery/workspace.ts';

import { ModuleDeliveryWorktreeTestSupportScenario } from './worktree-test-support.ts';

import type { SourceSnapshotExpectation } from '../../src/module-delivery/integration-provenance.ts';

import type { GitFixture } from './worktree-test-support.ts';

import type { ModuleIntegrationState } from '../../src/module-delivery/integration-provenance.ts';

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
  test('captures an immutable snapshot at the return boundary', () => {
    const fixture =
      ModuleDeliveryIntegrationSourceProvenanceScenario.trackedFixture();
    const snapshot = ModuleIntegrationProvenanceRegistry.captureSourceSnapshot(
      fixture.sourceRoot,
    );
    const original = snapshot.refsDigest;

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Reflect.set(snapshot, 'refsDigest', 'f'.repeat(64))).toBe(false);
    expect(snapshot.refsDigest).toBe(original);
  });

  test('copies and freezes snapshots before storing private provenance', () => {
    const fixture =
      ModuleDeliveryIntegrationSourceProvenanceScenario.trackedFixture();
    const capturedSource =
      ModuleIntegrationProvenanceRegistry.captureSourceSnapshot(
        fixture.sourceRoot,
      );
    const capturedWorkspace =
      ModuleIntegrationProvenanceRegistry.captureSourceSnapshot(
        fixture.sourceRoot,
      );
    const sourceSnapshot = { ...capturedSource };
    const workspaceSnapshot = { ...capturedWorkspace };
    const runtime = ModuleDeliveryEvidenceScenario.runtime(fixture);
    const workspace = Object.freeze({
      role: ModuleWorktreeRole.IntegrationParent,
      sourceRepositoryRoot: fixture.sourceRoot,
      ownedWorkspaceRoot: fixture.workspaceRoot,
      worktreePath: fixture.sourceRoot,
      worktreeAdminDirectory: fixture.sourceRoot,
      gitCommonDirectory: fixture.sourceRoot,
      worktreeId: 'integration-parent',
      branchName: 'codex/module-delivery-test',
      planDigest: runtime.accepted.planDigest,
      taskId: 'module-delivery-integration',
      attempt: 1,
      baselineCommit: fixture.sourceCommit,
    });
    const cleanupHandle = Object.freeze({
      sessionId: 'source-provenance-test',
    });
    const state: ModuleIntegrationState = Object.freeze({
      phase: ModuleIntegrationPhase.AcceptingProviders,
      generation: runtime.accepted.plan.generation,
      planDigest: runtime.accepted.planDigest,
      sourceCommit: fixture.sourceCommit,
      originMainSha: fixture.originMainSha,
      pinnedLocalDevSha: fixture.pinnedLocalDevSha,
      topologicalOrder: runtime.accepted.topologicalOrder,
      waves: runtime.accepted.waves,
      completedWaveCount: 0,
      integratedTaskIds: [],
      acceptedWrites: [],
      acceptedEvidence: [],
      headCommit: fixture.sourceCommit,
      admissionState: runtime.state,
      workspace,
      cleanupHandle,
    });
    const session = ModuleIntegrationProvenanceRegistry.createIntegrationSession({
      cleanupHandle,
      workspace,
      integrationRef: '',
      currentHead: state.headCommit,
    });

    ModuleIntegrationProvenanceRegistry.registerIntegrationState({
      authority: runtime.authority,
      state,
      sourceSnapshot,
      workspaceSnapshot,
      session,
    });

    sourceSnapshot.refsDigest = 'f'.repeat(64);
    workspaceSnapshot.indexDigest = 'f'.repeat(64);
    const provenance =
      ModuleIntegrationProvenanceRegistry.integrationProvenance(state);

    expect(provenance.sourceSnapshot).not.toBe(sourceSnapshot);
    expect(provenance.workspaceSnapshot).not.toBe(workspaceSnapshot);
    expect(Object.isFrozen(provenance.sourceSnapshot)).toBe(true);
    expect(Object.isFrozen(provenance.workspaceSnapshot)).toBe(true);
    expect(provenance.sourceSnapshot.refsDigest).toBe(
      capturedSource.refsDigest,
    );
    expect(provenance.workspaceSnapshot.indexDigest).toBe(
      capturedWorkspace.indexDigest,
    );
    expect(
      Reflect.set(provenance.sourceSnapshot, 'contentDigest', 'f'.repeat(64)),
    ).toBe(false);
    expect(
      Reflect.set(provenance.workspaceSnapshot, 'metadataDigest', 'f'.repeat(64)),
    ).toBe(false);
    const forgedProvenance = {
      ...provenance,
      sourceSnapshot: {
        ...provenance.sourceSnapshot,
        refsDigest: 'f'.repeat(64),
      },
    };
    expect(() =>
      ModuleIntegrationProvenanceRegistry.assertFreshModuleIntegrationState({
        state,
        provenance: forgedProvenance,
      }),
    ).toThrow('violates its private provenance');
  });

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

  test('rejects tracked content drift', () => {
    const fixture =
      ModuleDeliveryIntegrationSourceProvenanceScenario.trackedFixture();
    const expectation =
      ModuleDeliveryIntegrationSourceProvenanceScenario.sourceExpectation(
        fixture,
      );
    ModuleDeliveryWorktreeTestSupportScenario.fixtureFileWriter(fixture)([
      'module/seed.txt',
      'forged content\n',
    ]);

    expect(() =>
      ModuleIntegrationProvenanceRegistry.assertSourceSnapshot(expectation),
    ).toThrow('Source repository changed');
  });

  test('rejects local config drift', () => {
    const fixture =
      ModuleDeliveryIntegrationSourceProvenanceScenario.trackedFixture();
    const expectation =
      ModuleDeliveryIntegrationSourceProvenanceScenario.sourceExpectation(
        fixture,
      );
    ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(fixture)([
      'config',
      '--local',
      'nook.snapshot.drift',
      'forged',
    ]);

    expect(() =>
      ModuleIntegrationProvenanceRegistry.assertSourceSnapshot(expectation),
    ).toThrow('Source repository changed');
  });

  test('rejects index flag drift', () => {
    const fixture =
      ModuleDeliveryIntegrationSourceProvenanceScenario.trackedFixture();
    const expectation =
      ModuleDeliveryIntegrationSourceProvenanceScenario.sourceExpectation(
        fixture,
      );
    ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(fixture)([
      'update-index',
      '--assume-unchanged',
      '--',
      'module/seed.txt',
    ]);

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
