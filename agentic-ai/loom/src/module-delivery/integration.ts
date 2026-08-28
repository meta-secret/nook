import { gitText, runModuleDeliveryGit } from './git-command.ts';
import { ModuleDeliveryTaskKind } from './domain.ts';
import {
  moduleCommitChangedPaths,
  verifyModuleCommitHandoff,
} from './handoff.ts';
import {
  assertSourceSnapshot,
  assertFreshModuleIntegrationState,
  assertCurrentModuleIntegrationAdmission,
  assertModuleIntegrationHandoffRepository,
  assertModuleIntegrationLeaseFrontier,
  assertModuleIntegrationProviderPrecedence,
  captureSourceSnapshot,
  createIntegrationSession,
  integrationProvenance,
  integrationSession,
  moduleIntegrationRef,
  moduleIntegrationCompletedWaveCount,
  immutableModuleIntegrationState,
  ModuleDeliveryEvidenceVerdict,
  ModuleDeliveryProviderSubmissionKind,
  ModuleIntegrationPhase,
  recordIntegratedLeaseAcceptance,
  registerIntegrationState,
  retireIntegrationState,
  updateModuleIntegrationRef,
} from './integration-provenance.ts';
import { applyModuleWaveTree } from './tree-integration.ts';
import {
  assertModuleDeliveryAttemptLeaseAuthority,
  assertModuleDeliveryAdmissionStateAuthority,
  assertModuleDeliveryAuthorityRepository,
  assertModuleDeliveryGenerationAuthority,
  createModuleDeliveryAdmissionState,
  moduleDeliveryAcceptedEvidenceIdentity,
  moduleDeliveryAuthorityPlan,
  verifyModuleDeliveryEvidenceSubmission,
} from './admission.ts';
import { EXACT_GIT_COMMIT } from './workspace-paths.ts';
import type { ModuleDeliveryEvidenceSubmissionVerification } from './evidence.ts';
import type {
  CreateModuleDeliveryAdmissionStateRequest,
  ModuleDeliveryAdmissionState,
  ModuleDeliveryGenerationAuthority,
} from './admission.ts';
import type {
  CleanupModuleIntegrationRequest,
  CleanupModuleIntegrationResult,
  FinalizeModuleDeliveryIntegrationRequest,
  IntegrateVerifiedModuleDeliveryTaskRequest,
  ModuleDeliveryHandoffSubmission,
  ModuleDeliveryProviderSubmission,
  ModuleDeliveryWriteProviderSubmission,
  ModuleIntegrationCleanupHandle,
  ModuleIntegrationState,
  PrepareModuleIntegrationRequest,
} from './integration-provenance.ts';
import {
  assertPreparedModuleWorktreeIdentity,
  cleanupModuleWorktree,
  prepareModuleWorktree,
} from './workspace.ts';

import type { GitCommandRequest } from './git-command.ts';
import type {
  ModuleDeliveryNode,
  ValidatedModuleDeliveryPlan,
  WriteModuleDeliveryNode,
} from './domain.ts';
import type {
  ModuleCommitPathRequest,
  VerifyModuleCommitHandoffRequest,
} from './handoff.ts';
import type {
  ModuleIntegrationProvenance,
  ModuleIntegrationSession,
  IntegrationSessionRegistration,
  IntegrationStateRegistration,
  FreshModuleIntegrationStateInspection,
  AdmissionStateAuthorityInspection,
  AttemptLeaseAuthorityInspection,
  GenerationAuthorityInspection,
  ModuleDeliveryAuthorityPlanRequest,
  ModuleDeliveryAuthorityRepositoryInspection,
  CurrentModuleIntegrationAdmissionInspection,
  ModuleIntegrationRefRequest,
  ModuleIntegrationHandoffRepositoryInspection,
  ModuleIntegrationLeaseFrontierInspection,
  ModuleIntegrationProviderPrecedenceInspection,
  ModuleIntegrationCompletedWaveCountRequest,
  RecordIntegratedLeaseAcceptanceRequest,
  SourceSnapshotExpectation,
  UpdateModuleIntegrationRefRequest,
} from './integration-provenance.ts';
import type {
  ApplyModuleWaveTreeRequest,
  TreeHandoff,
} from './tree-integration.ts';
import type {
  CleanupModuleWorktreeRequest,
  ModuleWorktreeHandle,
  PrepareModuleWorktreeRequest,
} from './workspace.ts';
import type { ModuleDeliveryAttemptLease } from './admission.ts';

const INTEGRATION_TASK_ID = 'module-delivery-integration';

type ModuleGitInvocation = {
  readonly cwd: string;
  readonly args: readonly string[];
  readonly allowFailure?: boolean;
};

