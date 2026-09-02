import { ModuleDeliveryTaskKind } from './domain.ts';

import type { AcceptedModuleDeliveryEvidenceRegistry } from './authority.ts';
import type { AcceptedModuleDeliveryEvidenceCollectionRequest } from './authority.ts';
import type {
  CommitFinalModuleDeliveryAdmissionStateRequest,
  CreateModuleDeliveryAdmissionStateRequest,
  ModuleDeliveryAdmissionState,
  ModuleDeliveryGenerationAuthority,
  PrepareFinalModuleDeliveryAdmissionStateRequest,
  RollbackFinalModuleDeliveryAdmissionStateRequest,
} from './admission.ts';
import type { AcceptedModuleDeliveryEvidence } from './integration-provenance.ts';
import type {
  AssertModuleDeliveryIntegratedWriterFrontierCapabilityRequest,
  ModuleDeliveryIntegratedWriterFrontierCapability,
} from './integration.ts';
import type { AssertModuleDeliveryCanonicalEvidenceTransitionRequest } from './integration-provenance.ts';
import type { ValidatedModuleDeliveryPlan } from './domain.ts';

type AdmissionStateProvenance = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  acceptedEvidence: readonly AcceptedModuleDeliveryEvidence[];
}>;
export type ModuleDeliveryAdmissionStateStore = Readonly<{
  storeId: symbol;
}>;
type AdmissionStateStoreData = Readonly<{
  authorities: ModuleDeliveryAdmissionStateStoreAuthorities;
  stateProvenance: WeakMap<
    ModuleDeliveryAdmissionState,
    AdmissionStateProvenance
  >;
  currentStates: WeakMap<
    ModuleDeliveryGenerationAuthority,
    ModuleDeliveryAdmissionState
  >;
}>;
export type ModuleDeliveryAdmissionStateStoreAuthorities = Readonly<{
  assertCanonicalTransition: (
    request: AssertModuleDeliveryCanonicalEvidenceTransitionRequest,
  ) => void;
  assertWriterFrontier: (
    request: AssertModuleDeliveryIntegratedWriterFrontierCapabilityRequest,
  ) => void;
}>;
type AdmissionStateStoreRequest = Readonly<{
  store: ModuleDeliveryAdmissionStateStore;
}>;
type MaterializeAdmissionStateRequest = AdmissionStateStoreRequest &
  Readonly<{
    request: CreateModuleDeliveryAdmissionStateRequest;
    acceptedPlan: ValidatedModuleDeliveryPlan;
    evidenceRegistry: AcceptedModuleDeliveryEvidenceRegistry;
    evidenceHeadCommit: string;
  }>;
type PrepareFinalAdmissionStateMaterialization = Omit<
  MaterializeAdmissionStateRequest,
  'request'
> &
  Readonly<{ request: PrepareFinalModuleDeliveryAdmissionStateRequest }>;
type AuthenticatedFrontiersRequest = AdmissionStateStoreRequest &
  Readonly<{
    request: CreateModuleDeliveryAdmissionStateRequest;
    acceptedPlan: ValidatedModuleDeliveryPlan;
  }>;
type RegisterAdmissionStateRequest = AdmissionStateStoreRequest &
  Readonly<{
    authority: ModuleDeliveryGenerationAuthority;
    state: ModuleDeliveryAdmissionState;
    acceptedEvidence: readonly AcceptedModuleDeliveryEvidence[];
  }>;
type AdmissionStateCurrentInspection = AdmissionStateStoreRequest &
  Readonly<{
    authority: ModuleDeliveryGenerationAuthority;
    state: ModuleDeliveryAdmissionState;
    generation: number;
    planDigest: string;
  }>;
type CommitFinalAdmissionStateStoreRequest = AdmissionStateStoreRequest &
  CommitFinalModuleDeliveryAdmissionStateRequest;
type RollbackFinalAdmissionStateStoreRequest = AdmissionStateStoreRequest &
  RollbackFinalModuleDeliveryAdmissionStateRequest;
type AdmissionStateAuthorityRequest = AdmissionStateStoreRequest &
  Readonly<{ state: ModuleDeliveryAdmissionState }>;

const stores = new WeakMap<
  ModuleDeliveryAdmissionStateStore,
  AdmissionStateStoreData
>();

