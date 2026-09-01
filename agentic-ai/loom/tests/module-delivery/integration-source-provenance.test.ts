import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  assertSourceSnapshot,
  captureSourceSnapshot,
} from '../../src/module-delivery/integration-provenance.ts';
import { AgentAttemptParentKind } from '../../src/agent-workflow/domain.ts';
import {
  REQUIRED_PARENT_OWNED_RESOURCES,
  ModuleDeliveryBaselineKind,
  ModuleDeliveryEvidenceVerdict,
  ModuleDeliveryJoinKind,
  ModuleDeliveryProviderSubmissionKind,
  ModuleDeliveryTaskKind,
  ModuleDeliveryValidationStatus,
  ModuleDeliveryWorkspaceKind,
  TeamKey,
  createModuleDeliveryAdmissionState,
  createModuleDeliveryGenerationAuthority,
  decodeAndValidateModuleDeliveryPlan,
  integrateVerifiedModuleDeliveryTask,
  prepareModuleIntegration,
  prepareModuleWorktree,
  recordModuleDeliveryAttemptLeases,
  selectModuleDeliveryAdmissions,
} from '../../src/module-delivery/index.ts';
import {
  createGitFixture,
  disposeGitFixture,
  fixtureGit,
} from './worktree-test-support.ts';

import type {
  ModuleDeliveryGenerationAuthority,
  ModuleDeliveryPlanV3,
  ModuleDeliveryWriteProviderSubmission,
  ModuleIntegrationState,
  ValidatedModuleDeliveryPlan,
} from '../../src/module-delivery/index.ts';
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

type PreparedWrite = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  fixture: GitFixture;
  plan: ValidatedModuleDeliveryPlan;
  state: ModuleIntegrationState;
  submission: ModuleDeliveryWriteProviderSubmission;
  lease: ReturnType<typeof recordModuleDeliveryAttemptLeases>['leases'][number];
}>;

