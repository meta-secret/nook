import {
  authenticateModuleDeliverySourceCommit,
  copyModuleDeliveryAdmission,
  createAcceptedModuleDeliveryEvidenceRegistry,
  expectedModuleDeliveryLineageMap,
  frozenModuleDeliveryResources,
  freezeModuleDeliveryAdmissionSelection,
  moduleDeliveryResourcesConflict,
  moduleDeliveryNode as nodeFor,
  trustedModuleDeliveryPlanSnapshot,
} from './authority.ts';
import {
  ModuleDeliveryBaselineKind,
  ModuleDeliveryTaskKind,
} from './domain.ts';
import { validateModuleDeliveryEvidenceSubmission } from './evidence.ts';
import {
  assertModuleDeliveryCanonicalEvidenceTransition,
  assertModuleDeliveryIntegratedWriterFrontierCapability,
} from './integration.ts';
import {
  admissionStateAuthority,
  assertAdmissionStateCurrent,
  commitFinalAdmissionState,
  createModuleDeliveryAdmissionStateStore,
  createAdmissionState,
  prepareFinalAdmissionState,
  registerAdmissionState,
  rollbackFinalAdmissionState,
} from './admission-state.ts';
import type {
  ModuleDeliveryAcceptedProviderEvidenceIdentity,
  ModuleDeliveryEvidenceSubmissionValidation,
  ModuleDeliveryEvidenceSubmissionVerification,
} from './evidence.ts';
import type { AgentAttemptParent } from '../agent-workflow/domain.ts';
import type { TeamKey } from '../team-agents/catalog.ts';
import { admitCortexAuthoringContext } from './cortex-context.ts';
import type { AdmitCortexAuthoringContextRequest } from './cortex-context.ts';
import type { TeamTaskContext } from '../team-agents/context.ts';
import type {
  ModuleDeliveryNodeV2,
  ModuleDeliveryOwnerIdentity,
  ModuleDeliveryResourceClaims,
  ValidatedModuleDeliveryPlan,
} from './domain.ts';
import type {
  AcceptedModuleDeliveryEvidence,
  AdmissionStateAuthorityInspection,
  AttemptLeaseAuthorityInspection,
  GenerationAuthorityInspection,
  ModuleDeliveryAuthorityPlanRequest,
  ModuleDeliveryAuthorityRepositoryInspection,
  ModuleDeliveryDispositionOutcome,
  RecordModuleDeliveryAttemptDispositionRequest,
} from './integration-provenance.ts';
import type { ModuleDeliveryIntegratedWriterFrontierCapability } from './integration.ts';
import type { ModuleDeliveryCanonicalEvidenceTransition } from './integration-provenance.ts';
import type {
  AcceptedModuleDeliveryEvidenceCollectionRequest,
  AcceptedModuleDeliveryEvidenceRegistry,
  AcceptedModuleDeliveryEvidenceInspection,
  AcceptedModuleDeliveryEvidenceRegistration,
  AuthenticateModuleDeliverySourceCommitRequest,
  ExpectedLineageMapRequest,
  FrozenModuleDeliveryResourcesRequest,
  ResourceConflictRequest,
} from './authority.ts';

const AUTHORITY = Symbol('module-delivery-generation-authority');
const admissionStateStoreAuthorities = {
  assertCanonicalTransition: assertModuleDeliveryCanonicalEvidenceTransition,
  assertWriterFrontier: assertModuleDeliveryIntegratedWriterFrontierCapability,
};
const admissionStateStore = createModuleDeliveryAdmissionStateStore(
  admissionStateStoreAuthorities,
);
export enum ModuleDeliveryAdmissionSelectionStatus {
  Selected = 'selected',
  Blocked = 'blocked',
}
export enum ModuleDeliveryAttemptDispositionKind {
  Accepted = 'accepted',
  FinalUnusable = 'final-unusable',
}
export enum ModuleDeliveryGenerationFenceKind {
  Accepted = 'accepted',
  Cancelled = 'cancelled',
  Failed = 'failed',
  Rejected = 'rejected',
}
export type ModuleDeliveryGenerationAuthority = Readonly<{
  [AUTHORITY]: true;
}>;
export type ModuleDeliveryExpectedLineage = Readonly<{
  taskId: string;
  parentLineage: AgentAttemptParent;
}>;
export type CreateModuleDeliveryGenerationAuthorityRequest = {
  readonly acceptedPlan: ValidatedModuleDeliveryPlan;
  readonly expectedLineage: readonly ModuleDeliveryExpectedLineage[];
  readonly repositoryRoot: string;
};
export type CreateModuleDeliveryAdmissionStateRequest = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly acceptedPlan: ValidatedModuleDeliveryPlan;
  readonly headCommit: string;
  readonly integratedWriterFrontiers: readonly ModuleDeliveryIntegratedWriterFrontierCapability[];
  readonly acceptedEvidence: readonly AcceptedModuleDeliveryEvidence[];
};
export type PrepareFinalModuleDeliveryAdmissionStateRequest =
  CreateModuleDeliveryAdmissionStateRequest & {
    readonly previousState: ModuleDeliveryAdmissionState;
    readonly canonicalTransition: ModuleDeliveryCanonicalEvidenceTransition;
  };
