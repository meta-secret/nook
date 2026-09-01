import { afterEach, expect, test } from 'bun:test';
import {
  chmodSync,
  mkdirSync,
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
  ModuleDeliveryEvidenceVerdict,
  ModuleDeliveryJoinKind,
  ModuleDeliveryProviderSubmissionKind,
  ModuleDeliveryTaskKind,
  ModuleDeliveryValidationStatus,
  ModuleDeliveryWorkspaceKind,
  TeamKey,
  acknowledgeModuleDeliveryPush,
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
import {
  createGitFixture,
  disposeGitFixture,
  evidenceSubmission,
  fixtureGit,
} from './worktree-test-support.ts';

import type {
  ModuleDeliveryAttemptLease,
  ModuleDeliveryPlanV3,
  ModuleDeliveryProviderSubmission,
  ModuleDeliveryReadOnlyNodeV2,
  ModuleDeliveryWriteNodeV2,
  ModuleDeliveryWriteProviderSubmission,
  ModuleIntegrationState,
  ValidatedModuleDeliveryPlan,
} from '../../src/module-delivery/index.ts';
import type { GitFixture } from './worktree-test-support.ts';

/* eslint-disable max-params -- lifecycle fixture helpers mirror production calls. */

const fixtures: GitFixture[] = [];
const ROOT = 'nook-app/nook-platform/nook-core';

afterEach(() => {
  for (const fixture of fixtures.splice(0).reverse())
    disposeGitFixture(fixture);
});

function writerNode(
  taskId: string,
  path: string,
  sourceCommit: string,
): ModuleDeliveryWriteNodeV2 {
  return {
    kind: ModuleDeliveryTaskKind.Write,
    taskId,
    team: TeamKey.DevelopmentCore,
    functionalOwner: TeamKey.Ai,
    acceptanceOwner: TeamKey.Ai,
    parentLineage: { kind: AgentAttemptParentKind.WorkflowRoot },
    expert: 'core_expert',
    moduleRoot: ROOT,
    consumerOutcome: `${taskId} publishes a direct commit.`,
    baseline: {
      kind: ModuleDeliveryBaselineKind.SourceCommit,
      sourceCommit,
    },
    agentDepthLimit: 2,
    dependencies: [],
    resources: {
      read: [`${ROOT}/${path}/**`],
      write: [`${ROOT}/${path}/**`],
      evidenceSurface: [],
    },
    parentOwnedExclusions: REQUIRED_PARENT_OWNED_RESOURCES,
    acceptance: {
      commands: [`task ${taskId}:test`],
      evidence: [`${taskId} passed`],
    },
    workspace: {
      kind: ModuleDeliveryWorkspaceKind.SharedCheckout,
      expectedCommitHandoff: true,
    },
  };
}

function validatedPlan(
  fixture: GitFixture,
  concurrent = false,
): ValidatedModuleDeliveryPlan {
  const alpha = writerNode('alpha', 'alpha', fixture.baselineCommit);
  const beta = writerNode('beta', 'beta', fixture.baselineCommit);
  const { workspace: _workspace, ...readerBase } = alpha;
  const reader: ModuleDeliveryReadOnlyNodeV2 = {
    ...readerBase,
    kind: ModuleDeliveryTaskKind.ReadOnly,
    taskId: 'reader',
    resources: {
      read: ['module/seed.txt'],
      write: [],
      evidenceSurface: ['module/seed.txt'],
    },
  };
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
    nodes: concurrent ? [alpha, beta, reader] : [alpha, beta],
    edgeContracts: [],
  };
  const decoded = decodeAndValidateModuleDeliveryPlan(JSON.stringify(plan));
  if (decoded.status !== ModuleDeliveryValidationStatus.Accepted)
    throw new Error(JSON.stringify(decoded.issues));
  return decoded;
}

function preparedRuntime(concurrent = false) {
  const fixture = createGitFixture();
  fixtures.push(fixture);
  const plan = validatedPlan(fixture, concurrent);
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
type Runtime = ReturnType<typeof preparedRuntime>;

function commitWriter(
  runtime: Runtime,
  lease: ModuleDeliveryAttemptLease,
  path: string,
): ModuleDeliveryWriteProviderSubmission {
  const { fixture, plan } = runtime;
  const workspace = prepareModuleWorktree({
    repositoryRoot: fixture.sourceRoot,
    workspaceRoot: fixture.workspaceRoot,
    planDigest: plan.planDigest,
    taskId: lease.taskId,
    attempt: lease.attempt,
    baselineCommit: lease.startingFrontier,
  });
  const file = join(fixture.sourceRoot, ROOT, path, 'feature.rs');
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, `pub fn ${lease.taskId}() {}\n`);
  const git = fixtureGit(fixture);
  git(['add', '--all']);
  git(['commit', '--quiet', '-m', lease.taskId]);
  return {
    kind: ModuleDeliveryProviderSubmissionKind.Write,
    generation: 1,
    acceptedByTeam: TeamKey.Ai,
    verdict: ModuleDeliveryEvidenceVerdict.TerminalSuccess,
    handoff: {
      taskId: lease.taskId,
      attempt: lease.attempt,
      planDigest: plan.planDigest,
      baselineCommit: lease.startingFrontier,
      commit: git(['rev-parse', 'HEAD']),
      workspace,
    },
  };
}

