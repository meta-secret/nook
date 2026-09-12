import type {
  AuthorityState,
  CapabilityProvenance,
  NodeLookupRequest,
  AuthorityTaskRequest,
  TaskReadyRequest,
  SynthesisReadyRequest,
  DispositionValidationRequest,
  StartingFrontierRequest,
} from './admission-state-contracts.ts';
import type {
  ModuleDeliveryExpectedLineage,
  CreateModuleDeliveryGenerationAuthorityRequest,
  CreateModuleDeliveryAdmissionStateRequest,
  PrepareFinalModuleDeliveryAdmissionStateRequest,
  CommitFinalModuleDeliveryAdmissionStateRequest,
  RollbackFinalModuleDeliveryAdmissionStateRequest,
  RestartModuleDeliveryGenerationRequest,
  AttemptIdentity,
  ModuleDeliveryAdmission,
  ModuleDeliveryAttemptLease,
  ModuleDeliveryAttemptDisposition,
  ModuleDeliveryAdmissionState,
  SelectModuleDeliveryAdmissionsRequest,
  ModuleDeliveryAdmissionSelection,
  RecordModuleDeliveryAttemptLeasesRequest,
  ModuleDeliveryLeaseRecording,
} from './admission-contracts.ts';
import {
  ModuleDeliveryAdmissionSelectionStatus,
  ModuleDeliveryAttemptDispositionKind,
  ModuleDeliveryGenerationFenceKind,
} from './admission-contracts.ts';
export type {
  ModuleDeliveryExpectedLineage,
  CreateModuleDeliveryGenerationAuthorityRequest,
  CreateModuleDeliveryAdmissionStateRequest,
  PrepareFinalModuleDeliveryAdmissionStateRequest,
  CommitFinalModuleDeliveryAdmissionStateRequest,
  RollbackFinalModuleDeliveryAdmissionStateRequest,
  RestartModuleDeliveryGenerationRequest,
  ModuleDeliveryAdmission,
  ModuleDeliveryAttemptLease,
  ModuleDeliveryAttemptDisposition,
  ModuleDeliveryAdmissionState,
  SelectModuleDeliveryAdmissionsRequest,
  ModuleDeliveryAdmissionSelection,
  RecordModuleDeliveryAttemptLeasesRequest,
  ModuleDeliveryLeaseRecording,
} from './admission-contracts.ts';
export {
  ModuleDeliveryAdmissionSelectionStatus,
  ModuleDeliveryAttemptDispositionKind,
  ModuleDeliveryGenerationFenceKind,
} from './admission-contracts.ts';
import { ModuleSourceAuthority } from './authority.ts';
import { ModuleDeliveryTaskKind } from './domain.ts';
import { ModuleEvidenceBoundary } from './evidence.ts';
import { ModuleIntegrationCoordinator } from './integration.ts';
import { ModuleAdmissionStateRegistry } from './admission-state.ts';
import type {
  ModuleDeliveryAcceptedProviderEvidenceIdentity,
  ModuleDeliveryEvidenceSubmissionValidation,
  ModuleDeliveryEvidenceSubmissionVerification,
  RestoreModuleDeliveryCanonicalEvidenceReceiptRequest,
} from './evidence.ts';
import type { AgentAttemptParent } from '../agent-workflow/domain.ts';

import { CortexAuthoringAdmission } from './cortex-context.ts';
import type { AdmitCortexAuthoringContextRequest } from './cortex-context.ts';
import type { TeamTaskContext } from '../team-agents/context.ts';
import type { ValidatedModuleDeliveryPlan } from './domain.ts';
import type {
  AcceptedModuleDeliveryEvidence,
  AdmissionStateAuthorityInspection,
  AttemptLeaseAuthorityInspection,
  GenerationAuthorityInspection,
  ModuleDeliveryAuthorityPlanRequest,
  ModuleDeliveryAuthorityRepositoryInspection,
  RecordModuleDeliveryAttemptDispositionRequest,
} from './integration-provenance.ts';
import type { ModuleDeliveryIntegratedWriterFrontierCapability } from './integration.ts';

