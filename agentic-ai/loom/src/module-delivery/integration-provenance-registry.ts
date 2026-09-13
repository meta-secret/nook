import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { ModuleRepositoryGit } from './git-command.ts';
import { ModuleDeliverySourceRepositorySnapshot } from './repository-snapshot.ts';
import { ModuleIntegrationPhase } from './evidence-schema.ts';
import {
  ModuleDeliveryAttemptDispositionKind,
  ModuleDeliveryGenerationFenceKind,
  ModuleGenerationAuthority,
} from './admission.ts';

import type { GitCommandRequest } from './git-command.ts';
import type {
  ModuleDeliveryAdmissionState,
  ModuleDeliveryAttemptLease,
  ModuleDeliveryGenerationAuthority,
} from './admission.ts';
import type { PinnedDevBaseEvidence } from '../lib/base-evidence.ts';
import type {
  ModuleDeliveryNode,
  ModuleDeliveryOwnerIdentity,
  ValidatedModuleDeliveryPlan,
} from './domain.ts';
import type {
  CleanupModuleWorktreeRequest,
  ModuleWorktreeHandle,
} from './workspace.ts';
import { ModuleWorktree } from './workspace.ts';
import type {
  ModuleDeliveryReadOnlyEvidenceSubmission,
  ModuleDeliveryProviderSubmissionKind,
  ModuleDeliveryEvidenceVerdict,
} from './evidence-schema.ts';

const INTEGRATION_TASK_ID = 'module-delivery-integration';

export type AcceptedModuleDeliveryEvidence =
  ModuleDeliveryReadOnlyEvidenceSubmission &
    Readonly<{ sourceProvenanceDigest: string; verifiedHeadCommit: string }>;

export type PrepareModuleIntegrationRequest = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  repositoryRoot: string;
  workspaceRoot: string;
  acceptedPlan: ValidatedModuleDeliveryPlan;
  admissionState: ModuleDeliveryAdmissionState;
}>;
export type GenerationAuthorityInspection = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  generation: number;
  planDigest: string;
}>;
export type AdmissionStateAuthorityInspection = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  state: ModuleDeliveryAdmissionState;
}>;
export type AttemptLeaseAuthorityInspection = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  lease: ModuleDeliveryAttemptLease;
}>;
export type ModuleDeliveryAuthorityPlanRequest = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  acceptedPlan: ValidatedModuleDeliveryPlan;
}>;
export type ModuleDeliveryAuthorityRepositoryInspection = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  repositoryRoot: string;
}>;
export type AcceptedPlanStateInspection = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  acceptedPlan: ValidatedModuleDeliveryPlan;
  state: ModuleIntegrationState;
}>;
export type ModuleIntegrationNodeLookup = Readonly<{
  acceptedPlan: ValidatedModuleDeliveryPlan;
  taskId: string;
}>;
export type ModuleDeliveryCanonicalEvidenceTransition = Readonly<{
  previousHeadCommit: string;
  canonicalHeadCommit: string;
  integratedTaskIds: readonly string[];
}>;
export type AssertModuleDeliveryCanonicalEvidenceTransitionRequest = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  transition: ModuleDeliveryCanonicalEvidenceTransition;
  previousHeadCommit: string;
  canonicalHeadCommit: string;
  integratedTaskIds: readonly string[];
}>;
export type CanonicalEvidenceTransitionProvenance = Omit<
  AssertModuleDeliveryCanonicalEvidenceTransitionRequest,
  'transition'
>;
export type ModuleDeliveryDispositionOutcome = Readonly<{
  kind: ModuleDeliveryAttemptDispositionKind;
  conclusion: ModuleDeliveryGenerationFenceKind;
}>;
export type RecordModuleDeliveryAttemptDispositionRequest = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  state: ModuleDeliveryAdmissionState;
  lease: ModuleDeliveryAttemptLease;
  outcome: ModuleDeliveryDispositionOutcome;
}>;

export type ModuleDeliveryHandoffSubmission = Readonly<{
  taskId: string;
  attempt: number;
  planDigest: string;
  baselineCommit: string;
  commit: string;
  workspace: ModuleWorktreeHandle;
}>;