function integrate(
  runtime: Runtime,
  state: ModuleIntegrationState,
  lease: ModuleDeliveryAttemptLease,
  submission: ModuleDeliveryProviderSubmission,
): ModuleIntegrationState {
  return integrateVerifiedModuleDeliveryTask({
    authority: runtime.authority,
    acceptedPlan: runtime.plan,
    lease,
    state,
    submission,
  });
}

function finalize(runtime: Runtime, state: ModuleIntegrationState) {
  return finalizeModuleDeliveryIntegration({
    authority: runtime.authority,
    acceptedPlan: runtime.plan,
    state,
  });
}

function acknowledge(runtime: Runtime, state: ModuleIntegrationState) {
  return acknowledgeModuleDeliveryPush({
    authority: runtime.authority,
    acceptedPlan: runtime.plan,
    state,
  });
}

function leases(runtime: Runtime) {
  const admissions = selectModuleDeliveryAdmissions({
    authority: runtime.authority,
    acceptedPlan: runtime.plan,
    state: runtime.state.admissionState,
  }).admissions;
  return recordModuleDeliveryAttemptLeases({
    authority: runtime.authority,
    state: runtime.state.admissionState,
    admissions,
  }).leases;
}

function nextWriter(runtime: Runtime, state: ModuleIntegrationState) {
  const admission = selectModuleDeliveryAdmissions({
    authority: runtime.authority,
    acceptedPlan: runtime.plan,
    state: state.admissionState,
  }).admissions[0]!;
  const lease = recordModuleDeliveryAttemptLeases({
    authority: runtime.authority,
    state: state.admissionState,
    admissions: [admission],
  }).leases[0]!;
  return [lease, commitWriter(runtime, lease, lease.taskId)] as const;
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
  const hidden = join(fixture.sourceRoot, 'hidden');
  writeFileSync(join(info, 'hidden-control'), 'control');
  mkdirSync(hidden);
  writeFileSync(join(hidden, 'secret'), 'secret');
  return () => {
    rmSync(join(info, 'hidden-control'));
    rmSync(hidden, { recursive: true });
  };
}

function rejectMutations(runtime: Runtime, action: () => void): void {
  for (const kind of MUTATIONS) {
    const restore = mutateGit([runtime.fixture, kind]);
    expect(action).toThrow();
    restore();
  }
}

test('rejects protected mutations during production write acceptance', () => {
  const runtime = preparedRuntime();
  const [lease, submission] = nextWriter(runtime, runtime.state);
  rejectMutations(runtime, () =>
    integrate(runtime, runtime.state, lease, submission),
  );
});

test.each(['read-first', 'writer-first'] as const)(
  'accepts concurrent writer and reader in %s production order',
  (order) => {
    const runtime = preparedRuntime(true);
    const concurrentLeases = leases(runtime);
    const writerLease = concurrentLeases.find(
      ({ taskId }) => taskId === 'alpha',
    )!;
    const readLease = concurrentLeases.find(
      ({ taskId }) => taskId === 'reader',
    )!;
    const reader = runtime.plan.plan.nodes[2] as ModuleDeliveryReadOnlyNodeV2;
    const evidence = evidenceSubmission({
      state: runtime.state,
      node: reader,
      lease: readLease,
    });
    let state = runtime.state;
    const rejectReadMutations = () =>
      rejectMutations(runtime, () =>
        integrate(runtime, state, readLease, evidence),
      );
    if (order === 'read-first') {
      rejectReadMutations();
      state = integrate(runtime, state, readLease, evidence);
    }
    const writer = commitWriter(runtime, writerLease, 'alpha');
    if (order === 'writer-first') {
      expect(() => integrate(runtime, state, readLease, evidence)).toThrow();
    }
    state = integrate(runtime, state, writerLease, writer);
    if (order === 'read-first') {
      const git = fixtureGit(runtime.fixture);
      const upstream = git([
        'rev-parse',
        '--symbolic-full-name',
        '@{upstream}',
      ]);
      expect(() => acknowledge(runtime, state)).toThrow();
      git(['update-ref', upstream, writer.handoff.commit]);
      expect(() => finalize(runtime, state)).toThrow();
      git(['update-ref', 'refs/custom/push-drift', 'HEAD']);
      expect(() => acknowledge(runtime, state)).toThrow();
      git(['update-ref', '-d', 'refs/custom/push-drift']);
      state = acknowledge(runtime, state);
    }
    if (order === 'writer-first') {
      rejectReadMutations();
      state = integrate(runtime, state, readLease, evidence);
    }
    const restoreAdmission = mutateGit([runtime.fixture, 'hook']);
    expect(() => nextWriter(runtime, state)).toThrow();
    restoreAdmission();
    const [betaLease, beta] = nextWriter(runtime, state);
    state = integrate(runtime, state, betaLease, beta);
    rejectMutations(runtime, () => finalize(runtime, state));
    finalize(runtime, state);
  },
);