export type CommitFinalModuleDeliveryAdmissionStateRequest = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  previousState: ModuleDeliveryAdmissionState;
  state: ModuleDeliveryAdmissionState;
}>;
export type RollbackFinalModuleDeliveryAdmissionStateRequest = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  finalizedState: ModuleDeliveryAdmissionState;
  previousState: ModuleDeliveryAdmissionState;
}>;
export type RestartModuleDeliveryGenerationRequest = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly previousState: ModuleDeliveryAdmissionState;
  readonly acceptedPlan: ValidatedModuleDeliveryPlan;
  readonly expectedLineage: readonly ModuleDeliveryExpectedLineage[];
};
type AttemptIdentity = Readonly<{
  taskId: string;
  attempt: number;
  generation: number;
  planDigest: string;
}>;
export type ModuleDeliveryAdmission = AttemptIdentity & {
  readonly startingFrontier: string;
  readonly resources: ModuleDeliveryResourceClaims;
  readonly context?: TeamTaskContext;
  readonly team: TeamKey;
  readonly functionalOwner: ModuleDeliveryOwnerIdentity;
  readonly acceptanceOwner: ModuleDeliveryOwnerIdentity;
  readonly parentLineage: AgentAttemptParent;
  readonly acceptanceRequirements: readonly string[];
  readonly authorizedProviderEvidence: readonly ModuleDeliveryAcceptedProviderEvidenceIdentity[];
};
export type ModuleDeliveryAttemptLease = ModuleDeliveryAdmission;
export type ModuleDeliveryAttemptDisposition = AttemptIdentity & {
  readonly kind: ModuleDeliveryAttemptDispositionKind;
  readonly conclusion: ModuleDeliveryGenerationFenceKind;
};
export type ModuleDeliveryAdmissionState = Readonly<{
  generation: number;
  planDigest: string;
  headCommit: string;
  integratedWriterFrontiers: readonly ModuleDeliveryIntegratedWriterFrontierCapability[];
  acceptedProviderEvidence: readonly ModuleDeliveryAcceptedProviderEvidenceIdentity[];
}>;
export type SelectModuleDeliveryAdmissionsRequest = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly acceptedPlan: ValidatedModuleDeliveryPlan;
  readonly state: ModuleDeliveryAdmissionState;
};
export type ModuleDeliveryAdmissionSelection = {
  readonly status: ModuleDeliveryAdmissionSelectionStatus;
  readonly admissions: readonly ModuleDeliveryAdmission[];
  readonly pendingTaskIds: readonly string[];
  readonly blockedTaskIds: readonly string[];
};
export type RecordModuleDeliveryAttemptLeasesRequest = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly state: ModuleDeliveryAdmissionState;
  readonly admissions: readonly ModuleDeliveryAdmission[];
};
export type ModuleDeliveryLeaseRecording = {
  readonly state: ModuleDeliveryAdmissionState;
  readonly leases: readonly ModuleDeliveryAttemptLease[];
};
type AuthorityState = {
  repositoryRoot: string;
  inputPlan: ValidatedModuleDeliveryPlan;
  acceptedPlan: ValidatedModuleDeliveryPlan;
  expectedLineage: ReadonlyMap<string, AgentAttemptParent>;
  activeLeases: Map<string, ModuleDeliveryAttemptLease>;
  leaseHistory: Map<string, ModuleDeliveryAttemptLease>;
  attemptsByTask: Map<string, number>;
  dispositions: ModuleDeliveryAttemptDisposition[];
  evidenceRegistry: AcceptedModuleDeliveryEvidenceRegistry;
};
type CapabilityProvenance = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly state: ModuleDeliveryAdmissionState;
};
type NodeLookupRequest = {
  readonly plan: ValidatedModuleDeliveryPlan;
  readonly taskId: string;
};
type AuthorityTaskRequest = {
  readonly authority: AuthorityState;
  readonly taskId: string;
};
type TaskReadyRequest = {
  readonly authority: AuthorityState;
  readonly state: ModuleDeliveryAdmissionState;
  readonly node: ModuleDeliveryNodeV2;
};
type SynthesisReadyRequest = {
  readonly state: ModuleDeliveryAdmissionState;
  readonly node: ModuleDeliveryNodeV2;
};
type DispositionValidationRequest = {
  readonly authority: AuthorityState;
  readonly state: ModuleDeliveryAdmissionState;
  readonly lease: ModuleDeliveryAttemptLease;
  readonly outcome: ModuleDeliveryDispositionOutcome;
};
type StartingFrontierRequest = {
  readonly authority: AuthorityState;
  readonly state: ModuleDeliveryAdmissionState;
  readonly node: ModuleDeliveryNodeV2;
  readonly plan: ValidatedModuleDeliveryPlan;
};
const authorityStates = new WeakMap<
  ModuleDeliveryGenerationAuthority,
  AuthorityState