import type {
  AcceptedModuleDeliveryEvidenceInspection,
  AcceptedModuleDeliveryEvidenceRegistration,
  AuthenticateModuleDeliverySourceCommitRequest,
  ExpectedLineageMapRequest,
  FrozenModuleDeliveryResourcesRequest,
  ResourceConflictRequest,
} from './authority.ts';
import { ModuleAdmissionSource } from './admission-source.ts';
const AUTHORITY = Symbol('module-delivery-generation-authority');
const admissionStateStoreAuthorities = {
  assertCanonicalTransition:
    ModuleIntegrationCoordinator.assertModuleDeliveryCanonicalEvidenceTransition,
  assertWriterFrontier:
    ModuleIntegrationCoordinator.assertModuleDeliveryIntegratedWriterFrontierCapability,
};
const admissionStateStore =
  ModuleAdmissionStateRegistry.createModuleDeliveryAdmissionStateStore(
    admissionStateStoreAuthorities,
  );
export type ModuleDeliveryGenerationAuthority = Readonly<{
  [AUTHORITY]: true;
}>;

/** Owns the module generation authority registry and its capability transitions. */
export class ModuleGenerationAuthority {
  private constructor() {}
  private static readonly authorityStates = new WeakMap<
    ModuleDeliveryGenerationAuthority,
    AuthorityState
  >();

  private static readonly admissionProvenance = new WeakMap<
    ModuleDeliveryAdmission,
    CapabilityProvenance
  >();

  private static readonly leaseProvenance = new WeakMap<
    ModuleDeliveryAttemptLease,
    CapabilityProvenance
  >();

  private static readonly consumedAdmissions =
    new WeakSet<ModuleDeliveryAdmission>();

  private static readonly disposedLeases =
    new WeakSet<ModuleDeliveryAttemptLease>();

  private static readonly acceptedEvidenceLeases =
    new WeakSet<ModuleDeliveryAttemptLease>();

  private static readonly evidenceAuthorities = new WeakMap<
    AcceptedModuleDeliveryEvidence,
    ModuleDeliveryGenerationAuthority
  >();

