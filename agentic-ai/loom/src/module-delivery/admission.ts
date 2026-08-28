/* eslint-disable max-params, loom/no-raw-object-arguments */
import { taskResourcePatternsOverlap } from '../agent-workflow/domain.ts';
import {
  ModuleDeliveryBaselineKind,
  ModuleDeliveryTaskKind,
} from './domain.ts';
import {
  assertAcceptedModuleDeliveryEvidence,
  moduleDeliveryAcceptedEvidenceIdentity,
} from './evidence.ts';
import type { ModuleDeliveryAcceptedProviderEvidenceIdentity } from './evidence.ts';
import { ModuleDeliveryValidationStatus } from './domain.ts';
import { decodeAndValidateModuleDeliveryPlan } from './validation.ts';

import type {
  AgentAttemptParent,
  TaskResourcePatternPair,
} from '../agent-workflow/domain.ts';
import type { TeamKey } from '../team-agents/catalog.ts';
import type {
  ModuleDeliveryNodeV2,
  ModuleDeliveryResourceClaims,
  ValidatedModuleDeliveryPlan,
} from './domain.ts';
import type { AcceptedModuleDeliveryEvidence } from './integration-provenance.ts';

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

export type ModuleDeliveryIntegratedWriterFrontier = Readonly<{
  taskId: string;
  headCommit: string;
}>;

export type CreateModuleDeliveryGenerationAuthorityRequest = {
  readonly acceptedPlan: ValidatedModuleDeliveryPlan;
  readonly expectedLineage: readonly ModuleDeliveryExpectedLineage[];
};

export type CreateModuleDeliveryAdmissionStateRequest = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly acceptedPlan: ValidatedModuleDeliveryPlan;
  readonly headCommit: string;
  readonly integratedWriterFrontiers: readonly ModuleDeliveryIntegratedWriterFrontier[];
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
  integratedWriterFrontiers: readonly ModuleDeliveryIntegratedWriterFrontier[];
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
  currentState: ModuleDeliveryAdmissionState | undefined;
  activeLeases: Map<string, ModuleDeliveryAttemptLease>;
  leaseHistory: Map<string, ModuleDeliveryAttemptLease>;
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

const authorityStates = new WeakMap<
  ModuleDeliveryGenerationAuthority,
  AuthorityState
>();
const stateProvenance = new WeakMap<
  ModuleDeliveryAdmissionState,
  StateProvenance
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

const COMMIT = /^[0-9a-f]{40}$/u;

export function createModuleDeliveryGenerationAuthority(
  request: CreateModuleDeliveryGenerationAuthorityRequest,
): ModuleDeliveryGenerationAuthority {
  const acceptedPlan = trustedPlanSnapshot(request.acceptedPlan);
  const expectedLineage = expectedLineageMap(
    acceptedPlan,
    request.expectedLineage,
  );
  const value: ModuleDeliveryGenerationAuthority = { [AUTHORITY]: true };
  const authority = Object.freeze(value);
  authorityStates.set(authority, {
    inputPlan: request.acceptedPlan,
    acceptedPlan,
    expectedLineage,
    currentState: undefined,
    activeLeases: new Map(),
    leaseHistory: new Map(),
    dispositions: [],
  });
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
  authority: ModuleDeliveryGenerationAuthority,
  acceptedPlan: ValidatedModuleDeliveryPlan,
): ValidatedModuleDeliveryPlan {
  return authorityStateForPlan(authority, acceptedPlan).acceptedPlan;
}

