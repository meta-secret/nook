import { ModuleAdmissionSource } from './admission-source.ts';
import { ModuleSourceAuthority } from './authority.ts';
import { CortexAuthoringAdmission } from './cortex-context.ts';
import { ModuleDeliveryTaskKind } from './domain.ts';
import { PinnedDevBaseEvidenceContract } from '../lib/base-evidence.ts';
import type { AgentAttemptParent } from '../agent-workflow/domain.ts';
import type { TeamTaskContext } from '../team-agents/context.ts';
import type {
  ModuleDeliveryAdmission,
  ModuleDeliveryAdmissionSelection,
  ModuleDeliveryAdmissionState,
  ModuleDeliveryAttemptDisposition,
  ModuleDeliveryAttemptLease,
  ModuleDeliveryExpectedLineage,
  ModuleDeliveryLeaseRecording,
  RecordModuleDeliveryAttemptDispositionRequest,
  RecordModuleDeliveryAttemptLeasesRequest,
  SelectModuleDeliveryAdmissionsRequest,
  CreateModuleDeliveryAdmissionStateRequest,
  CreateModuleDeliveryGenerationAuthorityRequest,
  PrepareFinalModuleDeliveryAdmissionStateRequest,
  CommitFinalModuleDeliveryAdmissionStateRequest,
  RollbackFinalModuleDeliveryAdmissionStateRequest,
  RestartModuleDeliveryGenerationRequest,
} from './admission-contracts.ts';
import {
  ModuleDeliveryAdmissionSelectionStatus,
  ModuleDeliveryAttemptDispositionKind,
  ModuleDeliveryGenerationFenceKind,
} from './admission-contracts.ts';
import type {
  ValidatedModuleDeliveryPlan,
  ModuleDeliveryResourceClaims,
} from './domain.ts';

type RuntimeState = {
  acceptedPlan: ValidatedModuleDeliveryPlan;
  repositoryRoot: string;
  expectedLineage: ReadonlyMap<string, AgentAttemptParent>;
  activeLeases: Map<string, ModuleDeliveryAttemptLease>;
  attemptsByTask: Map<string, number>;
  dispositions: ModuleDeliveryAttemptDisposition[];
};

enum ModuleDeliveryAttemptStateKind {
  NotAttempted = 'not-attempted',
  Recorded = 'recorded',
}

type ModuleDeliveryAttemptState =
  | { readonly kind: ModuleDeliveryAttemptStateKind.NotAttempted }
  | {
      readonly kind: ModuleDeliveryAttemptStateKind.Recorded;
      readonly count: number;
    };

enum ModuleDeliveryContextStateKind {
  NotRequired = 'not-required',
  Admitted = 'admitted',
}

type ModuleDeliveryContextState =
  | { readonly kind: ModuleDeliveryContextStateKind.NotRequired }
  | {
      readonly kind: ModuleDeliveryContextStateKind.Admitted;
      readonly context: TeamTaskContext;
    };

/** Trusted in-process scheduler state. It is deliberately not a capability registry. */
export class ModuleGenerationAuthority {
  private constructor(private runtime: RuntimeState) {}

  static createModuleDeliveryGenerationAuthority(
    request: CreateModuleDeliveryGenerationAuthorityRequest,
  ): ModuleGenerationAuthority {
    const source = ModuleAdmissionSource.freeze({
      acceptedPlan: request.acceptedPlan,
      repositoryRoot: request.repositoryRoot,
    });
    const expectedLineage =
      ModuleSourceAuthority.expectedModuleDeliveryLineageMap({
        acceptedPlan: source.acceptedPlan,
        entries: request.expectedLineage,
      });
    return new ModuleGenerationAuthority({
      acceptedPlan: source.acceptedPlan,
      repositoryRoot: source.repositoryRoot,
      expectedLineage,
      activeLeases: new Map(),
      attemptsByTask: new Map(),
      dispositions: [],
    });
  }

  static assertModuleDeliveryGenerationAuthority(
    authority: ModuleGenerationAuthority,
  ): void {
    if (!(authority instanceof ModuleGenerationAuthority))
      throw new Error('Module delivery authority must be scheduler state.');
  }

  static moduleDeliveryAuthorityPlan(
    authority: ModuleGenerationAuthority,
  ): ValidatedModuleDeliveryPlan {
    ModuleGenerationAuthority.assertModuleDeliveryGenerationAuthority(
      authority,
    );
    return authority.runtime.acceptedPlan;
  }

