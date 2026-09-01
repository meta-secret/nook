import { afterEach, expect, test } from 'bun:test';
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { AgentAttemptParentKind } from '../../src/agent-workflow/domain.ts';
import {
  REQUIRED_PARENT_OWNED_RESOURCES,
  ModuleDeliveryBaselineKind,
  ModuleDeliveryAttemptDispositionKind,
  ModuleDeliveryEvidenceVerdict,
  ModuleDeliveryJoinKind,
  ModuleDeliveryProviderSubmissionKind,
  ModuleDeliveryGenerationFenceKind,
  ModuleDeliveryTaskKind,
  ModuleDeliveryValidationStatus,
  ModuleDeliveryWorkspaceKind,
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
  recordModuleDeliveryAttemptDisposition,
  selectModuleDeliveryAdmissions,
} from '../../src/module-delivery/index.ts';
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
  ModuleDeliveryProviderSubmission,
  ModuleDeliveryReadOnlyNodeV2,
  ModuleDeliveryWriteNodeV2,
  ModuleDeliveryWriteProviderSubmission,
  ModuleIntegrationState,
  ValidatedModuleDeliveryPlan,
} from '../../src/module-delivery/index.ts';
import type { GitFixture } from './worktree-test-support.ts';

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

function validatedPlan([fixture, concurrent = false]: readonly [
  GitFixture,
  boolean?,
]): ValidatedModuleDeliveryPlan {
  const alpha = writerNode({
    taskId: 'alpha',
    path: 'alpha',
    sourceCommit: fixture.baselineCommit,
  });
  const reader = readerNode(fixture.baselineCommit);
  const plan: ModuleDeliveryPlanV3 = {
    version: 3,
    generation: 1,
    sourceCommit: fixture.baselineCommit,
    maxConcurrency: concurrent ? 2 : 1,
    maxAgentDepth: 2,
    maxAttempts: 2,
    parentOwnedResources: REQUIRED_PARENT_OWNED_RESOURCES,
    parentJoin: {
      kind: ModuleDeliveryJoinKind.DirectCommits,
      owner: 'delivery-owner',
      validationCommands: ['task loom:verify'],
    },
    nodes: concurrent
      ? [alpha, reader]
      : [
          alpha,
          writerNode({
            taskId: 'beta',
            path: 'beta',
            sourceCommit: fixture.baselineCommit,
          }),
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

function preparedRuntime(concurrent = false): Runtime {
  const fixture = createGitFixture();
  fixtures.push(fixture);
  const plan = validatedPlan([fixture, concurrent]);
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

function integrate([runtime, state, lease, submission]: readonly [
  Runtime,
  ModuleIntegrationState,
  ModuleDeliveryAttemptLease,
  ModuleDeliveryProviderSubmission,
]): ModuleIntegrationState {
  return integrateVerifiedModuleDeliveryTask({
    authority: runtime.authority,
    acceptedPlan: runtime.plan,
    lease,
    state,
    submission,
  });
}

function nextWriter([runtime, state]: readonly [
  Runtime,
  ModuleIntegrationState,
]): readonly [
  ModuleDeliveryAttemptLease,
  ModuleDeliveryWriteProviderSubmission,
] {
  const admission = selectModuleDeliveryAdmissions({
    authority: runtime.authority,
    acceptedPlan: runtime.plan,
    state: state.admissionState,
  }).admissions[0];
  if (!admission) throw new Error('Writer admission is missing.');
  const lease = recordModuleDeliveryAttemptLeases({
    authority: runtime.authority,
    state: state.admissionState,
    admissions: [admission],
  }).leases[0];
  if (!lease) throw new Error('Writer lease is missing.');
  return [lease, commitWriter({ runtime, lease, path: lease.taskId })];
}

const MUTATIONS = [
  'remote-config',
  'hook',
  'foreign-ref',
  'staged-index',
  'skip-worktree',
  'assume-unchanged',
  'info-content',
  'info-mode',
  'info-symlink',
  'info-root-mode',
  'info-root-type',
  'info-hidden-file',
] as const;

function mutateGit([fixture, mutation]: readonly [
  GitFixture,
  (typeof MUTATIONS)[number],
]): () => void {
  const git = fixtureGit(fixture);
  const info = join(fixture.sourceRoot, '.git/info');
  const exclude = join(info, 'exclude');
  if (mutation === 'remote-config') {
    git(['config', 'remote.origin.url', 'https://example.invalid/repo']);
    return () => void git(['config', '--unset-all', 'remote.origin.url']);
  }
  if (mutation === 'hook') {
    const hook = join(fixture.sourceRoot, '.git/hooks/pre-commit');
    writeFileSync(hook, '#!/bin/sh\nexit 0\n');
    return () => rmSync(hook);
  }
  if (mutation === 'foreign-ref') {
    git(['update-ref', 'refs/custom/drift', 'HEAD']);
    return () => void git(['update-ref', '-d', 'refs/custom/drift']);
  }
  if (mutation === 'staged-index') {
    writeFileSync(join(fixture.sourceRoot, 'module/seed.txt'), 'drift\n');
    git(['add', 'module/seed.txt']);
    return () => void git(['reset', '--hard', '--quiet', 'HEAD']);
  }
  if (mutation === 'skip-worktree' || mutation === 'assume-unchanged') {
    git(['update-index', `--${mutation}`, 'module/seed.txt']);
    return () =>
      void git(['update-index', `--no-${mutation}`, 'module/seed.txt']);
  }
  if (mutation === 'info-content') {
    const control = join(info, 'control');
    writeFileSync(control, 'drift');
    return () => rmSync(control);
  }
  if (mutation === 'info-mode' || mutation === 'info-root-mode') {
    const path = mutation === 'info-mode' ? exclude : info;
    const mode = statSync(path).mode;
    chmodSync(path, 0o700);
    return () => chmodSync(path, mode);
  }
  if (mutation === 'info-symlink') {
    const saved = `${exclude}.saved`;
    renameSync(exclude, saved);
    symlinkSync('../../module/seed.txt', exclude);
    return () => {
      rmSync(exclude);
      renameSync(saved, exclude);
    };
  }
  if (mutation === 'info-root-type') {
    const saved = `${info}.saved`;
    renameSync(info, saved);
    writeFileSync(info, 'unsupported');
    return () => {
      rmSync(info);
      renameSync(saved, info);
    };
  }
  const original = readFileSync(exclude);
  const hidden = join(fixture.sourceRoot, 'hidden');
  writeFileSync(exclude, 'hidden/**\n');
  writeFileSync(join(info, 'hidden-control'), 'control');
  mkdirSync(hidden);
  writeFileSync(join(hidden, 'secret'), 'secret');
  return () => {
    writeFileSync(exclude, original);
    rmSync(join(info, 'hidden-control'));
    rmSync(hidden, { recursive: true });
  };
}

test.each([...MUTATIONS])(
  'rejects %s during production write acceptance',
  (kind) => {
    const runtime = preparedRuntime();
    const [lease, submission] = nextWriter([runtime, runtime.state]);
    const restore = mutateGit([runtime.fixture, kind]);
    expect(() =>
      integrate([runtime, runtime.state, lease, submission]),
    ).toThrow();
    restore();
  },
);

test('sequences shared commits with failure atomicity and exact cleanup', () => {
  const runtime = preparedRuntime();
  const [alphaLease, alpha] = nextWriter([runtime, runtime.state]);
  const afterAlpha = integrate([runtime, runtime.state, alphaLease, alpha]);
  const [betaLease, beta] = nextWriter([runtime, afterAlpha]);
  expect(betaLease.startingFrontier).toBe(alpha.handoff.commit);
  const afterBeta = integrate([runtime, afterAlpha, betaLease, beta]);
  const finalized = finalizeModuleDeliveryIntegration({
    authority: runtime.authority,
    acceptedPlan: runtime.plan,
    state: afterBeta,
  });
  expect(finalized.headCommit).toBe(beta.handoff.commit);
  expect(
    cleanupModuleIntegration({ cleanupHandle: finalized.cleanupHandle }),
  ).toEqual({ removed: true });
  expect(
    cleanupModuleIntegration({ cleanupHandle: finalized.cleanupHandle }),
  ).toEqual({ removed: false });
});

test.each(['read-first', 'writer-first'] as const)(
  'accepts concurrent writer and reader in %s production order',
  (order) => {
    const runtime = preparedRuntime(true);
    const selection = selectModuleDeliveryAdmissions({
      authority: runtime.authority,
      acceptedPlan: runtime.plan,
      state: runtime.state.admissionState,
    });
    const leases = recordModuleDeliveryAttemptLeases({
      authority: runtime.authority,
      state: runtime.state.admissionState,
      admissions: selection.admissions,
    }).leases;
    const writerLease = leases.find(({ taskId }) => taskId === 'alpha');
    const readLease = leases.find(({ taskId }) => taskId === 'reader');
    const reader = runtime.plan.plan.nodes[1];
    if (
      !writerLease ||
      !readLease ||
      reader?.kind !== ModuleDeliveryTaskKind.ReadOnly
    )
      throw new Error('Concurrent leases are missing.');
    const evidence = evidenceSubmission({
      state: runtime.state,
      node: reader,
      lease: readLease,
    });
    let state = runtime.state;
    const rejectReadMutations = () => {
      for (const kind of MUTATIONS) {
        const restore = mutateGit([runtime.fixture, kind]);
        expect(() =>
          integrate([runtime, state, readLease, evidence]),
        ).toThrow();
        restore();
      }
    };
    if (order === 'read-first') {
      rejectReadMutations();
      state = integrate([runtime, state, readLease, evidence]);
    }
    let writer = commitWriter({ runtime, lease: writerLease, path: 'alpha' });
    if (order === 'writer-first') {
      expect(() => integrate([runtime, state, readLease, evidence])).toThrow();
      writeFileSync(
        join(runtime.fixture.sourceRoot, ROOT, 'alpha/feature.rs'),
        'dirty\n',
      );
      const disposition = {
        authority: runtime.authority,
        state: state.admissionState,
        lease: writerLease,
        outcome: {
          kind: ModuleDeliveryAttemptDispositionKind.FinalUnusable,
          conclusion: ModuleDeliveryGenerationFenceKind.Rejected,
        },
      } as const;
      expect(() =>
        recordModuleDeliveryAttemptDisposition(disposition),
      ).toThrow();
      fixtureGit(runtime.fixture)([
        'reset',
        '--hard',
        '--quiet',
        state.headCommit,
      ]);
      recordModuleDeliveryAttemptDisposition(disposition);
      const retry = selectModuleDeliveryAdmissions({
        authority: runtime.authority,
        acceptedPlan: runtime.plan,
        state: state.admissionState,
      }).admissions.find(({ taskId }) => taskId === 'alpha');
      if (!retry) throw new Error('Writer retry is missing.');
      expect(retry.startingFrontier).toBe(writerLease.startingFrontier);
      const retryLease = recordModuleDeliveryAttemptLeases({
        authority: runtime.authority,
        state: state.admissionState,
        admissions: [retry],
      }).leases[0];
      if (!retryLease) throw new Error('Writer retry lease is missing.');
      writer = commitWriter({ runtime, lease: retryLease, path: 'alpha' });
      state = integrate([runtime, state, retryLease, writer]);
    } else {
      const git = fixtureGit(runtime.fixture);
      git(['commit', '--amend', '--quiet', '-m', 'amended-alpha']);
      writer = {
        ...writer,
        handoff: { ...writer.handoff, commit: git(['rev-parse', 'HEAD']) },
      };
      state = integrate([runtime, state, writerLease, writer]);
    }
    if (order === 'writer-first') {
      rejectReadMutations();
      state = integrate([runtime, state, readLease, evidence]);
    }
    for (const kind of MUTATIONS) {
      const restore = mutateGit([runtime.fixture, kind]);
      expect(() =>
        finalizeModuleDeliveryIntegration({
          authority: runtime.authority,
          acceptedPlan: runtime.plan,
          state,
        }),
      ).toThrow();
      restore();
    }
    finalizeModuleDeliveryIntegration({
      authority: runtime.authority,
      acceptedPlan: runtime.plan,
      state,
    });
  },
);
