import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
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
  ModuleIntegrationPhase,
  TeamKey,
  cleanupModuleIntegration,
  createModuleDeliveryAdmissionState,
  createModuleDeliveryGenerationAuthority,
  decodeAndValidateModuleDeliveryPlan,
  finalizeModuleDeliveryIntegration,
  integrateVerifiedModuleDeliveryTask,
  prepareModuleIntegration,
  prepareModuleWorktree,
  recordModuleDeliveryAttemptLeases,
  selectModuleDeliveryAdmissions,
} from '../../src/module-delivery/index.ts';
import { applyModuleWaveTree } from '../../src/module-delivery/tree-integration.ts';
import {
  createGitFixture,
  disposeGitFixture,
  evidenceSubmission,
  fixtureGit,
} from './worktree-test-support.ts';

import type {
  ModuleDeliveryAttemptLease,
  ModuleDeliveryGenerationAuthority,
  ModuleDeliveryPlanV3,
  ModuleDeliveryReadOnlyNodeV2,
  ModuleDeliveryWriteNodeV2,
  ModuleDeliveryWriteProviderSubmission,
  ModuleIntegrationState,
  ValidatedModuleDeliveryPlan,
} from '../../src/module-delivery/index.ts';
import type { GitFixture, GitRunner } from './worktree-test-support.ts';

const fixtures: GitFixture[] = [];
const ROOT = 'nook-app/nook-platform/nook-core';

afterEach(() => {
  for (const fixture of fixtures.splice(0).reverse())
    disposeGitFixture(fixture);
});

type WriterNodeRequest = Readonly<{
  taskId: string;
  path: string;
  sourceCommit: string;
}>;

function writerNode(request: WriterNodeRequest): ModuleDeliveryWriteNodeV2 {
  return {
    kind: ModuleDeliveryTaskKind.Write,
    taskId: request.taskId,
    team: TeamKey.DevelopmentCore,
    functionalOwner: TeamKey.Ai,
    acceptanceOwner: TeamKey.Ai,
    parentLineage: { kind: AgentAttemptParentKind.WorkflowRoot },
    expert: 'core_expert',
    moduleRoot: ROOT,
    consumerOutcome: `${request.taskId} publishes a direct commit.`,
    baseline: {
      kind: ModuleDeliveryBaselineKind.SourceCommit,
      sourceCommit: request.sourceCommit,
    },
    agentDepthLimit: 2,
    dependencies: [],
    resources: {
      read: [`${ROOT}/${request.path}/**`],
      write: [`${ROOT}/${request.path}/**`],
      evidenceSurface: [],
    },
    parentOwnedExclusions: REQUIRED_PARENT_OWNED_RESOURCES,
    acceptance: {
      commands: [`task ${request.taskId}:test`],
      evidence: [`${request.taskId} passed`],
    },
    workspace: {
      kind: ModuleDeliveryWorkspaceKind.SharedCheckout,
      expectedCommitHandoff: true,
    },
  };
}

function readerNode(sourceCommit: string): ModuleDeliveryReadOnlyNodeV2 {
  const { workspace: _workspace, ...common } = writerNode({
    taskId: 'reader',
    path: 'reader',
    sourceCommit,
  });
  return {
    ...common,
    kind: ModuleDeliveryTaskKind.ReadOnly,
    resources: {
      read: ['module/seed.txt'],
      write: [],
      evidenceSurface: ['module/seed.txt'],
    },
  };
}

function validatedPlan(fixture: GitFixture): ValidatedModuleDeliveryPlan {
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
      writerNode({
        taskId: 'alpha',
        path: 'alpha',
        sourceCommit: fixture.baselineCommit,
      }),
      writerNode({
        taskId: 'beta',
        path: 'beta',
        sourceCommit: fixture.baselineCommit,
      }),
      readerNode(fixture.baselineCommit),
    ],
    edgeContracts: [],
  };
  const decoded = decodeAndValidateModuleDeliveryPlan(JSON.stringify(plan));
  if (decoded.status !== ModuleDeliveryValidationStatus.Accepted)
    throw new Error(JSON.stringify(decoded.issues));
  return decoded;
}

type Runtime = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  fixture: GitFixture;
  plan: ValidatedModuleDeliveryPlan;
  state: ModuleIntegrationState;
}>;