export type ModuleDeliveryWriteProviderSubmission = PinnedDevBaseEvidence &
  Readonly<{
    kind: ModuleDeliveryProviderSubmissionKind.Write;
    generation: number;
    acceptedByTeam: ModuleDeliveryOwnerIdentity;
    verdict: ModuleDeliveryEvidenceVerdict;
    handoff: ModuleDeliveryHandoffSubmission;
  }>;

export type ModuleDeliveryProviderSubmission =
  | ModuleDeliveryWriteProviderSubmission
  | ModuleDeliveryReadOnlyEvidenceSubmission;

export type AcceptedModuleDeliveryWrite = Readonly<{
  taskId: string;
  attempt: number;
  generation: number;
  planDigest: string;
  startingFrontier: string;
  originMainSha: string;
  pinnedLocalDevSha: string;
  featureHeadSha: string;
  integrationCommit: string;
  acceptedByTeam: ModuleDeliveryOwnerIdentity;
  handoff: ModuleDeliveryHandoffSubmission;
}>;

export type ModuleIntegrationCleanupHandle = Readonly<{
  sessionId: string;
}>;

export type ModuleIntegrationState = PinnedDevBaseEvidence &
  Readonly<{
    phase: ModuleIntegrationPhase;
    generation: number;
    planDigest: string;
    sourceCommit: string;
    topologicalOrder: readonly string[];
    waves: readonly (readonly string[])[];
    completedWaveCount: number;
    integratedTaskIds: readonly string[];
    acceptedWrites: readonly AcceptedModuleDeliveryWrite[];
    acceptedEvidence: readonly AcceptedModuleDeliveryEvidence[];
    headCommit: string;
    admissionState: ModuleDeliveryAdmissionState;
    workspace: ModuleWorktreeHandle;
    cleanupHandle: ModuleIntegrationCleanupHandle;
  }>;

export type IntegrateVerifiedModuleDeliveryTaskRequest = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  acceptedPlan: ValidatedModuleDeliveryPlan;
  lease: ModuleDeliveryAttemptLease;
  state: ModuleIntegrationState;
  submission: ModuleDeliveryProviderSubmission;
}>;

export type FinalizeModuleDeliveryIntegrationRequest = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  acceptedPlan: ValidatedModuleDeliveryPlan;
  state: ModuleIntegrationState;
}>;

export type CleanupModuleIntegrationRequest = Readonly<{
  cleanupHandle: ModuleIntegrationCleanupHandle;
}>;

export type CleanupModuleIntegrationResult = Readonly<{ removed: boolean }>;

export type ModuleIntegrationRefRequest = Readonly<{
  workspace: ModuleWorktreeHandle;
  planDigest: string;
}>;

export type UpdateModuleIntegrationRefRequest = Readonly<{
  provenance: ModuleIntegrationProvenance;
  nextCommit: string;
  rollback: boolean;
}>;

export type FreshModuleIntegrationStateInspection = Readonly<{
  state: ModuleIntegrationState;
  provenance: ModuleIntegrationProvenance;
}>;

export type RecordIntegratedLeaseAcceptanceRequest = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  state: ModuleDeliveryAdmissionState;
  lease: ModuleDeliveryAttemptLease;
}>;

export type ModuleIntegrationHandoffRepositoryInspection = Readonly<{
  state: ModuleIntegrationState;
  handoff: ModuleDeliveryHandoffSubmission;
}>;

export type CurrentModuleIntegrationAdmissionInspection = Readonly<{
  authority: ModuleDeliveryGenerationAuthority;
  state: ModuleIntegrationState;
}>;

export type ModuleIntegrationLeaseFrontierInspection = Readonly<{
  state: ModuleIntegrationState;
  lease: ModuleDeliveryAttemptLease;
}>;

export type ModuleIntegrationProviderPrecedenceInspection = Readonly<{
  acceptedPlan: ValidatedModuleDeliveryPlan;
  state: ModuleIntegrationState;
  taskId: string;
  lease: ModuleDeliveryAttemptLease;
}>;