type AcceptedPlanStateInspection = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly acceptedPlan: ValidatedModuleDeliveryPlan;
  readonly state: ModuleIntegrationState;
};

type ExpectedHandoff = {
  readonly node: WriteModuleDeliveryNode;
  readonly baselineCommit: string;
  readonly submission: ModuleDeliveryHandoffSubmission;
};

type NodeLookup = {
  readonly acceptedPlan: ValidatedModuleDeliveryPlan;
  readonly taskId: string;
};

type ExpectedHandoffVerification = {
  readonly expected: ExpectedHandoff;
  readonly acceptedPlan: ValidatedModuleDeliveryPlan;
};

type ValidatedWaveApplication = {
  readonly state: ModuleIntegrationState;
  readonly expectedHandoffs: readonly ExpectedHandoff[];
  readonly provenance: ModuleIntegrationProvenance;
};

type AdvancedIntegrationStateRequest = {
  readonly previousState: ModuleIntegrationState;
  readonly nextState: ModuleIntegrationState;
  readonly provenance: ModuleIntegrationProvenance;
  readonly writerFrontiers: readonly ModuleDeliveryIntegratedWriterFrontierCapability[];
};

type ProviderLeaseInspection = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly acceptedPlan: ValidatedModuleDeliveryPlan;
  readonly lease: ModuleDeliveryAttemptLease;
  readonly submission: ModuleDeliveryProviderSubmission;
};

type RefreshedWriterFrontiersRequest = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  state: ModuleIntegrationState;
}>;

export type ModuleDeliveryIntegratedWriterFrontierCapability = Readonly<{
  taskId: string;
  attempt: number;
  generation: number;
  planDigest: string;
  headCommit: string;
  integratedTaskIds: readonly string[];
}>;

export type AssertModuleDeliveryIntegratedWriterFrontierCapabilityRequest =
  Readonly<{
    capability: ModuleDeliveryIntegratedWriterFrontierCapability;
    authority: ModuleDeliveryGenerationAuthority;
    taskId: string;
    attempt: number;
    generation: number;
    planDigest: string;
    headCommit: string;
    integratedTaskIds: readonly string[];
  }>;

type IntegratedWriterFrontierProvenance = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  taskId: string;
  attempt: number;
  generation: number;
  planDigest: string;
  headCommit: string;
  integratedTaskIds: readonly string[];
}>;

type MintIntegratedWriterFrontierRequest = IntegratedWriterFrontierProvenance;

const ZERO_COMMIT = '0'.repeat(40);
const PROHIBITED_MATERIALIZATION_FILES = new Set([
  '.gitattributes',
  '.gitmodules',
  '.lfsconfig',
]);
const WRITER_FRONTIER_PROVENANCE = new WeakMap<
  ModuleDeliveryIntegratedWriterFrontierCapability,
  IntegratedWriterFrontierProvenance
>();
const STATE_WRITER_FRONTIERS = new WeakMap<
  ModuleIntegrationState,
  readonly ModuleDeliveryIntegratedWriterFrontierCapability[]
>();

function mintIntegratedWriterFrontier(
  request: MintIntegratedWriterFrontierRequest,
): ModuleDeliveryIntegratedWriterFrontierCapability {
  const integratedTaskIds = Object.freeze([...request.integratedTaskIds]);
  const capabilityValue: ModuleDeliveryIntegratedWriterFrontierCapability = {
    taskId: request.taskId,
    attempt: request.attempt,
    generation: request.generation,
    planDigest: request.planDigest,
    headCommit: request.headCommit,
    integratedTaskIds,
  };
  const capability = Object.freeze(capabilityValue);
  const provenance: IntegratedWriterFrontierProvenance = {
    ...request,
    integratedTaskIds,
  };
  WRITER_FRONTIER_PROVENANCE.set(capability, Object.freeze(provenance));
  return capability;
}

export function assertModuleDeliveryIntegratedWriterFrontierCapability(
  request: AssertModuleDeliveryIntegratedWriterFrontierCapabilityRequest,
): void {
  const provenance = WRITER_FRONTIER_PROVENANCE.get(request.capability);
  if (
    !provenance ||
    provenance.authority !== request.authority ||
    provenance.taskId !== request.taskId ||
    provenance.attempt !== request.attempt ||
    provenance.generation !== request.generation ||
    provenance.planDigest !== request.planDigest ||
    provenance.headCommit !== request.headCommit ||
    JSON.stringify(provenance.integratedTaskIds) !==
      JSON.stringify(request.integratedTaskIds)
  )
    throw new Error('Integrated writer frontier capability is invalid.');
}

