import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, renameSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

import * as integrationSource from '../../src/module-delivery/integration.ts';
import { AgentAttemptParentKind } from '../../src/agent-workflow/domain.ts';
import {
  REQUIRED_PARENT_OWNED_RESOURCES,
  ModuleDeliveryBaselineKind,
  ModuleDeliveryJoinKind,
  ModuleDeliveryProviderSubmissionKind,
  ModuleDeliveryEvidenceVerdict,
  ModuleDeliveryTaskKind,
  ModuleDeliveryValidationStatus,
  ModuleDeliveryWorkspaceKind,
  ModuleIntegrationPhase,
  TeamKey,
  cleanupModuleIntegration,
  cleanupModuleWorktree,
  createModuleDeliveryAdmissionState,
  createModuleDeliveryGenerationAuthority,
  decodeAndValidateModuleDeliveryPlan,
  finalizeModuleDeliveryIntegration,
  integrateVerifiedModuleDeliveryTask,
  prepareModuleIntegration,
  prepareModuleWorktree,
  recordModuleDeliveryAttemptLeases,
  restartModuleDeliveryGeneration,
  selectModuleDeliveryAdmissions,
} from '../../src/module-delivery/index.ts';
import {
  createGitFixture,
  disposeGitFixture,
  evidenceSubmission,
  fixtureGit,
  invalidEvidenceCases,
  writeFixtureFile,
  worktreeFileWriter,
  worktreeGit,
} from './worktree-test-support.ts';
import type {
  ValidatedModuleDeliveryPlan,
  CleanupModuleWorktreeRequest,
  CleanupModuleIntegrationRequest,
  CreateModuleDeliveryAdmissionStateRequest,
  CreateModuleDeliveryGenerationAuthorityRequest,
  FinalizeModuleDeliveryIntegrationRequest,
  IntegrateVerifiedModuleDeliveryTaskRequest,
  ModuleDeliveryBaseline,
  ModuleDeliveryEdgeContract,
  ModuleDeliveryHandoffSubmission,
  ModuleDeliveryAttemptLease,
  ModuleDeliveryGenerationAuthority,
  ModuleDeliveryLeaseRecording,
  ModuleDeliveryReadOnlyEvidenceSubmission,
  ModuleDeliveryWriteProviderSubmission,
  ModuleDeliveryNodeV2,
  ModuleDeliveryPlan,
  ModuleIntegrationState,
  ModuleWorktreeHandle,
  PrepareModuleIntegrationRequest,
  PrepareModuleWorktreeRequest,
  RecordModuleDeliveryAttemptLeasesRequest,
  RestartModuleDeliveryGenerationRequest,
  SelectModuleDeliveryAdmissionsRequest,
  ModuleDeliveryReadOnlyNodeV2,
  ModuleDeliveryWriteNodeV2,
} from '../../src/module-delivery/index.ts';
import type {
  EvidenceFixtureInput,
  GitFixture,
} from './worktree-test-support.ts';
const CORE_ROOT = 'nook-app/nook-platform/nook-core';
const PARENT_RESOURCES: readonly string[] = REQUIRED_PARENT_OWNED_RESOURCES;
type WriteNodeInput = {
  readonly taskId: string;
  readonly sourceCommit: string;
  readonly dependencies: readonly string[];
  readonly writeClaims: readonly string[];
  readonly readClaims: readonly string[];
};
type ReadOnlyNodeInput = {
  readonly taskId: string;
  readonly sourceCommit: string;
};
type PlanInput = {
  readonly sourceCommit: string;
  readonly nodes: readonly ModuleDeliveryNodeV2[];
  readonly edges: readonly ModuleDeliveryEdgeContract[];
};
type EdgeInput = {
  readonly providerTaskId: string;
  readonly consumerTaskId: string;
};
type WriterPreparation = {
  readonly fixture: GitFixture;
  readonly acceptedPlan: ValidatedModuleDeliveryPlan;
  readonly node: ModuleDeliveryWriteNodeV2;
  readonly baselineCommit: string;
};
type WriterCommit = {
  readonly workspace: ModuleWorktreeHandle;
  readonly relativePath: string;
  readonly contents: string;
};
type WaveIntegration = {
  readonly acceptedPlan: ValidatedModuleDeliveryPlan;
  readonly state: ModuleIntegrationState;
  readonly handoffs: readonly ModuleDeliveryHandoffSubmission[];
};
type IndependentWriterInput = {
  readonly taskId: string;
  readonly sourceCommit: string;
  readonly writeClaim: string;
};
enum FixtureLifecycleKind {
  Empty = 'empty',
  Active = 'active',
}
type FixtureLifecycle =
  | { readonly kind: FixtureLifecycleKind.Empty }
  | {
      readonly kind: FixtureLifecycleKind.Active;
      readonly fixture: GitFixture;
    };