export function createModuleDeliveryAdmissionState(
  request: CreateModuleDeliveryAdmissionStateRequest,
): ModuleDeliveryAdmissionState {
  const authority = authorityStateForPlan(
    request.authority,
    request.acceptedPlan,
  );
  if (!COMMIT.test(request.headCommit))
    throw new Error('Module delivery admission head must be an exact commit.');
  const frontiers = integratedFrontiers(
    authority.acceptedPlan,
    request.headCommit,
    request.integratedWriterFrontiers,
  );
  const evidence = acceptedEvidenceIdentities(
    request.authority,
    authority.acceptedPlan,
    request.acceptedEvidence,
  );
  const state = Object.freeze({
    generation: authority.acceptedPlan.plan.generation,
    planDigest: authority.acceptedPlan.planDigest,
    headCommit: request.headCommit,
    integratedWriterFrontiers: frontiers,
    acceptedProviderEvidence: evidence.identities,
  });
  stateProvenance.set(state, {
    authority: request.authority,
    acceptedEvidence: evidence.accepted,
  });
  authority.currentState = state;
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
    authority.currentState !== inspection.state ||
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
  const authority = authorityStateForPlan(
    request.authority,
    request.acceptedPlan,
  );
  assertModuleDeliveryAdmissionStateAuthority(request);
  const blockedTaskIds = terminallyBlockedTaskIds(authority);
  if (blockedTaskIds.length > 0)
    return frozenSelection(
      ModuleDeliveryAdmissionSelectionStatus.Blocked,
      [],
      [],
      blockedTaskIds,
    );
  const available =
    authority.acceptedPlan.plan.maxConcurrency - authority.activeLeases.size;
  const admissions: ModuleDeliveryAdmission[] = [];
  const pendingTaskIds: string[] = [];
  for (const taskId of authority.acceptedPlan.topologicalOrder) {
    const node = nodeFor(authority.acceptedPlan, taskId);
    if (
      !taskPending(authority, taskId) ||
      !taskReady(authority, request.state, node)
    )
      continue;
    const resources = frozenResources(node, authority.acceptedPlan);
    if (
      admissions.length >= Math.max(available, 0) ||
      [...authority.activeLeases.values(), ...admissions].some((active) =>
        resourcesConflict(resources, active.resources),
      )
    ) {
      pendingTaskIds.push(taskId);
      continue;
    }
    const admission = Object.freeze({
      taskId,
      attempt: nextAttempt(authority, taskId),
      generation: request.state.generation,
      planDigest: request.state.planDigest,
      startingFrontier: startingFrontier(request.state, node),
      resources,
      team: node.team,
      functionalOwner: node.functionalOwner,
      acceptanceOwner: node.acceptanceOwner,
      parentLineage: frozenParent(authority.expectedLineage.get(taskId)),
      acceptanceRequirements: Object.freeze([...node.acceptance.evidence]),
    });
    admissionProvenance.set(admission, {
      authority: request.authority,
      state: request.state,
    });
    admissions.push(admission);
  }
  return frozenSelection(
    ModuleDeliveryAdmissionSelectionStatus.Selected,
    admissions,
    pendingTaskIds,
    [],
  );
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
    const lease = Object.freeze(copyAdmission(admission));
    authority.activeLeases.set(attemptKey(lease), lease);
    authority.leaseHistory.set(attemptKey(lease), lease);
    leaseProvenance.set(lease, {
      authority: request.authority,
      state: request.state,
    });
    return lease;
  });
  return Object.freeze({ state: request.state, leases: Object.freeze(leases) });
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
  if (
    disposedLeases.has(request.lease) ||
    authority.activeLeases.get(key) !== request.lease ||
    !validDisposition(authority, request.state, request.lease, request.outcome)
  )
    throw new Error('Module delivery lease capability is invalid.');
  disposedLeases.add(request.lease);
  authority.activeLeases.delete(key);
  authority.dispositions.push(
    Object.freeze({
      taskId: request.lease.taskId,
      attempt: request.lease.attempt,
      generation: request.lease.generation,
      planDigest: request.lease.planDigest,
      ...request.outcome,
    }),
  );
  return request.state;
}