function gitRequest(invocation: ModuleGitInvocation): GitCommandRequest {
  if ('allowFailure' in invocation) {
    return {
      cwd: invocation.cwd,
      args: invocation.args,
      allowFailure: invocation.allowFailure,
    };
  }
  return { cwd: invocation.cwd, args: invocation.args };
}

function gitInvocation(invocation: ModuleGitInvocation): string {
  return gitText(runModuleDeliveryGit(gitRequest(invocation)));
}

function assertAcceptedPlanState(
  inspection: AcceptedPlanStateInspection,
): void {
  const metadataInspection: ModuleDeliveryAuthorityPlanRequest = {
    authority: inspection.authority,
    acceptedPlan: inspection.acceptedPlan,
  };
  const validation = moduleDeliveryAuthorityPlan(metadataInspection);
  if (
    inspection.state.planDigest !== validation.planDigest ||
    inspection.state.generation !== validation.plan.generation ||
    inspection.state.sourceCommit !== validation.plan.sourceCommit ||
    JSON.stringify(inspection.state.topologicalOrder) !==
      JSON.stringify(validation.topologicalOrder) ||
    JSON.stringify(inspection.state.waves) !== JSON.stringify(validation.waves)
  ) {
    throw new Error(
      'Module integration state does not match the accepted plan.',
    );
  }
}

function nodeByTaskId(lookup: NodeLookup): ModuleDeliveryNode {
  const node = lookup.acceptedPlan.plan.nodes.find(
    (candidate) => candidate.taskId === lookup.taskId,
  );
  if (!node) throw new Error(`Accepted plan is missing task ${lookup.taskId}.`);
  return node;
}

function verifyExpectedHandoff(
  verification: ExpectedHandoffVerification,
): void {
  const handoff = verification.expected.submission;
  if (
    handoff.taskId !== verification.expected.node.taskId ||
    handoff.attempt < 1 ||
    handoff.planDigest !== verification.acceptedPlan.planDigest ||
    handoff.baselineCommit !== verification.expected.baselineCommit ||
    handoff.workspace.taskId !== handoff.taskId ||
    handoff.workspace.attempt !== handoff.attempt ||
    handoff.workspace.planDigest !== handoff.planDigest ||
    handoff.workspace.baselineCommit !== handoff.baselineCommit ||
    !EXACT_GIT_COMMIT.test(handoff.commit)
  ) {
    throw new Error(
      `Handoff metadata is invalid for ${verification.expected.node.taskId}.`,
    );
  }
  const verificationRequest: VerifyModuleCommitHandoffRequest = {
    workspace: handoff.workspace,
    baselineCommit: verification.expected.baselineCommit,
    allowedWriteClaims: verification.expected.node.resources.write,
  };
  const pathRequest: ModuleCommitPathRequest = {
    workspace: handoff.workspace,
    baselineCommit: handoff.baselineCommit,
    commit: handoff.commit,
  };
  for (const path of moduleCommitChangedPaths(pathRequest)) {
    const basename = path.slice(path.lastIndexOf('/') + 1);
    if (PROHIBITED_MATERIALIZATION_FILES.has(basename)) {
      throw new Error(`Handoff cannot author materialization control ${path}.`);
    }
  }
  const verified = verifyModuleCommitHandoff(verificationRequest);
  if (
    verified.commit !== handoff.commit ||
    verified.taskId !== handoff.taskId ||
    verified.attempt !== handoff.attempt ||
    verified.planDigest !== handoff.planDigest ||
    verified.baselineCommit !== handoff.baselineCommit
  ) {
    throw new Error(
      `Raw handoff commit is invalid for ${verification.expected.node.taskId}.`,
    );
  }
}

function applyAndValidateWave(application: ValidatedWaveApplication): string {
  const sourceExpectation: SourceSnapshotExpectation = {
    repositoryRoot: application.state.workspace.sourceRepositoryRoot,
    expected: application.provenance.sourceSnapshot,
  };
  const workspaceExpectation: SourceSnapshotExpectation = {
    repositoryRoot: application.state.workspace.worktreePath,
    expected: application.provenance.workspaceSnapshot,
  };
  assertSourceSnapshot(sourceExpectation);
  assertSourceSnapshot(workspaceExpectation);
  if (application.expectedHandoffs.length === 0) {
    assertSourceSnapshot(sourceExpectation);
    assertSourceSnapshot(workspaceExpectation);
    return application.state.headCommit;
  }
  const handoffs: TreeHandoff[] = application.expectedHandoffs.map(
    (expected) => ({
      taskId: expected.node.taskId,
      baselineCommit: expected.baselineCommit,
      commit: expected.submission.commit,
    }),
  );
  const applyRequest: ApplyModuleWaveTreeRequest = {
    workspace: application.state.workspace,
    currentHead: application.state.headCommit,
    handoffs,
  };
  const headCommit = applyModuleWaveTree(applyRequest);
  const refUpdate: UpdateModuleIntegrationRefRequest = {
    provenance: application.provenance,
    nextCommit: headCommit,
    rollback: false,
  };
  updateModuleIntegrationRef(refUpdate);
  try {
    assertSourceSnapshot(sourceExpectation);
    assertSourceSnapshot(workspaceExpectation);
    return headCommit;
  } catch {
    const rollback: UpdateModuleIntegrationRefRequest = {
      provenance: application.provenance,
      nextCommit: headCommit,
      rollback: true,
    };
    updateModuleIntegrationRef(rollback);
    throw new Error('Module delivery wave failed and was fully rolled back.');
  }
}

