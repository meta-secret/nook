import type {
  ModuleGitInvocation,
  ExpectedHandoff,
  ExpectedHandoffVerification,
  ValidatedWaveApplication,
  AdvancedIntegrationStateRequest,
  ProviderLeaseInspection,
  RefreshedWriterFrontiersRequest,
  IntegrationStateUpdate,
  ModuleDeliveryIntegratedWriterFrontierCapability,
  AssertModuleDeliveryIntegratedWriterFrontierCapabilityRequest,
  IntegratedWriterFrontierProvenance,
  MintIntegratedWriterFrontierRequest,
} from './integration-contracts.ts';
export type {
  ModuleDeliveryIntegratedWriterFrontierCapability,
  AssertModuleDeliveryIntegratedWriterFrontierCapabilityRequest,
} from './integration-contracts.ts';
import { randomUUID } from 'node:crypto';

import { ModuleRepositoryGit } from './git-command.ts';
import { ModuleDeliveryTaskKind } from './domain.ts';
import { ModuleCommitHandoff } from './handoff.ts';
import {
  ModuleDeliveryEvidenceVerdict,
  ModuleDeliveryProviderSubmissionKind,
  ModuleIntegrationPhase,
  ModuleIntegrationProvenanceRegistry,
} from './integration-provenance.ts';
import { ModuleWaveTree } from './tree-integration.ts';
import { ModuleWriterFrontierRegistry } from './integration-writer-frontiers.ts';
import { CanonicalWriterClosure } from './integration-finalization.ts';
import type { CanonicalModuleFinalizationInspection } from './integration-finalization.ts';
import { ModuleGenerationAuthority } from './admission.ts';
import { EXACT_GIT_COMMIT } from './workspace-paths.ts';
import type { ModuleDeliveryEvidenceSubmissionVerification } from './evidence.ts';
import type {
  CommitFinalModuleDeliveryAdmissionStateRequest,
  CreateModuleDeliveryAdmissionStateRequest,
  PrepareFinalModuleDeliveryAdmissionStateRequest,
  RollbackFinalModuleDeliveryAdmissionStateRequest,
} from './admission.ts';
import type {
  CleanupModuleIntegrationRequest,
  CleanupModuleIntegrationResult,
  FinalizeModuleDeliveryIntegrationRequest,
  IntegrateVerifiedModuleDeliveryTaskRequest,
  ModuleIntegrationCleanupHandle,
  ModuleIntegrationState,
  PrepareModuleIntegrationRequest,
  ModuleDeliveryCanonicalEvidenceTransition,
  AssertModuleDeliveryCanonicalEvidenceTransitionRequest,
  CanonicalEvidenceTransitionProvenance,
} from './integration-provenance.ts';
import { ModuleWorktree } from './workspace.ts';
import type { GitCommandRequest } from './git-command.ts';

import type {
  ModuleCommitPathRequest,
  VerifyModuleCommitHandoffRequest,
} from './handoff.ts';
import type {
  IntegrationSessionRegistration,
  IntegrationStateRegistration,
  FreshModuleIntegrationStateInspection,
  AdmissionStateAuthorityInspection,
  AttemptLeaseAuthorityInspection,
  GenerationAuthorityInspection,
  ModuleDeliveryAuthorityPlanRequest,
  ModuleDeliveryAuthorityRepositoryInspection,
  CurrentModuleIntegrationAdmissionInspection,
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
  PrepareModuleWorktreeRequest,
} from './workspace.ts';
import type { ModuleDeliveryAttemptLease } from './admission.ts';
const INTEGRATION_TASK_ID = 'module-delivery-integration';
const PROHIBITED_MATERIALIZATION_FILES = new Set([
  '.gitattributes',
  '.gitmodules',
  '.lfsconfig',
]);

/** Owns the module integration coordinator registry and its capability transitions. */
export class ModuleIntegrationCoordinator {
  private constructor() {}
  private static readonly WRITER_FRONTIER_PROVENANCE = new WeakMap<
    ModuleDeliveryIntegratedWriterFrontierCapability,
    IntegratedWriterFrontierProvenance
  >();