>();
const admissionProvenance = new WeakMap<
  ModuleDeliveryAdmission,
  CapabilityProvenance
>();
const leaseProvenance = new WeakMap<
  ModuleDeliveryAttemptLease,
  CapabilityProvenance
>();
const consumedAdmissions = new WeakSet<ModuleDeliveryAdmission>();
const disposedLeases = new WeakSet<ModuleDeliveryAttemptLease>();
const acceptedEvidenceLeases = new WeakSet<ModuleDeliveryAttemptLease>();
const evidenceAuthorities = new WeakMap<
  AcceptedModuleDeliveryEvidence,
  ModuleDeliveryGenerationAuthority
>();
const COMMIT = /^[0-9a-f]{40}$/u;

export function createModuleDeliveryGenerationAuthority(
  request: CreateModuleDeliveryGenerationAuthorityRequest,
): ModuleDeliveryGenerationAuthority {
  const acceptedPlan = trustedModuleDeliveryPlanSnapshot(request.acceptedPlan);
  const authenticationRequest: AuthenticateModuleDeliverySourceCommitRequest = {
    repositoryRoot: request.repositoryRoot,
    sourceCommit: acceptedPlan.plan.sourceCommit,
  };
  const repositoryRoot = authenticateModuleDeliverySourceCommit(
    authenticationRequest,
  );
  const lineageRequest: ExpectedLineageMapRequest = {
    acceptedPlan,
    entries: request.expectedLineage,
  };
  const expectedLineage = expectedModuleDeliveryLineageMap(lineageRequest);
  const value: ModuleDeliveryGenerationAuthority = { [AUTHORITY]: true };
  const authority = Object.freeze(value);
  const authorityState: AuthorityState = {
    repositoryRoot,
    inputPlan: request.acceptedPlan,
    acceptedPlan,
    expectedLineage,
    activeLeases: new Map(),
    leaseHistory: new Map(),
    attemptsByTask: new Map(),
    dispositions: [],
    evidenceRegistry: createAcceptedModuleDeliveryEvidenceRegistry(),
  };
  authorityStates.set(authority, authorityState);
  return authority;
}

export function assertModuleDeliveryGenerationAuthority(
  inspection: GenerationAuthorityInspection,
): void {
  const state = authorityStates.get(inspection.authority);
  if (
    !state ||
    state.acceptedPlan.plan.generation !== inspection.generation ||
    state.acceptedPlan.planDigest !== inspection.planDigest
  )
    throw new Error(
      'Module delivery generation authority is invalid or superseded.',
    );
}

export function moduleDeliveryAuthorityPlan(
  request: ModuleDeliveryAuthorityPlanRequest,
): ValidatedModuleDeliveryPlan {
  return trustedModuleDeliveryPlanSnapshot(
    authorityStateForPlan(request).acceptedPlan,
  );
}

export function assertModuleDeliveryAuthorityRepository(
  inspection: ModuleDeliveryAuthorityRepositoryInspection,
): void {
  const authority = requiredAuthority(inspection.authority);
  const authentication: AuthenticateModuleDeliverySourceCommitRequest = {
    repositoryRoot: inspection.repositoryRoot,
    sourceCommit: authority.acceptedPlan.plan.sourceCommit,
  };
  if (
    authenticateModuleDeliverySourceCommit(authentication) !==
    authority.repositoryRoot
  )
    throw new Error('Module delivery repository authority is invalid.');
}

export function assertAcceptedModuleDeliveryEvidence(
  inspection: AcceptedModuleDeliveryEvidenceInspection,
): void {
  requiredAuthority(inspection.authority).evidenceRegistry.assert(inspection);
}

export function moduleDeliveryAcceptedEvidenceIdentity(
  evidence: AcceptedModuleDeliveryEvidence,
): ModuleDeliveryAcceptedProviderEvidenceIdentity {
  const authority = authorityForAcceptedEvidence(evidence);
  return authority.evidenceRegistry.identity(evidence);
}