  static assertModuleDeliveryAuthorityRepository(
    request: Readonly<{
      authority: ModuleGenerationAuthority;
      repositoryRoot: string;
      sourceCommit: string;
      originMainSha: string;
      pinnedLocalDevSha: string;
    }>,
  ): void {
    ModuleGenerationAuthority.assertModuleDeliveryGenerationAuthority(
      request.authority,
    );
    if (request.repositoryRoot !== request.authority.runtime.repositoryRoot)
      throw new Error(
        'Module delivery repository does not match scheduler state.',
      );
    ModuleSourceAuthority.authenticateModuleDeliverySourceCommit({
      repositoryRoot: request.repositoryRoot,
      sourceCommit: request.sourceCommit,
    });
    PinnedDevBaseEvidenceContract.assertAncestry({
      workingDirectory: request.repositoryRoot,
      sourceCommit: request.sourceCommit,
      originMainSha: request.originMainSha,
      pinnedLocalDevSha: request.pinnedLocalDevSha,
    });
  }

  static createModuleDeliveryAdmissionState(
    request: CreateModuleDeliveryAdmissionStateRequest,
  ): ModuleDeliveryAdmissionState {
    ModuleGenerationAuthority.assertModuleDeliveryGenerationAuthority(
      request.authority,
    );
    const plan = request.authority.runtime.acceptedPlan;
    if (request.acceptedPlan.planDigest !== plan.planDigest)
      throw new Error('Admission state plan does not match scheduler state.');
    PinnedDevBaseEvidenceContract.assertShape({
      originMainSha: plan.plan.originMainSha,
      pinnedLocalDevSha: plan.plan.pinnedLocalDevSha,
    });
    const state = Object.freeze({
      originMainSha: plan.plan.originMainSha,
      pinnedLocalDevSha: plan.plan.pinnedLocalDevSha,
      generation: plan.plan.generation,
      planDigest: plan.planDigest,
      headCommit: request.headCommit,
      integratedWriterFrontiers: Object.freeze(
        request.integratedWriterFrontiers.map((frontier) =>
          Object.freeze({
            ...frontier,
            integratedTaskIds: Object.freeze([...frontier.integratedTaskIds]),
          }),
        ),
      ),
      acceptedProviderEvidence: Object.freeze(
        request.acceptedEvidence.map((result) =>
          Object.freeze({
            ...result,
            result: Object.freeze([...result.result]),
          }),
        ),
      ),
    });
    return state;
  }

  static prepareFinalModuleDeliveryAdmissionState(
    request: PrepareFinalModuleDeliveryAdmissionStateRequest,
  ): ModuleDeliveryAdmissionState {
    return ModuleGenerationAuthority.createModuleDeliveryAdmissionState(
      request,
    );
  }

  static commitFinalModuleDeliveryAdmissionState(
    request: CommitFinalModuleDeliveryAdmissionStateRequest,
  ): ModuleDeliveryAdmissionState {
    ModuleGenerationAuthority.assertModuleDeliveryGenerationAuthority(
      request.authority,
    );
    return request.state;
  }

  static rollbackFinalModuleDeliveryAdmissionState(
    request: RollbackFinalModuleDeliveryAdmissionStateRequest,
  ): ModuleDeliveryAdmissionState {
    ModuleGenerationAuthority.assertModuleDeliveryGenerationAuthority(
      request.authority,
    );
    return request.previousState;
  }

  static restartModuleDeliveryGeneration(
    request: RestartModuleDeliveryGenerationRequest,
  ): ModuleDeliveryAdmissionState {
    ModuleGenerationAuthority.assertModuleDeliveryGenerationAuthority(
      request.authority,
    );
    const source = ModuleAdmissionSource.freeze({
      acceptedPlan: request.acceptedPlan,
      repositoryRoot: request.authority.runtime.repositoryRoot,
    });
    request.authority.runtime.acceptedPlan = source.acceptedPlan;
    request.authority.runtime.expectedLineage =
      ModuleSourceAuthority.expectedModuleDeliveryLineageMap({
        acceptedPlan: source.acceptedPlan,
        entries: request.expectedLineage,
      });
    request.authority.runtime.activeLeases.clear();
    request.authority.runtime.dispositions = [];
    request.authority.runtime.attemptsByTask.clear();
    return ModuleGenerationAuthority.createModuleDeliveryAdmissionState({
      authority: request.authority,
      acceptedPlan: source.acceptedPlan,
      headCommit: request.previousState.headCommit,
      integratedWriterFrontiers: [],
      acceptedEvidence: [],
    });
  }