let fixtureLifecycle: FixtureLifecycle = { kind: FixtureLifecycleKind.Empty };
const fixtures: GitFixture[] = [];
const workspaces: ModuleWorktreeHandle[] = [];
const authorities = new WeakMap<
  ModuleIntegrationState,
  ModuleDeliveryGenerationAuthority
>();
afterEach(() => {
  for (const workspace of workspaces.splice(0).reverse()) {
    const request: CleanupModuleWorktreeRequest = { workspace };
    try {
      cleanupModuleWorktree(request);
    } catch {
      continue;
    }
  }
  for (const trackedFixture of fixtures.splice(0).reverse()) {
    disposeGitFixture(trackedFixture);
  }
  fixtureLifecycle = { kind: FixtureLifecycleKind.Empty };
});
function createTrackedFixture(): GitFixture {
  const trackedFixture = createGitFixture();
  fixtures.push(trackedFixture);
  fixtureLifecycle = {
    kind: FixtureLifecycleKind.Active,
    fixture: trackedFixture,
  };
  return trackedFixture;
}
function currentFixture(): GitFixture {
  if (fixtureLifecycle.kind === FixtureLifecycleKind.Empty)
    throw new Error('Fixture lifecycle is empty.');
  return fixtureLifecycle.fixture;
}
function baseline(input: WriteNodeInput): ModuleDeliveryBaseline {
  return input.dependencies.length === 0
    ? {
        kind: ModuleDeliveryBaselineKind.SourceCommit,
        sourceCommit: input.sourceCommit,
      }
    : {
        kind: ModuleDeliveryBaselineKind.IntegratedDependencies,
        providerTaskIds: input.dependencies,
      };
}
function writeNode(input: WriteNodeInput): ModuleDeliveryWriteNodeV2 {
  return {
    kind: ModuleDeliveryTaskKind.Write,
    taskId: input.taskId,
    team: TeamKey.DevelopmentCore,
    functionalOwner: TeamKey.Ai,
    acceptanceOwner: TeamKey.Ai,
    parentLineage: { kind: AgentAttemptParentKind.WorkflowRoot },
    expert: 'core_expert',
    moduleRoot: CORE_ROOT,
    consumerOutcome: `${input.taskId} publishes a tested capability.`,
    baseline: baseline(input),
    agentDepthLimit: 2,
    dependencies: input.dependencies,
    resources: {
      read: input.readClaims,
      write: input.writeClaims,
      evidenceSurface: [],
    },
    parentOwnedExclusions: PARENT_RESOURCES,
    acceptance: {
      commands: [`task ${input.taskId}:test`],
      evidence: [`${input.taskId} passed`],
    },
    workspace: {
      kind: ModuleDeliveryWorkspaceKind.IsolatedWorktree,
      expectedCommitHandoff: true,
    },
  };
}
function readOnlyNode(input: ReadOnlyNodeInput): ModuleDeliveryReadOnlyNodeV2 {
  return {
    kind: ModuleDeliveryTaskKind.ReadOnly,
    taskId: input.taskId,
    team: TeamKey.DevelopmentCore,
    functionalOwner: TeamKey.Ai,
    acceptanceOwner: TeamKey.Ai,
    parentLineage: { kind: AgentAttemptParentKind.WorkflowRoot },
    expert: 'core_expert',
    moduleRoot: CORE_ROOT,
    consumerOutcome: `${input.taskId} reports evidence.`,
    baseline: {
      kind: ModuleDeliveryBaselineKind.SourceCommit,
      sourceCommit: input.sourceCommit,
    },
    agentDepthLimit: 2,
    dependencies: [],
    resources: {
      read: [`${CORE_ROOT}/**`],
      write: [],
      evidenceSurface: [`${CORE_ROOT}/**`],
    },
    parentOwnedExclusions: PARENT_RESOURCES,
    acceptance: {
      commands: [`task ${input.taskId}:audit`],
      evidence: [`${input.taskId} completed`],
    },
  };
}
function edge(input: EdgeInput): ModuleDeliveryEdgeContract {
  return {
    providerTaskId: input.providerTaskId,
    consumerTaskId: input.consumerTaskId,
    capability: `${input.providerTaskId} capability`,
    publicTypes: [`${input.providerTaskId}Result`],
    errors: [`${input.providerTaskId}Error`],
    behaviorInvariants: ['The contract is deterministic.'],
    securityInvariants: ['The provider retains protected state.'],
    compatibilityExpectations: ['The consumer accepts the provider result.'],
    owningTests: [`${input.providerTaskId} contract test`],
  };
}
function acceptedPlan(input: PlanInput): ValidatedModuleDeliveryPlan {
  const plan: ModuleDeliveryPlan = {
    version: 2,
    generation: 1,
    sourceCommit: input.sourceCommit,
    maxConcurrency: 3,
    maxAgentDepth: 3,
    maxAttempts: 2,
    parentOwnedResources: PARENT_RESOURCES,
    parentJoin: {
      kind: ModuleDeliveryJoinKind.OrderedCommitHandoffs,
      owner: 'delivery-owner',
      validationCommands: ['task integration:test'],
    },
    nodes: input.nodes,
    edgeContracts: input.edges,
  };
  const validation = decodeAndValidateModuleDeliveryPlan(JSON.stringify(plan));
  if (validation.status !== ModuleDeliveryValidationStatus.Accepted) {
    throw new Error(JSON.stringify(validation.issues));
  }
  return validation;
}
function readOnlyPlan(fixture: GitFixture) {
  const readInput: ReadOnlyNodeInput = {
    taskId: 'core-audit',
    sourceCommit: fixture.baselineCommit,
  };
  const audit = readOnlyNode(readInput);
  const planInput: PlanInput = {
    sourceCommit: fixture.baselineCommit,
    nodes: [audit],
    edges: [],
  };
  return { accepted: acceptedPlan(planInput), audit };
}
function preparedIntegration(
  accepted: ValidatedModuleDeliveryPlan,
): ModuleIntegrationState {
  const fixture = currentFixture();
  const authorityRequest: CreateModuleDeliveryGenerationAuthorityRequest = {
    acceptedPlan: accepted,
    repositoryRoot: fixture.sourceRoot,
    expectedLineage: accepted.plan.nodes.map(({ taskId, parentLineage }) => ({
      taskId,
      parentLineage,
    })),
  };
  const authority = createModuleDeliveryGenerationAuthority(authorityRequest);
  const stateRequest: CreateModuleDeliveryAdmissionStateRequest = {
    authority,
    acceptedPlan: accepted,
    headCommit: accepted.plan.sourceCommit,
    integratedWriterFrontiers: [],
    acceptedEvidence: [],
  };
  const admissionState = createModuleDeliveryAdmissionState(stateRequest);
  const request: PrepareModuleIntegrationRequest = {
    authority,
    repositoryRoot: fixture.sourceRoot,
    workspaceRoot: fixture.workspaceRoot,
    acceptedPlan: accepted,
    admissionState,
  };
  const state = prepareModuleIntegration(request);
  authorities.set(state, authority);
  workspaces.push(state.workspace);
  return state;
}
function preparedWriter(preparation: WriterPreparation): ModuleWorktreeHandle {
  const request: PrepareModuleWorktreeRequest = {
    repositoryRoot: preparation.fixture.sourceRoot,
    workspaceRoot: preparation.fixture.workspaceRoot,
    planDigest: preparation.acceptedPlan.planDigest,
    taskId: preparation.node.taskId,
    attempt: 1,
    baselineCommit: preparation.baselineCommit,
  };
  const workspace = prepareModuleWorktree(request);
  workspaces.push(workspace);
  return workspace;
}
function commitWriter(commit: WriterCommit): ModuleDeliveryHandoffSubmission {
  const write = worktreeFileWriter(commit.workspace);
  write([commit.relativePath, commit.contents]);
  const git = worktreeGit(commit.workspace);
  git(['add', '--all']);
  git(['commit', '--quiet', '-m', `write ${commit.relativePath}`]);
  return {
    taskId: commit.workspace.taskId,
    attempt: commit.workspace.attempt,
    planDigest: commit.workspace.planDigest,
    baselineCommit: commit.workspace.baselineCommit,
    commit: git(['rev-parse', 'HEAD']),
    workspace: commit.workspace,
  };
}
type LeaseLookup = {
  readonly recording: ModuleDeliveryLeaseRecording;
  readonly taskId: string;
};
function authorityFor(
  state: ModuleIntegrationState,
): ModuleDeliveryGenerationAuthority {
  const authority = authorities.get(state);
  if (!authority) throw new Error('Fixture integration authority is missing.');
  return authority;
}
function leaseFor(input: LeaseLookup): ModuleDeliveryAttemptLease {
  const lease = input.recording.leases.find(
    (candidate) => candidate.taskId === input.taskId,
  );
  if (!lease) throw new Error(`Fixture lease ${input.taskId} is missing.`);
  return lease;
}
function recordingFor(
  integration: WaveIntegration,
): ModuleDeliveryLeaseRecording {
  const authority = authorityFor(integration.state);
  const admissionState = integration.state.admissionState;
  const selectRequest: SelectModuleDeliveryAdmissionsRequest = {
    authority,
    acceptedPlan: integration.acceptedPlan,
    state: admissionState,
  };
  const selection = selectModuleDeliveryAdmissions(selectRequest);
  const admissions =
    integration.handoffs.length === 0
      ? selection.admissions
      : integration.handoffs.flatMap(({ taskId }) =>
          selection.admissions.filter((entry) => entry.taskId === taskId),
        );
  if (admissions.length === 0)
    throw new Error('Fixture providers are not authoritatively ready.');
  const leaseRequest: RecordModuleDeliveryAttemptLeasesRequest = {
    authority,
    state: admissionState,
    admissions,
  };
  return recordModuleDeliveryAttemptLeases(leaseRequest);
}
function integrateRequest(
  request: IntegrateVerifiedModuleDeliveryTaskRequest,
): ModuleIntegrationState {
  const state = integrateVerifiedModuleDeliveryTask(request);
  authorities.set(state, request.authority);
  return state;
}
function integrateWave(integration: WaveIntegration): ModuleIntegrationState {
  const recording = recordingFor(integration);
  let state = integration.state;
  for (const lease of recording.leases) {
    const node = integration.acceptedPlan.plan.nodes.find(
      ({ taskId }) => taskId === lease.taskId,
    );
    if (!node) throw new Error(`Missing fixture task ${lease.taskId}.`);
    const handoff = integration.handoffs.find(
      ({ taskId }) => taskId === lease.taskId,
    );
    let submission:
      | ModuleDeliveryReadOnlyEvidenceSubmission
      | ModuleDeliveryWriteProviderSubmission;
    if (node.kind === ModuleDeliveryTaskKind.Write) {
      if (!handoff) throw new Error('Write integration requires a handoff.');
      submission = {
        kind: ModuleDeliveryProviderSubmissionKind.Write,
        generation: integration.acceptedPlan.plan.generation,
        acceptedByTeam: node.acceptanceOwner,
        verdict: ModuleDeliveryEvidenceVerdict.TerminalSuccess,
        handoff,
      };
    } else {
      const evidenceInput: EvidenceFixtureInput = { state, node, lease };
      submission = evidenceSubmission(evidenceInput);
    }
    const request: IntegrateVerifiedModuleDeliveryTaskRequest = {
      authority: authorityFor(state),
      acceptedPlan: integration.acceptedPlan,
      lease,
      state,
      submission,
    };
    state = integrateRequest(request);
  }
  return state;
}
function independentWriter(
  input: IndependentWriterInput,
): ModuleDeliveryWriteNodeV2 {
  const writeInput: WriteNodeInput = {
    taskId: input.taskId,
    sourceCommit: input.sourceCommit,
    dependencies: [],
    readClaims: [input.writeClaim],
    writeClaims: [input.writeClaim],
  };
  return writeNode(writeInput);
}
describe('module delivery wave integration', () => {
  test('integrates a complete wave in accepted topology order without touching source', () => {
    expect('mintIntegratedWriterFrontier' in integrationSource).toBe(false);
    expect('canonicalEvidenceTransition' in integrationSource).toBe(false);
    const fixture = createTrackedFixture();
    const alphaClaim = `${CORE_ROOT}/alpha/**`;
    const betaClaim = `${CORE_ROOT}/beta/**`;
    const alphaInput: IndependentWriterInput = {
      taskId: 'alpha-provider',
      sourceCommit: fixture.baselineCommit,
      writeClaim: alphaClaim,
    };
    const alpha = independentWriter(alphaInput);
    const betaInput: IndependentWriterInput = {
      taskId: 'beta-provider',
      sourceCommit: fixture.baselineCommit,
      writeClaim: betaClaim,
    };
    const beta = independentWriter(betaInput);
    const planInput: PlanInput = {
      sourceCommit: fixture.baselineCommit,
      nodes: [beta, alpha],
      edges: [],
    };
    const accepted = acceptedPlan(planInput);
    const sourceGit = fixtureGit(fixture);
    const sourceHead = sourceGit(['rev-parse', 'HEAD']);
    const state = preparedIntegration(accepted);
    const repeatedState = preparedIntegration(accepted);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.workspace)).toBe(true);

    const alphaPreparation: WriterPreparation = {
      fixture,
      acceptedPlan: accepted,
      node: alpha,
      baselineCommit: fixture.baselineCommit,
    };
    const alphaWorkspace = preparedWriter(alphaPreparation);
    const betaPreparation: WriterPreparation = {
      fixture,
      acceptedPlan: accepted,
      node: beta,
      baselineCommit: fixture.baselineCommit,
    };
    const betaWorkspace = preparedWriter(betaPreparation);
    const alphaCommit: WriterCommit = {
      workspace: alphaWorkspace,
      relativePath: `${CORE_ROOT}/alpha/value.ts`,
      contents: 'alpha\n',
    };
    const betaCommit: WriterCommit = {
      workspace: betaWorkspace,
      relativePath: `${CORE_ROOT}/beta/value.ts`,
      contents: 'beta\n',
    };
    const alphaHandoff = commitWriter(alphaCommit);
    const betaHandoff = commitWriter(betaCommit);
    const integration: WaveIntegration = {
      acceptedPlan: accepted,
      state,
      handoffs: [betaHandoff, alphaHandoff],
    };
    const advanced = integrateWave(integration);
    const repeatedIntegration: WaveIntegration = {
      acceptedPlan: accepted,
      state: repeatedState,
      handoffs: [alphaHandoff, betaHandoff],
    };
    const repeated = integrateWave(repeatedIntegration);

    expect(advanced.completedWaveCount).toBe(1);
    expect(advanced.integratedTaskIds).toEqual([
      'beta-provider',
      'alpha-provider',
    ]);
    expect(advanced.headCommit).not.toBe(state.headCommit);
    const firstFinalization: FinalizeModuleDeliveryIntegrationRequest = {
      authority: authorityFor(advanced),
      acceptedPlan: accepted,
      state: advanced,
    };
    const repeatedFinalization: FinalizeModuleDeliveryIntegrationRequest = {
      authority: authorityFor(repeated),
      acceptedPlan: accepted,
      state: repeated,
    };
    expect(
      finalizeModuleDeliveryIntegration(firstFinalization).headCommit,
    ).toBe(finalizeModuleDeliveryIntegration(repeatedFinalization).headCommit);
    expect(
      sourceGit(['show', `${advanced.headCommit}:${alphaCommit.relativePath}`]),
    ).toBe('alpha');
    expect(
      sourceGit(['show', `${advanced.headCommit}:${betaCommit.relativePath}`]),
    ).toBe('beta');
    expect(sourceGit(['rev-parse', 'HEAD'])).toBe(sourceHead);
    expect(sourceGit(['status', '--porcelain=v1'])).toBe('');

    expect(() => integrateWave(integration)).toThrow('invalid or stale');
  }, 15_000);

  test('authenticates typed evidence and rejects stale tuples after supersession', () => {
    const fixture = createTrackedFixture();
    const { accepted, audit } = readOnlyPlan(fixture);
    const state = preparedIntegration(accepted);
    const integration: WaveIntegration = {
      acceptedPlan: accepted,
      state,
      handoffs: [],
    };
    const recording = recordingFor(integration);
    const leaseLookup: LeaseLookup = { recording, taskId: audit.taskId };
    const lease = leaseFor(leaseLookup);
    const evidenceInput: EvidenceFixtureInput = { state, node: audit, lease };
    const valid = evidenceSubmission(evidenceInput);
    for (const [submission, error] of invalidEvidenceCases(valid)) {
      const invalidRequest: IntegrateVerifiedModuleDeliveryTaskRequest = {
        authority: authorityFor(state),
        acceptedPlan: accepted,
        lease,
        state,
        submission,
      };
      expect(() => integrateVerifiedModuleDeliveryTask(invalidRequest)).toThrow(
        error,
      );
    }
    const request: IntegrateVerifiedModuleDeliveryTaskRequest = {
      authority: authorityFor(state),
      acceptedPlan: accepted,
      lease,
      state,
      submission: valid,
    };
    const advanced = integrateRequest(request);
    const authority = authorityFor(advanced);
    const finalization: FinalizeModuleDeliveryIntegrationRequest = {
      authority,
      acceptedPlan: accepted,
      state: advanced,
    };
    const finalized = finalizeModuleDeliveryIntegration(finalization);
    expect(finalized.phase).toBe(ModuleIntegrationPhase.Finalized);
    expect(finalized.headCommit).toBe(state.headCommit);
    expect(finalized.acceptedEvidence).toEqual(advanced.acceptedEvidence);
    const nextPlan: ModuleDeliveryPlan = { ...accepted.plan, generation: 2 };
    const next = decodeAndValidateModuleDeliveryPlan(JSON.stringify(nextPlan));
    if (next.status !== ModuleDeliveryValidationStatus.Accepted)
      throw new Error('Superseding evidence plan is invalid.');
    const restart: RestartModuleDeliveryGenerationRequest = {
      authority,
      previousState: finalized.admissionState,
      acceptedPlan: next,
      expectedLineage: next.plan.nodes.map(({ taskId, parentLineage }) => ({
        taskId,
        parentLineage,
      })),
    };
    restartModuleDeliveryGeneration(restart);
    expect(() => integrateVerifiedModuleDeliveryTask(request)).toThrow(
      'superseded',
    );
  });

  test('allows overlapping history only from a frontier carrying predecessor closure', () => {
    const fixture = createTrackedFixture();
    const providerClaim = `${CORE_ROOT}/provider/**`;
    const providerInput: IndependentWriterInput = {
      taskId: 'core-provider',
      sourceCommit: fixture.baselineCommit,
      writeClaim: providerClaim,
    };
    const provider = independentWriter(providerInput);
    const consumerInput: WriteNodeInput = {
      taskId: 'core-consumer',
      sourceCommit: fixture.baselineCommit,
      dependencies: ['core-provider'],
      readClaims: [providerClaim],
      writeClaims: [providerClaim],
    };
    const consumer = writeNode(consumerInput);
    const edgeInput: EdgeInput = {
      providerTaskId: provider.taskId,
      consumerTaskId: consumer.taskId,
    };
    const planInput: PlanInput = {
      sourceCommit: fixture.baselineCommit,
      nodes: [consumer, provider],
      edges: [edge(edgeInput)],
    };
    const accepted = acceptedPlan(planInput);
    const state = preparedIntegration(accepted);
    const staleState = preparedIntegration(accepted);
    const stalePreparation: WriterPreparation = {
      fixture,
      acceptedPlan: accepted,
      node: consumer,
      baselineCommit: staleState.headCommit,
    };
    const staleWorkspace = preparedWriter(stalePreparation);
    const staleCommit: WriterCommit = {
      workspace: staleWorkspace,
      relativePath: `${CORE_ROOT}/provider/stale.ts`,
      contents: 'stale\n',
    };
    const staleHandoff = commitWriter(staleCommit);
    const providerPreparation: WriterPreparation = {
      fixture,
      acceptedPlan: accepted,
      node: provider,
      baselineCommit: state.headCommit,
    };
    const providerWorkspace = preparedWriter(providerPreparation);
    const providerCommit: WriterCommit = {
      workspace: providerWorkspace,
      relativePath: `${CORE_ROOT}/provider/value.ts`,
      contents: 'provider\n',
    };
    const providerHandoff = commitWriter(providerCommit);
    const firstIntegration: WaveIntegration = {
      acceptedPlan: accepted,
      state,
      handoffs: [providerHandoff],
    };
    const providerState = integrateWave(firstIntegration);
    const staleProviderIntegration: WaveIntegration = {
      acceptedPlan: accepted,
      state: staleState,
      handoffs: [providerHandoff],
    };
    const staleProviderState = integrateWave(staleProviderIntegration);
    const staleConsumerIntegration: WaveIntegration = {
      acceptedPlan: accepted,
      state: staleProviderState,
      handoffs: [staleHandoff],
    };
    expect(() => integrateWave(staleConsumerIntegration)).toThrow(
      'Handoff metadata is invalid',
    );

    const consumerPreparation: WriterPreparation = {
      fixture,
      acceptedPlan: accepted,
      node: consumer,
      baselineCommit: providerState.headCommit,
    };
    const consumerWorkspace = preparedWriter(consumerPreparation);
    const consumerCommit: WriterCommit = {
      workspace: consumerWorkspace,
      relativePath: `${CORE_ROOT}/provider/consumer.ts`,
      contents: 'consumer\n',
    };
    const consumerHandoff = commitWriter(consumerCommit);
    const secondIntegration: WaveIntegration = {
      acceptedPlan: accepted,
      state: providerState,
      handoffs: [consumerHandoff],
    };
    const completed = integrateWave(secondIntegration);
    expect(completed.completedWaveCount).toBe(2);
    expect(completed.integratedTaskIds).toEqual([
      'core-provider',
      'core-consumer',
    ]);
  });

  test('rejects incomplete and forged handoff sets before mutation', () => {
    const fixture = createTrackedFixture();
    const claim = `${CORE_ROOT}/feature/**`;
    const writerInput: IndependentWriterInput = {
      taskId: 'core-provider',
      sourceCommit: fixture.baselineCommit,
      writeClaim: claim,
    };
    const writer = independentWriter(writerInput);
    const planInput: PlanInput = {
      sourceCommit: fixture.baselineCommit,
      nodes: [writer],
      edges: [],
    };
    const accepted = acceptedPlan(planInput);
    const state = preparedIntegration(accepted);
    const missing: WaveIntegration = {
      acceptedPlan: accepted,
      state,
      handoffs: [],
    };
    expect(() => integrateWave(missing)).toThrow('requires a handoff');
    expect(worktreeGit(state.workspace)(['rev-parse', 'HEAD'])).toBe(
      state.headCommit,
    );

    const preparation: WriterPreparation = {
      fixture,
      acceptedPlan: accepted,
      node: writer,
      baselineCommit: state.headCommit,
    };
    const writerWorkspace = preparedWriter(preparation);
    const commit: WriterCommit = {
      workspace: writerWorkspace,
      relativePath: `${CORE_ROOT}/feature/value.ts`,
      contents: 'value\n',
    };
    const valid = commitWriter(commit);
    const forged: ModuleDeliveryHandoffSubmission = {
      ...valid,
      commit: fixture.baselineCommit,
    };
    const forgedState = preparedIntegration(accepted);
    const forgedIntegration: WaveIntegration = {
      acceptedPlan: accepted,
      state: forgedState,
      handoffs: [forged],
    };
    expect(() => integrateWave(forgedIntegration)).toThrow('Raw handoff');
    expect(worktreeGit(state.workspace)(['rev-parse', 'HEAD'])).toBe(
      state.headCommit,
    );
  });

  test('rejects worker filter controls without executing the configured canary', () => {
    const fixture = createTrackedFixture();
    const marker = join(fixture.root, 'filter-canary');
    const sourceGit = fixtureGit(fixture);
    sourceGit(['config', 'filter.fail.smudge', `touch ${marker}; cat`]);
    sourceGit(['config', 'filter.fail.required', 'true']);
    const attributesPath = `${CORE_ROOT}/.gitattributes`;
    const attributesInput: IndependentWriterInput = {
      taskId: 'attributes-writer',
      sourceCommit: fixture.baselineCommit,
      writeClaim: attributesPath,
    };
    const attributesWriter = independentWriter(attributesInput);
    const valuePath = `${CORE_ROOT}/value.ts`;
    const valueInput: IndependentWriterInput = {
      taskId: 'value-writer',
      sourceCommit: fixture.baselineCommit,
      writeClaim: valuePath,
    };
    const valueWriter = independentWriter(valueInput);
    const planInput: PlanInput = {
      sourceCommit: fixture.baselineCommit,
      nodes: [valueWriter, attributesWriter],
      edges: [],
    };
    const accepted = acceptedPlan(planInput);
    const state = preparedIntegration(accepted);
    const attributesPreparation: WriterPreparation = {
      fixture,
      acceptedPlan: accepted,
      node: attributesWriter,
      baselineCommit: state.headCommit,
    };
    const valuePreparation: WriterPreparation = {
      fixture,
      acceptedPlan: accepted,
      node: valueWriter,
      baselineCommit: state.headCommit,
    };
    const attributesWorkspace = preparedWriter(attributesPreparation);
    const valueWorkspace = preparedWriter(valuePreparation);
    const attributesCommit: WriterCommit = {
      workspace: attributesWorkspace,
      relativePath: attributesPath,
      contents: '*.ts filter=fail\n',
    };
    const valueCommit: WriterCommit = {
      workspace: valueWorkspace,
      relativePath: valuePath,
      contents: 'value\n',
    };
    const attributesHandoff = commitWriter(attributesCommit);
    const valueHandoff = commitWriter(valueCommit);
    const integration: WaveIntegration = {
      acceptedPlan: accepted,
      state,
      handoffs: [valueHandoff, attributesHandoff],
    };
    expect(() => integrateWave(integration)).toThrow('materialization control');
    expect(worktreeGit(state.workspace)(['rev-parse', 'HEAD'])).toBe(
      state.headCommit,
    );
    expect(worktreeGit(state.workspace)(['status', '--porcelain=v1'])).toBe('');
    expect(existsSync(join(state.workspace.worktreePath, attributesPath))).toBe(
      false,
    );
    expect(existsSync(join(state.workspace.worktreePath, valuePath))).toBe(
      false,
    );
    expect(existsSync(marker)).toBe(false);
  });

  test('rejects source byte, ref, and config drift after preparation', () => {
    const fixture = createTrackedFixture();
    const { accepted } = readOnlyPlan(fixture);
    const state = preparedIntegration(accepted);
    const sourceWrite = {
      fixture,
      relativePath: 'module/seed.txt',
      contents: 'mutated source bytes\n',
    } as const;
    writeFixtureFile(sourceWrite);
    const sourceGit = fixtureGit(fixture);
    sourceGit(['branch', 'source-drift', 'HEAD']);
    sourceGit(['config', 'nook.test-drift', 'true']);
    const integration: WaveIntegration = {
      acceptedPlan: accepted,
      state,
      handoffs: [],
    };
    expect(() => integrateWave(integration)).toThrow(
      'Source repository changed',
    );
  });

  test('rejects drift in a custom ref outside the private integration namespace', () => {
    const fixture = createTrackedFixture();
    const { accepted } = readOnlyPlan(fixture);
    const state = preparedIntegration(accepted);
    fixtureGit(fixture)([
      'update-ref',
      'refs/custom/module-delivery-drift',
      'HEAD',
    ]);
    const integration: WaveIntegration = {
      acceptedPlan: accepted,
      state,
      handoffs: [],
    };
    expect(() => integrateWave(integration)).toThrow(
      'Source repository changed',
    );
  });

  test('rejects a custom symbolic ref retargeted between equal commits', () => {
    const fixture = createTrackedFixture();
    const sourceGit = fixtureGit(fixture);
    sourceGit(['branch', 'symbolic-a', 'HEAD']);
    sourceGit(['branch', 'symbolic-b', 'HEAD']);
    sourceGit([
      'symbolic-ref',
      'refs/custom/module-pointer',
      'refs/heads/symbolic-a',
    ]);
    const { accepted } = readOnlyPlan(fixture);
    const state = preparedIntegration(accepted);
    sourceGit([
      'symbolic-ref',
      'refs/custom/module-pointer',
      'refs/heads/symbolic-b',
    ]);
    expect(sourceGit(['rev-parse', 'refs/heads/symbolic-a'])).toBe(
      sourceGit(['rev-parse', 'refs/heads/symbolic-b']),
    );
    const integration: WaveIntegration = {
      acceptedPlan: accepted,
      state,
      handoffs: [],
    };
    expect(() => integrateWave(integration)).toThrow(
      'Source repository changed',
    );
  });

  test('rejects source mode drift at a metadata-only checkpoint', () => {
    const fixture = createTrackedFixture();
    const { accepted } = readOnlyPlan(fixture);
    const state = preparedIntegration(accepted);
    chmodSync(join(fixture.sourceRoot, 'module/seed.txt'), 0o755);
    const integration: WaveIntegration = {
      acceptedPlan: accepted,
      state,
      handoffs: [],
    };
    expect(() => integrateWave(integration)).toThrow(
      'Source repository changed',
    );
  });

  test('rejects an intermediate symlink before preparing integration', () => {
    const fixture = createTrackedFixture();
    const modulePath = join(fixture.sourceRoot, 'module');
    const realModulePath = join(fixture.sourceRoot, 'module-real');
    renameSync(modulePath, realModulePath);
    symlinkSync('module-real', modulePath);
    const { accepted } = readOnlyPlan(fixture);
    expect(() => preparedIntegration(accepted)).toThrow('symlink ancestor');
  });

  test('rejects an unauthorized integration-worktree commit', () => {
    const fixture = createTrackedFixture();
    const { accepted } = readOnlyPlan(fixture);
    const state = preparedIntegration(accepted);
    const sourceGit = fixtureGit(fixture);
    expect(
      sourceGit(['for-each-ref', '--format=%(refname)', 'refs/nook']),
    ).toContain('refs/nook/module-delivery/');

    const write = worktreeFileWriter(state.workspace);
    write(['module/unauthorized.txt', 'unauthorized\n']);
    const integrationGit = worktreeGit(state.workspace);
    integrationGit(['add', '--all']);
    integrationGit(['commit', '--quiet', '-m', 'unauthorized']);
    const integration: WaveIntegration = {
      acceptedPlan: accepted,
      state,
      handoffs: [],
    };
    expect(() => integrateWave(integration)).toThrow('without authority');
  });

  test('cleans the latest session through the original stable handle exactly once', () => {
    const fixture = createTrackedFixture();
    const { accepted } = readOnlyPlan(fixture);
    const original = preparedIntegration(accepted);
    const integration: WaveIntegration = {
      acceptedPlan: accepted,
      state: original,
      handoffs: [],
    };
    integrateWave(integration);
    const sourceGit = fixtureGit(fixture);
    expect(
      sourceGit(['for-each-ref', '--format=%(refname)', 'refs/nook']),
    ).toContain('refs/nook/module-delivery/');

    const cleanupRequest: CleanupModuleIntegrationRequest = {
      cleanupHandle: original.cleanupHandle,
    };
    const removedResult = { removed: true } as const;
    const alreadyRemovedResult = { removed: false } as const;
    expect(cleanupModuleIntegration(cleanupRequest)).toEqual(removedResult);
    expect(cleanupModuleIntegration(cleanupRequest)).toEqual(
      alreadyRemovedResult,
    );
    expect(
      sourceGit(['for-each-ref', '--format=%(refname)', 'refs/nook']),
    ).toBe('');
  });
});
