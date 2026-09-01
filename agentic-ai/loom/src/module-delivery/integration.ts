import { randomUUID } from 'node:crypto';

import { gitText, runModuleDeliveryGit } from './git-command.ts';
import { ModuleDeliveryTaskKind } from './domain.ts';
import {
  moduleCommitChangedPaths,
  verifyModuleCommitHandoff,
} from './handoff.ts';
import {
  assertSourceSnapshot,
  assertModuleIntegrationAcceptedPlanState,
  assertFreshModuleIntegrationState,
  assertCurrentModuleIntegrationAdmission,
  assertModuleIntegrationHandoffRepository,
  assertModuleIntegrationLeaseFrontier,
  assertModuleIntegrationProviderPrecedence,
  captureSourceSnapshot,
  cleanupRegisteredModuleIntegration,
  createIntegrationSession,
  integrationProvenance,
  moduleIntegrationCompletedWaveCount,
  moduleIntegrationNodeByTaskId,
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
  moduleDeliveryWriterFrontiers,
  registerModuleDeliveryWriterFrontiers,
} from './integration-writer-frontiers.ts';
import { validatedCanonicalWriterClosure } from './integration-finalization.ts';
import type { CanonicalModuleFinalizationInspection } from './integration-finalization.ts';
import {
  assertModuleDeliveryAttemptLeaseAuthority,
  assertModuleDeliveryAdmissionStateAuthority,
  assertModuleDeliveryAuthorityRepository,
  assertModuleDeliveryGenerationAuthority,
  commitFinalModuleDeliveryAdmissionState,
  createModuleDeliveryAdmissionState,
  moduleDeliveryAcceptedEvidenceIdentity,
  moduleDeliveryAuthorityPlan,
  prepareFinalModuleDeliveryAdmissionState,
  rollbackFinalModuleDeliveryAdmissionState,
  verifyModuleDeliveryEvidenceSubmission,
} from './admission.ts';
import { EXACT_GIT_COMMIT } from './workspace-paths.ts';
import type { ModuleDeliveryEvidenceSubmissionVerification } from './evidence.ts';
import type {
  CommitFinalModuleDeliveryAdmissionStateRequest,
  CreateModuleDeliveryAdmissionStateRequest,
  ModuleDeliveryAdmissionState,
  ModuleDeliveryGenerationAuthority,
  PrepareFinalModuleDeliveryAdmissionStateRequest,
  RollbackFinalModuleDeliveryAdmissionStateRequest,
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
  ModuleDeliveryCanonicalEvidenceTransition,
  AssertModuleDeliveryCanonicalEvidenceTransitionRequest,
  CanonicalEvidenceTransitionProvenance,
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
  AcceptedPlanStateInspection,
  ModuleIntegrationNodeLookup,
  RecordIntegratedLeaseAcceptanceRequest,
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
type ExpectedHandoff = {
  readonly node: WriteModuleDeliveryNode;
  readonly baselineCommit: string;
  readonly submission: ModuleDeliveryHandoffSubmission;
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
type IntegrationStateUpdate = readonly [
  ModuleIntegrationState,
  Partial<ModuleIntegrationState>,
];
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
const PROHIBITED_MATERIALIZATION_FILES = new Set([
  '.gitattributes',
  '.gitmodules',
  '.lfsconfig',
]);
const WRITER_FRONTIER_PROVENANCE = new WeakMap<
  ModuleDeliveryIntegratedWriterFrontierCapability,
  IntegratedWriterFrontierProvenance
>();
const CANONICAL_EVIDENCE_TRANSITIONS = new WeakMap<
  ModuleDeliveryCanonicalEvidenceTransition,
  CanonicalEvidenceTransitionProvenance
>();
function mintIntegratedWriterFrontier(
  request: MintIntegratedWriterFrontierRequest,
): ModuleDeliveryIntegratedWriterFrontierCapability {
  const integratedTaskIds = Object.freeze(request.integratedTaskIds.slice());
  const capabilityValue: ModuleDeliveryIntegratedWriterFrontierCapability = {
    taskId: request.taskId,
    attempt: request.attempt,
    generation: request.generation,
    planDigest: request.planDigest,
    headCommit: request.headCommit,
    integratedTaskIds,
  };
  const capability = Object.freeze(capabilityValue);
  const provenance: IntegratedWriterFrontierProvenance = Object.assign(
    {},
    request,
    { integratedTaskIds },
  );
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
export function assertModuleDeliveryCanonicalEvidenceTransition(
  request: AssertModuleDeliveryCanonicalEvidenceTransitionRequest,
): void {
  const provenance = CANONICAL_EVIDENCE_TRANSITIONS.get(request.transition);
  if (
    !provenance ||
    provenance.authority !== request.authority ||
    provenance.previousHeadCommit !== request.previousHeadCommit ||
    provenance.canonicalHeadCommit !== request.canonicalHeadCommit ||
    JSON.stringify(provenance.integratedTaskIds) !==
      JSON.stringify(request.integratedTaskIds)
  )
    throw new Error('Canonical evidence transition is invalid.');
}
function canonicalEvidenceTransition(
  request: CanonicalEvidenceTransitionProvenance,
): ModuleDeliveryCanonicalEvidenceTransition {
  const integratedTaskIds = Object.freeze(request.integratedTaskIds.slice());
  const transitionValue: ModuleDeliveryCanonicalEvidenceTransition = {
    previousHeadCommit: request.previousHeadCommit,
    canonicalHeadCommit: request.canonicalHeadCommit,
    integratedTaskIds,
  };
  const transition = Object.freeze(transitionValue);
  const provenance: CanonicalEvidenceTransitionProvenance = Object.assign(
    {},
    request,
    { integratedTaskIds },
  );
  CANONICAL_EVIDENCE_TRANSITIONS.set(transition, Object.freeze(provenance));
  return transition;
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
  if (application.expectedHandoffs.length === 0)
    return application.state.headCommit;
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
  updateModuleIntegrationRef({
    provenance: application.provenance,
    nextCommit: headCommit,
    rollback: false,
  });
  return headCommit;
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
  registerModuleDeliveryWriterFrontiers({
    state: immutable,
    writerFrontiers: request.writerFrontiers,
  });
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

function updatedIntegrationState([
  state,
  updates,
]: IntegrationStateUpdate): ModuleIntegrationState {
  return Object.assign({}, state, updates);
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
  try {
    const cleanupHandleValue: ModuleIntegrationCleanupHandle = {
      sessionId: `${request.acceptedPlan.planDigest}:${randomUUID()}`,
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
      integrationRef: '',
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
    registerModuleDeliveryWriterFrontiers({
      state: immutable,
      writerFrontiers: Object.freeze([]),
    });
    return immutable;
  } catch {
    const cleanupRequest: CleanupModuleWorktreeRequest = { workspace };
    cleanupModuleWorktree(cleanupRequest);
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
  moduleDeliveryAuthorityPlan(inspection);
  assertModuleIntegrationAcceptedPlanState(inspection);
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
  const lookup: ModuleIntegrationNodeLookup = {
    acceptedPlan: request.acceptedPlan,
    taskId,
  };
  const node = moduleIntegrationNodeByTaskId(lookup);
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
      const provisionalState = updatedIntegrationState([
        request.state,
        {
          integratedTaskIds: request.state.integratedTaskIds.concat(taskId),
          acceptedWrites: request.state.acceptedWrites.concat({
            taskId,
            attempt: request.submission.handoff.attempt,
            generation: request.submission.generation,
            planDigest: request.submission.handoff.planDigest,
            startingFrontier: lease.startingFrontier,
            integrationCommit: headCommit,
            acceptedByTeam: request.submission.acceptedByTeam,
            handoff: request.submission.handoff,
          }),
          headCommit,
        },
      ]);
      const waveCountRequest: ModuleIntegrationCompletedWaveCountRequest = {
        acceptedPlan: request.acceptedPlan,
        state: provisionalState,
      };
      const stateWithWrite = updatedIntegrationState([
        provisionalState,
        {
          completedWaveCount:
            moduleIntegrationCompletedWaveCount(waveCountRequest),
        },
      ]);
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
      const nextState = updatedIntegrationState([
        stateWithWrite,
        { admissionState },
      ]);
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
      throw new Error('Shared-branch handoff acceptance failed.');
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
  const provisionalState = updatedIntegrationState([
    request.state,
    { acceptedEvidence: request.state.acceptedEvidence.concat(accepted) },
  ]);
  const waveCountRequest: ModuleIntegrationCompletedWaveCountRequest = {
    acceptedPlan: request.acceptedPlan,
    state: provisionalState,
  };
  const stateWithEvidence = updatedIntegrationState([
    provisionalState,
    {
      completedWaveCount: moduleIntegrationCompletedWaveCount(waveCountRequest),
    },
  ]);
  const capabilities = moduleDeliveryWriterFrontiers(request.state);
  const stateRequest: CreateModuleDeliveryAdmissionStateRequest = {
    authority: request.authority,
    acceptedPlan: request.acceptedPlan,
    headCommit: stateWithEvidence.headCommit,
    integratedWriterFrontiers: capabilities,
    acceptedEvidence: stateWithEvidence.acceptedEvidence,
  };
  const admissionState = createModuleDeliveryAdmissionState(stateRequest);
  const nextState = updatedIntegrationState([
    stateWithEvidence,
    { admissionState },
  ]);
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
  moduleDeliveryAuthorityPlan(inspection);
  assertModuleIntegrationAcceptedPlanState(inspection);
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
  const canonicalHead =
    handoffs.length === 0
      ? request.state.headCommit
      : applyModuleWaveTree(application);
  const canonicalInspection: CanonicalModuleFinalizationInspection = {
    repositoryRoot: request.state.workspace.sourceRepositoryRoot,
    previousHeadCommit: request.state.headCommit,
    canonicalHeadCommit: canonicalHead,
    acceptedPlan: request.acceptedPlan,
    integratedTaskIds: request.state.integratedTaskIds,
  };
  const writerTaskIds = validatedCanonicalWriterClosure(canonicalInspection);
  const finalizedState = updatedIntegrationState([
    request.state,
    {
      phase: ModuleIntegrationPhase.Finalized,
      completedWaveCount: request.acceptedPlan.waves.length,
      headCommit: canonicalHead,
    },
  ]);
  const frontierRequest: RefreshedWriterFrontiersRequest = {
    authority: request.authority,
    state: finalizedState,
  };
  const capabilities = refreshedWriterFrontiers(frontierRequest);
  const transitionRequest: CanonicalEvidenceTransitionProvenance = {
    authority: request.authority,
    previousHeadCommit: request.state.headCommit,
    canonicalHeadCommit: canonicalHead,
    integratedTaskIds: writerTaskIds,
  };
  const canonicalTransition = canonicalEvidenceTransition(transitionRequest);
  const stateRequest: PrepareFinalModuleDeliveryAdmissionStateRequest = {
    authority: request.authority,
    acceptedPlan: request.acceptedPlan,
    headCommit: canonicalHead,
    integratedWriterFrontiers: capabilities,
    acceptedEvidence: finalizedState.acceptedEvidence,
    previousState: request.state.admissionState,
    canonicalTransition,
  };
  const admissionState = prepareFinalModuleDeliveryAdmissionState(stateRequest);
  const nextState = updatedIntegrationState([
    finalizedState,
    { admissionState },
  ]);
  const advance: AdvancedIntegrationStateRequest = {
    previousState: request.state,
    nextState,
    provenance,
    writerFrontiers: capabilities,
  };
  const refUpdate: UpdateModuleIntegrationRefRequest = {
    provenance,
    nextCommit: canonicalHead,
    rollback: false,
  };
  updateModuleIntegrationRef(refUpdate);
  try {
    const commitRequest: CommitFinalModuleDeliveryAdmissionStateRequest = {
      authority: request.authority,
      previousState: request.state.admissionState,
      state: admissionState,
    };
    commitFinalModuleDeliveryAdmissionState(commitRequest);
    return advancedIntegrationState(advance);
  } catch {
    const admissionRollback: RollbackFinalModuleDeliveryAdmissionStateRequest =
      {
        authority: request.authority,
        finalizedState: admissionState,
        previousState: request.state.admissionState,
      };
    rollbackFinalModuleDeliveryAdmissionState(admissionRollback);
    const refRollback: UpdateModuleIntegrationRefRequest = {
      provenance,
      nextCommit: canonicalHead,
      rollback: true,
    };
    updateModuleIntegrationRef(refRollback);
    throw new Error('Final module join failed and was fully rolled back.');
  }
}

export function cleanupModuleIntegration(
  request: CleanupModuleIntegrationRequest,
): CleanupModuleIntegrationResult {
  return cleanupRegisteredModuleIntegration(request);
}