  static assertModuleDeliveryAdmissionStateAuthority(
    request: Readonly<{
      authority: ModuleGenerationAuthority;
      acceptedPlan: ValidatedModuleDeliveryPlan;
      state: ModuleDeliveryAdmissionState;
    }>,
  ): void {
    ModuleGenerationAuthority.assertModuleDeliveryGenerationAuthority(
      request.authority,
    );
    if (
      request.acceptedPlan.planDigest !==
        request.authority.runtime.acceptedPlan.planDigest ||
      request.state.planDigest !== request.acceptedPlan.planDigest ||
      request.state.generation !== request.acceptedPlan.plan.generation
    )
      throw new Error('Admission state is not current scheduler state.');
  }

  static selectModuleDeliveryAdmissions(
    request: SelectModuleDeliveryAdmissionsRequest,
  ): ModuleDeliveryAdmissionSelection {
    ModuleGenerationAuthority.assertModuleDeliveryAdmissionStateAuthority(
      request,
    );
    const runtime = request.authority.runtime;
    const plan = request.acceptedPlan;
    const completed = new Set([
      ...request.state.acceptedProviderEvidence.map(({ taskId }) => taskId),
      ...request.state.integratedWriterFrontiers.flatMap(
        ({ integratedTaskIds }) => integratedTaskIds,
      ),
    ]);
    const pendingTaskIds = plan.topologicalOrder.filter(
      (taskId) => !completed.has(taskId),
    );
    const blockedTaskIds: string[] = [];
    const admissions: ModuleDeliveryAdmission[] = [];
    const selectedClaims: ModuleDeliveryResourceClaims[] = [];
    for (const taskId of pendingTaskIds) {
      const node = ModuleSourceAuthority.moduleDeliveryNode({ plan, taskId });
      if (node.dependencies.some((dependency) => !completed.has(dependency))) {
        blockedTaskIds.push(taskId);
        continue;
      }
      if (runtime.activeLeases.has(taskId)) continue;
      const attemptState = ModuleGenerationAuthority.attemptState({
        runtime,
        taskId,
      });
      if (
        attemptState.kind === ModuleDeliveryAttemptStateKind.Recorded &&
        attemptState.count >= plan.plan.maxAttempts
      ) {
        blockedTaskIds.push(taskId);
        continue;
      }
      const attempt =
        attemptState.kind === ModuleDeliveryAttemptStateKind.Recorded
          ? attemptState.count + 1
          : 1;
      const resources = ModuleSourceAuthority.frozenModuleDeliveryResources({
        node,
        plan,
      });
      if (
        [...runtime.activeLeases.values(), ...admissions].some((active) =>
          ModuleSourceAuthority.moduleDeliveryResourcesConflict({
            first: resources,
            second: active.resources,
          }),
        ) ||
        selectedClaims.some((claim) =>
          ModuleSourceAuthority.moduleDeliveryResourcesConflict({
            first: resources,
            second: claim,
          }),
        )
      )
        continue;
      const parentLineage = runtime.expectedLineage.get(taskId);
      if (!parentLineage) throw new Error(`No expected lineage for ${taskId}.`);
      const context = ModuleGenerationAuthority.contextFor({
        node,
        resources,
        repositoryRoot: runtime.repositoryRoot,
        startingFrontier: request.state.headCommit,
      });
      const admission: ModuleDeliveryAdmission = Object.freeze({
        taskId,
        attempt,
        generation: plan.plan.generation,
        planDigest: plan.planDigest,
        originMainSha: plan.plan.originMainSha,
        pinnedLocalDevSha: plan.plan.pinnedLocalDevSha,
        startingFrontier: request.state.headCommit,
        resources,
        ...(context.kind === ModuleDeliveryContextStateKind.Admitted
          ? { context: context.context }
          : {}),
        team: node.team,
        functionalOwner: node.functionalOwner,
        acceptanceOwner: node.acceptanceOwner,
        parentLineage,
        acceptanceRequirements: Object.freeze([
          ...node.acceptance.commands.map(({ selector }) => selector),
          ...node.acceptance.evidence,
        ]),
      });
      admissions.push(admission);
      selectedClaims.push(resources);
    }
    const status =
      admissions.length > 0
        ? ModuleDeliveryAdmissionSelectionStatus.Selected
        : ModuleDeliveryAdmissionSelectionStatus.Blocked;
    return ModuleSourceAuthority.freezeModuleDeliveryAdmissionSelection({
      status,
      admissions,
      pendingTaskIds,
      blockedTaskIds,
    });
  }