export function verifyModuleDeliveryEvidenceSubmission(
  verification: ModuleDeliveryEvidenceSubmissionVerification,
): AcceptedModuleDeliveryEvidence {
  const authority = requiredAuthority(verification.authority);
  const planRequest: ModuleDeliveryAuthorityPlanRequest = {
    authority: verification.authority,
    acceptedPlan: verification.acceptedPlan,
  };
  const acceptedPlan = moduleDeliveryAuthorityPlan(planRequest);
  const generationInspection: GenerationAuthorityInspection = {
    authority: verification.authority,
    generation: acceptedPlan.plan.generation,
    planDigest: acceptedPlan.planDigest,
  };
  assertModuleDeliveryGenerationAuthority(generationInspection);
  const leaseInspection: AttemptLeaseAuthorityInspection = {
    authority: verification.authority,
    lease: verification.lease,
  };
  assertModuleDeliveryAttemptLeaseAuthority(leaseInspection);
  const stateInspection: AdmissionStateAuthorityInspection = {
    authority: verification.authority,
    state: verification.state,
  };
  assertModuleDeliveryAdmissionStateAuthority(stateInspection);
  if (acceptedEvidenceLeases.has(verification.lease))
    throw new Error(
      `Evidence metadata is invalid for ${verification.lease.taskId}.`,
    );
  const seen = new Set<string>();
  const authorized = Object.freeze(
    verification.authorizedProviderEvidence.map((evidence) => {
      const inspection: AcceptedModuleDeliveryEvidenceInspection = {
        authority: verification.authority,
        evidence,
      };
      authority.evidenceRegistry.assert(inspection);
      const identity = authority.evidenceRegistry.identity(evidence);
      if (seen.has(identity.taskId))
        throw new Error(`Duplicate accepted evidence for ${identity.taskId}.`);
      seen.add(identity.taskId);
      return identity;
    }),
  );
  const validation: ModuleDeliveryEvidenceSubmissionValidation = {
    verification,
    acceptedPlan,
    authorized,
  };
  const accepted = validateModuleDeliveryEvidenceSubmission(validation);
  const integratedTaskIds =
    verification.state.integratedWriterFrontiers[0]?.integratedTaskIds ?? [];
  const registration: AcceptedModuleDeliveryEvidenceRegistration = {
    authority: verification.authority,
    evidence: accepted,
    integratedTaskIds,
  };
  authority.evidenceRegistry.register(registration);
  evidenceAuthorities.set(accepted, verification.authority);
  acceptedEvidenceLeases.add(verification.lease);
  return accepted;
}

export function createModuleDeliveryAdmissionState(
  request: CreateModuleDeliveryAdmissionStateRequest,
): ModuleDeliveryAdmissionState {
  const authority = authorityStateForPlan(request);
  const materialization = {
    store: admissionStateStore,
    request,
    acceptedPlan: authority.acceptedPlan,
    evidenceRegistry: authority.evidenceRegistry,
    evidenceHeadCommit: request.headCommit,
  };
  return createAdmissionState(materialization);
}

export function prepareFinalModuleDeliveryAdmissionState(
  request: PrepareFinalModuleDeliveryAdmissionStateRequest,
): ModuleDeliveryAdmissionState {
  const authority = authorityStateForPlan(request);
  const materialization = {
    store: admissionStateStore,
    request,
    acceptedPlan: authority.acceptedPlan,
    evidenceRegistry: authority.evidenceRegistry,
    evidenceHeadCommit: request.previousState.headCommit,
  };
  return prepareFinalAdmissionState(materialization);
}

export function commitFinalModuleDeliveryAdmissionState(
  request: CommitFinalModuleDeliveryAdmissionStateRequest,
): void {
  const commitRequest = { ...request, store: admissionStateStore };
  commitFinalAdmissionState(commitRequest);
}

export function rollbackFinalModuleDeliveryAdmissionState(
  request: RollbackFinalModuleDeliveryAdmissionStateRequest,
): void {
  const rollbackRequest = { ...request, store: admissionStateStore };
  rollbackFinalAdmissionState(rollbackRequest);
}