export type ModuleIntegrationCompletedWaveCountRequest = Readonly<{
  acceptedPlan: ValidatedModuleDeliveryPlan;
  state: ModuleIntegrationState;
}>;

/** Owns the module integration provenance registry registry and its capability transitions. */

export class ModuleIntegrationProvenanceRegistry {
  private constructor() {}
  private static readonly PROVENANCE = new WeakMap<
    ModuleIntegrationState,
    ModuleIntegrationProvenance
  >();

  private static readonly SESSIONS = new WeakMap<
    ModuleIntegrationCleanupHandle,
    ModuleIntegrationSession
  >();

  private static readonly RETIRED_STATES =
    new WeakSet<ModuleIntegrationState>();

  static moduleDeliveryEvidenceSha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  static captureSourceSnapshot(
    repositoryRoot: string,
  ): SourceRepositorySnapshot {
    return ModuleDeliverySourceRepositorySnapshot.captureSourceSnapshot(
      repositoryRoot,
    );
  }

  static assertSourceSnapshot(expectation: SourceSnapshotExpectation): void {
    ModuleDeliverySourceRepositorySnapshot.assertSourceSnapshot(expectation);
  }

  static createIntegrationSession(
    registration: IntegrationSessionRegistration,
  ): ModuleIntegrationSession {
    const session: ModuleIntegrationSession = {
      cleanupHandle: registration.cleanupHandle,
      workspace: registration.workspace,
      integrationRef: registration.integrationRef,
      currentHead: registration.currentHead,
      cleaned: false,
    };
    ModuleIntegrationProvenanceRegistry.SESSIONS.set(
      registration.cleanupHandle,
      session,
    );
    return session;
  }

  static integrationSession(
    handle: ModuleIntegrationCleanupHandle,
  ): ModuleIntegrationSession {
    const session = ModuleIntegrationProvenanceRegistry.SESSIONS.get(handle);
    if (!session)
      throw new Error('Module integration cleanup handle is invalid.');
    return session;
  }

  static registerIntegrationState(
    registration: IntegrationStateRegistration,
  ): void {
    const provenanceValue: ModuleIntegrationProvenance = {
      authority: registration.authority,
      planDigest: registration.state.planDigest,
      sourceCommit: registration.state.sourceCommit,
      originMainSha: registration.state.originMainSha,
      pinnedLocalDevSha: registration.state.pinnedLocalDevSha,
      featureHeadSha: registration.state.featureHeadSha,
      completedWaveCount: registration.state.completedWaveCount,
      headCommit: registration.state.headCommit,
      workspace: registration.state.workspace,
      sourceSnapshot: registration.sourceSnapshot,
      workspaceSnapshot: registration.workspaceSnapshot,
      session: registration.session,
    };
    ModuleIntegrationProvenanceRegistry.PROVENANCE.set(
      registration.state,
      Object.freeze(provenanceValue),
    );
  }

  static integrationProvenance(
    state: ModuleIntegrationState,
  ): ModuleIntegrationProvenance {
    if (ModuleIntegrationProvenanceRegistry.RETIRED_STATES.has(state)) {
      throw new Error('Module integration state is stale.');
    }
    const provenance =
      ModuleIntegrationProvenanceRegistry.PROVENANCE.get(state);
    if (!provenance) {
      throw new Error('Module integration state lacks private provenance.');
    }
    return provenance;
  }

  static retireIntegrationState(state: ModuleIntegrationState): void {
    ModuleIntegrationProvenanceRegistry.RETIRED_STATES.add(state);
  }

  private static frozenAcceptedWrite(
    entry: AcceptedModuleDeliveryWrite,
  ): AcceptedModuleDeliveryWrite {
    const handoffValue: ModuleDeliveryHandoffSubmission = { ...entry.handoff };
    const handoff = Object.freeze(handoffValue);
    const value: AcceptedModuleDeliveryWrite = { ...entry, handoff };
    return Object.freeze(value);
  }

