import { realpathSync } from 'node:fs';
import { TaskResourceClaim } from '../agent-workflow/domain.ts';
import {
  ModuleDeliveryTaskKind,
  ModuleDeliveryValidationStatus,
} from './domain.ts';
import { ModuleRepositoryGit } from './git-command.ts';
import { ModuleDeliveryPlanDecoder } from './validation.ts';
import type {
  AgentAttemptParent,
  TaskResourcePatternPair,
} from '../agent-workflow/domain.ts';
import type {
  ModuleDeliveryAdmission,
  ModuleDeliveryAdmissionSelection,
  ModuleDeliveryAttemptLease,
  ModuleDeliveryExpectedLineage,
} from './admission.ts';
import type {
  ModuleDeliveryNodeV2,
  ModuleDeliveryResourceClaims,
  ValidatedModuleDeliveryPlan,
} from './domain.ts';

/** Owns source-repository checks and deterministic plan/resource snapshots. */
export class ModuleSourceAuthority {
  private constructor(
    private readonly request: AuthenticateModuleDeliverySourceCommitRequest,
  ) {}

  static authenticateModuleDeliverySourceCommit(
    request: AuthenticateModuleDeliverySourceCommitRequest,
  ): string {
    return new ModuleSourceAuthority(request).execute();
  }

  private execute(): string {
    const repositoryRoot = realpathSync(this.request.repositoryRoot);
    const root = ModuleRepositoryGit.runModuleDeliveryGit({
      cwd: repositoryRoot,
      args: ['rev-parse', '--show-toplevel'],
      allowFailure: true,
    });
    if (
      root.exitCode !== 0 ||
      realpathSync(ModuleRepositoryGit.gitText(root)) !== repositoryRoot
    )
      throw new Error('Module delivery repository root is not canonical.');
    const commit = ModuleRepositoryGit.runModuleDeliveryGit({
      cwd: repositoryRoot,
      args: ['cat-file', '-e', `${this.request.sourceCommit}^{commit}`],
      allowFailure: true,
    });
    if (commit.exitCode !== 0)
      throw new Error('Module delivery source commit is not authenticated.');
    return repositoryRoot;
  }

  static trustedModuleDeliveryPlanSnapshot(
    candidate: ValidatedModuleDeliveryPlan,
  ): ValidatedModuleDeliveryPlan {
    const accepted = ModuleDeliveryPlanDecoder.decodeAndValidate(
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
      throw new Error('Validated module delivery plan is inconsistent.');
    return accepted;
  }

  static frozenModuleDeliveryResources(
    request: FrozenModuleDeliveryResourcesRequest,
  ): ModuleDeliveryResourceClaims {
    const evidenceReads =
      request.node.kind === ModuleDeliveryTaskKind.EvidenceSynthesis
        ? []
        : request.node.dependencies.flatMap((taskId) => {
            const provider = ModuleSourceAuthority.moduleDeliveryNode({
              plan: request.plan,
              taskId,
            });
            return provider.kind === ModuleDeliveryTaskKind.ReadOnly
              ? provider.resources.evidenceSurface
              : [];
          });
    return Object.freeze({
      read: Object.freeze([
        ...new Set([...request.node.resources.read, ...evidenceReads]),
      ]),
      write: Object.freeze([...request.node.resources.write]),
      evidenceSurface: Object.freeze([
        ...request.node.resources.evidenceSurface,
      ]),
    });
  }

  static moduleDeliveryNode(
    request: ModuleDeliveryNodeLookupRequest,
  ): ModuleDeliveryNodeV2 {
    const node = request.plan.plan.nodes.find(
      (candidate) => candidate.taskId === request.taskId,
    );
    if (!node)
      throw new Error(`Validated plan is missing task ${request.taskId}.`);
    return node;
  }

  static expectedModuleDeliveryLineageMap(
    request: ExpectedLineageMapRequest,
  ): ReadonlyMap<string, AgentAttemptParent> {
    if (request.entries.length !== request.acceptedPlan.plan.nodes.length)
      throw new Error('Expected lineage must bind every module delivery task.');
    const result = new Map<string, AgentAttemptParent>();
    for (const entry of request.entries) {
      const node = request.acceptedPlan.plan.nodes.find(
        ({ taskId }) => taskId === entry.taskId,
      );
      if (
        !node ||
        result.has(entry.taskId) ||
        JSON.stringify(entry.parentLineage) !==
          JSON.stringify(node.parentLineage)
      )
        throw new Error(`Expected lineage is invalid for ${entry.taskId}.`);
      result.set(entry.taskId, Object.freeze({ ...entry.parentLineage }));
    }
    return result;
  }

  static moduleDeliveryResourcesConflict(
    request: ResourceConflictRequest,
  ): boolean {
    const claims: readonly ResourceClaimPair[] = [
      { first: request.first.write, second: request.second.write },
      { first: request.first.write, second: request.second.read },
      { first: request.first.read, second: request.second.write },
    ];
    return claims.some((claim) =>
      claim.first.some((left) =>
        claim.second.some((right) =>
          TaskResourceClaim.taskResourcePatternsOverlap({
            first: left,
            second: right,
          } as TaskResourcePatternPair),
        ),
      ),
    );
  }

  static freezeModuleDeliveryAdmissionSelection(
    request: Readonly<ModuleDeliveryAdmissionSelection>,
  ): ModuleDeliveryAdmissionSelection {
    return Object.freeze({
      ...request,
      admissions: Object.freeze([...request.admissions]),
      pendingTaskIds: Object.freeze([...request.pendingTaskIds]),
      blockedTaskIds: Object.freeze([...request.blockedTaskIds]),
    });
  }

  static copyModuleDeliveryAdmission(
    admission: ModuleDeliveryAdmission,
  ): ModuleDeliveryAttemptLease {
    return Object.freeze({
      ...admission,
      resources: Object.freeze({
        read: Object.freeze([...admission.resources.read]),
        write: Object.freeze([...admission.resources.write]),
        evidenceSurface: Object.freeze([
          ...admission.resources.evidenceSurface,
        ]),
      }),
      parentLineage: Object.freeze({ ...admission.parentLineage }),
      acceptanceRequirements: Object.freeze([
        ...admission.acceptanceRequirements,
      ]),
    });
  }
}

export type ExpectedLineageMapRequest = Readonly<{
  acceptedPlan: ValidatedModuleDeliveryPlan;
  entries: readonly ModuleDeliveryExpectedLineage[];
}>;

export type ResourceConflictRequest = Readonly<{
  first: ModuleDeliveryResourceClaims;
  second: ModuleDeliveryResourceClaims;
}>;

type ResourceClaimPair = Readonly<{
  first: readonly string[];
  second: readonly string[];
}>;

export type AuthenticateModuleDeliverySourceCommitRequest = Readonly<{
  repositoryRoot: string;
  sourceCommit: string;
}>;

export type FrozenModuleDeliveryResourcesRequest = Readonly<{
  node: ModuleDeliveryNodeV2;
  plan: ValidatedModuleDeliveryPlan;
}>;

export type ModuleDeliveryNodeLookupRequest = Readonly<{
  plan: ValidatedModuleDeliveryPlan;
  taskId: string;
}>;