export function restartModuleDeliveryGeneration(
  request: RestartModuleDeliveryGenerationRequest,
): ModuleDeliveryAdmissionState {
  const stateInspection: AdmissionStateAuthorityInspection = {
    authority: request.authority,
    state: request.previousState,
  };
  assertModuleDeliveryAdmissionStateAuthority(stateInspection);
  const authority = requiredAuthority(request.authority);
  const dispositionKeys = new Set(authority.dispositions.map(attemptKey));
  if (
    authority.activeLeases.size > 0 ||
    [...authority.leaseHistory.values()].some(
      (lease) => !dispositionKeys.has(attemptKey(lease)),
    )
  )
    throw new Error(
      'Generation restart requires authoritative terminal release evidence.',
    );
  const acceptedPlan = trustedModuleDeliveryPlanSnapshot(request.acceptedPlan);
  if (acceptedPlan.plan.generation <= request.previousState.generation)
    throw new Error(
      'A superseding module plan requires a newer immutable generation.',
    );
  const authenticationRequest: AuthenticateModuleDeliverySourceCommitRequest = {
    repositoryRoot: authority.repositoryRoot,
    sourceCommit: acceptedPlan.plan.sourceCommit,
  };
  authenticateModuleDeliverySourceCommit(authenticationRequest);
  const lineageRequest: ExpectedLineageMapRequest = {
    acceptedPlan,
    entries: request.expectedLineage,
  };
  const expectedLineage = expectedModuleDeliveryLineageMap(lineageRequest);
  const previousTaskIds = new Set(
    authority.acceptedPlan.plan.nodes.map(({ taskId }) => taskId),
  );
  const attemptsByTask = new Map<string, number>();
  for (const { taskId } of acceptedPlan.plan.nodes) {
    const attempts = authority.attemptsByTask.get(taskId);
    if (previousTaskIds.has(taskId) && attempts)
      attemptsByTask.set(taskId, attempts);
  }
  const frontiers: readonly ModuleDeliveryIntegratedWriterFrontierCapability[] =
    Object.freeze([]);
  const identities: readonly ModuleDeliveryAcceptedProviderEvidenceIdentity[] =
    Object.freeze([]);
  const evidence: readonly AcceptedModuleDeliveryEvidence[] = Object.freeze([]);
  const stateValue: ModuleDeliveryAdmissionState = {
    generation: acceptedPlan.plan.generation,
    planDigest: acceptedPlan.planDigest,
    headCommit: acceptedPlan.plan.sourceCommit,
    integratedWriterFrontiers: frontiers,
    acceptedProviderEvidence: identities,
  };
  const state = Object.freeze(stateValue);
  const stateRegistration = {
    store: admissionStateStore,
    authority: request.authority,
    state,
    acceptedEvidence: evidence,
  };
  const evidenceRegistry = createAcceptedModuleDeliveryEvidenceRegistry();
  authority.inputPlan = request.acceptedPlan;
  authority.acceptedPlan = acceptedPlan;
  authority.expectedLineage = expectedLineage;
  authority.activeLeases = new Map();
  authority.leaseHistory = new Map();
  authority.attemptsByTask = attemptsByTask;
  authority.dispositions = [];
  authority.evidenceRegistry = evidenceRegistry;
  registerAdmissionState(stateRegistration);
  return state;
}

export function assertModuleDeliveryAdmissionStateAuthority(
  inspection: AdmissionStateAuthorityInspection,
): void {
  const authority = authorityStates.get(inspection.authority);
  if (!authority)
    throw new Error(
      'Module delivery admission state authority is invalid or stale.',
    );
  const currentInspection = {
    store: admissionStateStore,
    authority: inspection.authority,
    state: inspection.state,
    generation: authority.acceptedPlan.plan.generation,
    planDigest: authority.acceptedPlan.planDigest,
  };
  assertAdmissionStateCurrent(currentInspection);
}