  static immutableModuleIntegrationState(
    state: ModuleIntegrationState,
  ): ModuleIntegrationState {
    const workspaceValue: ModuleWorktreeHandle = { ...state.workspace };
    const workspace = Object.isFrozen(state.workspace)
      ? state.workspace
      : Object.freeze(workspaceValue);
    const value: ModuleIntegrationState = {
      ...state,
      topologicalOrder: Object.freeze([...state.topologicalOrder]),
      waves: Object.freeze(state.waves.map((wave) => Object.freeze([...wave]))),
      integratedTaskIds: Object.freeze([...state.integratedTaskIds]),
      acceptedWrites: Object.freeze(
        state.acceptedWrites.map(
          ModuleIntegrationProvenanceRegistry.frozenAcceptedWrite,
        ),
      ),
      acceptedEvidence: Object.freeze([...state.acceptedEvidence]),
      workspace,
    };
    return Object.freeze(value);
  }

  static moduleIntegrationRef(request: ModuleIntegrationRefRequest): string {
    return `refs/nook/module-delivery/${request.planDigest}/${request.workspace.worktreeId}`;
  }

  static updateModuleIntegrationRef(
    request: UpdateModuleIntegrationRefRequest,
  ): void {
    if (request.rollback)
      request.provenance.session.currentHead = request.provenance.headCommit;
    else request.provenance.session.currentHead = request.nextCommit;
  }

  static assertFreshModuleIntegrationState(
    request: FreshModuleIntegrationStateInspection,
  ): void {
    const { state, provenance } = request;
    if (
      provenance.planDigest !== state.planDigest ||
      provenance.sourceCommit !== state.sourceCommit ||
      provenance.originMainSha !== state.originMainSha ||
      provenance.pinnedLocalDevSha !== state.pinnedLocalDevSha ||
      provenance.featureHeadSha !== state.featureHeadSha ||
      provenance.completedWaveCount !== state.completedWaveCount ||
      provenance.headCommit !== state.headCommit ||
      provenance.workspace !== state.workspace
    )
      throw new Error(
        'Module integration state violates its private provenance.',
      );
    if (
      state.phase !== ModuleIntegrationPhase.AcceptingProviders &&
      state.phase !== ModuleIntegrationPhase.Finalized
    )
      throw new Error('Module integration state has an invalid phase.');
    if (
      !Number.isSafeInteger(state.completedWaveCount) ||
      state.completedWaveCount < 0 ||
      state.completedWaveCount > state.waves.length
    )
      throw new Error('Module integration state has an invalid wave frontier.');
    if (
      new Set(state.integratedTaskIds).size !== state.integratedTaskIds.length
    )
      throw new Error(
        'Module integration state has an inconsistent task frontier.',
      );
    ModuleWorktree.assertIntegrationWorkspaceIdentity(state.workspace);
    if (
      state.workspace.planDigest !== state.planDigest ||
      state.workspace.baselineCommit !== state.sourceCommit ||
      state.admissionState.originMainSha !== state.originMainSha ||
      state.admissionState.pinnedLocalDevSha !== state.pinnedLocalDevSha ||
      state.admissionState.featureHeadSha !== state.featureHeadSha ||
      state.workspace.taskId !== INTEGRATION_TASK_ID ||
      state.workspace.attempt !== 1
    )
      throw new Error('Module integration workspace metadata is inconsistent.');
    if (
      provenance.session.cleaned ||
      provenance.session.cleanupHandle !== state.cleanupHandle ||
      provenance.session.workspace !== state.workspace ||
      provenance.session.currentHead !== state.headCommit
    )
      throw new Error(
        'Module integration session is stale or already cleaned.',
      );
    const expectedSnapshot =
      state.headCommit === provenance.sourceSnapshot.headCommit
        ? provenance.sourceSnapshot
        : provenance.workspaceSnapshot;
    ModuleIntegrationProvenanceRegistry.assertSourceSnapshot({
      repositoryRoot: state.workspace.sourceRepositoryRoot,
      expected: expectedSnapshot,
    });
  }