  static createModuleDeliveryGenerationAuthority(
    request: CreateModuleDeliveryGenerationAuthorityRequest,
  ): ModuleDeliveryGenerationAuthority {
    const { acceptedPlan, repositoryRoot } =
      ModuleAdmissionSource.freeze(request);
    const lineageRequest: ExpectedLineageMapRequest = {
      acceptedPlan,
      entries: request.expectedLineage,
    };
    const expectedLineage =
      ModuleSourceAuthority.expectedModuleDeliveryLineageMap(lineageRequest);
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
      evidenceRegistry:
        ModuleSourceAuthority.createAcceptedModuleDeliveryEvidenceRegistry(),
    };
    ModuleGenerationAuthority.authorityStates.set(authority, authorityState);
    return authority;
  }

  static assertModuleDeliveryGenerationAuthority(
    inspection: GenerationAuthorityInspection,
  ): void {
    const state = ModuleGenerationAuthority.authorityStates.get(
      inspection.authority,
    );
    if (
      !state ||
      state.acceptedPlan.plan.generation !== inspection.generation ||
      state.acceptedPlan.planDigest !== inspection.planDigest
    )
      throw new Error(
        'Module delivery generation authority is invalid or superseded.',
      );
  }

  static moduleDeliveryAuthorityPlan(
    request: ModuleDeliveryAuthorityPlanRequest,
  ): ValidatedModuleDeliveryPlan {
    return ModuleSourceAuthority.trustedModuleDeliveryPlanSnapshot(
      ModuleGenerationAuthority.authorityStateForPlan(request).acceptedPlan,
    );
  }

  static assertModuleDeliveryAuthorityRepository(
    inspection: ModuleDeliveryAuthorityRepositoryInspection,
  ): void {
    const authority = ModuleGenerationAuthority.requiredAuthority(
      inspection.authority,
    );
    const authentication: AuthenticateModuleDeliverySourceCommitRequest = {
      repositoryRoot: inspection.repositoryRoot,
      sourceCommit: authority.acceptedPlan.plan.sourceCommit,
    };
    if (
      ModuleSourceAuthority.authenticateModuleDeliverySourceCommit(
        authentication,
      ) !== authority.repositoryRoot
    )
      throw new Error('Module delivery repository authority is invalid.');
  }

  static assertAcceptedModuleDeliveryEvidence(
    inspection: AcceptedModuleDeliveryEvidenceInspection,
  ): void {
    ModuleGenerationAuthority.requiredAuthority(
      inspection.authority,
    ).evidenceRegistry.assert(inspection);
  }

  static moduleDeliveryAcceptedEvidenceIdentity(
    evidence: AcceptedModuleDeliveryEvidence,
  ): ModuleDeliveryAcceptedProviderEvidenceIdentity {
    const authority =
      ModuleGenerationAuthority.authorityForAcceptedEvidence(evidence);
    return authority.evidenceRegistry.identity(evidence);
  }

  static verifyModuleDeliveryEvidenceSubmission(
    verification: ModuleDeliveryEvidenceSubmissionVerification,
  ): AcceptedModuleDeliveryEvidence {
    const authority = ModuleGenerationAuthority.requiredAuthority(
      verification.authority,
    );
    const planRequest: ModuleDeliveryAuthorityPlanRequest = {
      authority: verification.authority,
      acceptedPlan: verification.acceptedPlan,
    };
    const acceptedPlan =
      ModuleGenerationAuthority.moduleDeliveryAuthorityPlan(planRequest);
    const generationInspection: GenerationAuthorityInspection = {
      authority: verification.authority,
      generation: acceptedPlan.plan.generation,
      planDigest: acceptedPlan.planDigest,
    };
    ModuleGenerationAuthority.assertModuleDeliveryGenerationAuthority(
      generationInspection,
    );
    const leaseInspection: AttemptLeaseAuthorityInspection = {
      authority: verification.authority,
      lease: verification.lease,
    };
    ModuleGenerationAuthority.assertModuleDeliveryAttemptLeaseAuthority(
      leaseInspection,
    );
    const stateInspection: AdmissionStateAuthorityInspection = {
      authority: verification.authority,
      state: verification.state,
    };
    ModuleGenerationAuthority.assertModuleDeliveryAdmissionStateAuthority(
      stateInspection,
    );
    if (
      ModuleGenerationAuthority.acceptedEvidenceLeases.has(verification.lease)
    )
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
          throw new Error(
            `Duplicate accepted evidence for ${identity.taskId}.`,
          );
        seen.add(identity.taskId);
        return identity;
      }),
    );
    const validation: ModuleDeliveryEvidenceSubmissionValidation = {
      verification,
      acceptedPlan,
      authorized,
    };
    const accepted =
      ModuleEvidenceBoundary.validateModuleDeliveryEvidenceSubmission(
        validation,
      );
    const [integratedTaskIds = []] = [
      verification.state.integratedWriterFrontiers[0]?.integratedTaskIds,
    ];
    const registration: AcceptedModuleDeliveryEvidenceRegistration = {
      authority: verification.authority,
      evidence: accepted,
      integratedTaskIds,
    };
    authority.evidenceRegistry.register(registration);
    ModuleGenerationAuthority.evidenceAuthorities.set(
      accepted,
      verification.authority,
    );
    ModuleGenerationAuthority.acceptedEvidenceLeases.add(verification.lease);
    return accepted;
  }

  static restoreModuleDeliveryCanonicalEvidenceReceipt(
    request: RestoreModuleDeliveryCanonicalEvidenceReceiptRequest,
  ) {
    const authority = ModuleGenerationAuthority.authorityStateForPlan(request);
    if (ModuleGenerationAuthority.acceptedEvidenceLeases.has(request.lease))
      throw new Error('Canonical evidence receipt lease is already consumed.');
    ModuleGenerationAuthority.assertModuleDeliveryAdmissionStateAuthority(
      request,
    );
    ModuleGenerationAuthority.assertModuleDeliveryAttemptLeaseAuthority(
      request,
    );
    const evidence =
      ModuleEvidenceBoundary.restoreModuleDeliveryCanonicalEvidenceReceipt({
        ...request,
        registry: authority.evidenceRegistry,
        node: ModuleSourceAuthority.moduleDeliveryNode({
          plan: authority.acceptedPlan,
          taskId: request.lease.taskId,
        }),
      });
    ModuleGenerationAuthority.evidenceAuthorities.set(
      evidence,
      request.authority,
    );
    const state = ModuleGenerationAuthority.createModuleDeliveryAdmissionState({
      ...request,
      headCommit: request.state.headCommit,
      integratedWriterFrontiers: request.state.integratedWriterFrontiers,
      acceptedEvidence: [...request.acceptedEvidence, evidence],
    });
    ModuleGenerationAuthority.acceptedEvidenceLeases.add(request.lease);
    ModuleGenerationAuthority.recordModuleDeliveryAttemptDisposition({
      authority: request.authority,
      state,
      lease: request.lease,
      outcome: {
        kind: ModuleDeliveryAttemptDispositionKind.Accepted,
        conclusion: ModuleDeliveryGenerationFenceKind.Accepted,
      },
    });
    return Object.freeze({ evidence, state });
  }

  static createModuleDeliveryAdmissionState(
    request: CreateModuleDeliveryAdmissionStateRequest,
  ): ModuleDeliveryAdmissionState {
    const authority = ModuleGenerationAuthority.authorityStateForPlan(request);
    const materialization = {
      store: admissionStateStore,
      request,
      acceptedPlan: authority.acceptedPlan,
      evidenceRegistry: authority.evidenceRegistry,
      evidenceHeadCommit: request.headCommit,
    };
    return ModuleAdmissionStateRegistry.createAdmissionState(materialization);
  }

  static prepareFinalModuleDeliveryAdmissionState(
    request: PrepareFinalModuleDeliveryAdmissionStateRequest,
  ): ModuleDeliveryAdmissionState {
    const authority = ModuleGenerationAuthority.authorityStateForPlan(request);
    const materialization = {
      store: admissionStateStore,
      request,
      acceptedPlan: authority.acceptedPlan,
      evidenceRegistry: authority.evidenceRegistry,
      evidenceHeadCommit: request.previousState.headCommit,
    };
    return ModuleAdmissionStateRegistry.prepareFinalAdmissionState(
      materialization,
    );
  }

  static commitFinalModuleDeliveryAdmissionState(
    request: CommitFinalModuleDeliveryAdmissionStateRequest,
  ): void {
    const commitRequest = { ...request, store: admissionStateStore };
    ModuleAdmissionStateRegistry.commitFinalAdmissionState(commitRequest);
  }

  static rollbackFinalModuleDeliveryAdmissionState(
    request: RollbackFinalModuleDeliveryAdmissionStateRequest,
  ): void {
    const rollbackRequest = { ...request, store: admissionStateStore };
    ModuleAdmissionStateRegistry.rollbackFinalAdmissionState(rollbackRequest);
  }

  static restartModuleDeliveryGeneration(
    request: RestartModuleDeliveryGenerationRequest,
  ): ModuleDeliveryAdmissionState {
    const stateInspection: AdmissionStateAuthorityInspection = {
      authority: request.authority,
      state: request.previousState,
    };
    ModuleGenerationAuthority.assertModuleDeliveryAdmissionStateAuthority(
      stateInspection,
    );
    const authority = ModuleGenerationAuthority.requiredAuthority(
      request.authority,
    );
    const dispositionKeys = new Set(
      authority.dispositions.map(ModuleGenerationAuthority.attemptKey),
    );
    if (
      authority.activeLeases.size > 0 ||
      [...authority.leaseHistory.values()].some(
        (lease) =>
          !dispositionKeys.has(ModuleGenerationAuthority.attemptKey(lease)),
      )
    )
      throw new Error(
        'Generation restart requires authoritative terminal release evidence.',
      );
    const { acceptedPlan } = ModuleAdmissionSource.freeze({
      acceptedPlan: request.acceptedPlan,
      repositoryRoot: authority.repositoryRoot,
    });
    if (acceptedPlan.plan.generation <= request.previousState.generation)
      throw new Error(
        'A superseding module plan requires a newer immutable generation.',
      );
    if (
      authority.leaseHistory.size > 0 &&
      acceptedPlan.plan.maxAttempts !== authority.acceptedPlan.plan.maxAttempts
    )
      throw new Error(
        'A superseding module plan cannot change maxAttempts after execution begins.',
      );
    const lineageRequest: ExpectedLineageMapRequest = {
      acceptedPlan,
      entries: request.expectedLineage,
    };
    const expectedLineage =
      ModuleSourceAuthority.expectedModuleDeliveryLineageMap(lineageRequest);
    const attemptsByTask = new Map(authority.attemptsByTask);
    const frontiers: readonly ModuleDeliveryIntegratedWriterFrontierCapability[] =
      Object.freeze([]);
    const identities: readonly ModuleDeliveryAcceptedProviderEvidenceIdentity[] =
      Object.freeze([]);
    const evidence: readonly AcceptedModuleDeliveryEvidence[] = Object.freeze(
      [],
    );
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
    const evidenceRegistry =
      ModuleSourceAuthority.createAcceptedModuleDeliveryEvidenceRegistry();
    authority.inputPlan = request.acceptedPlan;
    authority.acceptedPlan = acceptedPlan;
    authority.expectedLineage = expectedLineage;
    authority.activeLeases = new Map();
    authority.leaseHistory = new Map();
    authority.attemptsByTask = attemptsByTask;
    authority.dispositions = [];
    authority.evidenceRegistry = evidenceRegistry;
    ModuleAdmissionStateRegistry.registerAdmissionState(stateRegistration);
    return state;
  }

  static assertModuleDeliveryAdmissionStateAuthority(
    inspection: AdmissionStateAuthorityInspection,
  ): void {
    const authority = ModuleGenerationAuthority.authorityStates.get(
      inspection.authority,
    );
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
    ModuleAdmissionStateRegistry.assertAdmissionStateCurrent(currentInspection);
  }

  static selectModuleDeliveryAdmissions(
    request: SelectModuleDeliveryAdmissionsRequest,
  ): ModuleDeliveryAdmissionSelection {
    const planRequest: ModuleDeliveryAuthorityPlanRequest = request;
    const authority =
      ModuleGenerationAuthority.authorityStateForPlan(planRequest);
    ModuleGenerationAuthority.assertModuleDeliveryAdmissionStateAuthority(
      request,
    );
    const blockedTaskIds =
      ModuleGenerationAuthority.terminallyBlockedTaskIds(authority);
    const available =
      authority.acceptedPlan.plan.maxConcurrency - authority.activeLeases.size;
    const admissions: ModuleDeliveryAdmission[] = [];
    const pendingTaskIds: string[] = [];
    for (const taskId of authority.acceptedPlan.topologicalOrder) {
      const nodeRequest: NodeLookupRequest = {
        plan: authority.acceptedPlan,
        taskId,
      };
      const node = ModuleSourceAuthority.moduleDeliveryNode(nodeRequest);
      const taskRequest: AuthorityTaskRequest = { authority, taskId };
      const readyRequest: TaskReadyRequest = {
        authority,
        state: request.state,
        node,
      };
      if (
        blockedTaskIds.includes(taskId) ||
        !ModuleGenerationAuthority.taskPending(taskRequest) ||
        !ModuleGenerationAuthority.taskReady(readyRequest)
      )
        continue;
      const resourcesRequest: FrozenModuleDeliveryResourcesRequest = {
        node,
        plan: authority.acceptedPlan,
      };
      const resources =
        ModuleSourceAuthority.frozenModuleDeliveryResources(resourcesRequest);
      const activeAdmissions = [
        ...authority.activeLeases.values(),
        ...admissions,
      ];
      if (
        admissions.length >= Math.max(available, 0) ||
        (node.kind === ModuleDeliveryTaskKind.Write &&
          activeAdmissions.some(
            (active) => active.resources.write.length > 0,
          )) ||
        activeAdmissions.some((active) => {
          const conflictRequest: ResourceConflictRequest = {
            first: resources,
            second: active.resources,
          };
          return ModuleSourceAuthority.moduleDeliveryResourcesConflict(
            conflictRequest,
          );
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
          startingFrontier:
            ModuleGenerationAuthority.startingFrontier(frontierRequest),
          node,
          resources,
        };
        contextFields.context = CortexAuthoringAdmission.admit(
          contextAdmissionRequest,
        );
      }
      const admissionValue: ModuleDeliveryAdmission = {
        taskId,
        attempt: ModuleGenerationAuthority.nextAttempt(attemptRequest),
        generation: request.state.generation,
        planDigest: request.state.planDigest,
        startingFrontier:
          ModuleGenerationAuthority.startingFrontier(frontierRequest),
        resources,
        ...contextFields,
        team: node.team,
        functionalOwner: node.functionalOwner,
        acceptanceOwner: node.acceptanceOwner,
        parentLineage: ModuleGenerationAuthority.expectedParent(taskRequest),
        acceptanceRequirements: Object.freeze([...node.acceptance.evidence]),
        authorizedProviderEvidence,
      };
      const admission = Object.freeze(admissionValue);
      const provenance: CapabilityProvenance = {
        authority: request.authority,
        state: request.state,
      };
      ModuleGenerationAuthority.admissionProvenance.set(admission, provenance);
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
    return ModuleSourceAuthority.freezeModuleDeliveryAdmissionSelection(
      selectionRequest,
    );
  }

  static recordModuleDeliveryAttemptLeases(
    request: RecordModuleDeliveryAttemptLeasesRequest,
  ): ModuleDeliveryLeaseRecording {
    ModuleGenerationAuthority.assertModuleDeliveryAdmissionStateAuthority(
      request,
    );
    const authority = ModuleGenerationAuthority.requiredAuthority(
      request.authority,
    );
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
      const provenance =
        ModuleGenerationAuthority.admissionProvenance.get(admission);
      const key = ModuleGenerationAuthority.attemptKey(admission);
      if (
        !provenance ||
        provenance.authority !== request.authority ||
        provenance.state !== request.state ||
        ModuleGenerationAuthority.consumedAdmissions.has(admission) ||
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
          return ModuleSourceAuthority.moduleDeliveryResourcesConflict(
            conflictRequest,
          );
        })
      )
        throw new Error('Module delivery admission capability is invalid.');
      seenAdmissions.add(admission);
      seenTasks.add(admission.taskId);
      compatible.push(admission);
    }
    const leases = request.admissions.map((admission) => {
      ModuleGenerationAuthority.consumedAdmissions.add(admission);
      const lease = Object.freeze(
        ModuleSourceAuthority.copyModuleDeliveryAdmission(admission),
      );
      authority.activeLeases.set(
        ModuleGenerationAuthority.attemptKey(lease),
        lease,
      );
      authority.leaseHistory.set(
        ModuleGenerationAuthority.attemptKey(lease),
        lease,
      );
      authority.attemptsByTask.set(lease.taskId, lease.attempt);
      const provenance: CapabilityProvenance = {
        authority: request.authority,
        state: request.state,
      };
      ModuleGenerationAuthority.leaseProvenance.set(lease, provenance);
      return lease;
    });
    const recording: ModuleDeliveryLeaseRecording = {
      state: request.state,
      leases: Object.freeze(leases),
    };
    return Object.freeze(recording);
  }

  static assertModuleDeliveryAttemptLeaseAuthority(
    inspection: AttemptLeaseAuthorityInspection,
  ): void {
    const authority = ModuleGenerationAuthority.requiredAuthority(
      inspection.authority,
    );
    const provenance = ModuleGenerationAuthority.leaseProvenance.get(
      inspection.lease,
    );
    if (
      !provenance ||
      provenance.authority !== inspection.authority ||
      authority.activeLeases.get(
        ModuleGenerationAuthority.attemptKey(inspection.lease),
      ) !== inspection.lease ||
      inspection.lease.generation !== authority.acceptedPlan.plan.generation ||
      inspection.lease.planDigest !== authority.acceptedPlan.planDigest
    )
      throw new Error('Module delivery lease authority is invalid.');
  }

  static recordModuleDeliveryAttemptDisposition(
    request: RecordModuleDeliveryAttemptDispositionRequest,
  ): ModuleDeliveryAdmissionState {
    ModuleGenerationAuthority.assertModuleDeliveryAdmissionStateAuthority(
      request,
    );
    ModuleGenerationAuthority.assertModuleDeliveryAttemptLeaseAuthority(
      request,
    );
    const authority = ModuleGenerationAuthority.requiredAuthority(
      request.authority,
    );
    const key = ModuleGenerationAuthority.attemptKey(request.lease);
    const dispositionRequest: DispositionValidationRequest = {
      authority,
      state: request.state,
      lease: request.lease,
      outcome: request.outcome,
    };
    if (
      ModuleGenerationAuthority.disposedLeases.has(request.lease) ||
      authority.activeLeases.get(key) !== request.lease ||
      !ModuleGenerationAuthority.validDisposition(dispositionRequest)
    )
      throw new Error('Module delivery lease capability is invalid.');
    ModuleGenerationAuthority.disposedLeases.add(request.lease);
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

  private static requiredAuthority(
    authority: ModuleDeliveryGenerationAuthority,
  ): AuthorityState {
    const state = ModuleGenerationAuthority.authorityStates.get(authority);
    if (!state)
      throw new Error('Module delivery generation authority is invalid.');
    return state;
  }

  private static authorityForAcceptedEvidence(
    evidence: AcceptedModuleDeliveryEvidence,
  ): AuthorityState {
    const authority =
      ModuleGenerationAuthority.evidenceAuthorities.get(evidence);
    if (!authority)
      throw new Error('Accepted module delivery evidence is forged.');
    return ModuleGenerationAuthority.requiredAuthority(authority);
  }

  private static authorityForState(
    state: ModuleDeliveryAdmissionState,
  ): AuthorityState {
    const request = { store: admissionStateStore, state };
    return ModuleGenerationAuthority.requiredAuthority(
      ModuleAdmissionStateRegistry.admissionStateAuthority(request),
    );
  }

  private static expectedParent(
    request: AuthorityTaskRequest,
  ): AgentAttemptParent {
    const parent = request.authority.expectedLineage.get(request.taskId);
    if (!parent) throw new Error('Expected lineage is missing.');
    return parent;
  }

  private static acceptedAttemptKeys(
    authority: AuthorityState,
  ): ReadonlySet<string> {
    return new Set(
      authority.dispositions
        .filter(
          ({ kind }) => kind === ModuleDeliveryAttemptDispositionKind.Accepted,
        )
        .map(ModuleGenerationAuthority.attemptKey),
    );
  }

  private static authorityStateForPlan(
    request: ModuleDeliveryAuthorityPlanRequest,
  ): AuthorityState {
    const state = ModuleGenerationAuthority.requiredAuthority(
      request.authority,
    );
    if (state.inputPlan !== request.acceptedPlan)
      throw new Error(
        'Module delivery validated plan authority is invalid or superseded.',
      );
    return state;
  }

  private static taskPending(request: AuthorityTaskRequest): boolean {
    return (
      ![...request.authority.activeLeases.values()].some(
        (lease) => lease.taskId === request.taskId,
      ) &&
      !request.authority.dispositions.some(
        (entry) =>
          entry.taskId === request.taskId &&
          entry.kind === ModuleDeliveryAttemptDispositionKind.Accepted,
      ) &&
      ModuleGenerationAuthority.nextAttempt(request) <=
        request.authority.acceptedPlan.plan.maxAttempts
    );
  }

  private static taskReady(request: TaskReadyRequest): boolean {
    const accepted = ModuleGenerationAuthority.acceptedAttemptKeys(
      request.authority,
    );
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
          const predecessor =
            ModuleSourceAuthority.moduleDeliveryNode(nodeRequest);
          if (
            edge.requiresIntegratedWriterFrontier ||
            predecessor.kind === ModuleDeliveryTaskKind.Write
          )
            return request.state.integratedWriterFrontiers.some(
              (identity) =>
                identity.taskId === predecessor.taskId &&
                accepted.has(ModuleGenerationAuthority.attemptKey(identity)),
            );
          return request.state.acceptedProviderEvidence.some(
            (identity) =>
              identity.taskId === predecessor.taskId &&
              accepted.has(ModuleGenerationAuthority.attemptKey(identity)),
          );
        }) && ModuleGenerationAuthority.synthesisInputsReady(synthesisRequest)
    );
  }

  private static synthesisInputsReady(request: SynthesisReadyRequest): boolean {
    if (request.node.kind !== ModuleDeliveryTaskKind.EvidenceSynthesis)
      return true;
    const expected = request.node.evidenceInput.expectedProducers;
    const accepted = ModuleGenerationAuthority.acceptedAttemptKeys(
      ModuleGenerationAuthority.authorityForState(request.state),
    );
    return (
      expected.length > 0 &&
      expected.every((producer) =>
        request.state.acceptedProviderEvidence.some(
          (identity) =>
            identity.taskId === producer.taskId &&
            identity.producerTeam === producer.team &&
            identity.functionalOwner === producer.functionalOwner &&
            identity.acceptanceOwner === producer.acceptanceOwner &&
            accepted.has(ModuleGenerationAuthority.attemptKey(identity)),
        ),
      )
    );
  }

  private static terminallyBlockedTaskIds(
    authority: AuthorityState,
  ): readonly string[] {
    const failed = new Set(
      authority.acceptedPlan.plan.nodes
        .filter(({ taskId }) => {
          const [attempts = 0] = [authority.attemptsByTask.get(taskId)];
          return (
            attempts >= authority.acceptedPlan.plan.maxAttempts &&
            ![...authority.activeLeases.values()].some(
              (lease) => lease.taskId === taskId,
            ) &&
            !authority.dispositions.some(
              (entry) =>
                entry.taskId === taskId &&
                entry.kind === ModuleDeliveryAttemptDispositionKind.Accepted,
            )
          );
        })
        .map(({ taskId }) => taskId),
    );
    for (const taskId of authority.acceptedPlan.topologicalOrder) {
      if (
        authority.acceptedPlan.executionPrecedence.some(
          (edge) =>
            edge.successorTaskId === taskId &&
            failed.has(edge.predecessorTaskId),
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

  private static validDisposition(
    request: DispositionValidationRequest,
  ): boolean {
    const nodeRequest: NodeLookupRequest = {
      plan: request.authority.acceptedPlan,
      taskId: request.lease.taskId,
    };
    const node = ModuleSourceAuthority.moduleDeliveryNode(nodeRequest);
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
        request.outcome.conclusion ===
          ModuleDeliveryGenerationFenceKind.Failed ||
        request.outcome.conclusion ===
          ModuleDeliveryGenerationFenceKind.Rejected)
    );
  }

  private static startingFrontier(request: StartingFrontierRequest): string {
    return request.state.headCommit;
  }

  private static nextAttempt(request: AuthorityTaskRequest): number {
    const [defaulted2 = 0] = [
      request.authority.attemptsByTask.get(request.taskId),
    ];
    return defaulted2 + 1;
  }

  private static attemptKey(identity: AttemptIdentity): string {
    return `${identity.taskId}:${identity.attempt}`;
  }
}

const COMMIT = /^[0-9a-f]{40}$/u;