function advancedIntegrationState(
  request: AdvancedIntegrationStateRequest,
): ModuleIntegrationState {
  const immutable = immutableModuleIntegrationState(request.nextState);
  request.provenance.session.currentHead = immutable.headCommit;
  const registration: IntegrationStateRegistration = {
    authority: request.provenance.authority,
    state: immutable,
    sourceSnapshot: request.provenance.sourceSnapshot,
    workspaceSnapshot: request.provenance.workspaceSnapshot,
    session: request.provenance.session,
  };
  registerIntegrationState(registration);
  STATE_WRITER_FRONTIERS.set(immutable, request.writerFrontiers);
  retireIntegrationState(request.previousState);
  return immutable;
}

function authoritativeProviderLease(
  inspection: ProviderLeaseInspection,
): ModuleDeliveryAttemptLease {
  const stateInspection: AttemptLeaseAuthorityInspection = {
    authority: inspection.authority,
    lease: inspection.lease,
  };
  assertModuleDeliveryAttemptLeaseAuthority(stateInspection);
  if (
    inspection.lease.generation !== inspection.acceptedPlan.plan.generation ||
    inspection.lease.planDigest !== inspection.acceptedPlan.planDigest
  ) {
    throw new Error('Provider lease belongs to an obsolete plan.');
  }
  const taskId =
    inspection.submission.kind === ModuleDeliveryProviderSubmissionKind.Write
      ? inspection.submission.handoff.taskId
      : inspection.submission.taskId;
  const attempt =
    inspection.submission.kind === ModuleDeliveryProviderSubmissionKind.Write
      ? inspection.submission.handoff.attempt
      : inspection.submission.attempt;
  if (
    inspection.lease.taskId !== taskId ||
    inspection.lease.attempt !== attempt
  ) {
    throw new Error(
      `Provider ${taskId} has no authoritative unreleased lease.`,
    );
  }
  return inspection.lease;
}

function refreshedWriterFrontiers(
  request: RefreshedWriterFrontiersRequest,
): readonly ModuleDeliveryIntegratedWriterFrontierCapability[] {
  const { authority, state } = request;
  return Object.freeze(
    state.acceptedWrites.map((write) => {
      const request: MintIntegratedWriterFrontierRequest = {
        authority,
        taskId: write.taskId,
        attempt: write.attempt,
        generation: write.generation,
        planDigest: write.planDigest,
        headCommit: state.headCommit,
        integratedTaskIds: state.integratedTaskIds,
      };
      return mintIntegratedWriterFrontier(request);
    }),
  );
}

function writerFrontiers(
  state: ModuleIntegrationState,
): readonly ModuleDeliveryIntegratedWriterFrontierCapability[] {
  const capabilities = STATE_WRITER_FRONTIERS.get(state);
  if (!capabilities)
    throw new Error('Module integration writer frontier is invalid.');
  return capabilities;
}