export function selectModuleDeliveryAdmissions(
  request: SelectModuleDeliveryAdmissionsRequest,
): ModuleDeliveryAdmissionSelection {
  const planRequest: ModuleDeliveryAuthorityPlanRequest = request;
  const authority = authorityStateForPlan(planRequest);
  assertModuleDeliveryAdmissionStateAuthority(request);
  const blockedTaskIds = terminallyBlockedTaskIds(authority);
  const available =
    authority.acceptedPlan.plan.maxConcurrency - authority.activeLeases.size;
  const admissions: ModuleDeliveryAdmission[] = [];
  const pendingTaskIds: string[] = [];
  for (const taskId of authority.acceptedPlan.topologicalOrder) {
    const nodeRequest: NodeLookupRequest = {
      plan: authority.acceptedPlan,
      taskId,
    };
    const node = nodeFor(nodeRequest);
    const taskRequest: AuthorityTaskRequest = { authority, taskId };
    const readyRequest: TaskReadyRequest = {
      authority,
      state: request.state,
      node,
    };
    if (
      blockedTaskIds.includes(taskId) ||
      !taskPending(taskRequest) ||
      !taskReady(readyRequest)
    )
      continue;
    const resourcesRequest: FrozenModuleDeliveryResourcesRequest = {
      node,
      plan: authority.acceptedPlan,
    };
    const resources = frozenModuleDeliveryResources(resourcesRequest);
    if (
      admissions.length >= Math.max(available, 0) ||
      [...authority.activeLeases.values(), ...admissions].some((active) => {
        const conflictRequest: ResourceConflictRequest = {
          first: resources,
          second: active.resources,
        };
        return moduleDeliveryResourcesConflict(conflictRequest);
      })
    ) {
      pendingTaskIds.push(taskId);
      continue;
    }
    const attemptRequest: AuthorityTaskRequest = { authority, taskId };
    const frontierRequest: StartingFrontierRequest = {
      authority,
      state: request.state,
      node,
      plan: authority.acceptedPlan,
    };
    const authorizedProviderEvidence =
      node.kind === ModuleDeliveryTaskKind.EvidenceSynthesis
        ? Object.freeze(
            node.evidenceInput.expectedProducers.map((producer) => {
              const identity = request.state.acceptedProviderEvidence.find(
                ({ taskId }) => taskId === producer.taskId,
              );
              if (!identity)
                throw new Error(
                  `Accepted evidence is missing for ${producer.taskId}.`,
                );
              return identity;
            }),
          )
        : Object.freeze([]);
    const contextFields: { context?: TeamTaskContext } = {};
    if (node.kind === ModuleDeliveryTaskKind.Write && node.cortexAuthoring) {
      const contextAdmissionRequest: AdmitCortexAuthoringContextRequest = {
        repositoryRoot: authority.repositoryRoot,
        startingFrontier: startingFrontier(frontierRequest),
        node,
        resources,
      };
      contextFields.context = admitCortexAuthoringContext(
        contextAdmissionRequest,
      );
    }
    const admissionValue: ModuleDeliveryAdmission = {
      taskId,
      attempt: nextAttempt(attemptRequest),
      generation: request.state.generation,
      planDigest: request.state.planDigest,
      startingFrontier: startingFrontier(frontierRequest),
      resources,
      ...contextFields,
      team: node.team,
      functionalOwner: node.functionalOwner,
      acceptanceOwner: node.acceptanceOwner,
      parentLineage: expectedParent(taskRequest),
      acceptanceRequirements: Object.freeze([...node.acceptance.evidence]),
      authorizedProviderEvidence,
    };
    const admission = Object.freeze(admissionValue);
    const provenance: CapabilityProvenance = {
      authority: request.authority,
      state: request.state,
    };
    admissionProvenance.set(admission, provenance);
    admissions.push(admission);
  }
  const selectionRequest = {
    status:
      admissions.length > 0 ||
      authority.activeLeases.size > 0 ||
      pendingTaskIds.length > 0 ||
      blockedTaskIds.length === 0
        ? ModuleDeliveryAdmissionSelectionStatus.Selected
        : ModuleDeliveryAdmissionSelectionStatus.Blocked,
    admissions,
    pendingTaskIds,
    blockedTaskIds,
  };
  return freezeModuleDeliveryAdmissionSelection(selectionRequest);
}

export function recordModuleDeliveryAttemptLeases(
  request: RecordModuleDeliveryAttemptLeasesRequest,
): ModuleDeliveryLeaseRecording {
  assertModuleDeliveryAdmissionStateAuthority(request);
  const authority = requiredAuthority(request.authority);
  if (
    request.admissions.length === 0 ||
    authority.activeLeases.size + request.admissions.length >
      authority.acceptedPlan.plan.maxConcurrency
  )
    throw new Error('Module delivery admission capability is invalid.');
  const seenTasks = new Set(
    [...authority.activeLeases.values()].map(({ taskId }) => taskId),
  );
  const compatible: ModuleDeliveryAdmission[] = [
    ...authority.activeLeases.values(),
  ];
  const seenAdmissions = new Set<ModuleDeliveryAdmission>();
  for (const admission of request.admissions) {
    const provenance = admissionProvenance.get(admission);
    const key = attemptKey(admission);
    if (
      !provenance ||
      provenance.authority !== request.authority ||
      provenance.state !== request.state ||
      consumedAdmissions.has(admission) ||
      seenAdmissions.has(admission) ||
      seenTasks.has(admission.taskId) ||
      authority.leaseHistory.has(key)
    )
      throw new Error('Module delivery admission capability is invalid.');
    if (
      compatible.some((active) => {
        const conflictRequest: ResourceConflictRequest = {
          first: admission.resources,
          second: active.resources,
        };
        return moduleDeliveryResourcesConflict(conflictRequest);
      })
    )
      throw new Error('Module delivery admission capability is invalid.');
    seenAdmissions.add(admission);
    seenTasks.add(admission.taskId);
    compatible.push(admission);
  }
  const leases = request.admissions.map((admission) => {
    consumedAdmissions.add(admission);
    const lease = Object.freeze(copyModuleDeliveryAdmission(admission));
    authority.activeLeases.set(attemptKey(lease), lease);
    authority.leaseHistory.set(attemptKey(lease), lease);
    authority.attemptsByTask.set(lease.taskId, lease.attempt);
    const provenance: CapabilityProvenance = {
      authority: request.authority,
      state: request.state,
    };
    leaseProvenance.set(lease, provenance);
    return lease;
  });
  const recording: ModuleDeliveryLeaseRecording = {
    state: request.state,
    leases: Object.freeze(leases),
  };
  return Object.freeze(recording);
}

