import { ModuleSourceAuthority } from './authority.ts';
import { ModuleEvidenceBoundary } from './evidence.ts';
import { ModuleGenerationAuthority } from './admission-authority.ts';
import { ModuleDeliveryTaskKind } from './domain.ts';
import { ModuleRepositoryGit } from './git-command.ts';
import { ModuleWaveTree } from './tree-integration.ts';
import { ModuleWorktree } from './workspace.ts';
import type { TreeHandoff } from './tree-integration.ts';
import type {
  CleanupModuleIntegrationRequest,
  CleanupModuleIntegrationResult,
  FinalizeModuleDeliveryIntegrationRequest,
  IntegrateVerifiedModuleDeliveryTaskRequest,
  ModuleDeliveryHandoffSubmission,
  ModuleDeliveryProviderResult,
  ModuleIntegrationState,
  PrepareModuleIntegrationRequest,
} from './integration-provenance.ts';
import type {
  ModuleDeliveryAdmissionState,
  ModuleDeliveryAttemptLease,
} from './admission.ts';
import {
  ModuleDeliveryAttemptDispositionKind,
  ModuleDeliveryGenerationFenceKind,
} from './admission.ts';
import {
  ModuleDeliveryProviderSubmissionKind,
  ModuleIntegrationPhase,
} from './integration-provenance.ts';

const INTEGRATION_TASK_ID = 'module-delivery-integration';

/** Coordinates typed task results and preserves the actual Git/worktree boundary. */
export class ModuleIntegrationCoordinator {
  private constructor() {}

  static prepareModuleIntegration(
    request: PrepareModuleIntegrationRequest,
  ): ModuleIntegrationState {
    const plan = ModuleSourceAuthority.trustedModuleDeliveryPlanSnapshot(
      request.acceptedPlan,
    );
    ModuleGenerationAuthority.assertModuleDeliveryAdmissionStateAuthority({
      authority: request.authority,
      acceptedPlan: plan,
      state: request.state,
    });
    const repositoryRoot =
      ModuleSourceAuthority.authenticateModuleDeliverySourceCommit({
        repositoryRoot: request.repositoryRoot,
        sourceCommit: plan.plan.sourceCommit,
      });
    if (request.state.headCommit !== plan.plan.sourceCommit)
      throw new Error(
        'Integration must start at the accepted source frontier.',
      );
    const workspace = ModuleWorktree.prepareSharedIntegrationWorkspace({
      repositoryRoot,
      workspaceRoot: request.workspaceRoot,
      planDigest: plan.planDigest,
      taskId: INTEGRATION_TASK_ID,
      attempt: 1,
      baselineCommit: request.state.headCommit,
    });
    const cleanupHandle = Object.freeze({
      sessionId: workspace.worktreeId,
      workspace,
    });
    return ModuleIntegrationCoordinator.state({
      plan,
      state: request.state,
      workspace,
      phase: ModuleIntegrationPhase.AcceptingProviders,
      cleanupHandle,
      acceptedEvidence: [],
      acceptedWrites: [],
      integratedTaskIds: [],
      integratedWriterFrontiers: [],
      headCommit: request.state.headCommit,
      completedWaveCount: 0,
      admissionState: request.state,
    });
  }

