import { taskResourcePatternsOverlap } from '../agent-workflow/domain.ts';
import {
  ModuleDeliveryBaselineKind,
  ModuleDeliveryTaskKind,
  ModuleDeliveryValidationStatus,
} from './domain.ts';
import { decodeAndValidateModuleDeliveryPlan } from './validation.ts';
import type { TaskResourcePatternPair } from '../agent-workflow/domain.ts';
import type { AgentAttemptParent } from '../agent-workflow/domain.ts';
import type { TeamKey } from '../team-agents/catalog.ts';
import type {
  AcceptedModuleDeliveryPlan,
  ModuleDeliveryNodeV2,
  ModuleDeliveryResourceClaims,
} from './domain.ts';
type GenerationAuthorityState = {
  generation: number;
  planDigest: string;
  maxConcurrency: number;
  frontier: ModuleDeliveryFrontierState;
  activeLeases: ReadonlyMap<string, ModuleDeliveryAttemptLease>;
  leaseHistory: ReadonlyMap<string, ModuleDeliveryAttemptLease>;
  dispositions: readonly ModuleDeliveryAttemptDisposition[];
  currentAdmission: ModuleDeliveryAdmissionSlot;
};
enum ModuleDeliveryFrontierKind {
  Source = 'source',
  Integrated = 'integrated',
}
type ModuleDeliveryFrontierState = {
  readonly kind: ModuleDeliveryFrontierKind.Source;
  readonly headCommit: string;
};
enum ModuleDeliveryAdmissionSlotKind {
  Empty = 'empty',
  Issued = 'issued',
}
type ModuleDeliveryAdmissionSlot =
  | { readonly kind: ModuleDeliveryAdmissionSlotKind.Empty }
  | {
      readonly kind: ModuleDeliveryAdmissionSlotKind.Issued;
      readonly state: ModuleDeliveryAdmissionState;
    };
const GENERATION_AUTHORITY = Symbol('module-delivery-generation-authority');
export type ModuleDeliveryGenerationAuthority = {
  readonly [GENERATION_AUTHORITY]: true;
};
export type GenerationAuthorityInspection = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly generation: number;
  readonly planDigest: string;
};
type GenerationAuthoritySupersession = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly previousGeneration: number;
  readonly previousPlanDigest: string;
  readonly acceptedPlan: AcceptedModuleDeliveryPlan;
};
type AdmissionStateProvenance = {
  readonly authority: ModuleDeliveryGenerationAuthority;
};
type AdmissionProvenance = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly state: ModuleDeliveryAdmissionState;
};
export type AcceptedModuleDeliveryPlanMetadataInspection = {
  readonly acceptedPlan: AcceptedModuleDeliveryPlan;
};
const authorityStates = new WeakMap<
  ModuleDeliveryGenerationAuthority,
  GenerationAuthorityState
>();
const admissionStates = new WeakMap<
  ModuleDeliveryAdmissionState,
  AdmissionStateProvenance
>();
const issuedAdmissions = new WeakMap<
  ModuleDeliveryAdmission,
  AdmissionProvenance
>();
const issuedLeases = new WeakMap<
  ModuleDeliveryAttemptLease,
  AdmissionProvenance
