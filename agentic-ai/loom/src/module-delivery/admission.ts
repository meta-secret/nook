import {
  copyModuleDeliveryAdmission,
  createAcceptedModuleDeliveryEvidenceRegistry,
  expectedModuleDeliveryLineageMap,
  freezeModuleDeliveryAdmissionSelection,
  moduleDeliveryResourcesConflict,
  trustedModuleDeliveryPlanSnapshot,
} from './authority.ts';
import {
  ModuleDeliveryBaselineKind,
  ModuleDeliveryTaskKind,
} from './domain.ts';
import { validateModuleDeliveryEvidenceSubmission } from './evidence.ts';
import type {
  ModuleDeliveryAcceptedProviderEvidenceIdentity,
  ModuleDeliveryEvidenceSubmissionValidation,
  ModuleDeliveryEvidenceSubmissionVerification,
} from './evidence.ts';
import type { AgentAttemptParent } from '../agent-workflow/domain.ts';
import type { TeamKey } from '../team-agents/catalog.ts';
import type {
  ModuleDeliveryNodeV2,
  ModuleDeliveryResourceClaims,
  ValidatedModuleDeliveryPlan,
} from './domain.ts';
import type { AcceptedModuleDeliveryEvidence } from './integration-provenance.ts';
import { assertModuleDeliveryIntegratedWriterFrontierCapability } from './integration-provenance.ts';
import type {
  AssertModuleDeliveryIntegratedWriterFrontierCapabilityRequest,
  ModuleDeliveryIntegratedWriterFrontierCapability,
} from './integration-provenance.ts';
import type {
  AcceptedModuleDeliveryEvidenceCollectionRequest,
  AcceptedModuleDeliveryEvidenceInspection,
  AcceptedModuleDeliveryEvidenceRegistration,
  ExpectedLineageMapRequest,
  ResourceConflictRequest,
} from './authority.ts';

const AUTHORITY = Symbol('module-delivery-generation-authority');

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
};

export type CreateModuleDeliveryAdmissionStateRequest = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly acceptedPlan: ValidatedModuleDeliveryPlan;
  readonly headCommit: string;
  readonly integratedWriterFrontiers: readonly ModuleDeliveryIntegratedWriterFrontierCapability[];
  readonly acceptedEvidence: readonly AcceptedModuleDeliveryEvidence[];
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
  readonly team: TeamKey;
  readonly functionalOwner: TeamKey;
  readonly acceptanceOwner: TeamKey;
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

export type ModuleDeliveryDispositionOutcome = {
  readonly kind: ModuleDeliveryAttemptDispositionKind;
  readonly conclusion: ModuleDeliveryGenerationFenceKind;
};

export type RecordModuleDeliveryAttemptDispositionRequest = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly state: ModuleDeliveryAdmissionState;
  readonly lease: ModuleDeliveryAttemptLease;
  readonly outcome: ModuleDeliveryDispositionOutcome;
};

export type RestartModuleDeliveryGenerationRequest = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly previousState: ModuleDeliveryAdmissionState;
  readonly acceptedPlan: ValidatedModuleDeliveryPlan;
  readonly expectedLineage: readonly ModuleDeliveryExpectedLineage[];
};

export type GenerationAuthorityInspection = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly generation: number;
  readonly planDigest: string;
};

export type AdmissionStateAuthorityInspection = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly state: ModuleDeliveryAdmissionState;
};

export type AttemptLeaseAuthorityInspection = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly lease: ModuleDeliveryAttemptLease;
};

type AuthorityState = {
  inputPlan: ValidatedModuleDeliveryPlan;
  acceptedPlan: ValidatedModuleDeliveryPlan;
  expectedLineage: ReadonlyMap<string, AgentAttemptParent>;
  activeLeases: Map<string, ModuleDeliveryAttemptLease>;
  leaseHistory: Map<string, ModuleDeliveryAttemptLease>;
  attemptsByTask: Map<string, number>;
  dispositions: ModuleDeliveryAttemptDisposition[];
};

type StateProvenance = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly acceptedEvidence: readonly AcceptedModuleDeliveryEvidence[];
};