  static integrateVerifiedModuleDeliveryTask(
    request: IntegrateVerifiedModuleDeliveryTaskRequest,
  ): ModuleIntegrationState {
    const state = request.state;
    if (state.phase !== ModuleIntegrationPhase.AcceptingProviders)
      throw new Error('Finalized module integration cannot accept results.');
    const plan = ModuleSourceAuthority.trustedModuleDeliveryPlanSnapshot(
      request.acceptedPlan,
    );
    ModuleGenerationAuthority.assertModuleDeliveryAdmissionStateAuthority({
      authority: request.authority,
      acceptedPlan: plan,
      state: state.admissionState,
    });
    ModuleWorktree.assertIntegrationWorkspaceIdentity(state.workspace);
    ModuleWorktree.assertIntegrationWorkspaceClean(state.workspace);
    const submission = request.submission;
    const node = ModuleSourceAuthority.moduleDeliveryNode({
      plan,
      taskId: submission.taskId,
    });
    if (
      state.integratedTaskIds.includes(submission.taskId) ||
      state.acceptedEvidence.some(({ taskId }) => taskId === submission.taskId)
    )
      throw new Error(`Module task ${submission.taskId} already has a result.`);
    const completed = new Set([
      ...state.integratedTaskIds,
      ...state.acceptedEvidence.map(({ taskId }) => taskId),
    ]);
    if (node.dependencies.some((dependency) => !completed.has(dependency)))
      throw new Error(
        `Module task ${submission.taskId} has incomplete dependencies.`,
      );
    if (
      submission.kind === ModuleDeliveryProviderSubmissionKind.ReadOnlyEvidence
    ) {
      const lease = ModuleIntegrationCoordinator.leaseFor({
        authority: request.authority,
        state: state.admissionState,
        lease: request.lease,
      });
      const result =
        ModuleEvidenceBoundary.validateModuleDeliveryEvidenceSubmission({
          authority: request.authority,
          acceptedPlan: plan,
          repositoryRoot: state.workspace.sourceRepositoryRoot,
          state: state.admissionState,
          submission,
          lease,
        });
      ModuleGenerationAuthority.recordModuleDeliveryAttemptDisposition({
        authority: request.authority,
        state: state.admissionState,
        lease,
        outcome: {
          kind: ModuleDeliveryAttemptDispositionKind.Accepted,
          conclusion: ModuleDeliveryGenerationFenceKind.Accepted,
        },
      });
      const acceptedEvidence = [...state.acceptedEvidence, result];
      const admissionState =
        ModuleGenerationAuthority.createModuleDeliveryAdmissionState({
          authority: request.authority,
          acceptedPlan: plan,
          headCommit: state.headCommit,
          integratedWriterFrontiers: state.integratedWriterFrontiers,
          acceptedEvidence,
        });
      return ModuleIntegrationCoordinator.state({
        plan,
        state: { ...state, admissionState },
        workspace: state.workspace,
        phase: state.phase,
        cleanupHandle: state.cleanupHandle,
        acceptedEvidence,
        acceptedWrites: state.acceptedWrites,
        integratedTaskIds: state.integratedTaskIds,
        integratedWriterFrontiers: state.integratedWriterFrontiers,
        headCommit: state.headCommit,
        completedWaveCount: ModuleIntegrationCoordinator.waveCount({
          plan,
          integratedTaskIds: state.integratedTaskIds,
          evidence: acceptedEvidence,
        }),
        admissionState,
      });
    }
    if (node.kind !== ModuleDeliveryTaskKind.Write)
      throw new Error('Write handoff does not match a write task.');
    const write = ModuleIntegrationCoordinator.validateWriteSubmission({
      plan,
      submission,
      state,
    });
    const headCommit = ModuleWaveTree.apply({
      workspace: state.workspace,
      currentHead: state.headCommit,
      handoffs: [
        {
          taskId: write.taskId,
          baselineCommit: write.handoff.baselineCommit,
          commit: write.handoff.commit,
          allowedWriteClaims: write.allowedWriteClaims,
        } satisfies TreeHandoff,
      ],
    });
    const acceptedWrites = [...state.acceptedWrites, write];
    const integratedTaskIds = [...state.integratedTaskIds, write.taskId];
    const integratedWriterFrontiers = [
      ...state.integratedWriterFrontiers,
      Object.freeze({
        taskId: write.taskId,
        attempt: write.attempt,
        headCommit,
        integratedTaskIds: Object.freeze([...integratedTaskIds]),
      }),
    ];
    const admissionState =
      ModuleGenerationAuthority.createModuleDeliveryAdmissionState({
        authority: request.authority,
        acceptedPlan: plan,
        headCommit,
        integratedWriterFrontiers,
        acceptedEvidence: state.acceptedEvidence,
      });
    const lease = ModuleIntegrationCoordinator.leaseFor({
      authority: request.authority,
      state: state.admissionState,
      lease: request.lease,
    });
    ModuleGenerationAuthority.recordModuleDeliveryAttemptDisposition({
      authority: request.authority,
      state: state.admissionState,
      lease,
      outcome: {
        kind: ModuleDeliveryAttemptDispositionKind.Accepted,
        conclusion: ModuleDeliveryGenerationFenceKind.Accepted,
      },
    });
    return ModuleIntegrationCoordinator.state({
      plan,
      state: { ...state, admissionState },
      workspace: state.workspace,
      phase: state.phase,
      cleanupHandle: state.cleanupHandle,
      acceptedWrites,
      integratedTaskIds,
      integratedWriterFrontiers,
      headCommit,
      acceptedEvidence: state.acceptedEvidence,
      completedWaveCount: ModuleIntegrationCoordinator.waveCount({
        plan,
        integratedTaskIds,
        evidence: state.acceptedEvidence,
      }),
      admissionState,
    });
  }