  private static contextFor(
    request: Readonly<{
      node: ValidatedModuleDeliveryPlan['plan']['nodes'][number];
      resources: ModuleDeliveryResourceClaims;
      repositoryRoot: string;
      startingFrontier: string;
    }>,
  ): ModuleDeliveryContextState {
    if (
      request.node.kind !== ModuleDeliveryTaskKind.Write ||
      !request.node.cortexAuthoring
    )
      return { kind: ModuleDeliveryContextStateKind.NotRequired };
    return {
      kind: ModuleDeliveryContextStateKind.Admitted,
      context: CortexAuthoringAdmission.admit({
        repositoryRoot: request.repositoryRoot,
        startingFrontier: request.startingFrontier,
        node: request.node,
        resources: request.resources,
      }),
    };
  }

  private static attemptState(
    request: Readonly<{ runtime: RuntimeState; taskId: string }>,
  ): ModuleDeliveryAttemptState {
    for (const [taskId, count] of request.runtime.attemptsByTask) {
      if (taskId === request.taskId)
        return { kind: ModuleDeliveryAttemptStateKind.Recorded, count };
    }
    return { kind: ModuleDeliveryAttemptStateKind.NotAttempted };
  }

  static recordModuleDeliveryAttemptLeases(
    request: RecordModuleDeliveryAttemptLeasesRequest,
  ): ModuleDeliveryLeaseRecording {
    ModuleGenerationAuthority.assertModuleDeliveryAdmissionStateAuthority({
      authority: request.authority,
      acceptedPlan: request.authority.runtime.acceptedPlan,
      state: request.state,
    });
    for (const admission of request.admissions) {
      if (request.authority.runtime.activeLeases.has(admission.taskId))
        throw new Error(`Task ${admission.taskId} is already admitted.`);
      request.authority.runtime.activeLeases.set(
        admission.taskId,
        ModuleSourceAuthority.copyModuleDeliveryAdmission(admission),
      );
      request.authority.runtime.attemptsByTask.set(
        admission.taskId,
        admission.attempt,
      );
    }
    return Object.freeze({
      state: request.state,
      leases: Object.freeze(
        request.admissions.map(
          ModuleSourceAuthority.copyModuleDeliveryAdmission,
        ),
      ),
    });
  }

  static assertModuleDeliveryAttemptLeaseAuthority(
    request: Readonly<{
      authority: ModuleGenerationAuthority;
      state: ModuleDeliveryAdmissionState;
      lease: ModuleDeliveryAttemptLease;
    }>,
  ): void {
    ModuleGenerationAuthority.assertModuleDeliveryAdmissionStateAuthority({
      authority: request.authority,
      acceptedPlan: request.authority.runtime.acceptedPlan,
      state: request.state,
    });
    const active = request.authority.runtime.activeLeases.get(
      request.lease.taskId,
    );
    if (
      !active ||
      active.attempt !== request.lease.attempt ||
      active.planDigest !== request.lease.planDigest
    )
      throw new Error('Attempt lease is not active scheduler state.');
  }

  static recordModuleDeliveryAttemptDisposition(
    request: RecordModuleDeliveryAttemptDispositionRequest,
  ): ModuleDeliveryAdmissionState {
    ModuleGenerationAuthority.assertModuleDeliveryAttemptLeaseAuthority(
      request,
    );
    request.authority.runtime.activeLeases.delete(request.lease.taskId);
    request.authority.runtime.dispositions.push(
      Object.freeze({
        taskId: request.lease.taskId,
        attempt: request.lease.attempt,
        generation: request.lease.generation,
        planDigest: request.lease.planDigest,
        kind: request.outcome.kind,
        conclusion: request.outcome.conclusion,
      }),
    );
    return request.state;
  }
}

export type ModuleDeliveryGenerationAuthority = ModuleGenerationAuthority;