  static recordIntegratedLeaseAcceptance(
    accepted: RecordIntegratedLeaseAcceptanceRequest,
  ): void {
    const outcome: ModuleDeliveryDispositionOutcome = {
      kind: ModuleDeliveryAttemptDispositionKind.Accepted,
      conclusion: ModuleDeliveryGenerationFenceKind.Accepted,
    };
    const request: RecordModuleDeliveryAttemptDispositionRequest = {
      authority: accepted.authority,
      state: accepted.state,
      lease: accepted.lease,
      outcome,
    };
    ModuleGenerationAuthority.recordModuleDeliveryAttemptDisposition(request);
  }

  static assertModuleIntegrationHandoffRepository(
    inspection: ModuleIntegrationHandoffRepositoryInspection,
  ): void {
    const integrationInvocation: GitCommandRequest = {
      cwd: inspection.state.workspace.sourceRepositoryRoot,
      args: ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    };
    const handoffInvocation: GitCommandRequest = {
      cwd: inspection.handoff.workspace.worktreePath,
      args: ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    };
    const integrationGit = realpathSync(
      ModuleRepositoryGit.gitText(
        ModuleRepositoryGit.runModuleDeliveryGit(integrationInvocation),
      ),
    );
    const handoffGit = realpathSync(
      ModuleRepositoryGit.gitText(
        ModuleRepositoryGit.runModuleDeliveryGit(handoffInvocation),
      ),
    );
    if (
      inspection.handoff.workspace.sourceRepositoryRoot !==
        inspection.state.workspace.sourceRepositoryRoot ||
      handoffGit !== integrationGit
    )
      throw new Error('Module delivery handoff repository is invalid.');
  }

  static assertCurrentModuleIntegrationAdmission(
    inspection: CurrentModuleIntegrationAdmissionInspection,
  ): void {
    const authorityInspection: AdmissionStateAuthorityInspection = {
      authority: inspection.authority,
      state: inspection.state.admissionState,
    };
    ModuleGenerationAuthority.assertModuleDeliveryAdmissionStateAuthority(
      authorityInspection,
    );
  }

  static assertModuleIntegrationLeaseFrontier(
    inspection: ModuleIntegrationLeaseFrontierInspection,
  ): void {
    if (!/^[0-9a-f]{40}$/u.test(inspection.lease.startingFrontier))
      throw new Error('Provider lease has an invalid starting frontier.');
    const invocation: GitCommandRequest = {
      cwd: inspection.state.workspace.sourceRepositoryRoot,
      args: [
        'merge-base',
        '--is-ancestor',
        inspection.lease.startingFrontier,
        inspection.state.headCommit,
      ],
      allowFailure: true,
    };
    if (ModuleRepositoryGit.runModuleDeliveryGit(invocation).exitCode !== 0)
      throw new Error(
        'Provider lease starting frontier is stale or unrelated.',
      );
  }

  static assertModuleIntegrationProviderPrecedence(
    inspection: ModuleIntegrationProviderPrecedenceInspection,
  ): void {
    const predecessors = inspection.acceptedPlan.executionPrecedence
      .filter((edge) => edge.successorTaskId === inspection.taskId)
      .map((edge) => edge.predecessorTaskId);
    for (const predecessor of predecessors) {
      const acceptedWrite = inspection.state.acceptedWrites.find(
        (entry) => entry.taskId === predecessor,
      );
      const evidenceAccepted = inspection.state.acceptedEvidence.some(
        (entry) => entry.taskId === predecessor,
      );
      if (!acceptedWrite && !evidenceAccepted)
        throw new Error(
          `Provider ${inspection.taskId} is not ready; predecessor ${predecessor} is undispositioned.`,
        );
      if (!acceptedWrite) continue;
      const invocation: GitCommandRequest = {
        cwd: inspection.state.workspace.sourceRepositoryRoot,
        args: [
          'merge-base',
          '--is-ancestor',
          acceptedWrite.integrationCommit,
          inspection.lease.startingFrontier,
        ],
        allowFailure: true,
      };
      if (ModuleRepositoryGit.runModuleDeliveryGit(invocation).exitCode !== 0)
        throw new Error(
          `Provider ${inspection.taskId} lease predates integrated predecessor ${predecessor}.`,
        );
    }
  }