  private static leaseFor(
    request: Readonly<{
      authority: IntegrateVerifiedModuleDeliveryTaskRequest['authority'];
      state: ModuleDeliveryAdmissionState;
      lease: ModuleDeliveryAttemptLease;
    }>,
  ): ModuleDeliveryAttemptLease {
    ModuleGenerationAuthority.assertModuleDeliveryAttemptLeaseAuthority({
      authority: request.authority,
      state: request.state,
      lease: request.lease,
    });
    return request.lease;
  }

  private static validateWriteSubmission(
    request: Readonly<{
      plan: IntegrateVerifiedModuleDeliveryTaskRequest['acceptedPlan'];
      submission: Extract<
        IntegrateVerifiedModuleDeliveryTaskRequest['submission'],
        { kind: ModuleDeliveryProviderSubmissionKind.Write }
      >;
      state: ModuleIntegrationState;
    }>,
  ): ModuleDeliveryHandoffSubmission {
    const { plan, submission, state } = request;
    const node = ModuleSourceAuthority.moduleDeliveryNode({
      plan,
      taskId: submission.taskId,
    });
    if (
      submission.planDigest !== plan.planDigest ||
      submission.generation !== plan.plan.generation ||
      submission.sourceCommit !== plan.plan.sourceCommit ||
      submission.producerTeam !== node.team ||
      submission.functionalOwner !== node.functionalOwner ||
      submission.acceptanceOwner !== node.acceptanceOwner ||
      submission.handoff.taskId !== submission.taskId ||
      submission.handoff.attempt !== submission.attempt ||
      submission.handoff.planDigest !== plan.planDigest ||
      submission.handoff.baselineCommit !== state.headCommit
    )
      throw new Error(
        'Write handoff metadata does not match the current task state.',
      );
    if (submission.kind !== ModuleDeliveryProviderSubmissionKind.Write)
      throw new Error('Expected a write handoff.');
    return Object.freeze({
      ...submission,
      allowedWriteClaims: Object.freeze([...submission.allowedWriteClaims]),
    });
  }

