import { afterEach, describe, expect, test } from 'bun:test';
import { AgentAttemptParentKind } from '../../src/agent-workflow/domain.ts';

import {
  REQUIRED_PARENT_OWNED_RESOURCES,
  ModuleDeliveryBaselineKind,
  ModuleDeliveryJoinKind,
  ModuleDeliveryProviderSubmissionKind,
  ModuleDeliveryEvidenceVerdict,
  ModuleDeliveryEvidenceInputSchema,
  ModuleDeliveryTaskKind,
  ModuleDeliveryValidationStatus,
  ModuleDeliveryWorkspaceKind,
  TeamKey,
  cleanupModuleIntegration,
  cleanupModuleWorktree,
  createModuleDeliveryAdmissionState,
  createModuleDeliveryGenerationAuthority,
  decodeAndValidateModuleDeliveryPlan,
  integrateVerifiedModuleDeliveryTask,
  prepareModuleIntegration,
  prepareModuleWorktree,
  recordModuleDeliveryAttemptLeases,
  selectModuleDeliveryAdmissions,
  verifyModuleCommitHandoff,
} from '../../src/module-delivery/index.ts';
import {
  createGitFixture,
  disposeGitFixture,
  fixtureGit,
  evidenceSubmission,
  worktreeFileWriter,
  worktreeGit,
} from './worktree-test-support.ts';

import type {
  ValidatedModuleDeliveryPlan,
  CleanupModuleIntegrationRequest,
  CleanupModuleWorktreeRequest,
  CreateModuleDeliveryAdmissionStateRequest,
  CreateModuleDeliveryGenerationAuthorityRequest,
  IntegrateVerifiedModuleDeliveryTaskRequest,
  ModuleDeliveryBaseline,
  ModuleDeliveryEdgeContract,
  ModuleDeliveryEvidenceSynthesisNodeV2,
  ModuleDeliveryHandoffSubmission,
  ModuleDeliveryWriteProviderSubmission,
  ModuleDeliveryReadOnlyNodeV2,
  ModuleDeliveryPlan,
  ModuleDeliveryGenerationAuthority,
  ModuleIntegrationCleanupHandle,
  ModuleIntegrationState,
  ModuleWorktreeHandle,
  PrepareModuleIntegrationRequest,
  PrepareModuleWorktreeRequest,
  RecordModuleDeliveryAttemptLeasesRequest,
  SelectModuleDeliveryAdmissionsRequest,
  VerifyModuleCommitHandoffRequest,
  ModuleDeliveryWriteNodeV2,
} from '../../src/module-delivery/index.ts';
import type {
  EvidenceFixtureInput,
  GitFixture,
} from './worktree-test-support.ts';

const CORE_ROOT = 'nook-app/nook-platform/nook-core';
const WASM_MODULE_ROOT = 'nook-app/nook-platform/nook-wasm';
const WASM_ROOT = `${WASM_MODULE_ROOT}/nook-core-wasm`;
const WEB_ROOT = 'nook-app/nook-web/nook-web-shared';
const CORE_OUTPUT = `${CORE_ROOT}/src/module_delivery_pilot.rs`;
const WASM_OUTPUT = `${WASM_ROOT}/src/module_delivery_pilot.rs`;
const WEB_OUTPUT = `${WEB_ROOT}/src/module-delivery-pilot.ts`;
const CORE_CONTENT = 'pub struct PilotCoreCapability;\n';
const WASM_CONTENT = 'pub struct PilotWasmAdapter;\n';
const WEB_CONTENT = 'export const pilotWebConsumer = true;\n';
const PARENT_RESOURCES: readonly string[] = [
  ...REQUIRED_PARENT_OWNED_RESOURCES,
];

type PilotNodeInput = {
  readonly taskId: string;
  readonly expert: string;
  readonly moduleRoot: string;
  readonly sourceCommit: string;
  readonly dependencies: readonly string[];
  readonly readClaims: readonly string[];
  readonly writeClaim: string;
};