>();
const consumedAdmissions = new WeakSet<ModuleDeliveryAdmission>();
const disposedLeases = new WeakSet<ModuleDeliveryAttemptLease>();
export function createModuleDeliveryGenerationAuthority(
  acceptedPlan: AcceptedModuleDeliveryPlan,
): ModuleDeliveryGenerationAuthority {
  assertPlan(acceptedPlan);
  const authorityValue: ModuleDeliveryGenerationAuthority = {
    [GENERATION_AUTHORITY]: true,
  };
  const authority = Object.freeze(authorityValue);
  const state: GenerationAuthorityState = {
    generation: acceptedPlan.plan.generation,
    planDigest: acceptedPlan.planDigest,
    maxConcurrency: acceptedPlan.plan.maxConcurrency,
    frontier: {
      kind: ModuleDeliveryFrontierKind.Source,
      headCommit: acceptedPlan.plan.sourceCommit,
    },
    activeLeases: new Map<string, ModuleDeliveryAttemptLease>(),
    leaseHistory: new Map<string, ModuleDeliveryAttemptLease>(),
    dispositions: [],
    currentAdmission: { kind: ModuleDeliveryAdmissionSlotKind.Empty },
  };
  authorityStates.set(authority, state);
  return authority;
}
export function assertModuleDeliveryGenerationAuthority(
  inspection: GenerationAuthorityInspection,
): void {
  const state = authorityStates.get(inspection.authority);
  if (
    !state ||
    state.generation !== inspection.generation ||
    state.planDigest !== inspection.planDigest
  )
    throw new Error('Module delivery generation authority is superseded.');
}
export function assertAcceptedModuleDeliveryPlanMetadata(
  inspection: AcceptedModuleDeliveryPlanMetadataInspection,
): AcceptedModuleDeliveryPlan {
  const accepted = decodeAndValidateModuleDeliveryPlan(
    JSON.stringify(inspection.acceptedPlan.plan),
  );
  if (
    accepted.status !== ModuleDeliveryValidationStatus.Accepted ||
    accepted.planDigest !== inspection.acceptedPlan.planDigest ||
    JSON.stringify(accepted.topologicalOrder) !==
      JSON.stringify(inspection.acceptedPlan.topologicalOrder) ||
    JSON.stringify(accepted.waves) !==
      JSON.stringify(inspection.acceptedPlan.waves) ||
    JSON.stringify(accepted.executionPrecedence) !==
      JSON.stringify(inspection.acceptedPlan.executionPrecedence)
  )
    throw new Error('Accepted module delivery plan metadata is inconsistent.');
  return accepted;
}
function supersedeModuleDeliveryGenerationAuthority(
  supersession: GenerationAuthoritySupersession,
): void {
  const state = authorityStates.get(supersession.authority);
  if (
    !state ||
    state.generation !== supersession.previousGeneration ||
    state.planDigest !== supersession.previousPlanDigest
  )
    throw new Error('Module delivery generation authority is stale.');
  state.generation = supersession.acceptedPlan.plan.generation;
  state.planDigest = supersession.acceptedPlan.planDigest;
  state.maxConcurrency = supersession.acceptedPlan.plan.maxConcurrency;
  state.frontier = {
    kind: ModuleDeliveryFrontierKind.Source,
    headCommit: supersession.acceptedPlan.plan.sourceCommit,
  };
  state.activeLeases = new Map<string, ModuleDeliveryAttemptLease>();
  state.leaseHistory = new Map<string, ModuleDeliveryAttemptLease>();
  state.dispositions = [];
  state.currentAdmission = { kind: ModuleDeliveryAdmissionSlotKind.Empty };
}
export enum ModuleDeliveryAttemptDispositionKind {
  FinalUnusable = 'final-unusable',
}
export enum ModuleDeliveryGenerationFenceKind {
  Cancelled = 'cancelled',
  Rejected = 'rejected',
}
export enum ModuleDeliveryAdmissionSelectionStatus {
  Selected = 'selected',
  Blocked = 'blocked',
}
type ModuleDeliveryAttemptIdentity = Readonly<{
  taskId: string;
  attempt: number;
  generation: number;
  planDigest: string;
}>;
export type ModuleDeliveryAttemptLease = ModuleDeliveryAttemptIdentity & {
  readonly startingFrontier: string;
  readonly resources: ModuleDeliveryResourceClaims;
  readonly team: TeamKey;
  readonly functionalOwner: TeamKey;
  readonly acceptanceOwner: TeamKey;
  readonly parentLineage: AgentAttemptParent;
  readonly acceptanceRequirements: readonly string[];
};
export type ModuleDeliveryAttemptDisposition = ModuleDeliveryAttemptIdentity & {
  readonly kind: ModuleDeliveryAttemptDispositionKind.FinalUnusable;
  readonly conclusion: ModuleDeliveryGenerationFenceKind;
};
export type ModuleDeliveryAdmissionState = {
  readonly generation: number;
  readonly planDigest: string;
  readonly headCommit: string;
};
export type CreateModuleDeliveryAdmissionStateRequest = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly acceptedPlan: AcceptedModuleDeliveryPlan;
};
export type SelectModuleDeliveryAdmissionsRequest = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly acceptedPlan: AcceptedModuleDeliveryPlan;
  readonly state: ModuleDeliveryAdmissionState;
};
export type ModuleDeliveryAdmission = ModuleDeliveryAttemptIdentity & {
  readonly startingFrontier: string;
  readonly resources: ModuleDeliveryResourceClaims;
  readonly team: TeamKey;
  readonly functionalOwner: TeamKey;
  readonly acceptanceOwner: TeamKey;
  readonly parentLineage: AgentAttemptParent;
  readonly acceptanceRequirements: readonly string[];
};
export type ModuleDeliveryLeaseRecording = {
  readonly state: ModuleDeliveryAdmissionState;
  readonly leases: readonly ModuleDeliveryAttemptLease[];
};
export type RecordModuleDeliveryAttemptLeasesRequest = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly state: ModuleDeliveryAdmissionState;
  readonly admissions: readonly ModuleDeliveryAdmission[];
};
export type ModuleDeliveryDispositionOutcome = {
  readonly kind: ModuleDeliveryAttemptDispositionKind.FinalUnusable;
  readonly conclusion: ModuleDeliveryGenerationFenceKind;
};
export type RecordModuleDeliveryAttemptDispositionRequest = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly state: ModuleDeliveryAdmissionState;
  readonly lease: ModuleDeliveryAttemptLease;
  readonly outcome: ModuleDeliveryDispositionOutcome;
};
export type ModuleDeliveryAdmissionSelection = {
  readonly status: ModuleDeliveryAdmissionSelectionStatus;
  readonly admissions: readonly ModuleDeliveryAdmission[];
  readonly pendingTaskIds: readonly string[];
  readonly blockedTaskIds: readonly string[];
};
export type RestartModuleDeliveryGenerationRequest = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly previousState: ModuleDeliveryAdmissionState;
  readonly acceptedPlan: AcceptedModuleDeliveryPlan;
};
export type AdmissionStateAuthorityInspection = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly state: ModuleDeliveryAdmissionState;
};
export type AttemptLeaseAuthorityInspection = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly lease: ModuleDeliveryAttemptLease;
};
type TaskState = Readonly<{
  request: SelectModuleDeliveryAdmissionsRequest;
  node: ModuleDeliveryNodeV2;
}>;
type CurrentAdmissionInspection = {
  readonly authorityState: GenerationAuthorityState;
  readonly state: ModuleDeliveryAdmissionState;
};
type ResourceClaimList = readonly string[];
type ResourceClaimOverlap = (second: ResourceClaimList) => boolean;
type ResourceConflict = (second: ModuleDeliveryResourceClaims) => boolean;
type NodeLookup = (taskId: string) => ModuleDeliveryNodeV2;
function assertPlan(acceptedPlan: AcceptedModuleDeliveryPlan): void {
  const inspection: AcceptedModuleDeliveryPlanMetadataInspection = {
    acceptedPlan,
  };
  assertAcceptedModuleDeliveryPlanMetadata(inspection);
}
function assertAuthority(inspection: GenerationAuthorityInspection): void {
  assertModuleDeliveryGenerationAuthority(inspection);
}
function generationAuthorityState(
  authority: ModuleDeliveryGenerationAuthority,
): GenerationAuthorityState {
  const state = authorityStates.get(authority);
  if (!state)
    throw new Error('Module delivery generation authority is invalid.');
  return state;
}
function leaseKey(identity: ModuleDeliveryAttemptIdentity): string {
  return `${identity.taskId}:${identity.attempt}`;
}
function publishAdmissionState(
  authority: ModuleDeliveryGenerationAuthority,
): ModuleDeliveryAdmissionState {
  const authorityState = generationAuthorityState(authority);
  const stateValue: ModuleDeliveryAdmissionState = {
    generation: authorityState.generation,
    planDigest: authorityState.planDigest,
    headCommit: authorityState.frontier.headCommit,
  };
  const state = Object.freeze(stateValue);
  const provenance: AdmissionStateProvenance = { authority };
  admissionStates.set(state, provenance);
  authorityState.currentAdmission = {
    kind: ModuleDeliveryAdmissionSlotKind.Issued,
    state,
  };
  return state;
}
function isCurrentAdmissionState(
  inspection: CurrentAdmissionInspection,
): boolean {
  return (
    inspection.authorityState.currentAdmission.kind ===
      ModuleDeliveryAdmissionSlotKind.Issued &&
    inspection.authorityState.currentAdmission.state === inspection.state
  );
}
export function createModuleDeliveryAdmissionState(
  request: CreateModuleDeliveryAdmissionStateRequest,
): ModuleDeliveryAdmissionState {
  assertPlan(request.acceptedPlan);
  const inspection: GenerationAuthorityInspection = {
    authority: request.authority,
    generation: request.acceptedPlan.plan.generation,
    planDigest: request.acceptedPlan.planDigest,
  };
  assertAuthority(inspection);
  return publishAdmissionState(request.authority);
}
export function assertModuleDeliveryAdmissionStateAuthority(
  inspection: AdmissionStateAuthorityInspection,
): void {
  const provenance = admissionStates.get(inspection.state);
  const authorityState = authorityStates.get(inspection.authority);
  if (
    !provenance ||
    provenance.authority !== inspection.authority ||
    !authorityState ||
    inspection.state.generation !== authorityState.generation ||
    inspection.state.planDigest !== authorityState.planDigest
  )
    throw new Error('Module delivery admission state authority is invalid.');
}
export function assertModuleDeliveryAttemptLeaseAuthority(
  inspection: AttemptLeaseAuthorityInspection,
): void {
  const authorityState = generationAuthorityState(inspection.authority);
  const provenance = issuedLeases.get(inspection.lease);
  if (
    !provenance ||
    provenance.authority !== inspection.authority ||
    authorityState.activeLeases.get(leaseKey(inspection.lease)) !==
      inspection.lease ||
    inspection.lease.generation !== authorityState.generation ||
    inspection.lease.planDigest !== authorityState.planDigest
  )
    throw new Error('Module delivery lease authority is invalid.');
}
export function recordModuleDeliveryAttemptLeases(
  request: RecordModuleDeliveryAttemptLeasesRequest,
): ModuleDeliveryLeaseRecording {
  assertModuleDeliveryAdmissionStateAuthority(request);
  const authorityState = generationAuthorityState(request.authority);
  const currentInspection: CurrentAdmissionInspection = {
    authorityState,
    state: request.state,
  };
  if (
    request.admissions.length === 0 ||
    !isCurrentAdmissionState(currentInspection)
  )
    throw new Error('Module delivery admission capability is invalid.');
  const capabilities = new Set<ModuleDeliveryAdmission>();
  const taskIds = new Set(
    [...authorityState.activeLeases.values()].map(({ taskId }) => taskId),
  );
  const keys = new Set<string>();
  for (const admission of request.admissions) {
    const provenance = issuedAdmissions.get(admission);
    const key = leaseKey(admission);
    if (
      !provenance ||
      provenance.authority !== request.authority ||
      provenance.state !== request.state ||
      consumedAdmissions.has(admission) ||
      capabilities.has(admission) ||
      taskIds.has(admission.taskId) ||
      keys.has(key) ||
      authorityState.leaseHistory.has(key)
    )
      throw new Error('Module delivery admission capability is invalid.');
    capabilities.add(admission);
    taskIds.add(admission.taskId);
    keys.add(key);
  }
  if (
    authorityState.activeLeases.size + request.admissions.length >
    authorityState.maxConcurrency
  )
    throw new Error('Module delivery lease capacity is exceeded.');
  const activeLeases = new Map(authorityState.activeLeases);
  const leaseHistory = new Map(authorityState.leaseHistory);
  const leases: ModuleDeliveryAttemptLease[] = [];
  for (const admission of request.admissions) {
    consumedAdmissions.add(admission);
    const leaseValue: ModuleDeliveryAttemptLease = copyAdmission(admission);
    const lease = Object.freeze(leaseValue);
    const key = leaseKey(lease);
    activeLeases.set(key, lease);
    leaseHistory.set(key, lease);
    const leaseProvenance: AdmissionProvenance = {
      authority: request.authority,
      state: request.state,
    };
    issuedLeases.set(lease, leaseProvenance);
    leases.push(lease);
  }
  authorityState.activeLeases = activeLeases;
  authorityState.leaseHistory = leaseHistory;
  return {
    state: publishAdmissionState(request.authority),
    leases: Object.freeze(leases),
  };
}
export function recordModuleDeliveryAttemptDisposition(
  request: RecordModuleDeliveryAttemptDispositionRequest,
): ModuleDeliveryAdmissionState {
  assertModuleDeliveryAdmissionStateAuthority(request);
  const provenance = issuedLeases.get(request.lease);
  const authorityState = generationAuthorityState(request.authority);
  const currentInspection: CurrentAdmissionInspection = {
    authorityState,
    state: request.state,
  };
  const key = leaseKey(request.lease);
  if (
    !provenance ||
    provenance.authority !== request.authority ||
    disposedLeases.has(request.lease) ||
    authorityState.activeLeases.get(key) !== request.lease ||
    !isCurrentAdmissionState(currentInspection)
  )
    throw new Error('Module delivery lease capability is invalid.');
  if (
    request.outcome.kind !==
      ModuleDeliveryAttemptDispositionKind.FinalUnusable ||
    (request.outcome.conclusion !==
      ModuleDeliveryGenerationFenceKind.Cancelled &&
      request.outcome.conclusion !== ModuleDeliveryGenerationFenceKind.Rejected)
  )
    throw new Error('Module delivery disposition must be terminal unusable.');
  disposedLeases.add(request.lease);
  const dispositionValue: ModuleDeliveryAttemptDisposition = {
    ...request.lease,
    ...request.outcome,
  };
  const disposition = Object.freeze(dispositionValue);
  const activeLeases = new Map(authorityState.activeLeases);
  activeLeases.delete(key);
  authorityState.activeLeases = activeLeases;
  authorityState.dispositions = [...authorityState.dispositions, disposition];
  return publishAdmissionState(request.authority);
}
export function restartModuleDeliveryGeneration(
  request: RestartModuleDeliveryGenerationRequest,
): ModuleDeliveryAdmissionState {
  assertPlan(request.acceptedPlan);
  const stateInspection: AdmissionStateAuthorityInspection = {
    authority: request.authority,
    state: request.previousState,
  };
  assertModuleDeliveryAdmissionStateAuthority(stateInspection);
  const authorityInspection: GenerationAuthorityInspection = {
    authority: request.authority,
    generation: request.previousState.generation,
    planDigest: request.previousState.planDigest,
  };
  assertAuthority(authorityInspection);
  if (request.acceptedPlan.plan.generation <= request.previousState.generation)
    throw new Error(
      'A superseding module plan requires a newer immutable generation.',
    );
  assertGenerationTermination(request);
  const supersession: GenerationAuthoritySupersession = {
    authority: request.authority,
    previousGeneration: request.previousState.generation,
    previousPlanDigest: request.previousState.planDigest,
    acceptedPlan: request.acceptedPlan,
  };
  supersedeModuleDeliveryGenerationAuthority(supersession);
  return publishAdmissionState(request.authority);
}
export function selectModuleDeliveryAdmissions(
  request: SelectModuleDeliveryAdmissionsRequest,
): ModuleDeliveryAdmissionSelection {
  assertPlan(request.acceptedPlan);
  const authorityInspection: GenerationAuthorityInspection = {
    authority: request.authority,
    generation: request.acceptedPlan.plan.generation,
    planDigest: request.acceptedPlan.planDigest,
  };
  assertAuthority(authorityInspection);
  assertCurrentState(request);
  const blockedTaskIds = terminallyBlockedTaskIds(request);
  if (blockedTaskIds.length > 0)
    return {
      status: ModuleDeliveryAdmissionSelectionStatus.Blocked,
      admissions: [],
      pendingTaskIds: [],
      blockedTaskIds,
    };
  const available =
    request.acceptedPlan.plan.maxConcurrency -
    generationAuthorityState(request.authority).activeLeases.size;
  if (available <= 0)
    return {
      status: ModuleDeliveryAdmissionSelectionStatus.Selected,
      admissions: [],
      pendingTaskIds: readyPendingTaskIds(request),
      blockedTaskIds: [],
    };
  const admissions: ModuleDeliveryAdmission[] = [];
  const pendingTaskIds: string[] = [];
  const lookup = nodeLookup(request.acceptedPlan);
  for (const taskId of request.acceptedPlan.topologicalOrder) {
    const node = lookup(taskId);
    const task: TaskState = { request, node };
    if (!taskIsPending(task) || !taskIsReady(task)) continue;
    const resources = leasedResources(task);
    const conflictsWith = resourceConflictsWith(resources);
    const conflicts =
      generationAuthorityState(request.authority).activeLeases.size > 0 &&
      [
        ...generationAuthorityState(request.authority).activeLeases.values(),
      ].some((lease) => conflictsWith(lease.resources));
    const selectedConflict = admissions.some((admission) =>
      conflictsWith(admission.resources),
    );
    if (admissions.length >= available || conflicts || selectedConflict) {
      pendingTaskIds.push(taskId);
      continue;
    }
    const admission: ModuleDeliveryAdmission = {
      taskId,
      attempt: nextAttempt(task),
      generation: request.state.generation,
      planDigest: request.state.planDigest,
      startingFrontier: startingFrontier(task),
      resources,
      team: node.team,
      functionalOwner: node.functionalOwner,
      acceptanceOwner: node.acceptanceOwner,
      parentLineage: frozenParentLineage(node.parentLineage),
      acceptanceRequirements: Object.freeze([...node.acceptance.evidence]),
    };
    const issued = Object.freeze(admission);
    const provenance: AdmissionProvenance = {
      authority: request.authority,
      state: request.state,
    };
    issuedAdmissions.set(issued, provenance);
    admissions.push(issued);
  }
  return {
    status: ModuleDeliveryAdmissionSelectionStatus.Selected,
    admissions,
    pendingTaskIds,
    blockedTaskIds: [],
  };
}
function assertGenerationTermination(
  request: RestartModuleDeliveryGenerationRequest,
): void {
  const authorityState = generationAuthorityState(request.authority);
  const currentInspection: CurrentAdmissionInspection = {
    authorityState,
    state: request.previousState,
  };
  const undispositioned = [...authorityState.leaseHistory.values()].filter(
    (lease) =>
      authorityState.dispositions.every(
        (disposition) => leaseKey(disposition) !== leaseKey(lease),
      ),
  );
  const unfencedTaskIds = new Set(
    [...authorityState.leaseHistory.values()]
      .map(({ taskId }) => taskId)
      .filter((taskId) => {
        const taskDispositions = authorityState.dispositions.filter(
          (disposition) => disposition.taskId === taskId,
        );
        return !taskDispositions.some(
          ({ kind }) =>
            kind === ModuleDeliveryAttemptDispositionKind.FinalUnusable,
        );
      }),
  );
  if (
    !isCurrentAdmissionState(currentInspection) ||
    authorityState.activeLeases.size > 0 ||
    undispositioned.length > 0 ||
    unfencedTaskIds.size > 0
  )
    throw new Error(
      'Generation restart requires authoritative terminal release evidence.',
    );
}
function assertCurrentState(
  request: SelectModuleDeliveryAdmissionsRequest,
): void {
  const inspection: AdmissionStateAuthorityInspection = {
    authority: request.authority,
    state: request.state,
  };
  assertModuleDeliveryAdmissionStateAuthority(inspection);
  const authorityState = generationAuthorityState(request.authority);
  const currentInspection: CurrentAdmissionInspection = {
    authorityState,
    state: request.state,
  };
  if (
    !isCurrentAdmissionState(currentInspection) ||
    request.state.generation !== request.acceptedPlan.plan.generation ||
    request.state.planDigest !== request.acceptedPlan.planDigest ||
    request.state.headCommit !== authorityState.frontier.headCommit
  )
    throw new Error(
      'Module admission state belongs to an obsolete plan generation.',
    );
  if (
    [
      ...authorityState.activeLeases.values(),
      ...authorityState.dispositions,
    ].some(
      (entry) =>
        entry.generation !== request.state.generation ||
        entry.planDigest !== request.state.planDigest,
    )
  )
    throw new Error('Module admission state contains an obsolete attempt.');
}
function terminallyBlockedTaskIds(
  request: SelectModuleDeliveryAdmissionsRequest,
): readonly string[] {
  const failed = new Set(
    request.acceptedPlan.plan.nodes
      .filter((node) => {
        const task: TaskState = { request, node };
        return taskTerminallyFailed(task);
      })
      .map(({ taskId }) => taskId),
  );
  for (const taskId of request.acceptedPlan.topologicalOrder) {
    if (
      request.acceptedPlan.executionPrecedence.some(
        (edge) =>
          edge.successorTaskId === taskId && failed.has(edge.predecessorTaskId),
      )
    )
      failed.add(taskId);
  }
  return request.acceptedPlan.topologicalOrder.filter((taskId) =>
    failed.has(taskId),
  );
}
function taskTerminallyFailed(task: TaskState): boolean {
  const dispositions = generationAuthorityState(
    task.request.authority,
  ).dispositions.filter(({ taskId }) => taskId === task.node.taskId);
  return dispositions.length >= task.request.acceptedPlan.plan.maxAttempts;
}
function readyPendingTaskIds(
  request: SelectModuleDeliveryAdmissionsRequest,
): readonly string[] {
  const lookup = nodeLookup(request.acceptedPlan);
  return request.acceptedPlan.topologicalOrder.filter((taskId) => {
    const task: TaskState = {
      request,
      node: lookup(taskId),
    };
    return taskIsPending(task) && taskIsReady(task);
  });
}
function nodeLookup(acceptedPlan: AcceptedModuleDeliveryPlan): NodeLookup {
  return (taskId) => {
    const node = acceptedPlan.plan.nodes.find(
      (entry) => entry.taskId === taskId,
    );
    if (!node) throw new Error(`Accepted plan is missing task ${taskId}.`);
    return node;
  };
}
function taskIsPending(task: TaskState): boolean {
  const authorityState = generationAuthorityState(task.request.authority);
  if (
    [...authorityState.activeLeases.values()].some(
      ({ taskId }) => taskId === task.node.taskId,
    )
  )
    return false;
  const dispositions = authorityState.dispositions.filter(
    ({ taskId }) => taskId === task.node.taskId,
  );
  return dispositions.length < task.request.acceptedPlan.plan.maxAttempts;
}
function startingFrontier(task: TaskState): string {
  const hasExecutionPredecessor =
    task.request.acceptedPlan.executionPrecedence.some(
      ({ successorTaskId }) => successorTaskId === task.node.taskId,
    );
  return !hasExecutionPredecessor &&
    task.node.baseline.kind === ModuleDeliveryBaselineKind.SourceCommit
    ? task.node.baseline.sourceCommit
    : generationAuthorityState(task.request.authority).frontier.headCommit;
}
function taskIsReady(task: TaskState): boolean {
  return !task.request.acceptedPlan.executionPrecedence.some(
    ({ successorTaskId }) => successorTaskId === task.node.taskId,
  );
}
function leasedResources(task: TaskState): ModuleDeliveryResourceClaims {
  const lookup = nodeLookup(task.request.acceptedPlan);
  const evidence = task.node.dependencies.flatMap((taskId) => {
    const provider = lookup(taskId);
    return provider.kind === ModuleDeliveryTaskKind.ReadOnly
      ? provider.resources.evidenceSurface
      : [];
  });
  const resources: ModuleDeliveryResourceClaims = {
    read: Object.freeze([
      ...new Set([...task.node.resources.read, ...evidence]),
    ]),
    write: Object.freeze([...task.node.resources.write]),
    evidenceSurface: Object.freeze([...task.node.resources.evidenceSurface]),
  };
  return Object.freeze(resources);
}