export function restartModuleDeliveryGeneration(
  request: RestartModuleDeliveryGenerationRequest,
): ModuleDeliveryAdmissionState {
  assertModuleDeliveryAdmissionStateAuthority({
    authority: request.authority,
    state: request.previousState,
  });
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
  authority.inputPlan = request.acceptedPlan;
  authority.acceptedPlan = trustedPlanSnapshot(request.acceptedPlan);
  authority.expectedLineage = expectedLineageMap(
    authority.acceptedPlan,
    request.expectedLineage,
  );
  authority.activeLeases = new Map();
  authority.leaseHistory = new Map();
  authority.dispositions = [];
  authority.currentState = undefined;
  return createModuleDeliveryAdmissionState({
    authority: request.authority,
    acceptedPlan: request.acceptedPlan,
    headCommit: request.acceptedPlan.plan.sourceCommit,
    integratedWriterFrontiers: [],
    acceptedEvidence: [],
  });
}

function requiredAuthority(
  authority: ModuleDeliveryGenerationAuthority,
): AuthorityState {
  const state = authorityStates.get(authority);
  if (!state)
    throw new Error('Module delivery generation authority is invalid.');
  return state;
}

function authorityStateForPlan(
  authority: ModuleDeliveryGenerationAuthority,
  acceptedPlan: ValidatedModuleDeliveryPlan,
): AuthorityState {
  const state = requiredAuthority(authority);
  if (state.inputPlan !== acceptedPlan)
    throw new Error(
      'Module delivery validated plan authority is invalid or superseded.',
    );
  return state;
}

function trustedPlanSnapshot(
  candidate: ValidatedModuleDeliveryPlan,
): ValidatedModuleDeliveryPlan {
  const accepted = decodeAndValidateModuleDeliveryPlan(
    JSON.stringify(candidate.plan),
  );
  if (
    accepted.status !== ModuleDeliveryValidationStatus.Accepted ||
    accepted.planDigest !== candidate.planDigest ||
    JSON.stringify(accepted.topologicalOrder) !==
      JSON.stringify(candidate.topologicalOrder) ||
    JSON.stringify(accepted.waves) !== JSON.stringify(candidate.waves) ||
    JSON.stringify(accepted.executionPrecedence) !==
      JSON.stringify(candidate.executionPrecedence)
  )
    throw new Error('Validated module delivery plan metadata is inconsistent.');
  return accepted;
}

function expectedLineageMap(
  acceptedPlan: ValidatedModuleDeliveryPlan,
  entries: readonly ModuleDeliveryExpectedLineage[],
): ReadonlyMap<string, AgentAttemptParent> {
  if (entries.length !== acceptedPlan.plan.nodes.length)
    throw new Error('Expected lineage must bind every module delivery task.');
  const result = new Map<string, AgentAttemptParent>();
  for (const entry of entries) {
    const node = nodeFor(acceptedPlan, entry.taskId);
    if (
      result.has(entry.taskId) ||
      JSON.stringify(entry.parentLineage) !== JSON.stringify(node.parentLineage)
    )
      throw new Error(`Expected lineage is invalid for ${entry.taskId}.`);
    result.set(entry.taskId, frozenParent(entry.parentLineage));
  }
  return result;
}

function integratedFrontiers(
  plan: ValidatedModuleDeliveryPlan,
  headCommit: string,
  entries: readonly ModuleDeliveryIntegratedWriterFrontier[],
): readonly ModuleDeliveryIntegratedWriterFrontier[] {
  const seen = new Set<string>();
  const result = entries.map((entry) => {
    const node = nodeFor(plan, entry.taskId);
    if (
      seen.has(entry.taskId) ||
      node.kind !== ModuleDeliveryTaskKind.Write ||
      !COMMIT.test(entry.headCommit)
    )
      throw new Error(
        `Integrated writer frontier is invalid for ${entry.taskId}.`,
      );
    seen.add(entry.taskId);
    return Object.freeze({ ...entry });
  });
  if (
    result.length > 0 &&
    !result.some(({ headCommit: commit }) => commit === headCommit)
  )
    throw new Error(
      'Admission head is not an exact integrated writer frontier.',
    );
  return Object.freeze(result);
}