export function assertModuleDeliveryAttemptLeaseAuthority(
  inspection: AttemptLeaseAuthorityInspection,
): void {
  const authority = requiredAuthority(inspection.authority);
  const provenance = leaseProvenance.get(inspection.lease);
  if (
    !provenance ||
    provenance.authority !== inspection.authority ||
    authority.activeLeases.get(attemptKey(inspection.lease)) !==
      inspection.lease ||
    inspection.lease.generation !== authority.acceptedPlan.plan.generation ||
    inspection.lease.planDigest !== authority.acceptedPlan.planDigest
  )
    throw new Error('Module delivery lease authority is invalid.');
}

export function recordModuleDeliveryAttemptDisposition(
  request: RecordModuleDeliveryAttemptDispositionRequest,
): ModuleDeliveryAdmissionState {
  assertModuleDeliveryAdmissionStateAuthority(request);
  assertModuleDeliveryAttemptLeaseAuthority(request);
  const authority = requiredAuthority(request.authority);
  const key = attemptKey(request.lease);
  const dispositionRequest: DispositionValidationRequest = {
    authority,
    state: request.state,
    lease: request.lease,
    outcome: request.outcome,
  };
  if (
    disposedLeases.has(request.lease) ||
    authority.activeLeases.get(key) !== request.lease ||
    !validDisposition(dispositionRequest)
  )
    throw new Error('Module delivery lease capability is invalid.');
  disposedLeases.add(request.lease);
  authority.activeLeases.delete(key);
  const dispositionValue: ModuleDeliveryAttemptDisposition = {
    taskId: request.lease.taskId,
    attempt: request.lease.attempt,
    generation: request.lease.generation,
    planDigest: request.lease.planDigest,
    ...request.outcome,
  };
  authority.dispositions.push(Object.freeze(dispositionValue));
  return request.state;
}

function requiredAuthority(
  authority: ModuleDeliveryGenerationAuthority,
): AuthorityState {
  const state = authorityStates.get(authority);
  if (!state)
    throw new Error('Module delivery generation authority is invalid.');
  return state;
}

function authorityForAcceptedEvidence(
  evidence: AcceptedModuleDeliveryEvidence,
): AuthorityState {
  const authority = evidenceAuthorities.get(evidence);
  if (!authority)
    throw new Error('Accepted module delivery evidence is forged.');
  return requiredAuthority(authority);
}

function authorityForState(
  state: ModuleDeliveryAdmissionState,
): AuthorityState {
  const request = { store: admissionStateStore, state };
  return requiredAuthority(admissionStateAuthority(request));
}

function expectedParent(request: AuthorityTaskRequest): AgentAttemptParent {
  const parent = request.authority.expectedLineage.get(request.taskId);
  if (!parent) throw new Error('Expected lineage is missing.');
  return parent;
}

function acceptedAttemptKeys(authority: AuthorityState): ReadonlySet<string> {
  return new Set(
    authority.dispositions
      .filter(
        ({ kind }) => kind === ModuleDeliveryAttemptDispositionKind.Accepted,
      )
      .map(attemptKey),
  );
}

function authorityStateForPlan(
  request: ModuleDeliveryAuthorityPlanRequest,
): AuthorityState {
  const state = requiredAuthority(request.authority);
  if (state.inputPlan !== request.acceptedPlan)
    throw new Error(
      'Module delivery validated plan authority is invalid or superseded.',
    );
  return state;
}

function taskPending(request: AuthorityTaskRequest): boolean {
  return (
    ![...request.authority.activeLeases.values()].some(
      (lease) => lease.taskId === request.taskId,
    ) &&
    !request.authority.dispositions.some(
      (entry) =>
        entry.taskId === request.taskId &&
        entry.kind === ModuleDeliveryAttemptDispositionKind.Accepted,
    ) &&
    nextAttempt(request) <= request.authority.acceptedPlan.plan.maxAttempts
  );
}