type PilotEdgeInput = {
  readonly providerTaskId: string;
  readonly consumerTaskId: string;
  readonly capability: string;
};
type EvidenceNodeRequest = Readonly<{
  taskId: string;
  dependency: string;
}>;
type IntegrateEvidenceRequest = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  acceptedPlan: ValidatedModuleDeliveryPlan;
  state: ModuleIntegrationState;
  node: ModuleDeliveryReadOnlyNodeV2 | ModuleDeliveryEvidenceSynthesisNodeV2;
}>;

type WriterRequest = {
  readonly fixture: GitFixture;
  readonly acceptedPlan: ValidatedModuleDeliveryPlan;
  readonly node: ModuleDeliveryWriteNodeV2;
  readonly baselineCommit: string;
};

type WriterCommitRequest = {
  readonly workspace: ModuleWorktreeHandle;
  readonly outputPath: string;
  readonly contents: string;
  readonly message: string;
};

type IntegrateRequest = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly acceptedPlan: ValidatedModuleDeliveryPlan;
  readonly state: ModuleIntegrationState;
  readonly workspace: ModuleWorktreeHandle;
  readonly node: ModuleDeliveryWriteNodeV2;
};

type SourceProof = {
  readonly head: string;
  readonly indexHash: string;
  readonly status: string;
  readonly refs: string;
};

type SourceCommitInput = {
  readonly sourceCommit: string;
};

type FixtureInput = {
  readonly fixture: GitFixture;
};

type PlanNodeInput = {
  readonly plan: ValidatedModuleDeliveryPlan;
  readonly taskId: string;
};

const fixtures: GitFixture[] = [];
const integrationCleanups: ModuleIntegrationCleanupHandle[] = [];
const writerWorkspaces: ModuleWorktreeHandle[] = [];

function cleanupWriters(): void {
  for (const workspace of writerWorkspaces.splice(0).reverse()) {
    const request: CleanupModuleWorktreeRequest = { workspace };
    cleanupModuleWorktree(request);
  }
}

afterEach(() => {
  try {
    cleanupWriters();
    for (const cleanupHandle of integrationCleanups.splice(0).reverse()) {
      const request: CleanupModuleIntegrationRequest = {
        cleanupHandle,
      };
      cleanupModuleIntegration(request);
    }
  } finally {
    for (const trackedFixture of fixtures.splice(0).reverse()) {
      disposeGitFixture(trackedFixture);
    }
  }
});

function forgetIntegrationCleanup(
  request: CleanupModuleIntegrationRequest,
): void {
  const cleanupIndex = integrationCleanups.indexOf(request.cleanupHandle);
  if (cleanupIndex >= 0) integrationCleanups.splice(cleanupIndex, 1);
}