function frozenParentLineage(parent: AgentAttemptParent): AgentAttemptParent {
  const copy: AgentAttemptParent = { ...parent };
  return Object.freeze(copy);
}

function copyAdmission(
  admission: ModuleDeliveryAdmission,
): ModuleDeliveryAttemptLease {
  const resources: ModuleDeliveryResourceClaims = {
    read: Object.freeze([...admission.resources.read]),
    write: Object.freeze([...admission.resources.write]),
    evidenceSurface: Object.freeze([...admission.resources.evidenceSurface]),
  };
  return {
    ...admission,
    resources: Object.freeze(resources),
    parentLineage: frozenParentLineage(admission.parentLineage),
    acceptanceRequirements: Object.freeze([
      ...admission.acceptanceRequirements,
    ]),
  };
}
function nextAttempt(task: TaskState): number {
  const attempts = [
    ...generationAuthorityState(task.request.authority).leaseHistory.values(),
  ]
    .filter(({ taskId }) => taskId === task.node.taskId)
    .map(({ attempt }) => attempt);
  return attempts.length === 0 ? 1 : Math.max(...attempts) + 1;
}
function resourceConflictsWith(
  first: ModuleDeliveryResourceClaims,
): ResourceConflict {
  const firstWritesOverlap = claimsOverlap(first.write);
  const firstReadsOverlap = claimsOverlap(first.read);
  return (second) =>
    firstWritesOverlap(second.write) ||
    firstWritesOverlap(second.read) ||
    firstReadsOverlap(second.write);
}
function claimsOverlap(first: ResourceClaimList): ResourceClaimOverlap {
  return (second) =>
    first.some((firstClaim) =>
      second.some((secondClaim) => {
        const patterns: TaskResourcePatternPair = {
          first: firstClaim,
          second: secondClaim,
        };
        return taskResourcePatternsOverlap(patterns);
      }),
    );
}