export function prepareModuleIntegration(
  request: PrepareModuleIntegrationRequest,
): ModuleIntegrationState {
  const repositoryInspection: ModuleDeliveryAuthorityRepositoryInspection = {
    authority: request.authority,
    repositoryRoot: request.repositoryRoot,
  };
  assertModuleDeliveryAuthorityRepository(repositoryInspection);
  const inspection: ModuleDeliveryAuthorityPlanRequest = {
    authority: request.authority,
    acceptedPlan: request.acceptedPlan,
  };
  moduleDeliveryAuthorityPlan(inspection);
  const authorityInspection: GenerationAuthorityInspection = {
    authority: request.authority,
    generation: request.acceptedPlan.plan.generation,
    planDigest: request.acceptedPlan.planDigest,
  };
  assertModuleDeliveryGenerationAuthority(authorityInspection);
  const stateInspection: AdmissionStateAuthorityInspection = {
    authority: request.authority,
    state: request.admissionState,
  };
  assertModuleDeliveryAdmissionStateAuthority(stateInspection);
  if (
    request.admissionState.generation !==
      request.acceptedPlan.plan.generation ||
    request.admissionState.planDigest !== request.acceptedPlan.planDigest ||
    request.admissionState.headCommit !== request.acceptedPlan.plan.sourceCommit
  )
    throw new Error('Module integration admission state is inconsistent.');
  const before = captureSourceSnapshot(request.repositoryRoot);
  const prepareRequest: PrepareModuleWorktreeRequest = {
    repositoryRoot: request.repositoryRoot,
    workspaceRoot: request.workspaceRoot,
    planDigest: request.acceptedPlan.planDigest,
    taskId: INTEGRATION_TASK_ID,
    attempt: 1,
    baselineCommit: request.acceptedPlan.plan.sourceCommit,
  };
  const workspace = prepareModuleWorktree(prepareRequest);
  const sourceExpectation: SourceSnapshotExpectation = {
    repositoryRoot: request.repositoryRoot,
    expected: before,
  };
  const refRequest: ModuleIntegrationRefRequest = {
    workspace,
    planDigest: request.acceptedPlan.planDigest,
  };
  const ref = moduleIntegrationRef(refRequest);
  const createRefInvocation: ModuleGitInvocation = {
    cwd: workspace.sourceRepositoryRoot,
    args: [
      'update-ref',
      '--create-reflog',
      ref,
      request.acceptedPlan.plan.sourceCommit,
      ZERO_COMMIT,
    ],
  };
  let refCreated = false;
  try {
    assertSourceSnapshot(sourceExpectation);
    runModuleDeliveryGit(gitRequest(createRefInvocation));
    refCreated = true;
    const cleanupHandleValue: ModuleIntegrationCleanupHandle = {
      sessionId: `${request.acceptedPlan.planDigest}:${workspace.worktreeId}`,
    };
    const cleanupHandle = Object.freeze(cleanupHandleValue);
    const state: ModuleIntegrationState = {
      phase: ModuleIntegrationPhase.AcceptingProviders,
      generation: request.acceptedPlan.plan.generation,
      planDigest: request.acceptedPlan.planDigest,
      sourceCommit: request.acceptedPlan.plan.sourceCommit,
      topologicalOrder: request.acceptedPlan.topologicalOrder,
      waves: request.acceptedPlan.waves,
      completedWaveCount: 0,
      integratedTaskIds: [],
      acceptedWrites: [],
      acceptedEvidence: [],
      headCommit: request.acceptedPlan.plan.sourceCommit,
      admissionState: request.admissionState,
      workspace,
      cleanupHandle,
    };
    const immutable = immutableModuleIntegrationState(state);
    const workspaceSnapshot = captureSourceSnapshot(workspace.worktreePath);
    const sessionRegistration: IntegrationSessionRegistration = {
      cleanupHandle,
      workspace: immutable.workspace,
      integrationRef: ref,
      currentHead: immutable.headCommit,
    };
    const session = createIntegrationSession(sessionRegistration);
    const registration: IntegrationStateRegistration = {
      authority: request.authority,
      state: immutable,
      sourceSnapshot: before,
      workspaceSnapshot,
      session,
    };
    registerIntegrationState(registration);
    STATE_WRITER_FRONTIERS.set(immutable, Object.freeze([]));
    return immutable;
  } catch {
    let refDeleted = true;
    if (refCreated) {
      const deleteInvocation: ModuleGitInvocation = {
        cwd: workspace.sourceRepositoryRoot,
        args: ['update-ref', '-d', ref, request.acceptedPlan.plan.sourceCommit],
        allowFailure: true,
      };
      refDeleted =
        runModuleDeliveryGit(gitRequest(deleteInvocation)).exitCode === 0;
    }
    const cleanupRequest: CleanupModuleWorktreeRequest = { workspace };
    cleanupModuleWorktree(cleanupRequest);
    if (!refDeleted) {
      throw new Error(
        'Module integration preparation left a changed private ref.',
      );
    }
    throw new Error(
      'Module integration preparation failed and was cleaned up.',
    );
  }
}

