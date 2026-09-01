import { afterEach, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

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
  test.each([
    'config',
    'hook',
    'ref',
    'skip-worktree',
    'assume-unchanged',
    'info-content',
    'info-mode',
    'info-symlink',
  ] as const)(
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
      else if (mutation === 'ref')
        git(['update-ref', 'refs/custom/forged', 'HEAD']);
      else if (mutation.startsWith('info-')) {
        const exclude = join(prepared.fixture.sourceRoot, '.git/info/exclude');
        if (mutation === 'info-content') writeFileSync(exclude, 'hidden/**\n');
        else if (mutation === 'info-mode') chmodSync(exclude, 0o600);
        else {
          rmSync(exclude);
          symlinkSync('../../module/seed.txt', exclude);
        }
      } else
        git([
          'update-index',
          `--${mutation}`,
          'nook-app/nook-platform/nook-core/src/feature.rs',
        ]);

      expect(() =>
        integrateVerifiedModuleDeliveryTask({
          authority: prepared.authority,
          acceptedPlan: prepared.plan,
          lease: prepared.lease,
          state: prepared.state,
          submission: prepared.submission,
        }),
      ).toThrow(
        mutation === 'skip-worktree' || mutation === 'assume-unchanged'
          ? 'index is not canonical'
          : 'Git metadata changed during dispatch',
      );
    },
  );
});