export function createModuleDeliveryAdmissionStateStore(
  authorities: ModuleDeliveryAdmissionStateStoreAuthorities,
): ModuleDeliveryAdmissionStateStore {
  const storeValue: ModuleDeliveryAdmissionStateStore = {
    storeId: Symbol('module-delivery-admission-state'),
  };
  const store = Object.freeze(storeValue);
  const data: AdmissionStateStoreData = {
    authorities,
    stateProvenance: new WeakMap(),
    currentStates: new WeakMap(),
  };
  stores.set(store, data);
  return store;
}

function requiredStore(
  store: ModuleDeliveryAdmissionStateStore,
): AdmissionStateStoreData {
  const data = stores.get(store);
  if (!data)
    throw new Error('Module delivery admission state store is invalid.');
  return data;
}

export function createAdmissionState(
  request: MaterializeAdmissionStateRequest,
): ModuleDeliveryAdmissionState {
  const { currentStates } = requiredStore(request.store);
  const state = materializedAdmissionState(request);
  currentStates.set(request.request.authority, state);
  return state;
}

export function prepareFinalAdmissionState(
  materialization: PrepareFinalAdmissionStateMaterialization,
): ModuleDeliveryAdmissionState {
  const { request } = materialization;
  const { currentStates } = requiredStore(materialization.store);
  if (currentStates.get(request.authority) !== request.previousState)
    throw new Error('Final module delivery admission predecessor is stale.');
  const transitionInspection: AssertModuleDeliveryCanonicalEvidenceTransitionRequest =
    {
      authority: request.authority,
      transition: request.canonicalTransition,
      previousHeadCommit: request.previousState.headCommit,
      canonicalHeadCommit: request.headCommit,
      integratedTaskIds: request.canonicalTransition.integratedTaskIds,
    };
  requiredStore(materialization.store).authorities.assertCanonicalTransition(
    transitionInspection,
  );
  const state = materializedAdmissionState(materialization);
  const [integratedTaskIds = []] = [
    state.integratedWriterFrontiers[0]?.integratedTaskIds,
  ];
  const integratedTaskSet = new Set(integratedTaskIds);
  const canonicalTaskIds = request.canonicalTransition.integratedTaskIds;
  if (
    integratedTaskSet.size !== integratedTaskIds.length ||
    canonicalTaskIds.length !== integratedTaskIds.length ||
    canonicalTaskIds.some((taskId) => !integratedTaskSet.has(taskId))
  )
    throw new Error('Final module delivery writer closure is invalid.');
  return state;
}

export function commitFinalAdmissionState(
  request: CommitFinalAdmissionStateStoreRequest,
): void {
  const { currentStates, stateProvenance } = requiredStore(request.store);
  if (
    currentStates.get(request.authority) !== request.previousState ||
    stateProvenance.get(request.state)?.authority !== request.authority
  )
    throw new Error('Final module delivery admission transaction is stale.');
  currentStates.set(request.authority, request.state);
}

export function rollbackFinalAdmissionState(
  request: RollbackFinalAdmissionStateStoreRequest,
): void {
  const { currentStates, stateProvenance } = requiredStore(request.store);
  const current = currentStates.get(request.authority);
  if (current === request.previousState) return;
  if (
    current !== request.finalizedState ||
    stateProvenance.get(request.previousState)?.authority !== request.authority
  )
    throw new Error('Final module delivery admission rollback is invalid.');
  currentStates.set(request.authority, request.previousState);
}

export function registerAdmissionState(
  request: RegisterAdmissionStateRequest,
): void {
  const { currentStates, stateProvenance } = requiredStore(request.store);
  const provenance: AdmissionStateProvenance = {
    authority: request.authority,
    acceptedEvidence: request.acceptedEvidence,
  };
  stateProvenance.set(request.state, provenance);
  currentStates.set(request.authority, request.state);
}

export function assertAdmissionStateCurrent(
  inspection: AdmissionStateCurrentInspection,
): void {
  const { currentStates, stateProvenance } = requiredStore(inspection.store);
  const provenance = stateProvenance.get(inspection.state);
  if (
    !provenance ||
    provenance.authority !== inspection.authority ||
    currentStates.get(inspection.authority) !== inspection.state ||
    inspection.state.generation !== inspection.generation ||
    inspection.state.planDigest !== inspection.planDigest
  )
    throw new Error(
      'Module delivery admission state authority is invalid or stale.',
    );
}