export function integrateVerifiedModuleDeliveryTask(
  request: IntegrateVerifiedModuleDeliveryTaskRequest,
): ModuleIntegrationState {
  const inspection: AcceptedPlanStateInspection = {
    authority: request.authority,
    acceptedPlan: request.acceptedPlan,
    state: request.state,
  };
  assertAcceptedPlanState(inspection);
  const authorityInspection: GenerationAuthorityInspection = {
    authority: request.authority,
    generation: request.acceptedPlan.plan.generation,
    planDigest: request.acceptedPlan.planDigest,
  };
  assertModuleDeliveryGenerationAuthority(authorityInspection);
  const provenance = integrationProvenance(request.state);
  if (provenance.authority !== request.authority)
    throw new Error('Module integration authority does not own this state.');
  const freshInspection: FreshModuleIntegrationStateInspection = {
    state: request.state,
    provenance,
  };
  assertFreshModuleIntegrationState(freshInspection);
  const admissionInspection: CurrentModuleIntegrationAdmissionInspection = {
    authority: request.authority,
    state: request.state,
  };
  assertCurrentModuleIntegrationAdmission(admissionInspection);
  if (request.state.phase !== ModuleIntegrationPhase.AcceptingProviders) {
    throw new Error('Finalized module integration cannot accept providers.');
  }
  const leaseInspection: ProviderLeaseInspection = {
    authority: request.authority,
    acceptedPlan: request.acceptedPlan,
    lease: request.lease,
    submission: request.submission,
  };
  const lease = authoritativeProviderLease(leaseInspection);
  const frontierInspection: ModuleIntegrationLeaseFrontierInspection = {
    state: request.state,
    lease,
  };
  assertModuleIntegrationLeaseFrontier(frontierInspection);
  if (
    request.submission.generation !== request.state.generation ||
    (request.submission.kind === ModuleDeliveryProviderSubmissionKind.Write
      ? request.submission.handoff.planDigest
      : request.submission.planDigest) !== request.state.planDigest
  ) {
    throw new Error('Provider output belongs to an obsolete plan generation.');
  }
  const taskId =
    request.submission.kind === ModuleDeliveryProviderSubmissionKind.Write
      ? request.submission.handoff.taskId
      : request.submission.taskId;
  const lookup: NodeLookup = { acceptedPlan: request.acceptedPlan, taskId };
  const node = nodeByTaskId(lookup);
  if (
    request.state.integratedTaskIds.includes(taskId) ||
    request.state.acceptedEvidence.some((entry) => entry.taskId === taskId)
  ) {
    throw new Error(`Provider ${taskId} already has an accepted disposition.`);
  }
  const precedenceInspection: ModuleIntegrationProviderPrecedenceInspection = {
    acceptedPlan: request.acceptedPlan,
    state: request.state,
    taskId,
    lease,
  };
  assertModuleIntegrationProviderPrecedence(precedenceInspection);
  if (request.submission.kind === ModuleDeliveryProviderSubmissionKind.Write) {
    if (node.kind !== ModuleDeliveryTaskKind.Write) {
      throw new Error(`Provider ${taskId} requires read-only evidence.`);
    }
    if (
      request.submission.verdict !==
        ModuleDeliveryEvidenceVerdict.TerminalSuccess ||
      request.submission.acceptedByTeam !== lease.acceptanceOwner
    )
      throw new Error(`Provider ${taskId} lacks terminal owner acceptance.`);
    const repositoryInspection: ModuleIntegrationHandoffRepositoryInspection = {
      state: request.state,
      handoff: request.submission.handoff,
    };
    assertModuleIntegrationHandoffRepository(repositoryInspection);
    const expected: ExpectedHandoff = {
      node,
      baselineCommit: lease.startingFrontier,
      submission: request.submission.handoff,
    };
    const verification: ExpectedHandoffVerification = {
      expected,
      acceptedPlan: request.acceptedPlan,
    };
    verifyExpectedHandoff(verification);
    const application: ValidatedWaveApplication = {
      state: request.state,
      expectedHandoffs: [expected],
      provenance,
    };
    const headCommit = applyAndValidateWave(application);
    try {
      const provisionalState: ModuleIntegrationState = {
        ...request.state,
        integratedTaskIds: [...request.state.integratedTaskIds, taskId],
        acceptedWrites: [
          ...request.state.acceptedWrites,
          {
            taskId,
            attempt: request.submission.handoff.attempt,
            generation: request.submission.generation,
            planDigest: request.submission.handoff.planDigest,
            startingFrontier: lease.startingFrontier,
            integrationCommit: headCommit,
            acceptedByTeam: request.submission.acceptedByTeam,
            handoff: request.submission.handoff,
          },
        ],
        headCommit,
      };
      const waveCountRequest: ModuleIntegrationCompletedWaveCountRequest = {
        acceptedPlan: request.acceptedPlan,
        state: provisionalState,
      };
      const stateWithWrite: ModuleIntegrationState = {
        ...provisionalState,
        completedWaveCount:
          moduleIntegrationCompletedWaveCount(waveCountRequest),
      };
      const frontierRequest: RefreshedWriterFrontiersRequest = {
        authority: request.authority,
        state: stateWithWrite,
      };
      const capabilities = refreshedWriterFrontiers(frontierRequest);
      const stateRequest: CreateModuleDeliveryAdmissionStateRequest = {
        authority: request.authority,
        acceptedPlan: request.acceptedPlan,
        headCommit,
        integratedWriterFrontiers: capabilities,
        acceptedEvidence: stateWithWrite.acceptedEvidence,
      };
      const admissionState = createModuleDeliveryAdmissionState(stateRequest);
      const nextState: ModuleIntegrationState = {
        ...stateWithWrite,
        admissionState,
      };
      const advance: AdvancedIntegrationStateRequest = {
        previousState: request.state,
        nextState,
        provenance,
        writerFrontiers: capabilities,
      };
      const disposition: RecordIntegratedLeaseAcceptanceRequest = {
        authority: request.authority,
        state: admissionState,
        lease,
      };
      recordIntegratedLeaseAcceptance(disposition);
      return advancedIntegrationState(advance);
    } catch {
      const rollback: UpdateModuleIntegrationRefRequest = {
        provenance,
        nextCommit: headCommit,
        rollback: true,
      };
      updateModuleIntegrationRef(rollback);
      throw new Error(
        'Module delivery integration failed and was rolled back.',
      );
    }
  }
  const authorizedProviderEvidence = request.state.acceptedEvidence.filter(
    (evidence) =>
      lease.authorizedProviderEvidence.some(
        (identity) =>
          JSON.stringify(identity) ===
          JSON.stringify(moduleDeliveryAcceptedEvidenceIdentity(evidence)),
      ),
  );
  const evidenceRequest: ModuleDeliveryEvidenceSubmissionVerification = {
    authority: request.authority,
    acceptedPlan: request.acceptedPlan,
    repositoryRoot: request.state.workspace.sourceRepositoryRoot,
    state: request.state.admissionState,
    submission: request.submission,
    lease,
    authorizedProviderEvidence,
  };
  const accepted = verifyModuleDeliveryEvidenceSubmission(evidenceRequest);
  const provisionalState: ModuleIntegrationState = {
    ...request.state,
    acceptedEvidence: [...request.state.acceptedEvidence, accepted],
  };
  const waveCountRequest: ModuleIntegrationCompletedWaveCountRequest = {
    acceptedPlan: request.acceptedPlan,
    state: provisionalState,
  };
  const stateWithEvidence: ModuleIntegrationState = {
    ...provisionalState,
    completedWaveCount: moduleIntegrationCompletedWaveCount(waveCountRequest),
  };
  const capabilities = writerFrontiers(request.state);
  const stateRequest: CreateModuleDeliveryAdmissionStateRequest = {
    authority: request.authority,
    acceptedPlan: request.acceptedPlan,
    headCommit: stateWithEvidence.headCommit,
    integratedWriterFrontiers: capabilities,
    acceptedEvidence: stateWithEvidence.acceptedEvidence,
  };
  const admissionState = createModuleDeliveryAdmissionState(stateRequest);
  const nextState: ModuleIntegrationState = {
    ...stateWithEvidence,
    admissionState,
  };
  const advance: AdvancedIntegrationStateRequest = {
    previousState: request.state,
    nextState,
    provenance,
    writerFrontiers: capabilities,
  };
  const integrated = advancedIntegrationState(advance);
  const disposition: RecordIntegratedLeaseAcceptanceRequest = {
    authority: request.authority,
    state: admissionState,
    lease,
  };
  recordIntegratedLeaseAcceptance(disposition);
  return integrated;
}