  static finalizeModuleDeliveryIntegration(
    request: FinalizeModuleDeliveryIntegrationRequest,
  ): ModuleIntegrationState {
    const state = request.state;
    if (state.phase !== ModuleIntegrationPhase.AcceptingProviders)
      throw new Error('Module integration is already finalized.');
    const plan = ModuleSourceAuthority.trustedModuleDeliveryPlanSnapshot(
      request.acceptedPlan,
    );
    const completed = new Set([
      ...state.integratedTaskIds,
      ...state.acceptedEvidence.map(({ taskId }) => taskId),
    ]);
    if (plan.topologicalOrder.some((taskId) => !completed.has(taskId)))
      throw new Error('Module integration cannot finalize with pending tasks.');
    ModuleWorktree.assertIntegrationWorkspaceClean(state.workspace);
    const head = ModuleRepositoryGit.gitText(
      ModuleRepositoryGit.runModuleDeliveryGit({
        cwd: state.workspace.worktreePath,
        args: ['rev-parse', '--verify', 'HEAD^{commit}'],
      }),
    );
    if (head !== state.headCommit)
      throw new Error('Integration head does not match scheduler state.');
    return ModuleIntegrationCoordinator.state({
      plan,
      state,
      workspace: state.workspace,
      phase: ModuleIntegrationPhase.Finalized,
      cleanupHandle: state.cleanupHandle,
      acceptedEvidence: state.acceptedEvidence,
      acceptedWrites: state.acceptedWrites,
      integratedTaskIds: state.integratedTaskIds,
      integratedWriterFrontiers: state.integratedWriterFrontiers,
      headCommit: state.headCommit,
      completedWaveCount: plan.waves.length,
      admissionState: state.admissionState,
    });
  }

  static cleanupModuleIntegration(
    request: CleanupModuleIntegrationRequest,
  ): CleanupModuleIntegrationResult {
    return ModuleWorktree.cleanupSharedIntegrationWorkspace({
      workspace: request.state.cleanupHandle.workspace,
    });
  }

  private static state(
    request: Readonly<{
      plan: IntegrateVerifiedModuleDeliveryTaskRequest['acceptedPlan'];
      state: ModuleIntegrationState | ModuleDeliveryAdmissionState;
      workspace: ModuleIntegrationState['workspace'];
      phase: ModuleIntegrationPhase;
      cleanupHandle: ModuleIntegrationState['cleanupHandle'];
      acceptedEvidence: readonly ModuleDeliveryProviderResult[];
      acceptedWrites: readonly ModuleDeliveryHandoffSubmission[];
      integratedTaskIds: readonly string[];
      integratedWriterFrontiers: ModuleIntegrationState['integratedWriterFrontiers'];
      headCommit: string;
      completedWaveCount: number;
      admissionState: ModuleDeliveryAdmissionState;
    }>,
  ): ModuleIntegrationState {
    return Object.freeze({
      originMainSha: request.plan.plan.originMainSha,
      pinnedLocalDevSha: request.plan.plan.pinnedLocalDevSha,
      phase: request.phase,
      generation: request.plan.plan.generation,
      planDigest: request.plan.planDigest,
      sourceCommit: request.plan.plan.sourceCommit,
      topologicalOrder: Object.freeze([...request.plan.topologicalOrder]),
      waves: Object.freeze(
        request.plan.waves.map((wave) => Object.freeze([...wave])),
      ),
      completedWaveCount: request.completedWaveCount,
      integratedTaskIds: Object.freeze([...request.integratedTaskIds]),
      acceptedWrites: Object.freeze([...request.acceptedWrites]),
      acceptedEvidence: Object.freeze([...request.acceptedEvidence]),
      integratedWriterFrontiers: Object.freeze([
        ...request.integratedWriterFrontiers,
      ]),
      headCommit: request.headCommit,
      admissionState: request.admissionState,
      workspace: request.workspace,
      cleanupHandle: request.cleanupHandle,
    });
  }

  private static waveCount(
    request: Readonly<{
      plan: IntegrateVerifiedModuleDeliveryTaskRequest['acceptedPlan'];
      integratedTaskIds: readonly string[];
      evidence: readonly ModuleDeliveryProviderResult[];
    }>,
  ): number {
    const { plan, integratedTaskIds, evidence } = request;
    const complete = new Set([
      ...integratedTaskIds,
      ...evidence.map(({ taskId }) => taskId),
    ]);
    return plan.waves.filter((wave) =>
      wave.every((taskId) => complete.has(taskId)),
    ).length;
  }
}