  static moduleIntegrationCompletedWaveCount(
    request: ModuleIntegrationCompletedWaveCountRequest,
  ): number {
    let completed = 0;
    for (const wave of request.acceptedPlan.waves) {
      const complete = wave.every(
        (taskId) =>
          request.state.integratedTaskIds.includes(taskId) ||
          request.state.acceptedEvidence.some(
            (entry) => entry.taskId === taskId,
          ),
      );
      if (!complete) break;
      completed += 1;
    }
    return completed;
  }

  static assertModuleIntegrationAcceptedPlanState(
    inspection: AcceptedPlanStateInspection,
  ): void {
    const validation = inspection.acceptedPlan;
    if (
      inspection.state.planDigest !== validation.planDigest ||
      inspection.state.generation !== validation.plan.generation ||
      inspection.state.sourceCommit !== validation.plan.sourceCommit ||
      inspection.state.originMainSha !== validation.plan.originMainSha ||
      inspection.state.pinnedLocalDevSha !==
        validation.plan.pinnedLocalDevSha ||
      inspection.state.featureHeadSha !== validation.plan.featureHeadSha ||
      JSON.stringify(inspection.state.topologicalOrder) !==
        JSON.stringify(validation.topologicalOrder) ||
      JSON.stringify(inspection.state.waves) !==
        JSON.stringify(validation.waves)
    )
      throw new Error(
        'Module integration state does not match the accepted plan.',
      );
  }

  static moduleIntegrationNodeByTaskId(
    lookup: ModuleIntegrationNodeLookup,
  ): ModuleDeliveryNode {
    const node = lookup.acceptedPlan.plan.nodes.find(
      (candidate) => candidate.taskId === lookup.taskId,
    );
    if (!node)
      throw new Error(`Accepted plan is missing task ${lookup.taskId}.`);
    return node;
  }

  static cleanupRegisteredModuleIntegration(
    request: CleanupModuleIntegrationRequest,
  ): CleanupModuleIntegrationResult {
    const session = ModuleIntegrationProvenanceRegistry.integrationSession(
      request.cleanupHandle,
    );
    if (session.cleaned) return { removed: false };
    const cleanupRequest: CleanupModuleWorktreeRequest = {
      workspace: session.workspace,
    };
    ModuleWorktree.cleanupSharedIntegrationWorkspace(cleanupRequest);
    session.cleaned = true;
    return { removed: true };
  }
}


export type SourceRepositorySnapshot = {
  readonly headCommit: string;
  readonly symbolicHead: string;
  readonly contentDigest: string;
  readonly metadataDigest: string;
  readonly indexDigest: string;
  readonly refsDigest: string;
  readonly configDigest: string;
};

export type ModuleIntegrationSession = {
  readonly cleanupHandle: ModuleIntegrationCleanupHandle;
  readonly workspace: ModuleWorktreeHandle;
  readonly integrationRef: string;
  currentHead: string;
  cleaned: boolean;
};

export type ModuleIntegrationProvenance = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly planDigest: string;
  readonly sourceCommit: string;
  readonly originMainSha: string;
  readonly pinnedLocalDevSha: string;
  readonly featureHeadSha: string;
  readonly completedWaveCount: number;
  readonly headCommit: string;
  readonly workspace: ModuleWorktreeHandle;
  readonly sourceSnapshot: SourceRepositorySnapshot;
  readonly workspaceSnapshot: SourceRepositorySnapshot;
  readonly session: ModuleIntegrationSession;
};

export type SourceSnapshotExpectation = {
  readonly repositoryRoot: string;
  readonly expected: SourceRepositorySnapshot;
};

export type IntegrationSessionRegistration = {
  readonly cleanupHandle: ModuleIntegrationCleanupHandle;
  readonly workspace: ModuleWorktreeHandle;
  readonly integrationRef: string;
  readonly currentHead: string;
};

export type IntegrationStateRegistration = {
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly state: ModuleIntegrationState;
  readonly sourceSnapshot: SourceRepositorySnapshot;
  readonly workspaceSnapshot: SourceRepositorySnapshot;
  readonly session: ModuleIntegrationSession;
};