function preparedRuntime(): Runtime {
  const fixture = createGitFixture();
  fixtures.push(fixture);
  const plan = validatedPlan(fixture);
  const authority = createModuleDeliveryGenerationAuthority({
    acceptedPlan: plan,
    expectedLineage: plan.plan.nodes.map((node) => ({
      taskId: node.taskId,
      parentLineage: node.parentLineage,
    })),
    repositoryRoot: fixture.sourceRoot,
  });
  const admissionState = createModuleDeliveryAdmissionState({
    authority,
    acceptedPlan: plan,
    headCommit: fixture.baselineCommit,
    integratedWriterFrontiers: [],
    acceptedEvidence: [],
  });
  const state = prepareModuleIntegration({
    authority,
    repositoryRoot: fixture.sourceRoot,
    workspaceRoot: fixture.workspaceRoot,
    acceptedPlan: plan,
    admissionState,
  });
  return { authority, fixture, plan, state };
}

type CommitWriterRequest = Readonly<{
  runtime: Runtime;
  state: ModuleIntegrationState;
  lease: ModuleDeliveryAttemptLease;
  path: string;
}>;

function commitWriter(
  request: CommitWriterRequest,
): ModuleDeliveryWriteProviderSubmission {
  const { fixture, plan } = request.runtime;
  const workspace = prepareModuleWorktree({
    repositoryRoot: fixture.sourceRoot,
    workspaceRoot: fixture.workspaceRoot,
    planDigest: plan.planDigest,
    taskId: request.lease.taskId,
    attempt: request.lease.attempt,
    baselineCommit: request.lease.startingFrontier,
  });
  const file = join(fixture.sourceRoot, ROOT, request.path, 'feature.rs');
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, `pub fn ${request.lease.taskId}() {}\n`);
  const git = fixtureGit(fixture);
  git(['add', '--all']);
  git(['commit', '--quiet', '-m', request.lease.taskId]);
  return {
    kind: ModuleDeliveryProviderSubmissionKind.Write,
    generation: 1,
    acceptedByTeam: TeamKey.Ai,
    verdict: ModuleDeliveryEvidenceVerdict.TerminalSuccess,
    handoff: {
      taskId: request.lease.taskId,
      attempt: request.lease.attempt,
      planDigest: plan.planDigest,
      baselineCommit: request.lease.startingFrontier,
      commit: git(['rev-parse', 'HEAD']),
      workspace,
    },
  };
}

function normalizedMetadata(git: GitRunner): readonly string[] {
  const branch = git(['symbolic-ref', 'HEAD']);
  const refs = git([
    'for-each-ref',
    '--sort=refname',
    '--format=%(refname) %(objectname)',
    'refs',
  ])
    .split('\n')
    .map((line) => (line.startsWith(`${branch} `) ? `${branch} HEAD` : line))
    .join('\n');
  return [branch, git(['config', '--local', '--list']), refs];
}