type CapabilityProvenance = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly state: ModuleDeliveryAdmissionState;
};
export type ModuleDeliveryAuthorityPlanRequest = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly acceptedPlan: ValidatedModuleDeliveryPlan;
};
type IntegratedFrontiersRequest = {
  readonly plan: ValidatedModuleDeliveryPlan;
  readonly headCommit: string;
  readonly entries: readonly ModuleDeliveryIntegratedWriterFrontierCapability[];
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
type FrozenResourcesRequest = {
  readonly node: ModuleDeliveryNodeV2;
  readonly plan: ValidatedModuleDeliveryPlan;
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
const stateProvenance = new WeakMap<
  ModuleDeliveryAdmissionState,
  StateProvenance
>();
const currentStates = new WeakMap<
  ModuleDeliveryGenerationAuthority,
  ModuleDeliveryAdmissionState
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
const acceptedEvidenceRegistry = createAcceptedModuleDeliveryEvidenceRegistry();

const COMMIT = /^[0-9a-f]{40}$/u;

export function createModuleDeliveryGenerationAuthority(
  request: CreateModuleDeliveryGenerationAuthorityRequest,
): ModuleDeliveryGenerationAuthority {
  const acceptedPlan = trustedModuleDeliveryPlanSnapshot(request.acceptedPlan);
  const lineageRequest: ExpectedLineageMapRequest = {
    acceptedPlan,
    entries: request.expectedLineage,
  };
  const expectedLineage = expectedModuleDeliveryLineageMap(lineageRequest);
  const value: ModuleDeliveryGenerationAuthority = { [AUTHORITY]: true };
  const authority = Object.freeze(value);
  const authorityState: AuthorityState = {
    inputPlan: request.acceptedPlan,
    acceptedPlan,
    expectedLineage,
    activeLeases: new Map(),
    leaseHistory: new Map(),
    attemptsByTask: new Map(),
    dispositions: [],
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

export function assertAcceptedModuleDeliveryEvidence(
  inspection: AcceptedModuleDeliveryEvidenceInspection,
): void {
  acceptedEvidenceRegistry.assert(inspection);
}

export function moduleDeliveryAcceptedEvidenceIdentity(
  evidence: AcceptedModuleDeliveryEvidence,
): ModuleDeliveryAcceptedProviderEvidenceIdentity {
  return acceptedEvidenceRegistry.identity(evidence);
}

export function verifyModuleDeliveryEvidenceSubmission(
  verification: ModuleDeliveryEvidenceSubmissionVerification,
): AcceptedModuleDeliveryEvidence {
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
      acceptedEvidenceRegistry.assert(inspection);
      const identity = acceptedEvidenceRegistry.identity(evidence);
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
  acceptedEvidenceRegistry.register(registration);
  acceptedEvidenceLeases.add(verification.lease);
  return accepted;
}

export function createModuleDeliveryAdmissionState(
  request: CreateModuleDeliveryAdmissionStateRequest,
): ModuleDeliveryAdmissionState {
  const planRequest: ModuleDeliveryAuthorityPlanRequest = request;
  const authority = authorityStateForPlan(planRequest);
  if (!COMMIT.test(request.headCommit))
    throw new Error('Module delivery admission head must be an exact commit.');
  const frontierRequest: IntegratedFrontiersRequest = {
    plan: authority.acceptedPlan,
    headCommit: request.headCommit,
    entries: request.integratedWriterFrontiers,
  };
  const frontiers = integratedFrontiers(frontierRequest);
  if (
    request.headCommit !== authority.acceptedPlan.plan.sourceCommit &&
    frontiers.length === 0
  )
    throw new Error(
      'Module delivery admission head lacks integration authority.',
    );
  const integratedTaskIds = new Set(frontiers[0]?.integratedTaskIds ?? []);
  const integratedWrites = authority.acceptedPlan.plan.nodes
    .filter(({ taskId }) => integratedTaskIds.has(taskId))
    .map(({ taskId, resources }) => ({ taskId, claims: resources.write }));
  const evidenceRequest: AcceptedModuleDeliveryEvidenceCollectionRequest = {
    authority: request.authority,
    acceptedPlan: authority.acceptedPlan,
    entries: request.acceptedEvidence,
    headCommit: request.headCommit,
    integratedWrites,
  };
  const evidence = acceptedEvidenceRegistry.collect(evidenceRequest);
  const previousState = currentStates.get(request.authority);
  if (previousState) {
    const previousProvenance = stateProvenance.get(previousState);
    const previousIntegratedTaskIds =
      previousState.integratedWriterFrontiers[0]?.integratedTaskIds ?? [];
    if (
      !previousProvenance ||
      previousIntegratedTaskIds.some(
        (taskId) => !integratedTaskIds.has(taskId),
      ) ||
      previousProvenance.acceptedEvidence.some(
        (entry) => !evidence.accepted.includes(entry),
      )
    )
      throw new Error('Module delivery admission state cannot discard proof.');
  }
  const stateValue: ModuleDeliveryAdmissionState = {
    generation: authority.acceptedPlan.plan.generation,
    planDigest: authority.acceptedPlan.planDigest,
    headCommit: request.headCommit,
    integratedWriterFrontiers: frontiers,
    acceptedProviderEvidence: evidence.identities,
  };
  const state = Object.freeze(stateValue);
  const provenance: StateProvenance = {
    authority: request.authority,
    acceptedEvidence: evidence.accepted,
  };
  stateProvenance.set(state, provenance);
  currentStates.set(request.authority, state);
  return state;
}

export function assertModuleDeliveryAdmissionStateAuthority(
  inspection: AdmissionStateAuthorityInspection,
): void {
  const authority = authorityStates.get(inspection.authority);
  const provenance = stateProvenance.get(inspection.state);
  if (
    !authority ||
    !provenance ||
    provenance.authority !== inspection.authority ||
    currentStates.get(inspection.authority) !== inspection.state ||
    inspection.state.generation !== authority.acceptedPlan.plan.generation ||
    inspection.state.planDigest !== authority.acceptedPlan.planDigest
  )
    throw new Error(
      'Module delivery admission state authority is invalid or stale.',
    );
}

export function selectModuleDeliveryAdmissions(
  request: SelectModuleDeliveryAdmissionsRequest,
): ModuleDeliveryAdmissionSelection {
  const planRequest: ModuleDeliveryAuthorityPlanRequest = request;
  const authority = authorityStateForPlan(planRequest);
  assertModuleDeliveryAdmissionStateAuthority(request);
  const blockedTaskIds = terminallyBlockedTaskIds(authority);
  if (blockedTaskIds.length > 0) {
    const selectionRequest = {
      status: ModuleDeliveryAdmissionSelectionStatus.Blocked,
      admissions: [],
      pendingTaskIds: [],
      blockedTaskIds,
    };
    return freezeModuleDeliveryAdmissionSelection(selectionRequest);
  }
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
    if (!taskPending(taskRequest) || !taskReady(readyRequest)) continue;
    const resourcesRequest: FrozenResourcesRequest = {
      node,
      plan: authority.acceptedPlan,
    };
    const resources = frozenResources(resourcesRequest);
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
    const admissionValue: ModuleDeliveryAdmission = {
      taskId,
      attempt: nextAttempt(attemptRequest),
      generation: request.state.generation,
      planDigest: request.state.planDigest,
      startingFrontier: startingFrontier(frontierRequest),
      resources,
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
    status: ModuleDeliveryAdmissionSelectionStatus.Selected,
    admissions,
    pendingTaskIds,
    blockedTaskIds: [],
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
    seenAdmissions.add(admission);
    seenTasks.add(admission.taskId);
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

export function restartModuleDeliveryGeneration(
  request: RestartModuleDeliveryGenerationRequest,
): ModuleDeliveryAdmissionState {
  const stateInspection: AdmissionStateAuthorityInspection = {
    authority: request.authority,
    state: request.previousState,
  };
  assertModuleDeliveryAdmissionStateAuthority(stateInspection);
  const authority = requiredAuthority(request.authority);
  if (
    request.acceptedPlan.plan.generation <=
      authority.acceptedPlan.plan.generation ||
    authority.activeLeases.size > 0 ||
    [...authority.leaseHistory.values()].some(
      (lease) =>
        !authority.dispositions.some(
          (disposition) => attemptKey(disposition) === attemptKey(lease),
        ),
    )
  )
    throw new Error(
      'Generation restart requires a newer plan and terminal release evidence.',
    );
  const nextPlan = trustedModuleDeliveryPlanSnapshot(request.acceptedPlan);
  const lineageRequest: ExpectedLineageMapRequest = {
    acceptedPlan: nextPlan,
    entries: request.expectedLineage,
  };
  const nextLineage = expectedModuleDeliveryLineageMap(lineageRequest);
  authority.inputPlan = request.acceptedPlan;
  authority.acceptedPlan = nextPlan;
  authority.expectedLineage = nextLineage;
  authority.activeLeases = new Map();
  authority.leaseHistory = new Map();
  authority.dispositions = [];
  currentStates.delete(request.authority);
  const stateRequest: CreateModuleDeliveryAdmissionStateRequest = {
    authority: request.authority,
    acceptedPlan: request.acceptedPlan,
    headCommit: request.acceptedPlan.plan.sourceCommit,
    integratedWriterFrontiers: [],
    acceptedEvidence: [],
  };
  return createModuleDeliveryAdmissionState(stateRequest);
}

function requiredAuthority(
  authority: ModuleDeliveryGenerationAuthority,
): AuthorityState {
  const state = authorityStates.get(authority);
  if (!state)
    throw new Error('Module delivery generation authority is invalid.');
  return state;
}

function authorityForState(
  state: ModuleDeliveryAdmissionState,
): AuthorityState {
  const provenance = stateProvenance.get(state);
  if (!provenance)
    throw new Error('Module delivery admission state authority is invalid.');
  return requiredAuthority(provenance.authority);
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

function integratedFrontiers(
  request: IntegratedFrontiersRequest,
): readonly ModuleDeliveryIntegratedWriterFrontierCapability[] {
  const seen = new Set<string>();
  const integratedTaskIds = request.entries[0]?.integratedTaskIds ?? [];
  const result = request.entries.map((entry) => {
    const nodeRequest: NodeLookupRequest = {
      plan: request.plan,
      taskId: entry.taskId,
    };
    const node = nodeFor(nodeRequest);
    if (
      seen.has(entry.taskId) ||
      node.kind !== ModuleDeliveryTaskKind.Write ||
      !COMMIT.test(entry.headCommit) ||
      entry.headCommit !== request.headCommit
    )
      throw new Error(
        `Integrated writer frontier is invalid for ${entry.taskId}.`,
      );
    seen.add(entry.taskId);
    const inspection: AssertModuleDeliveryIntegratedWriterFrontierCapabilityRequest =
      {
        capability: entry,
        taskId: entry.taskId,
        attempt: entry.attempt,
        generation: request.plan.plan.generation,
        planDigest: request.plan.planDigest,
        headCommit: request.headCommit,
        integratedTaskIds,
      };
    assertModuleDeliveryIntegratedWriterFrontierCapability(inspection);
    return entry;
  });
  return Object.freeze(result);
}

function nodeFor(request: NodeLookupRequest): ModuleDeliveryNodeV2 {
  const node = request.plan.plan.nodes.find(
    (candidate) => candidate.taskId === request.taskId,
  );
  if (!node)
    throw new Error(`Validated plan is missing task ${request.taskId}.`);
  return node;
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
        (node) =>
          authority.dispositions.filter(
            (entry) =>
              entry.taskId === node.taskId &&
              entry.kind === ModuleDeliveryAttemptDispositionKind.FinalUnusable,
          ).length >= authority.acceptedPlan.plan.maxAttempts,
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
  if (request.outcome.kind === ModuleDeliveryAttemptDispositionKind.Accepted) {
    if (
      request.outcome.conclusion !== ModuleDeliveryGenerationFenceKind.Accepted
    )
      return false;
    const nodeRequest: NodeLookupRequest = {
      plan: request.authority.acceptedPlan,
      taskId: request.lease.taskId,
    };
    const node = nodeFor(nodeRequest);
    return node.kind === ModuleDeliveryTaskKind.Write
      ? request.state.integratedWriterFrontiers.some(
          ({ taskId, attempt }) =>
            taskId === request.lease.taskId &&
            attempt === request.lease.attempt,
        )
      : request.state.acceptedProviderEvidence.some(
          ({ taskId, attempt }) =>
            taskId === request.lease.taskId &&
            attempt === request.lease.attempt,
        );
  }
  return (
    request.outcome.kind ===
      ModuleDeliveryAttemptDispositionKind.FinalUnusable &&
    (request.outcome.conclusion ===
      ModuleDeliveryGenerationFenceKind.Cancelled ||
      request.outcome.conclusion === ModuleDeliveryGenerationFenceKind.Failed ||
      request.outcome.conclusion === ModuleDeliveryGenerationFenceKind.Rejected)
  );
}

function frozenResources(
  request: FrozenResourcesRequest,
): ModuleDeliveryResourceClaims {
  const evidenceReads =
    request.node.kind === ModuleDeliveryTaskKind.EvidenceSynthesis
      ? []
      : request.node.dependencies.flatMap((taskId) => {
          const nodeRequest: NodeLookupRequest = { plan: request.plan, taskId };
          const provider = nodeFor(nodeRequest);
          return provider.kind === ModuleDeliveryTaskKind.ReadOnly
            ? provider.resources.evidenceSurface
            : [];
        });
  const resources: ModuleDeliveryResourceClaims = {
    read: Object.freeze([
      ...new Set([...request.node.resources.read, ...evidenceReads]),
    ]),
    write: Object.freeze([...request.node.resources.write]),
    evidenceSurface: Object.freeze([...request.node.resources.evidenceSurface]),
  };
  return Object.freeze(resources);
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