export function finalizeModuleDeliveryIntegration(
  request: FinalizeModuleDeliveryIntegrationRequest,
): ModuleIntegrationState {
  const inspection: AcceptedPlanStateInspection = {
    authority: request.authority,
    acceptedPlan: request.acceptedPlan,
    state: request.state,
  };
  assertAcceptedPlanState(inspection);
  const authorityInspection: GenerationAuthorityInspection = {
    authority: request.authority,
    generation: request.acceptedPlan.plan.generation,
    planDigest: request.acceptedPlan.planDigest,
  };
  assertModuleDeliveryGenerationAuthority(authorityInspection);
  const provenance = integrationProvenance(request.state);
  if (provenance.authority !== request.authority)
    throw new Error('Module integration authority does not own this state.');
  const freshInspection: FreshModuleIntegrationStateInspection = {
    state: request.state,
    provenance,
  };
  assertFreshModuleIntegrationState(freshInspection);
  const admissionInspection: CurrentModuleIntegrationAdmissionInspection = {
    authority: request.authority,
    state: request.state,
  };
  assertCurrentModuleIntegrationAdmission(admissionInspection);
  if (request.state.phase !== ModuleIntegrationPhase.AcceptingProviders) {
    throw new Error('Module integration is already finalized.');
  }
  const allAccepted = request.acceptedPlan.plan.nodes.every((node) =>
    node.kind === ModuleDeliveryTaskKind.Write
      ? request.state.acceptedWrites.some(
          (entry) => entry.taskId === node.taskId,
        )
      : request.state.acceptedEvidence.some(
          (entry) => entry.taskId === node.taskId,
        ),
  );
  if (!allAccepted) {
    throw new Error('Final module join requires every accepted task result.');
  }
  const handoffs: TreeHandoff[] = request.acceptedPlan.topologicalOrder.flatMap(
    (taskId) =>
      request.state.acceptedWrites
        .filter((entry) => entry.taskId === taskId)
        .map((entry) => ({
          taskId: entry.taskId,
          baselineCommit: entry.startingFrontier,
          commit: entry.handoff.commit,
        })),
  );
  const application: ApplyModuleWaveTreeRequest = {
    workspace: request.state.workspace,
    currentHead: request.state.sourceCommit,
    handoffs,
  };
  const canonicalHead = applyModuleWaveTree(application);
  const refUpdate: UpdateModuleIntegrationRefRequest = {
    provenance,
    nextCommit: canonicalHead,
    rollback: false,
  };
  updateModuleIntegrationRef(refUpdate);
  try {
    const sourceExpectation: SourceSnapshotExpectation = {
      repositoryRoot: request.state.workspace.sourceRepositoryRoot,
      expected: provenance.sourceSnapshot,
    };
    assertSourceSnapshot(sourceExpectation);
    const workspaceExpectation: SourceSnapshotExpectation = {
      repositoryRoot: request.state.workspace.worktreePath,
      expected: provenance.workspaceSnapshot,
    };
    assertSourceSnapshot(workspaceExpectation);
  } catch {
    const rollback: UpdateModuleIntegrationRefRequest = {
      provenance,
      nextCommit: canonicalHead,
      rollback: true,
    };
    updateModuleIntegrationRef(rollback);
    throw new Error('Final module join failed and was fully rolled back.');
  }
  const finalizedState: ModuleIntegrationState = {
    ...request.state,
    phase: ModuleIntegrationPhase.Finalized,
    completedWaveCount: request.acceptedPlan.waves.length,
    headCommit: canonicalHead,
  };
  const frontierRequest: RefreshedWriterFrontiersRequest = {
    authority: request.authority,
    state: finalizedState,
  };
  const capabilities = refreshedWriterFrontiers(frontierRequest);
  const stateRequest: CreateModuleDeliveryAdmissionStateRequest = {
    authority: request.authority,
    acceptedPlan: request.acceptedPlan,
    headCommit: canonicalHead,
    integratedWriterFrontiers: capabilities,
    acceptedEvidence: finalizedState.acceptedEvidence,
  };
  const admissionState = createModuleDeliveryAdmissionState(stateRequest);
  const nextState: ModuleIntegrationState = {
    ...finalizedState,
    admissionState,
  };
  const advance: AdvancedIntegrationStateRequest = {
    previousState: request.state,
    nextState,
    provenance,
    writerFrontiers: capabilities,
  };
  return advancedIntegrationState(advance);
}

export function cleanupModuleIntegration(
  request: CleanupModuleIntegrationRequest,
): CleanupModuleIntegrationResult {
  const session = integrationSession(request.cleanupHandle);
  if (session.cleaned) return { removed: false };
  const deleteInvocation: ModuleGitInvocation = {
    cwd: session.workspace.sourceRepositoryRoot,
    args: ['update-ref', '-d', session.integrationRef, session.currentHead],
  };
  runModuleDeliveryGit(gitRequest(deleteInvocation));
  const cleanupRequest: CleanupModuleWorktreeRequest = {
    workspace: session.workspace,
  };
  try {
    cleanupModuleWorktree(cleanupRequest);
  } catch {
    const restoreInvocation: ModuleGitInvocation = {
      cwd: session.workspace.sourceRepositoryRoot,
      args: [
        'update-ref',
        '--create-reflog',
        session.integrationRef,
        session.currentHead,
        ZERO_COMMIT,
      ],
    };
    runModuleDeliveryGit(gitRequest(restoreInvocation));
    throw new Error('Module integration cleanup failed and restored its ref.');
  }
  session.cleaned = true;
  return { removed: true };
}