function preparedWrite(): PreparedWrite {
  const fixture = trackedFixture();
  const root = 'nook-app/nook-platform/nook-core';
  const plan: ModuleDeliveryPlanV3 = {
    version: 3,
    generation: 1,
    sourceCommit: fixture.baselineCommit,
    maxConcurrency: 1,
    maxAgentDepth: 2,
    maxAttempts: 2,
    parentOwnedResources: REQUIRED_PARENT_OWNED_RESOURCES,
    parentJoin: {
      kind: ModuleDeliveryJoinKind.DirectCommits,
      owner: 'delivery-owner',
      validationCommands: ['task loom:verify'],
    },
    nodes: [
      {
        kind: ModuleDeliveryTaskKind.Write,
        taskId: 'writer',
        team: TeamKey.DevelopmentCore,
        functionalOwner: TeamKey.Ai,
        acceptanceOwner: TeamKey.Ai,
        parentLineage: { kind: AgentAttemptParentKind.WorkflowRoot },
        expert: 'core_expert',
        moduleRoot: root,
        consumerOutcome: 'Writer publishes one direct commit.',
        baseline: {
          kind: ModuleDeliveryBaselineKind.SourceCommit,
          sourceCommit: fixture.baselineCommit,
        },
        agentDepthLimit: 2,
        dependencies: [],
        resources: {
          read: [`${root}/**`],
          write: [`${root}/src/**`],
          evidenceSurface: [],
        },
        parentOwnedExclusions: REQUIRED_PARENT_OWNED_RESOURCES,
        acceptance: {
          commands: ['task writer:test'],
          evidence: ['Writer passed.'],
        },
        workspace: {
          kind: ModuleDeliveryWorkspaceKind.SharedCheckout,
          expectedCommitHandoff: true,
        },
      },
    ],
    edgeContracts: [],
  };
  const decoded = decodeAndValidateModuleDeliveryPlan(JSON.stringify(plan));
  if (decoded.status !== ModuleDeliveryValidationStatus.Accepted)
    throw new Error(JSON.stringify(decoded.issues));
  const authority = createModuleDeliveryGenerationAuthority({
    acceptedPlan: decoded,
    expectedLineage: decoded.plan.nodes.map((node) => ({
      taskId: node.taskId,
      parentLineage: node.parentLineage,
    })),
    repositoryRoot: fixture.sourceRoot,
  });
  const admissionState = createModuleDeliveryAdmissionState({
    authority,
    acceptedPlan: decoded,
    headCommit: fixture.baselineCommit,
    integratedWriterFrontiers: [],
    acceptedEvidence: [],
  });
  const state = prepareModuleIntegration({
    authority,
    repositoryRoot: fixture.sourceRoot,
    workspaceRoot: fixture.workspaceRoot,
    acceptedPlan: decoded,
    admissionState,
  });
  const selection = selectModuleDeliveryAdmissions({
    authority,
    acceptedPlan: decoded,
    state: admissionState,
  });
  const admission = selection.admissions[0];
  if (!admission) throw new Error('Writer admission is missing.');
  const lease = recordModuleDeliveryAttemptLeases({
    authority,
    state: admissionState,
    admissions: [admission],
  }).leases[0];
  if (!lease) throw new Error('Writer lease is missing.');
  const writerWorkspace = prepareModuleWorktree({
    repositoryRoot: fixture.sourceRoot,
    workspaceRoot: fixture.workspaceRoot,
    planDigest: decoded.planDigest,
    taskId: 'writer',
    attempt: 1,
    baselineCommit: fixture.baselineCommit,
  });
  const git = fixtureGit(fixture);
  mkdirSync(join(fixture.sourceRoot, root, 'src'), { recursive: true });
  writeFileSync(
    join(fixture.sourceRoot, root, 'src/feature.rs'),
    'pub fn feature() {}\n',
    { flag: 'wx' },
  );
  git(['add', '--all']);
  git(['commit', '--quiet', '-m', 'writer']);
  const commit = git(['rev-parse', 'HEAD']);
  return {
    authority,
    fixture,
    plan: decoded,
    state,
    lease,
    submission: {
      kind: ModuleDeliveryProviderSubmissionKind.Write,
      generation: 1,
      acceptedByTeam: TeamKey.Ai,
      verdict: ModuleDeliveryEvidenceVerdict.TerminalSuccess,
      handoff: {
        taskId: 'writer',
        attempt: 1,
        planDigest: decoded.planDigest,
        baselineCommit: fixture.baselineCommit,
        commit,
        workspace: writerWorkspace,
      },
    },
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

  test.each(['config', 'hook', 'ref'] as const)(
    'rejects %s mutation through production handoff acceptance',
    (mutation) => {
      const prepared = preparedWrite();
      const git = fixtureGit(prepared.fixture);
      if (mutation === 'config')
        git(['config', 'remote.origin.url', 'https://example.invalid/repo']);
      else if (mutation === 'hook')
        writeFileSync(
          join(prepared.fixture.sourceRoot, '.git/hooks/pre-commit'),
          '#!/bin/sh\nexit 0\n',
        );
      else git(['update-ref', 'refs/custom/forged', 'HEAD']);

      expect(() =>
        integrateVerifiedModuleDeliveryTask({
          authority: prepared.authority,
          acceptedPlan: prepared.plan,
          lease: prepared.lease,
          state: prepared.state,
          submission: prepared.submission,
        }),
      ).toThrow('Git metadata changed during dispatch');
    },
  );

  test('accepts only the authenticated shared branch HEAD advance', () => {
    const prepared = preparedWrite();
    const accepted = integrateVerifiedModuleDeliveryTask({
      authority: prepared.authority,
      acceptedPlan: prepared.plan,
      lease: prepared.lease,
      state: prepared.state,
      submission: prepared.submission,
    });
    expect(accepted.headCommit).toBe(prepared.submission.handoff.commit);
    expect(accepted.acceptedWrites).toHaveLength(1);
  });
});