  private static readonly CANONICAL_EVIDENCE_TRANSITIONS = new WeakMap<
    ModuleDeliveryCanonicalEvidenceTransition,
    CanonicalEvidenceTransitionProvenance
  >();

  private static mintIntegratedWriterFrontier(
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
    ModuleIntegrationCoordinator.WRITER_FRONTIER_PROVENANCE.set(
      capability,
      Object.freeze(provenance),
    );
    return capability;
  }

  static assertModuleDeliveryIntegratedWriterFrontierCapability(
    request: AssertModuleDeliveryIntegratedWriterFrontierCapabilityRequest,
  ): void {
    const provenance =
      ModuleIntegrationCoordinator.WRITER_FRONTIER_PROVENANCE.get(
        request.capability,
      );
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

  static assertModuleDeliveryCanonicalEvidenceTransition(
    request: AssertModuleDeliveryCanonicalEvidenceTransitionRequest,
  ): void {
    const provenance =
      ModuleIntegrationCoordinator.CANONICAL_EVIDENCE_TRANSITIONS.get(
        request.transition,
      );
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

  private static canonicalEvidenceTransition(
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
    ModuleIntegrationCoordinator.CANONICAL_EVIDENCE_TRANSITIONS.set(
      transition,
      Object.freeze(provenance),
    );
    return transition;
  }

  private static gitRequest(
    invocation: ModuleGitInvocation,
  ): GitCommandRequest {
    if ('allowFailure' in invocation) {
      return {
        cwd: invocation.cwd,
        args: invocation.args,
        allowFailure: invocation.allowFailure,
      };
    }
    return { cwd: invocation.cwd, args: invocation.args };
  }

  private static gitInvocation(invocation: ModuleGitInvocation): string {
    return ModuleRepositoryGit.gitText(
      ModuleRepositoryGit.runModuleDeliveryGit(
        ModuleIntegrationCoordinator.gitRequest(invocation),
      ),
    );
  }

  private static verifyExpectedHandoff(
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
    for (const path of ModuleCommitHandoff.moduleCommitChangedPaths(
      pathRequest,
    )) {
      const basename = path.slice(path.lastIndexOf('/') + 1);
      if (PROHIBITED_MATERIALIZATION_FILES.has(basename)) {
        throw new Error(
          `Handoff cannot author materialization control ${path}.`,
        );
      }
    }
    const verified =
      ModuleCommitHandoff.verifyModuleCommitHandoff(verificationRequest);
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

  private static applyAndValidateWave(
    application: ValidatedWaveApplication,
  ): string {
    if (application.expectedHandoffs.length === 0)
      return application.state.headCommit;
    const handoffs: TreeHandoff[] = application.expectedHandoffs.map(
      (expected) => ({
        taskId: expected.node.taskId,
        baselineCommit: expected.baselineCommit,
        commit: expected.submission.commit,
        allowedWriteClaims: expected.node.resources.write,
      }),
    );
    const applyRequest: ApplyModuleWaveTreeRequest = {
      workspace: application.state.workspace,
      currentHead: application.state.headCommit,
      handoffs,
    };
    return ModuleWaveTree.apply(applyRequest);
  }

  private static advancedIntegrationState(
    request: AdvancedIntegrationStateRequest,
  ): ModuleIntegrationState {
    const immutable =
      ModuleIntegrationProvenanceRegistry.immutableModuleIntegrationState(
        request.nextState,
      );
    request.provenance.session.currentHead = immutable.headCommit;
    const registration: IntegrationStateRegistration = {
      authority: request.provenance.authority,
      state: immutable,
      sourceSnapshot: request.provenance.sourceSnapshot,
      workspaceSnapshot: request.provenance.workspaceSnapshot,
      session: request.provenance.session,
    };
    ModuleIntegrationProvenanceRegistry.registerIntegrationState(registration);
    ModuleWriterFrontierRegistry.registerModuleDeliveryWriterFrontiers({
      state: immutable,
      writerFrontiers: request.writerFrontiers,
    });
    ModuleIntegrationProvenanceRegistry.retireIntegrationState(
      request.previousState,
    );
    return immutable;
  }

  private static authoritativeProviderLease(
    inspection: ProviderLeaseInspection,
  ): ModuleDeliveryAttemptLease {
    const stateInspection: AttemptLeaseAuthorityInspection = {
      authority: inspection.authority,
      lease: inspection.lease,
    };
    ModuleGenerationAuthority.assertModuleDeliveryAttemptLeaseAuthority(
      stateInspection,
    );
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

  private static refreshedWriterFrontiers(
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
        return ModuleIntegrationCoordinator.mintIntegratedWriterFrontier(
          request,
        );
      }),
    );
  }

  private static updatedIntegrationState([
    state,
    updates,
  ]: IntegrationStateUpdate): ModuleIntegrationState {
    return Object.assign({}, state, updates);
  }

  static prepareModuleIntegration(
    request: PrepareModuleIntegrationRequest,
  ): ModuleIntegrationState {
    const repositoryInspection: ModuleDeliveryAuthorityRepositoryInspection = {
      authority: request.authority,
      repositoryRoot: request.repositoryRoot,
    };
    ModuleGenerationAuthority.assertModuleDeliveryAuthorityRepository(
      repositoryInspection,
    );
    const inspection: ModuleDeliveryAuthorityPlanRequest = {
      authority: request.authority,
      acceptedPlan: request.acceptedPlan,
    };
    ModuleGenerationAuthority.moduleDeliveryAuthorityPlan(inspection);
    const authorityInspection: GenerationAuthorityInspection = {
      authority: request.authority,
      generation: request.acceptedPlan.plan.generation,
      planDigest: request.acceptedPlan.planDigest,
    };
    ModuleGenerationAuthority.assertModuleDeliveryGenerationAuthority(
      authorityInspection,
    );
    const stateInspection: AdmissionStateAuthorityInspection = {
      authority: request.authority,
      state: request.admissionState,
    };
    ModuleGenerationAuthority.assertModuleDeliveryAdmissionStateAuthority(
      stateInspection,
    );
    if (
      request.admissionState.generation !==
        request.acceptedPlan.plan.generation ||
      request.admissionState.planDigest !== request.acceptedPlan.planDigest ||
      request.admissionState.headCommit !==
        request.acceptedPlan.plan.sourceCommit
    )
      throw new Error('Module integration admission state is inconsistent.');
    const before = ModuleIntegrationProvenanceRegistry.captureSourceSnapshot(
      request.repositoryRoot,
    );
    const prepareRequest: PrepareModuleWorktreeRequest = {
      repositoryRoot: request.repositoryRoot,
      workspaceRoot: request.workspaceRoot,
      planDigest: request.acceptedPlan.planDigest,
      taskId: INTEGRATION_TASK_ID,
      attempt: 1,
      baselineCommit: request.acceptedPlan.plan.sourceCommit,
    };
    const workspace =
      ModuleWorktree.prepareSharedIntegrationWorkspace(prepareRequest);
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
      const immutable =
        ModuleIntegrationProvenanceRegistry.immutableModuleIntegrationState(
          state,
        );
      const workspaceSnapshot =
        ModuleIntegrationProvenanceRegistry.captureSourceSnapshot(
          workspace.worktreePath,
        );
      const sessionRegistration: IntegrationSessionRegistration = {
        cleanupHandle,
        workspace: immutable.workspace,
        integrationRef: '',
        currentHead: immutable.headCommit,
      };
      const session =
        ModuleIntegrationProvenanceRegistry.createIntegrationSession(
          sessionRegistration,
        );
      const registration: IntegrationStateRegistration = {
        authority: request.authority,
        state: immutable,
        sourceSnapshot: before,
        workspaceSnapshot,
        session,
      };
      ModuleIntegrationProvenanceRegistry.registerIntegrationState(
        registration,
      );
      ModuleWriterFrontierRegistry.registerModuleDeliveryWriterFrontiers({
        state: immutable,
        writerFrontiers: Object.freeze([]),
      });
      return immutable;
    } catch {
      const cleanupRequest: CleanupModuleWorktreeRequest = { workspace };
      ModuleWorktree.cleanupSharedIntegrationWorkspace(cleanupRequest);
      throw new Error(
        'Module integration preparation failed and was cleaned up.',
      );
    }
  }