function acceptedEvidenceIdentities(
  authority: ModuleDeliveryGenerationAuthority,
  plan: ValidatedModuleDeliveryPlan,
  entries: readonly AcceptedModuleDeliveryEvidence[],
): {
  accepted: readonly AcceptedModuleDeliveryEvidence[];
  identities: readonly ModuleDeliveryAcceptedProviderEvidenceIdentity[];
} {
  const seen = new Set<string>();
  const accepted = entries.map((entry) => {
    assertAcceptedModuleDeliveryEvidence({ authority, evidence: entry });
    const identity = moduleDeliveryAcceptedEvidenceIdentity(entry);
    if (
      identity.generation !== plan.plan.generation ||
      identity.planDigest !== plan.planDigest ||
      seen.has(identity.taskId)
    )
      throw new Error(`Accepted evidence is invalid for ${identity.taskId}.`);
    seen.add(identity.taskId);
    return entry;
  });
  return {
    accepted: Object.freeze([...accepted]),
    identities: Object.freeze(
      accepted.map(moduleDeliveryAcceptedEvidenceIdentity),
    ),
  };
}

function nodeFor(
  plan: ValidatedModuleDeliveryPlan,
  taskId: string,
): ModuleDeliveryNodeV2 {
  const node = plan.plan.nodes.find((candidate) => candidate.taskId === taskId);
  if (!node) throw new Error(`Validated plan is missing task ${taskId}.`);
  return node;
}

function taskPending(authority: AuthorityState, taskId: string): boolean {
  return (
    ![...authority.activeLeases.values()].some(
      (lease) => lease.taskId === taskId,
    ) &&
    !authority.dispositions.some(
      (entry) =>
        entry.taskId === taskId &&
        entry.kind === ModuleDeliveryAttemptDispositionKind.Accepted,
    ) &&
    authority.dispositions.filter((entry) => entry.taskId === taskId).length <
      authority.acceptedPlan.plan.maxAttempts
  );
}

function taskReady(
  authority: AuthorityState,
  state: ModuleDeliveryAdmissionState,
  node: ModuleDeliveryNodeV2,
): boolean {
  return (
    authority.acceptedPlan.executionPrecedence
      .filter((edge) => edge.successorTaskId === node.taskId)
      .every((edge) => {
        const predecessor = nodeFor(
          authority.acceptedPlan,
          edge.predecessorTaskId,
        );
        if (
          edge.requiresIntegratedWriterFrontier ||
          predecessor.kind === ModuleDeliveryTaskKind.Write
        )
          return state.integratedWriterFrontiers.some(
            ({ taskId }) => taskId === predecessor.taskId,
          );
        return state.acceptedProviderEvidence.some(
          ({ taskId }) => taskId === predecessor.taskId,
        );
      }) && synthesisInputsReady(state, node)
  );
}