function taskReady(request: TaskReadyRequest): boolean {
  const accepted = acceptedAttemptKeys(request.authority);
  const synthesisRequest: SynthesisReadyRequest = {
    state: request.state,
    node: request.node,
  };
  return (
    request.authority.acceptedPlan.executionPrecedence
      .filter((edge) => edge.successorTaskId === request.node.taskId)
      .every((edge) => {
        const nodeRequest: NodeLookupRequest = {
          plan: request.authority.acceptedPlan,
          taskId: edge.predecessorTaskId,
        };
        const predecessor = nodeFor(nodeRequest);
        if (
          edge.requiresIntegratedWriterFrontier ||
          predecessor.kind === ModuleDeliveryTaskKind.Write
        )
          return request.state.integratedWriterFrontiers.some(
            (identity) =>
              identity.taskId === predecessor.taskId &&
              accepted.has(attemptKey(identity)),
          );
        return request.state.acceptedProviderEvidence.some(
          (identity) =>
            identity.taskId === predecessor.taskId &&
            accepted.has(attemptKey(identity)),
        );
      }) && synthesisInputsReady(synthesisRequest)
  );
}

function synthesisInputsReady(request: SynthesisReadyRequest): boolean {
  if (request.node.kind !== ModuleDeliveryTaskKind.EvidenceSynthesis)
    return true;
  const expected = request.node.evidenceInput.expectedProducers;
  const accepted = acceptedAttemptKeys(authorityForState(request.state));
  return (
    expected.length > 0 &&
    expected.every((producer) =>
      request.state.acceptedProviderEvidence.some(
        (identity) =>
          identity.taskId === producer.taskId &&
          identity.producerTeam === producer.team &&
          identity.functionalOwner === producer.functionalOwner &&
          identity.acceptanceOwner === producer.acceptanceOwner &&
          accepted.has(attemptKey(identity)),
      ),
    )
  );
}

function terminallyBlockedTaskIds(
  authority: AuthorityState,
): readonly string[] {
  const failed = new Set(
    authority.acceptedPlan.plan.nodes
      .filter(
        ({ taskId }) =>
          (authority.attemptsByTask.get(taskId) ?? 0) >=
            authority.acceptedPlan.plan.maxAttempts &&
          ![...authority.activeLeases.values()].some(
            (lease) => lease.taskId === taskId,
          ) &&
          !authority.dispositions.some(
            (entry) =>
              entry.taskId === taskId &&
              entry.kind === ModuleDeliveryAttemptDispositionKind.Accepted,
          ),
      )
      .map(({ taskId }) => taskId),
  );
  for (const taskId of authority.acceptedPlan.topologicalOrder) {
    if (
      authority.acceptedPlan.executionPrecedence.some(
        (edge) =>
          edge.successorTaskId === taskId && failed.has(edge.predecessorTaskId),
      )
    )
      failed.add(taskId);
  }
  return Object.freeze(
    authority.acceptedPlan.topologicalOrder.filter((taskId) =>
      failed.has(taskId),
    ),
  );
}

function validDisposition(request: DispositionValidationRequest): boolean {
  const nodeRequest: NodeLookupRequest = {
    plan: request.authority.acceptedPlan,
    taskId: request.lease.taskId,
  };
  const node = nodeFor(nodeRequest);
  const proofPresent =
    node.kind === ModuleDeliveryTaskKind.Write
      ? request.state.integratedWriterFrontiers
      : request.state.acceptedProviderEvidence;
  const exactProofPresent = proofPresent.some(
    ({ taskId, attempt }) =>
      taskId === request.lease.taskId && attempt === request.lease.attempt,
  );
  if (request.outcome.kind === ModuleDeliveryAttemptDispositionKind.Accepted)
    return (
      request.outcome.conclusion ===
        ModuleDeliveryGenerationFenceKind.Accepted && exactProofPresent
    );
  return (
    request.outcome.kind ===
      ModuleDeliveryAttemptDispositionKind.FinalUnusable &&
    !exactProofPresent &&
    (request.outcome.conclusion ===
      ModuleDeliveryGenerationFenceKind.Cancelled ||
      request.outcome.conclusion === ModuleDeliveryGenerationFenceKind.Failed ||
      request.outcome.conclusion === ModuleDeliveryGenerationFenceKind.Rejected)
  );
}

function startingFrontier(request: StartingFrontierRequest): string {
  const previous = [...request.authority.leaseHistory.values()].find(
    ({ taskId }) => taskId === request.node.taskId,
  );
  if (previous) return previous.startingFrontier;
  const requiresIntegrated = request.plan.executionPrecedence.some(
    (edge) =>
      edge.successorTaskId === request.node.taskId &&
      edge.requiresIntegratedWriterFrontier,
  );
  return !requiresIntegrated &&
    request.node.baseline.kind === ModuleDeliveryBaselineKind.SourceCommit &&
    request.node.dependencies.length === 0
    ? request.node.baseline.sourceCommit
    : request.state.headCommit;
}

function nextAttempt(request: AuthorityTaskRequest): number {
  return (request.authority.attemptsByTask.get(request.taskId) ?? 0) + 1;
}

function attemptKey(identity: AttemptIdentity): string {
  return `${identity.taskId}:${identity.attempt}`;
}