  static integrateVerifiedModuleDeliveryTask(
    request: IntegrateVerifiedModuleDeliveryTaskRequest,
  ): ModuleIntegrationState {
    const inspection: AcceptedPlanStateInspection = {
      authority: request.authority,
      acceptedPlan: request.acceptedPlan,
      state: request.state,
    };
    ModuleGenerationAuthority.moduleDeliveryAuthorityPlan(inspection);
    ModuleIntegrationProvenanceRegistry.assertModuleIntegrationAcceptedPlanState(
      inspection,
    );
    const authorityInspection: GenerationAuthorityInspection = {
      authority: request.authority,
      generation: request.acceptedPlan.plan.generation,
      planDigest: request.acceptedPlan.planDigest,
    };
    ModuleGenerationAuthority.assertModuleDeliveryGenerationAuthority(
      authorityInspection,
    );
    const provenance =
      ModuleIntegrationProvenanceRegistry.integrationProvenance(request.state);
    if (provenance.authority !== request.authority)
      throw new Error('Module integration authority does not own this state.');
    const freshInspection: FreshModuleIntegrationStateInspection = {
      state: request.state,
      provenance,
    };
    ModuleIntegrationProvenanceRegistry.assertFreshModuleIntegrationState(
      freshInspection,
    );
    const admissionInspection: CurrentModuleIntegrationAdmissionInspection = {
      authority: request.authority,
      state: request.state,
    };
    ModuleIntegrationProvenanceRegistry.assertCurrentModuleIntegrationAdmission(
      admissionInspection,
    );
    if (request.state.phase !== ModuleIntegrationPhase.AcceptingProviders) {
      throw new Error('Finalized module integration cannot accept providers.');
    }
    const leaseInspection: ProviderLeaseInspection = {
      authority: request.authority,
      acceptedPlan: request.acceptedPlan,
      lease: request.lease,
      submission: request.submission,
    };
    const lease =
      ModuleIntegrationCoordinator.authoritativeProviderLease(leaseInspection);
    const frontierInspection: ModuleIntegrationLeaseFrontierInspection = {
      state: request.state,
      lease,
    };
    ModuleIntegrationProvenanceRegistry.assertModuleIntegrationLeaseFrontier(
      frontierInspection,
    );
    if (
      request.submission.generation !== request.state.generation ||
      (request.submission.kind === ModuleDeliveryProviderSubmissionKind.Write
        ? request.submission.handoff.planDigest
        : request.submission.planDigest) !== request.state.planDigest
    ) {
      throw new Error(
        'Provider output belongs to an obsolete plan generation.',
      );
    }
    const taskId =
      request.submission.kind === ModuleDeliveryProviderSubmissionKind.Write
        ? request.submission.handoff.taskId
        : request.submission.taskId;
    const lookup: ModuleIntegrationNodeLookup = {
      acceptedPlan: request.acceptedPlan,
      taskId,
    };
    const node =
      ModuleIntegrationProvenanceRegistry.moduleIntegrationNodeByTaskId(lookup);
    if (
      request.state.integratedTaskIds.includes(taskId) ||
      request.state.acceptedEvidence.some((entry) => entry.taskId === taskId)
    ) {
      throw new Error(
        `Provider ${taskId} already has an accepted disposition.`,
      );
    }
    const precedenceInspection: ModuleIntegrationProviderPrecedenceInspection =
      {
        acceptedPlan: request.acceptedPlan,
        state: request.state,
        taskId,
        lease,
      };
    ModuleIntegrationProvenanceRegistry.assertModuleIntegrationProviderPrecedence(
      precedenceInspection,
    );
    if (
      request.submission.kind === ModuleDeliveryProviderSubmissionKind.Write
    ) {
      if (node.kind !== ModuleDeliveryTaskKind.Write) {
        throw new Error(`Provider ${taskId} requires read-only evidence.`);
      }
      if (
        request.submission.verdict !==
          ModuleDeliveryEvidenceVerdict.TerminalSuccess ||
        request.submission.acceptedByTeam !== lease.acceptanceOwner
      )
        throw new Error(`Provider ${taskId} lacks terminal owner acceptance.`);
      const repositoryInspection: ModuleIntegrationHandoffRepositoryInspection =
        {
          state: request.state,
          handoff: request.submission.handoff,
        };
      ModuleIntegrationProvenanceRegistry.assertModuleIntegrationHandoffRepository(
        repositoryInspection,
      );
      const expected: ExpectedHandoff = {
        node,
        baselineCommit: lease.startingFrontier,
        submission: request.submission.handoff,
      };
      const verification: ExpectedHandoffVerification = {
        expected,
        acceptedPlan: request.acceptedPlan,
      };
      ModuleIntegrationCoordinator.verifyExpectedHandoff(verification);
      const application: ValidatedWaveApplication = {
        state: request.state,
        expectedHandoffs: [expected],
        provenance,
      };
      let headCommit: string | undefined;
      try {
        headCommit =
          ModuleIntegrationCoordinator.applyAndValidateWave(application);
        ModuleIntegrationProvenanceRegistry.updateModuleIntegrationRef({
          provenance,
          nextCommit: headCommit,
          rollback: false,
        });
        const provisionalState =
          ModuleIntegrationCoordinator.updatedIntegrationState([
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
        const stateWithWrite =
          ModuleIntegrationCoordinator.updatedIntegrationState([
            provisionalState,
            {
              completedWaveCount:
                ModuleIntegrationProvenanceRegistry.moduleIntegrationCompletedWaveCount(
                  waveCountRequest,
                ),
            },
          ]);
        const frontierRequest: RefreshedWriterFrontiersRequest = {
          authority: request.authority,
          state: stateWithWrite,
        };
        const capabilities =
          ModuleIntegrationCoordinator.refreshedWriterFrontiers(
            frontierRequest,
          );
        const stateRequest: CreateModuleDeliveryAdmissionStateRequest = {
          authority: request.authority,
          acceptedPlan: request.acceptedPlan,
          headCommit,
          integratedWriterFrontiers: capabilities,
          acceptedEvidence: stateWithWrite.acceptedEvidence,
        };
        const admissionState =
          ModuleGenerationAuthority.createModuleDeliveryAdmissionState(
            stateRequest,
          );
        const nextState = ModuleIntegrationCoordinator.updatedIntegrationState([
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
        ModuleIntegrationProvenanceRegistry.recordIntegratedLeaseAcceptance(
          disposition,
        );
        return ModuleIntegrationCoordinator.advancedIntegrationState(advance);
      } catch {
        if (!headCommit)
          throw new Error(
            'Child worktree handoff failed before a parent frontier was returned; parent rollback was not proven.',
          );
        try {
          ModuleWaveTree.restore({
            workspace: request.state.workspace,
            originalHead: request.state.headCommit,
            appliedHead: headCommit,
          });
          ModuleIntegrationProvenanceRegistry.updateModuleIntegrationRef({
            provenance,
            nextCommit: headCommit,
            rollback: true,
          });
        } catch {
          throw new Error(
            'Child worktree handoff acceptance failed and parent rollback failed.',
          );
        }
        throw new Error(
          'Child worktree handoff acceptance failed and was rolled back.',
        );
      }
    }
    const authorizedProviderEvidence = request.state.acceptedEvidence.filter(
      (evidence) =>
        lease.authorizedProviderEvidence.some(
          (identity) =>
            JSON.stringify(identity) ===
            JSON.stringify(
              ModuleGenerationAuthority.moduleDeliveryAcceptedEvidenceIdentity(
                evidence,
              ),
            ),
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
    const accepted =
      ModuleGenerationAuthority.verifyModuleDeliveryEvidenceSubmission(
        evidenceRequest,
      );
    const provisionalState =
      ModuleIntegrationCoordinator.updatedIntegrationState([
        request.state,
        { acceptedEvidence: request.state.acceptedEvidence.concat(accepted) },
      ]);
    const waveCountRequest: ModuleIntegrationCompletedWaveCountRequest = {
      acceptedPlan: request.acceptedPlan,
      state: provisionalState,
    };
    const stateWithEvidence =
      ModuleIntegrationCoordinator.updatedIntegrationState([
        provisionalState,
        {
          completedWaveCount:
            ModuleIntegrationProvenanceRegistry.moduleIntegrationCompletedWaveCount(
              waveCountRequest,
            ),
        },
      ]);
    const capabilities =
      ModuleWriterFrontierRegistry.moduleDeliveryWriterFrontiers(request.state);
    const stateRequest: CreateModuleDeliveryAdmissionStateRequest = {
      authority: request.authority,
      acceptedPlan: request.acceptedPlan,
      headCommit: stateWithEvidence.headCommit,
      integratedWriterFrontiers: capabilities,
      acceptedEvidence: stateWithEvidence.acceptedEvidence,
    };
    const admissionState =
      ModuleGenerationAuthority.createModuleDeliveryAdmissionState(
        stateRequest,
      );
    const nextState = ModuleIntegrationCoordinator.updatedIntegrationState([
      stateWithEvidence,
      { admissionState },
    ]);
    const advance: AdvancedIntegrationStateRequest = {
      previousState: request.state,
      nextState,
      provenance,
      writerFrontiers: capabilities,
    };
    const integrated =
      ModuleIntegrationCoordinator.advancedIntegrationState(advance);
    const disposition: RecordIntegratedLeaseAcceptanceRequest = {
      authority: request.authority,
      state: admissionState,
      lease,
    };
    ModuleIntegrationProvenanceRegistry.recordIntegratedLeaseAcceptance(
      disposition,
    );
    return integrated;
  }

  static finalizeModuleDeliveryIntegration(
    request: FinalizeModuleDeliveryIntegrationRequest,
  ): ModuleIntegrationState {
    const inspection: AcceptedPlanStateInspection = {
      authority: request.authority,
      acceptedPlan: request.acceptedPlan,
      state: request.state,
    };
    ModuleGenerationAuthority.moduleDeliveryAuthorityPlan(inspection);
    ModuleIntegrationProvenanceRegistry.assertModuleIntegrationAcceptedPlanState(
      inspection,
    );
    const authorityInspection: GenerationAuthorityInspection = {
      authority: request.authority,
      generation: request.acceptedPlan.plan.generation,
      planDigest: request.acceptedPlan.planDigest,
    };
    ModuleGenerationAuthority.assertModuleDeliveryGenerationAuthority(
      authorityInspection,
    );
    const provenance =
      ModuleIntegrationProvenanceRegistry.integrationProvenance(request.state);
    if (provenance.authority !== request.authority)
      throw new Error('Module integration authority does not own this state.');
    const freshInspection: FreshModuleIntegrationStateInspection = {
      state: request.state,
      provenance,
    };
    ModuleIntegrationProvenanceRegistry.assertFreshModuleIntegrationState(
      freshInspection,
    );
    const admissionInspection: CurrentModuleIntegrationAdmissionInspection = {
      authority: request.authority,
      state: request.state,
    };
    ModuleIntegrationProvenanceRegistry.assertCurrentModuleIntegrationAdmission(
      admissionInspection,
    );
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
    ModuleWorktree.assertIntegrationWorkspaceIdentity(request.state.workspace);
    ModuleWorktree.assertModuleWorktreeClean(request.state.workspace);
    const parentHead = ModuleRepositoryGit.gitText(
      ModuleRepositoryGit.runModuleDeliveryGit({
        cwd: request.state.workspace.worktreePath,
        args: ['rev-parse', '--verify', 'HEAD^{commit}'],
      }),
    );
    if (
      !EXACT_GIT_COMMIT.test(request.state.headCommit) ||
      parentHead !== request.state.headCommit
    )
      throw new Error(
        'Final module join parent head does not match the integrated frontier.',
      );
    const canonicalHead = request.state.headCommit;
    const canonicalInspection: CanonicalModuleFinalizationInspection = {
      repositoryRoot: request.state.workspace.sourceRepositoryRoot,
      previousHeadCommit: request.state.headCommit,
      canonicalHeadCommit: canonicalHead,
      acceptedPlan: request.acceptedPlan,
      integratedTaskIds: request.state.integratedTaskIds,
    };
    const writerTaskIds = CanonicalWriterClosure.validate(canonicalInspection);
    const finalizedState = ModuleIntegrationCoordinator.updatedIntegrationState(
      [
        request.state,
        {
          phase: ModuleIntegrationPhase.Finalized,
          completedWaveCount: request.acceptedPlan.waves.length,
          headCommit: canonicalHead,
        },
      ],
    );
    const frontierRequest: RefreshedWriterFrontiersRequest = {
      authority: request.authority,
      state: finalizedState,
    };
    const capabilities =
      ModuleIntegrationCoordinator.refreshedWriterFrontiers(frontierRequest);
    const transitionRequest: CanonicalEvidenceTransitionProvenance = {
      authority: request.authority,
      previousHeadCommit: request.state.headCommit,
      canonicalHeadCommit: canonicalHead,
      integratedTaskIds: writerTaskIds,
    };
    const canonicalTransition =
      ModuleIntegrationCoordinator.canonicalEvidenceTransition(
        transitionRequest,
      );
    const stateRequest: PrepareFinalModuleDeliveryAdmissionStateRequest = {
      authority: request.authority,
      acceptedPlan: request.acceptedPlan,
      headCommit: canonicalHead,
      integratedWriterFrontiers: capabilities,
      acceptedEvidence: finalizedState.acceptedEvidence,
      previousState: request.state.admissionState,
      canonicalTransition,
    };
    const admissionState =
      ModuleGenerationAuthority.prepareFinalModuleDeliveryAdmissionState(
        stateRequest,
      );
    const nextState = ModuleIntegrationCoordinator.updatedIntegrationState([
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
    ModuleIntegrationProvenanceRegistry.updateModuleIntegrationRef(refUpdate);
    try {
      const commitRequest: CommitFinalModuleDeliveryAdmissionStateRequest = {
        authority: request.authority,
        previousState: request.state.admissionState,
        state: admissionState,
      };
      ModuleGenerationAuthority.commitFinalModuleDeliveryAdmissionState(
        commitRequest,
      );
      return ModuleIntegrationCoordinator.advancedIntegrationState(advance);
    } catch {
      const admissionRollback: RollbackFinalModuleDeliveryAdmissionStateRequest =
        {
          authority: request.authority,
          finalizedState: admissionState,
          previousState: request.state.admissionState,
        };
      ModuleGenerationAuthority.rollbackFinalModuleDeliveryAdmissionState(
        admissionRollback,
      );
      const refRollback: UpdateModuleIntegrationRefRequest = {
        provenance,
        nextCommit: canonicalHead,
        rollback: true,
      };
      ModuleIntegrationProvenanceRegistry.updateModuleIntegrationRef(
        refRollback,
      );
      throw new Error('Final module join failed and was fully rolled back.');
    }
  }

  static cleanupModuleIntegration(
    request: CleanupModuleIntegrationRequest,
  ): CleanupModuleIntegrationResult {
    return ModuleIntegrationProvenanceRegistry.cleanupRegisteredModuleIntegration(
      request,
    );
  }
}