export function admissionStateAuthority(
  request: AdmissionStateAuthorityRequest,
): ModuleDeliveryGenerationAuthority {
  const { stateProvenance } = requiredStore(request.store);
  const authority = stateProvenance.get(request.state)?.authority;
  if (!authority)
    throw new Error('Module delivery admission state authority is invalid.');
  return authority;
}

function materializedAdmissionState(
  materialization: MaterializeAdmissionStateRequest,
): ModuleDeliveryAdmissionState {
  const { currentStates, stateProvenance } = requiredStore(
    materialization.store,
  );
  const { request, acceptedPlan, evidenceRegistry } = materialization;
  const frontierRequest: AuthenticatedFrontiersRequest = {
    store: materialization.store,
    request,
    acceptedPlan,
  };
  const frontiers = authenticatedFrontiers(frontierRequest);
  const [defaulted1 = []] = [frontiers[0]?.integratedTaskIds];
  const integratedTaskIds = new Set(defaulted1);
  const integratedWrites = acceptedPlan.plan.nodes
    .filter(({ taskId }) => integratedTaskIds.has(taskId))
    .map(({ taskId, resources }) => ({ taskId, claims: resources.write }));
  const evidenceRequest: AcceptedModuleDeliveryEvidenceCollectionRequest = {
    authority: request.authority,
    acceptedPlan,
    entries: request.acceptedEvidence,
    headCommit: materialization.evidenceHeadCommit,
    integratedWrites,
  };
  const evidence = evidenceRegistry.collect(evidenceRequest);
  const previousState = currentStates.get(request.authority);
  const previousProvenance = previousState
    ? stateProvenance.get(previousState)
    : false;
  const [previousTaskIds = []] = [
    previousState?.integratedWriterFrontiers[0]?.integratedTaskIds,
  ];
  if (
    previousState &&
    (!previousProvenance ||
      previousTaskIds.some((taskId) => !integratedTaskIds.has(taskId)) ||
      previousProvenance.acceptedEvidence.some(
        (entry) => !evidence.accepted.includes(entry),
      ))
  )
    throw new Error('Module delivery admission state cannot discard proof.');
  const stateValue: ModuleDeliveryAdmissionState = {
    generation: acceptedPlan.plan.generation,
    planDigest: acceptedPlan.planDigest,
    headCommit: request.headCommit,
    integratedWriterFrontiers: frontiers,
    acceptedProviderEvidence: evidence.identities,
  };
  const state = Object.freeze(stateValue);
  const provenance: AdmissionStateProvenance = {
    authority: request.authority,
    acceptedEvidence: evidence.accepted,
  };
  stateProvenance.set(state, provenance);
  return state;
}

function authenticatedFrontiers(
  input: AuthenticatedFrontiersRequest,
): readonly ModuleDeliveryIntegratedWriterFrontierCapability[] {
  const { request, acceptedPlan } = input;
  if (!/^[0-9a-f]{40}$/u.test(request.headCommit))
    throw new Error('Module delivery admission head must be an exact commit.');
  const [integratedTaskIds = []] = [
    request.integratedWriterFrontiers[0]?.integratedTaskIds,
  ];
  const seen = new Set<string>();
  const frontiers = request.integratedWriterFrontiers.map((entry) => {
    const node = acceptedPlan.plan.nodes.find(
      ({ taskId }) => taskId === entry.taskId,
    );
    if (
      !node ||
      seen.has(entry.taskId) ||
      node.kind !== ModuleDeliveryTaskKind.Write ||
      entry.headCommit !== request.headCommit
    )
      throw new Error(
        `Integrated writer frontier is invalid for ${entry.taskId}.`,
      );
    seen.add(entry.taskId);
    const inspection = {
      capability: entry,
      authority: request.authority,
      taskId: entry.taskId,
      attempt: entry.attempt,
      generation: acceptedPlan.plan.generation,
      planDigest: acceptedPlan.planDigest,
      headCommit: request.headCommit,
      integratedTaskIds,
    };
    requiredStore(input.store).authorities.assertWriterFrontier(inspection);
    return entry;
  });
  if (
    request.headCommit !== acceptedPlan.plan.sourceCommit &&
    frontiers.length === 0
  )
    throw new Error(
      'Module delivery admission head lacks integration authority.',
    );
  return Object.freeze(frontiers);
}