function nodeBaseline(input: PilotNodeInput): ModuleDeliveryBaseline {
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

function pilotNode(input: PilotNodeInput): ModuleDeliveryWriteNodeV2 {
  return {
    kind: ModuleDeliveryTaskKind.Write,
    taskId: input.taskId,
    team:
      input.expert === 'web_expert'
        ? TeamKey.WebDevelopment
        : TeamKey.DevelopmentCore,
    functionalOwner: TeamKey.Ai,
    acceptanceOwner: TeamKey.Ai,
    parentLineage: { kind: AgentAttemptParentKind.WorkflowRoot },
    expert: input.expert,
    moduleRoot: input.moduleRoot,
    consumerOutcome: `${input.taskId} publishes its layer contract.`,
    baseline: nodeBaseline(input),
    agentDepthLimit: 1,
    dependencies: input.dependencies,
    resources: {
      read: input.readClaims,
      write: [input.writeClaim],
      evidenceSurface: [],
    },
    parentOwnedExclusions: PARENT_RESOURCES,
    acceptance: {
      commands: [`task ${input.taskId}:test`],
      evidence: [`${input.taskId} contract is verified`],
    },
    workspace: {
      kind: ModuleDeliveryWorkspaceKind.IsolatedWorktree,
      expectedCommitHandoff: true,
    },
  };
}

function evidenceNode(
  request: EvidenceNodeRequest,
): ModuleDeliveryReadOnlyNodeV2 {
  const { taskId, dependency } = request;
  return {
    kind: ModuleDeliveryTaskKind.ReadOnly,
    taskId,
    team: TeamKey.DevelopmentCore,
    functionalOwner: TeamKey.Ai,
    acceptanceOwner: TeamKey.Ai,
    parentLineage: { kind: AgentAttemptParentKind.WorkflowRoot },
    expert: 'core_expert',
    moduleRoot: CORE_ROOT,
    consumerOutcome: 'Runtime evidence is accepted.',
    baseline: {
      kind: ModuleDeliveryBaselineKind.IntegratedDependencies,
      providerTaskIds: [dependency],
    },
    agentDepthLimit: 1,
    dependencies: [dependency],
    resources: { read: [CORE_ROOT], write: [], evidenceSurface: [CORE_ROOT] },
    parentOwnedExclusions: PARENT_RESOURCES,
    acceptance: {
      commands: ['task runtime:evidence'],
      evidence: [`${taskId} completed`],
    },
  };
}

function synthesisNode(
  provider: ModuleDeliveryReadOnlyNodeV2,
): ModuleDeliveryEvidenceSynthesisNodeV2 {
  return {
    ...provider,
    kind: ModuleDeliveryTaskKind.EvidenceSynthesis,
    taskId: 'evidence-synthesis',
    dependencies: [provider.taskId],
    baseline: {
      kind: ModuleDeliveryBaselineKind.IntegratedDependencies,
      providerTaskIds: [provider.taskId],
    },
    resources: { read: [], write: [], evidenceSurface: [] },
    evidenceInput: {
      schema: ModuleDeliveryEvidenceInputSchema.AcceptedProviderEvidenceV1,
      expectedProducers: [
        {
          taskId: provider.taskId,
          team: provider.team,
          functionalOwner: provider.functionalOwner,
          acceptanceOwner: provider.acceptanceOwner,
        },
      ],
    },
  };
}

function pilotEdge(input: PilotEdgeInput): ModuleDeliveryEdgeContract {
  return {
    providerTaskId: input.providerTaskId,
    consumerTaskId: input.consumerTaskId,
    capability: input.capability,
    publicTypes: [`${input.capability}Request`],
    errors: [`${input.capability}Error`],
    behaviorInvariants: ['The consumer observes the integrated provider tree.'],
    securityInvariants: ['Protected state remains provider-owned.'],
    compatibilityExpectations: ['The provider contract remains additive.'],
    owningTests: [`${input.providerTaskId} contract test`],
  };
}

function acceptedPilotPlan(
  input: SourceCommitInput,
): ValidatedModuleDeliveryPlan {
  const coreInput: PilotNodeInput = {
    taskId: 'core-provider',
    expert: 'core_expert',
    moduleRoot: CORE_ROOT,
    sourceCommit: input.sourceCommit,
    dependencies: [],
    readClaims: [`${CORE_ROOT}/**`],
    writeClaim: CORE_OUTPUT,
  };
  const wasmInput: PilotNodeInput = {
    taskId: 'wasm-adapter',
    expert: 'internal_api_expert',
    moduleRoot: WASM_MODULE_ROOT,
    sourceCommit: input.sourceCommit,
    dependencies: ['core-provider'],
    readClaims: [`${CORE_ROOT}/**`, `${WASM_ROOT}/**`],
    writeClaim: WASM_OUTPUT,
  };
  const webInput: PilotNodeInput = {
    taskId: 'web-consumer',
    expert: 'web_expert',
    moduleRoot: WEB_ROOT,
    sourceCommit: input.sourceCommit,
    dependencies: ['wasm-adapter', 'evidence-synthesis'],
    readClaims: [`${CORE_ROOT}/**`, `${WASM_ROOT}/**`, `${WEB_ROOT}/**`],
    writeClaim: WEB_OUTPUT,
  };
  const coreWasmEdge: PilotEdgeInput = {
    providerTaskId: 'core-provider',
    consumerTaskId: 'wasm-adapter',
    capability: 'CoreCapability',
  };
  const wasmWebEdge: PilotEdgeInput = {
    providerTaskId: 'wasm-adapter',
    consumerTaskId: 'web-consumer',
    capability: 'WasmAdapter',
  };
  const auditRequest: EvidenceNodeRequest = {
    taskId: 'runtime-evidence',
    dependency: 'wasm-adapter',
  };
  const audit = evidenceNode(auditRequest);
  const synthesis = synthesisNode(audit);
  const auditSynthesisEdge: PilotEdgeInput = {
    providerTaskId: audit.taskId,
    consumerTaskId: synthesis.taskId,
    capability: 'Evidence',
  };
  const synthesisWebEdge: PilotEdgeInput = {
    providerTaskId: synthesis.taskId,
    consumerTaskId: 'web-consumer',
    capability: 'AcceptedEvidence',
  };
  const wasmAuditEdge: PilotEdgeInput = {
    providerTaskId: 'wasm-adapter',
    consumerTaskId: audit.taskId,
    capability: 'RuntimeSurface',
  };
  const plan: ModuleDeliveryPlan = {
    version: 2,
    generation: 1,
    sourceCommit: input.sourceCommit,
    maxConcurrency: 1,
    maxAgentDepth: 1,
    maxAttempts: 1,
    parentOwnedResources: PARENT_RESOURCES,
    parentJoin: {
      kind: ModuleDeliveryJoinKind.OrderedCommitHandoffs,
      owner: 'delivery-owner',
      validationCommands: ['task module-delivery:pilot'],
    },
    nodes: [
      pilotNode(webInput),
      synthesis,
      audit,
      pilotNode(coreInput),
      pilotNode(wasmInput),
    ],
    edgeContracts: [
      pilotEdge(auditSynthesisEdge),
      pilotEdge(synthesisWebEdge),
      pilotEdge(wasmWebEdge),
      pilotEdge(wasmAuditEdge),
      pilotEdge(coreWasmEdge),
    ],
  };
  const validation = decodeAndValidateModuleDeliveryPlan(JSON.stringify(plan));
  if (validation.status !== ModuleDeliveryValidationStatus.Accepted) {
    throw new Error(JSON.stringify(validation.issues));
  }
  return validation;
}

function prepareWriter(request: WriterRequest): ModuleWorktreeHandle {
  const preparation: PrepareModuleWorktreeRequest = {
    repositoryRoot: request.fixture.sourceRoot,
    workspaceRoot: request.fixture.workspaceRoot,
    planDigest: request.acceptedPlan.planDigest,
    taskId: request.node.taskId,
    attempt: 1,
    baselineCommit: request.baselineCommit,
  };
  const workspace = prepareModuleWorktree(preparation);
  writerWorkspaces.push(workspace);
  return workspace;
}

function commitWriter(request: WriterCommitRequest): string {
  const write = worktreeFileWriter(request.workspace);
  write([request.outputPath, request.contents]);
  const git = worktreeGit(request.workspace);
  git(['add', '--', request.outputPath]);
  git(['commit', '--quiet', '--no-gpg-sign', '-m', request.message]);
  return git(['rev-parse', 'HEAD']);
}

function integrateWriter(request: IntegrateRequest): ModuleIntegrationState {
  const handoffRequest: VerifyModuleCommitHandoffRequest = {
    workspace: request.workspace,
    baselineCommit: request.state.headCommit,
    allowedWriteClaims: request.node.resources.write,
  };
  const verified = verifyModuleCommitHandoff(handoffRequest);
  const handoff: ModuleDeliveryHandoffSubmission = {
    taskId: request.node.taskId,
    attempt: verified.attempt,
    planDigest: verified.planDigest,
    baselineCommit: verified.baselineCommit,
    commit: verified.commit,
    workspace: request.workspace,
  };
  const submission: ModuleDeliveryWriteProviderSubmission = {
    kind: ModuleDeliveryProviderSubmissionKind.Write,
    generation: request.acceptedPlan.plan.generation,
    acceptedByTeam: request.node.acceptanceOwner,
    verdict: ModuleDeliveryEvidenceVerdict.TerminalSuccess,
    handoff,
  };
  const admissionState = request.state.admissionState;
  const selectRequest: SelectModuleDeliveryAdmissionsRequest = {
    authority: request.authority,
    acceptedPlan: request.acceptedPlan,
    state: admissionState,
  };
  const selection = selectModuleDeliveryAdmissions(selectRequest);
  const admission = selection.admissions.find(
    (candidate) => candidate.taskId === request.node.taskId,
  );
  if (!admission) throw new Error('Pilot provider is not ready.');
  const leaseRequest: RecordModuleDeliveryAttemptLeasesRequest = {
    authority: request.authority,
    state: admissionState,
    admissions: [admission],
  };
  const recording = recordModuleDeliveryAttemptLeases(leaseRequest);
  const lease = recording.leases[0];
  if (!lease) throw new Error('Pilot lease was not recorded.');
  const integrationRequest: IntegrateVerifiedModuleDeliveryTaskRequest = {
    authority: request.authority,
    acceptedPlan: request.acceptedPlan,
    lease,
    state: request.state,
    submission,
  };
  return integrateVerifiedModuleDeliveryTask(integrationRequest);
}

function integrateEvidence(
  request: IntegrateEvidenceRequest,
): ModuleIntegrationState {
  const { authority, acceptedPlan, state, node } = request;
  const selectionRequest: SelectModuleDeliveryAdmissionsRequest = {
    authority,
    acceptedPlan,
    state: state.admissionState,
  };
  const selection = selectModuleDeliveryAdmissions(selectionRequest);
  const admission = selection.admissions.find(
    ({ taskId }) => taskId === node.taskId,
  );
  if (!admission) throw new Error('Evidence provider is not ready.');
  const leaseRequest: RecordModuleDeliveryAttemptLeasesRequest = {
    authority,
    state: state.admissionState,
    admissions: [admission],
  };
  const recording = recordModuleDeliveryAttemptLeases(leaseRequest);
  const lease = recording.leases[0];
  if (!lease) throw new Error('Evidence lease was not recorded.');
  const evidenceInput: EvidenceFixtureInput = { state, node, lease };
  const integrationRequest: IntegrateVerifiedModuleDeliveryTaskRequest = {
    authority,
    acceptedPlan,
    state,
    lease,
    submission: evidenceSubmission(evidenceInput),
  };
  return integrateVerifiedModuleDeliveryTask(integrationRequest);
}

function sourceProof(input: FixtureInput): SourceProof {
  const git = fixtureGit(input.fixture);
  return {
    head: git(['rev-parse', 'HEAD']),
    indexHash: git(['hash-object', '.git/index']),
    status: git(['status', '--porcelain=v1', '-z']),
    refs: git([
      'for-each-ref',
      '--sort=refname',
      '--format=%(refname)%00%(objectname)%00%(symref)',
    ]),
  };
}

function nonIntegrationRefs(input: FixtureInput): string {
  return fixtureGit(input.fixture)([
    'for-each-ref',
    '--sort=refname',
    '--format=%(refname)%00%(objectname)%00%(symref)',
    '--exclude=refs/nook/module-delivery/**',
  ]);
}

function planNode(input: PlanNodeInput): ModuleDeliveryWriteNodeV2 {
  const node = input.plan.plan.nodes.find(
    (candidate) => candidate.taskId === input.taskId,
  );
  if (!node || node.kind !== ModuleDeliveryTaskKind.Write) {
    throw new Error(`Missing pilot writer ${input.taskId}.`);
  }
  return node;
}

describe('core to WASM to web module delivery pilot', () => {
  test('hands each integrated commit to the next registered layer', () => {
    const activeFixture = createGitFixture();
    fixtures.push(activeFixture);
    const fixtureInput: FixtureInput = { fixture: activeFixture };
    const before = sourceProof(fixtureInput);
    const sourceInput: SourceCommitInput = {
      sourceCommit: activeFixture.baselineCommit,
    };
    const acceptedPlan = acceptedPilotPlan(sourceInput);
    expect(acceptedPlan.topologicalOrder).toEqual([
      'core-provider',
      'wasm-adapter',
      'runtime-evidence',
      'evidence-synthesis',
      'web-consumer',
    ]);
    expect(acceptedPlan.waves).toEqual([
      ['core-provider'],
      ['wasm-adapter'],
      ['runtime-evidence'],
      ['evidence-synthesis'],
      ['web-consumer'],
    ]);

    const authorityRequest: CreateModuleDeliveryGenerationAuthorityRequest = {
      acceptedPlan,
      repositoryRoot: activeFixture.sourceRoot,
      expectedLineage: acceptedPlan.plan.nodes.map(
        ({ taskId, parentLineage }) => ({ taskId, parentLineage }),
      ),
    };
    const authority = createModuleDeliveryGenerationAuthority(authorityRequest);
    const stateRequest: CreateModuleDeliveryAdmissionStateRequest = {
      authority,
      acceptedPlan,
      headCommit: acceptedPlan.plan.sourceCommit,
      integratedWriterFrontiers: [],
      acceptedEvidence: [],
    };
    const admissionState = createModuleDeliveryAdmissionState(stateRequest);
    const preparation: PrepareModuleIntegrationRequest = {
      authority,
      repositoryRoot: activeFixture.sourceRoot,
      workspaceRoot: activeFixture.workspaceRoot,
      acceptedPlan,
      admissionState,
    };
    const initialState = prepareModuleIntegration(preparation);
    integrationCleanups.push(initialState.cleanupHandle);

    const coreNodeInput: PlanNodeInput = {
      plan: acceptedPlan,
      taskId: 'core-provider',
    };
    const coreNode = planNode(coreNodeInput);
    const corePreparation: WriterRequest = {
      fixture: activeFixture,
      acceptedPlan,
      node: coreNode,
      baselineCommit: initialState.headCommit,
    };
    const coreWorkspace = prepareWriter(corePreparation);
    const coreCommit: WriterCommitRequest = {
      workspace: coreWorkspace,
      outputPath: CORE_OUTPUT,
      contents: CORE_CONTENT,
      message: 'pilot core capability',
    };
    commitWriter(coreCommit);
    const coreIntegration: IntegrateRequest = {
      authority,
      acceptedPlan,
      state: initialState,
      workspace: coreWorkspace,
      node: coreNode,
    };
    const coreState = integrateWriter(coreIntegration);

    const wasmNodeInput: PlanNodeInput = {
      plan: acceptedPlan,
      taskId: 'wasm-adapter',
    };
    const wasmNode = planNode(wasmNodeInput);
    const wasmPreparation: WriterRequest = {
      fixture: activeFixture,
      acceptedPlan,
      node: wasmNode,
      baselineCommit: coreState.headCommit,
    };
    const wasmWorkspace = prepareWriter(wasmPreparation);
    const wasmGit = worktreeGit(wasmWorkspace);
    expect(wasmGit(['rev-parse', 'HEAD'])).toBe(coreState.headCommit);
    expect(wasmGit(['show', `HEAD:${CORE_OUTPUT}`])).toBe(CORE_CONTENT.trim());
    const wasmCommit: WriterCommitRequest = {
      workspace: wasmWorkspace,
      outputPath: WASM_OUTPUT,
      contents: WASM_CONTENT,
      message: 'pilot WASM adapter',
    };
    commitWriter(wasmCommit);
    const wasmIntegration: IntegrateRequest = {
      authority,
      acceptedPlan,
      state: coreState,
      workspace: wasmWorkspace,
      node: wasmNode,
    };
    const wasmState = integrateWriter(wasmIntegration);

    const audit = acceptedPlan.plan.nodes.find(
      ({ taskId }) => taskId === 'runtime-evidence',
    );
    if (!audit || audit.kind !== ModuleDeliveryTaskKind.ReadOnly)
      throw new Error('Missing runtime evidence node.');
    const evidenceIntegration: IntegrateEvidenceRequest = {
      authority,
      acceptedPlan,
      state: wasmState,
      node: audit,
    };
    const evidenceState = integrateEvidence(evidenceIntegration);
    const synthesis = acceptedPlan.plan.nodes.find(
      ({ taskId }) => taskId === 'evidence-synthesis',
    );
    if (
      !synthesis ||
      synthesis.kind !== ModuleDeliveryTaskKind.EvidenceSynthesis
    )
      throw new Error('Missing evidence synthesis node.');
    const synthesisIntegration: IntegrateEvidenceRequest = {
      authority,
      acceptedPlan,
      state: evidenceState,
      node: synthesis,
    };
    const synthesisState = integrateEvidence(synthesisIntegration);
    expect(synthesisState.headCommit).toBe(wasmState.headCommit);
    expect(synthesisState.acceptedEvidence).toHaveLength(2);

    const webNodeInput: PlanNodeInput = {
      plan: acceptedPlan,
      taskId: 'web-consumer',
    };
    const webNode = planNode(webNodeInput);
    const webPreparation: WriterRequest = {
      fixture: activeFixture,
      acceptedPlan,
      node: webNode,
      baselineCommit: synthesisState.headCommit,
    };
    const webWorkspace = prepareWriter(webPreparation);
    const webGit = worktreeGit(webWorkspace);
    expect(webGit(['rev-parse', 'HEAD'])).toBe(synthesisState.headCommit);
    expect(webGit(['show', `HEAD:${CORE_OUTPUT}`])).toBe(CORE_CONTENT.trim());
    expect(webGit(['show', `HEAD:${WASM_OUTPUT}`])).toBe(WASM_CONTENT.trim());
    const webCommit: WriterCommitRequest = {
      workspace: webWorkspace,
      outputPath: WEB_OUTPUT,
      contents: WEB_CONTENT,
      message: 'pilot web consumer',
    };
    commitWriter(webCommit);
    const webIntegration: IntegrateRequest = {
      authority,
      acceptedPlan,
      state: synthesisState,
      workspace: webWorkspace,
      node: webNode,
    };
    const finalState = integrateWriter(webIntegration);

    const sourceGit = fixtureGit(activeFixture);
    expect(sourceGit(['show', `${finalState.headCommit}:${CORE_OUTPUT}`])).toBe(
      CORE_CONTENT.trim(),
    );
    expect(sourceGit(['show', `${finalState.headCommit}:${WASM_OUTPUT}`])).toBe(
      WASM_CONTENT.trim(),
    );
    expect(sourceGit(['show', `${finalState.headCommit}:${WEB_OUTPUT}`])).toBe(
      WEB_CONTENT.trim(),
    );
    const ancestry = sourceGit([
      'rev-list',
      '--first-parent',
      '--reverse',
      `${activeFixture.baselineCommit}..${finalState.headCommit}`,
    ]).split('\n');
    expect(ancestry).toEqual([
      coreState.headCommit,
      wasmState.headCommit,
      finalState.headCommit,
    ]);
    expect(
      sourceGit([
        'for-each-ref',
        '--format=%(objectname)',
        'refs/nook/module-delivery/',
      ]),
    ).toBe(finalState.headCommit);
    expect(sourceGit(['rev-parse', 'HEAD'])).toBe(before.head);
    expect(sourceGit(['hash-object', '.git/index'])).toBe(before.indexHash);
    expect(sourceGit(['status', '--porcelain=v1', '-z'])).toBe(before.status);
    expect(nonIntegrationRefs(fixtureInput)).toBe(before.refs);

    cleanupWriters();
    const cleanupRequest: CleanupModuleIntegrationRequest = {
      cleanupHandle: initialState.cleanupHandle,
    };
    expect(cleanupModuleIntegration(cleanupRequest).removed).toBe(true);
    forgetIntegrationCleanup(cleanupRequest);
    expect(sourceProof(fixtureInput)).toEqual(before);
    expect(sourceGit(['worktree', 'list', '--porcelain'])).not.toContain(
      activeFixture.workspaceRoot,
    );
  });
});