test('sequences shared commits with failure atomicity and exact cleanup', () => {
  const runtime = preparedRuntime();
  const git = fixtureGit(runtime.fixture);
  const metadata = normalizedMetadata(git);
  const firstSelection = selectModuleDeliveryAdmissions({
    authority: runtime.authority,
    acceptedPlan: runtime.plan,
    state: runtime.state.admissionState,
  });
  expect(firstSelection.admissions.map(({ taskId }) => taskId)).toEqual([
    'alpha',
  ]);
  expect(firstSelection.pendingTaskIds).toEqual(['beta', 'reader']);
  const alphaLease = recordModuleDeliveryAttemptLeases({
    authority: runtime.authority,
    state: runtime.state.admissionState,
    admissions: firstSelection.admissions,
  }).leases[0];
  if (!alphaLease) throw new Error('Alpha lease is missing.');
  const alpha = commitWriter({
    runtime,
    state: runtime.state,
    lease: alphaLease,
    path: 'alpha',
  });
  const afterAlpha = integrateVerifiedModuleDeliveryTask({
    authority: runtime.authority,
    acceptedPlan: runtime.plan,
    lease: alphaLease,
    state: runtime.state,
    submission: alpha,
  });
  expect(() =>
    finalizeModuleDeliveryIntegration({
      authority: runtime.authority,
      acceptedPlan: runtime.plan,
      state: afterAlpha,
    }),
  ).toThrow('requires every accepted task result');
  expect(afterAlpha.phase).toBe(ModuleIntegrationPhase.AcceptingProviders);
  const secondSelection = selectModuleDeliveryAdmissions({
    authority: runtime.authority,
    acceptedPlan: runtime.plan,
    state: afterAlpha.admissionState,
  });
  expect(secondSelection.admissions[0]?.taskId).toBe('beta');
  expect(secondSelection.admissions[0]?.startingFrontier).toBe(
    alpha.handoff.commit,
  );
  const betaLease = recordModuleDeliveryAttemptLeases({
    authority: runtime.authority,
    state: afterAlpha.admissionState,
    admissions: secondSelection.admissions,
  }).leases[0];
  if (!betaLease) throw new Error('Beta lease is missing.');
  const beta = commitWriter({
    runtime,
    state: afterAlpha,
    lease: betaLease,
    path: 'beta',
  });
  expect(() =>
    applyModuleWaveTree({
      workspace: afterAlpha.workspace,
      currentHead: alpha.handoff.commit,
      handoffs: [
        {
          taskId: 'beta',
          baselineCommit: runtime.fixture.baselineCommit,
          commit: beta.handoff.commit,
        },
      ],
    }),
  ).toThrow('stale baseline');
  expect(git(['rev-parse', 'HEAD'])).toBe(beta.handoff.commit);
  const afterBeta = integrateVerifiedModuleDeliveryTask({
    authority: runtime.authority,
    acceptedPlan: runtime.plan,
    lease: betaLease,
    state: afterAlpha,
    submission: beta,
  });
  const readAdmission = selectModuleDeliveryAdmissions({
    authority: runtime.authority,
    acceptedPlan: runtime.plan,
    state: afterBeta.admissionState,
  }).admissions[0];
  if (!readAdmission) throw new Error('Reader admission is missing.');
  const readLease = recordModuleDeliveryAttemptLeases({
    authority: runtime.authority,
    state: afterBeta.admissionState,
    admissions: [readAdmission],
  }).leases[0];
  if (!readLease) throw new Error('Reader lease is missing.');
  const readNode = runtime.plan.plan.nodes[2];
  if (!readNode || readNode.kind !== ModuleDeliveryTaskKind.ReadOnly)
    throw new Error('Reader node is missing.');
  const evidence = evidenceSubmission({
    state: { ...afterBeta, headCommit: readLease.startingFrontier },
    node: readNode,
    lease: readLease,
  });
  git(['commit', '--quiet', '--allow-empty', '-m', 'unaccepted-writer']);
  expect(() =>
    integrateVerifiedModuleDeliveryTask({
      authority: runtime.authority,
      acceptedPlan: runtime.plan,
      lease: readLease,
      state: afterBeta,
      submission: evidence,
    }),
  ).toThrow('Git metadata changed');
  git(['reset', '--hard', '--quiet', beta.handoff.commit]);
  const branch = git(['symbolic-ref', 'HEAD']);
  const mutations = [
    [
      ['config', 'remote.origin.url', 'forged'],
      ['config', '--unset', 'remote.origin.url'],
    ],
    [
      ['update-ref', 'refs/custom/forged', 'HEAD'],
      ['update-ref', '-d', 'refs/custom/forged'],
    ],
    [
      ['update-index', '--skip-worktree', 'module/seed.txt'],
      ['update-index', '--no-skip-worktree', 'module/seed.txt'],
    ],
    [
      ['rm', '--quiet', 'module/seed.txt'],
      ['restore', '--staged', '--worktree', 'module/seed.txt'],
    ],
    [
      ['update-ref', branch, alpha.handoff.commit],
      ['update-ref', branch, beta.handoff.commit],
    ],
  ] as const;
  for (const [mutate, restore] of mutations) {
    git(mutate);
    expect(() =>
      integrateVerifiedModuleDeliveryTask({
        authority: runtime.authority,
        acceptedPlan: runtime.plan,
        lease: readLease,
        state: afterBeta,
        submission: evidence,
      }),
    ).toThrow();
    expect(afterBeta.acceptedEvidence).toHaveLength(0);
    git(restore);
  }
  const afterRead = integrateVerifiedModuleDeliveryTask({
    authority: runtime.authority,
    acceptedPlan: runtime.plan,
    lease: readLease,
    state: afterBeta,
    submission: evidence,
  });
  for (const [mutate, restore] of mutations) {
    git(mutate);
    expect(() =>
      finalizeModuleDeliveryIntegration({
        authority: runtime.authority,
        acceptedPlan: runtime.plan,
        state: afterRead,
      }),
    ).toThrow();
    expect(afterRead.phase).toBe(ModuleIntegrationPhase.AcceptingProviders);
    git(restore);
  }
  const finalized = finalizeModuleDeliveryIntegration({
    authority: runtime.authority,
    acceptedPlan: runtime.plan,
    state: afterRead,
  });
  expect(finalized.phase).toBe(ModuleIntegrationPhase.Finalized);
  expect(finalized.headCommit).toBe(beta.handoff.commit);
  expect(git(['rev-parse', 'HEAD'])).toBe(beta.handoff.commit);
  expect(
    cleanupModuleIntegration({ cleanupHandle: finalized.cleanupHandle }),
  ).toEqual({ removed: true });
  expect(
    cleanupModuleIntegration({ cleanupHandle: finalized.cleanupHandle }),
  ).toEqual({ removed: false });
  expect(normalizedMetadata(git)).toEqual(metadata);
});