function synthesisInputsReady(
  state: ModuleDeliveryAdmissionState,
  node: ModuleDeliveryNodeV2,
): boolean {
  if (node.kind !== ModuleDeliveryTaskKind.EvidenceSynthesis) return true;
  const expected = node.evidenceInput.expectedProducers;
  return (
    expected.length > 0 &&
    expected.every((producer) =>
      state.acceptedProviderEvidence.some(
        (identity) =>
          identity.taskId === producer.taskId &&
          identity.producerTeam === producer.team &&
          identity.functionalOwner === producer.functionalOwner &&
          identity.acceptanceOwner === producer.acceptanceOwner,
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

function validDisposition(
  authority: AuthorityState,
  state: ModuleDeliveryAdmissionState,
  lease: ModuleDeliveryAttemptLease,
  outcome: ModuleDeliveryDispositionOutcome,
): boolean {
  if (outcome.kind === ModuleDeliveryAttemptDispositionKind.Accepted) {
    if (outcome.conclusion !== ModuleDeliveryGenerationFenceKind.Accepted)
      return false;
    const node = nodeFor(authority.acceptedPlan, lease.taskId);
    return node.kind === ModuleDeliveryTaskKind.Write
      ? state.integratedWriterFrontiers.some(
          ({ taskId }) => taskId === lease.taskId,
        )
      : state.acceptedProviderEvidence.some(
          ({ taskId, attempt }) =>
            taskId === lease.taskId && attempt === lease.attempt,
        );
  }
  return (
    outcome.kind === ModuleDeliveryAttemptDispositionKind.FinalUnusable &&
    (outcome.conclusion === ModuleDeliveryGenerationFenceKind.Cancelled ||
      outcome.conclusion === ModuleDeliveryGenerationFenceKind.Failed ||
      outcome.conclusion === ModuleDeliveryGenerationFenceKind.Rejected)
  );
}

function frozenResources(
  node: ModuleDeliveryNodeV2,
  plan: ValidatedModuleDeliveryPlan,
): ModuleDeliveryResourceClaims {
  const evidenceReads = node.dependencies.flatMap((taskId) => {
    const provider = nodeFor(plan, taskId);
    return provider.kind === ModuleDeliveryTaskKind.ReadOnly
      ? provider.resources.evidenceSurface
      : [];
  });
  return Object.freeze({
    read: Object.freeze([
      ...new Set([...node.resources.read, ...evidenceReads]),
    ]),
    write: Object.freeze([...node.resources.write]),
    evidenceSurface: Object.freeze([...node.resources.evidenceSurface]),
  });
}

function startingFrontier(
  state: ModuleDeliveryAdmissionState,
  node: ModuleDeliveryNodeV2,
): string {
  return node.baseline.kind === ModuleDeliveryBaselineKind.SourceCommit &&
    node.dependencies.length === 0
    ? node.baseline.sourceCommit
    : state.headCommit;
}

function nextAttempt(authority: AuthorityState, taskId: string): number {
  const attempts = [...authority.leaseHistory.values()]
    .filter((lease) => lease.taskId === taskId)
    .map(({ attempt }) => attempt);
  return attempts.length === 0 ? 1 : Math.max(...attempts) + 1;
}

function frozenParent(
  parent: AgentAttemptParent | undefined,
): AgentAttemptParent {
  if (!parent) throw new Error('Expected lineage is missing.');
  return Object.freeze({ ...parent });
}

function copyAdmission(
  admission: ModuleDeliveryAdmission,
): ModuleDeliveryAttemptLease {
  return {
    ...admission,
    resources: Object.freeze({
      read: Object.freeze([...admission.resources.read]),
      write: Object.freeze([...admission.resources.write]),
      evidenceSurface: Object.freeze([...admission.resources.evidenceSurface]),
    }),
    parentLineage: frozenParent(admission.parentLineage),
    acceptanceRequirements: Object.freeze([
      ...admission.acceptanceRequirements,
    ]),
  };
}

function attemptKey(identity: AttemptIdentity): string {
  return `${identity.taskId}:${identity.attempt}`;
}

function resourcesConflict(
  first: ModuleDeliveryResourceClaims,
  second: ModuleDeliveryResourceClaims,
): boolean {
  return (
    claimsOverlap(first.write, second.write) ||
    claimsOverlap(first.write, second.read) ||
    claimsOverlap(first.read, second.write)
  );
}

function claimsOverlap(
  first: readonly string[],
  second: readonly string[],
): boolean {
  return first.some((left) =>
    second.some((right) => {
      const pair: TaskResourcePatternPair = { first: left, second: right };
      return taskResourcePatternsOverlap(pair);
    }),
  );
}

function frozenSelection(
  status: ModuleDeliveryAdmissionSelectionStatus,
  admissions: readonly ModuleDeliveryAdmission[],
  pendingTaskIds: readonly string[],
  blockedTaskIds: readonly string[],
): ModuleDeliveryAdmissionSelection {
  return Object.freeze({
    status,
    admissions: Object.freeze([...admissions]),
    pendingTaskIds: Object.freeze([...pendingTaskIds]),
    blockedTaskIds: Object.freeze([...blockedTaskIds]),
  });
}
