import { AgentAttemptParentKind } from '../../src/agent-workflow/domain.ts';

import { TeamKey } from '../../src/team-agents/catalog.ts';

import { ModuleDeliveryWorktreeTestSupportScenario } from './worktree-test-support.ts';

import {
  REQUIRED_PARENT_OWNED_RESOURCES,
  ModuleDeliveryAttemptDispositionKind,
  ModuleDeliveryBaselineKind,
  ModuleDeliveryEvidenceVerdict,
  ModuleDeliveryGenerationFenceKind,
  ModuleDeliveryJoinKind,
  ModuleDeliveryTaskKind,
  ModuleDeliveryValidationStatus,
  ModuleDeliveryWorkspaceKind,
  ModuleDeliveryProviderSubmissionKind,
  MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION,
  ModuleGenerationAuthority,
  ModuleDeliveryPlanDecoder,
  ModuleEvidenceBoundary,
} from '../../src/module-delivery/index.ts';

import type {
  AcceptedModuleDeliveryEvidence,
  CreateModuleDeliveryAdmissionStateRequest,
  CreateModuleDeliveryGenerationAuthorityRequest,
  ModuleDeliveryAdmissionState,
  ModuleDeliveryAttemptLease,
  ModuleDeliveryEdgeContract,
  ModuleDeliveryEvidenceArtifactDigestRequest,
  ModuleDeliveryExpectedLineage,
  ModuleDeliveryGenerationAuthority,
  ModuleDeliveryPlanV5,
  ModuleDeliveryReadOnlyEvidenceSubmission,
  ModuleDeliveryWriteNodeV2,
  RecordModuleDeliveryAttemptDispositionRequest,
  RecordModuleDeliveryAttemptLeasesRequest,
  RestartModuleDeliveryGenerationRequest,
  SelectModuleDeliveryAdmissionsRequest,
  ValidatedModuleDeliveryPlan,
} from '../../src/module-delivery/index.ts';

import type {
  ModuleDeliveryEvidenceDigestRequest,
  ModuleDeliveryEvidenceSubmissionVerification,
} from '../../src/module-delivery/evidence.ts';

import type { GitFixture } from './worktree-test-support.ts';

enum AdmissionSupplementStateKind {
  Empty = 'empty',
  Ready = 'ready',
}

type ReadyAdmissionSupplement = {
  readonly kind: AdmissionSupplementStateKind.Ready;
  readonly replacementSource: string;
  readonly foreignFixture: GitFixture;
  readonly foreignSource: string;
};

type AdmissionSupplementState =
  | { readonly kind: AdmissionSupplementStateKind.Empty }
  | ReadyAdmissionSupplement;

export class ModuleDeliveryAdmissionScenario {
  private constructor(private readonly request: string) {}

  private static supplement: AdmissionSupplementState = {
    kind: AdmissionSupplementStateKind.Empty,
  };

  static writeNode(request: WriteNodeRequest): ModuleDeliveryWriteNodeV2 {
    const { taskId, dependencies, path } = request;
    return {
      kind: ModuleDeliveryTaskKind.Write,
      taskId,
      team: TeamKey.DevelopmentCore,
      functionalOwner: TeamKey.Ai,
      acceptanceOwner: TeamKey.Ai,
      parentLineage: { kind: AgentAttemptParentKind.WorkflowRoot },
      expert: 'core_expert',
      moduleRoot: ROOT,
      consumerOutcome: `${taskId} publishes a capability.`,
      baseline:
        dependencies.length === 0
          ? {
              kind: ModuleDeliveryBaselineKind.SourceCommit,
              sourceCommit: PINNED_LOCAL_DEV_SHA,
            }
          : {
              kind: ModuleDeliveryBaselineKind.IntegratedDependencies,
              providerTaskIds: dependencies,
            },
      agentDepthLimit: 2,
      dependencies,
      resources: {
        read: [`${ROOT}/${path}/**`],
        write: [`${ROOT}/${path}/**`],
        evidenceSurface: [],
      },
      parentOwnedExclusions: REQUIRED_PARENT_OWNED_RESOURCES,
      acceptance: {
        commands: [`task ${taskId}:test`],
        evidence: [`${taskId} passed`],
      },
      workspace: {
        kind: ModuleDeliveryWorkspaceKind.SharedCheckout,
        expectedCommitHandoff: true,
      },
    };
  }

  static planAt(sourceCommit: string): ModuleDeliveryPlanV5 {
    return new ModuleDeliveryAdmissionScenario(sourceCommit).execute();
  }

  private execute(): ModuleDeliveryPlanV5 {
    const sourceCommit = this.request;
    const plan = structuredClone(PLAN);
    Object.assign(plan, {
      sourceCommit,
      originMainSha: ORIGIN_MAIN_SHA,
      pinnedLocalDevSha: PINNED_LOCAL_DEV_SHA,
    });
    for (const node of plan.nodes)
      if (node.baseline.kind === ModuleDeliveryBaselineKind.SourceCommit)
        Object.assign(node.baseline, {
          sourceCommit: PINNED_LOCAL_DEV_SHA,
        });
    return plan;
  }

  static generationPlan(request: GenerationPlanRequest): ModuleDeliveryPlanV5 {
    const plan = structuredClone(
      ModuleDeliveryAdmissionScenario.planAt(request.sourceCommit),
    );
    const nodes = request.includeGamma
      ? plan.nodes
      : plan.nodes.filter(({ taskId }) => taskId !== gamma.taskId);
    const update: GenerationPlanUpdate = {
      generation: request.generation,
      nodes,
    };
    Object.assign(plan, update);
    return plan;
  }

  static validate(plan: ModuleDeliveryPlanV5): ValidatedModuleDeliveryPlan {
    const result = ModuleDeliveryPlanDecoder.decodeAndValidate(
      JSON.stringify(plan),
    );
    if (result.status !== ModuleDeliveryValidationStatus.Accepted)
      throw new Error(JSON.stringify(result.issues));
    return result;
  }

  static lineage(
    plan: ValidatedModuleDeliveryPlan,
  ): readonly ModuleDeliveryExpectedLineage[] {
    return plan.plan.nodes.map((node) => ({
      taskId: node.taskId,
      parentLineage: node.parentLineage,
    }));
  }

  static authorityRequest(
    plan: ValidatedModuleDeliveryPlan,
  ): CreateModuleDeliveryGenerationAuthorityRequest {
    return {
      acceptedPlan: plan,
      expectedLineage: ModuleDeliveryAdmissionScenario.lineage(plan),
      repositoryRoot: fixture.sourceRoot,
    };
  }

  static runtime(plan: ValidatedModuleDeliveryPlan): Runtime {
    const authority =
      ModuleGenerationAuthority.createModuleDeliveryGenerationAuthority(
        ModuleDeliveryAdmissionScenario.authorityRequest(plan),
      );
    const stateRequest: CreateModuleDeliveryAdmissionStateRequest = {
      authority,
      acceptedPlan: plan,
      headCommit: plan.plan.sourceCommit,
      integratedWriterFrontiers: [],
      acceptedEvidence: [],
    };
    const state =
      ModuleGenerationAuthority.createModuleDeliveryAdmissionState(
        stateRequest,
      );
    return { accepted: plan, authority, state };
  }

  static replacementSource(): string {
    return ModuleDeliveryAdmissionScenario.supplementState().replacementSource;
  }

  static foreignSource(): string {
    return ModuleDeliveryAdmissionScenario.supplementState().foreignSource;
  }

  static disposeSupplement(): void {
    const state = ModuleDeliveryAdmissionScenario.supplement;
    if (state.kind === AdmissionSupplementStateKind.Empty) return;
    ModuleDeliveryWorktreeTestSupportScenario.disposeGitFixture(
      state.foreignFixture,
    );
    ModuleDeliveryAdmissionScenario.supplement = {
      kind: AdmissionSupplementStateKind.Empty,
    };
  }

  private static supplementState(): ReadyAdmissionSupplement {
    const existing = ModuleDeliveryAdmissionScenario.supplement;
    if (existing.kind === AdmissionSupplementStateKind.Ready) return existing;
    const replacementWrite = {
      fixture,
      relativePath: 'module/replacement.txt',
      contents: 'replacement\n',
    };
    ModuleDeliveryWorktreeTestSupportScenario.writeFixtureFile(
      replacementWrite,
    );
    const fixtureGit =
      ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(fixture);
    fixtureGit(['add', '--all']);
    fixtureGit(['commit', '--quiet', '-m', 'replacement']);
    const replacementSource = fixtureGit(['rev-parse', 'HEAD']);
    const foreignFixture =
      ModuleDeliveryWorktreeTestSupportScenario.createGitFixture();
    ModuleDeliveryWorktreeTestSupportScenario.writeFixtureFile({
      fixture: foreignFixture,
      relativePath: 'module/foreign.txt',
      contents: 'foreign\n',
    });
    const foreignGit =
      ModuleDeliveryWorktreeTestSupportScenario.fixtureGit(foreignFixture);
    foreignGit(['add', '--all']);
    foreignGit(['commit', '--quiet', '-m', 'foreign']);
    const ready: ReadyAdmissionSupplement = {
      kind: AdmissionSupplementStateKind.Ready,
      replacementSource,
      foreignFixture,
      foreignSource: foreignGit(['rev-parse', 'HEAD']),
    };
    ModuleDeliveryAdmissionScenario.supplement = ready;
    return ready;
  }

  static select(active: Runtime) {
    const request: SelectModuleDeliveryAdmissionsRequest = {
      authority: active.authority,
      acceptedPlan: active.accepted,
      state: active.state,
    };
    return ModuleGenerationAuthority.selectModuleDeliveryAdmissions(request);
  }

  static lease(request: LeaseRequest): ModuleDeliveryAttemptLease {
    const { runtime: active, taskId } = request;
    const admission = ModuleDeliveryAdmissionScenario.select(
      active,
    ).admissions.find((entry) => entry.taskId === taskId);
    if (!admission) throw new Error(`Admission ${taskId} is missing.`);
    const recordingRequest: RecordModuleDeliveryAttemptLeasesRequest = {
      authority: active.authority,
      state: active.state,
      admissions: [admission],
    };
    const recording =
      ModuleGenerationAuthority.recordModuleDeliveryAttemptLeases(
        recordingRequest,
      );
    const leased = recording.leases[0];
    if (!leased) throw new Error(`Lease ${taskId} is missing.`);
    return leased;
  }

  static cancelledLease(
    request: CancelledLeaseRequest,
  ): RecordModuleDeliveryAttemptDispositionRequest {
    return {
      authority: request.runtime.authority,
      state: request.runtime.state,
      lease: request.lease,
      outcome: {
        kind: ModuleDeliveryAttemptDispositionKind.FinalUnusable,
        conclusion: ModuleDeliveryGenerationFenceKind.Cancelled,
      },
    };
  }

  static restartRequest(
    request: GenerationRestartRequest,
  ): RestartModuleDeliveryGenerationRequest {
    return {
      authority: request.runtime.authority,
      previousState: request.runtime.state,
      acceptedPlan: request.acceptedPlan,
      expectedLineage: ModuleDeliveryAdmissionScenario.lineage(
        request.acceptedPlan,
      ),
    };
  }

  static evidenceSubmission(
    request: EvidenceSubmissionRequest,
  ): ModuleDeliveryReadOnlyEvidenceSubmission {
    const node = request.runtime.accepted.plan.nodes.find(
      ({ taskId }) => taskId === request.lease.taskId,
    );
    if (!node || node.kind === ModuleDeliveryTaskKind.Write)
      throw new Error('Evidence node is missing.');
    const acceptedProviderEvidence = request.acceptedEvidence.map(
      ModuleGenerationAuthority.moduleDeliveryAcceptedEvidenceIdentity,
    );
    const claimRequest: ModuleDeliveryEvidenceDigestRequest = {
      repositoryRoot: fixture.sourceRoot,
      sourceCommit: request.lease.startingFrontier,
      evidenceSurface: node.resources.evidenceSurface,
    };
    const claimIdentities =
      node.kind === ModuleDeliveryTaskKind.EvidenceSynthesis
        ? []
        : ModuleEvidenceBoundary.moduleDeliveryEvidenceClaimIdentities(
            claimRequest,
          );
    const artifactIdentity = `evidence/${node.taskId}.json`;
    const evidence = [`${node.taskId} reviewed.`];
    const digestRequest: ModuleDeliveryEvidenceArtifactDigestRequest = {
      artifactIdentity,
      evidence,
      acceptanceRequirements: request.lease.acceptanceRequirements,
      acceptedProviderEvidence,
    };
    return {
      kind: ModuleDeliveryProviderSubmissionKind.ReadOnlyEvidence,
      schemaVersion: MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION,
      taskId: node.taskId,
      attempt: request.lease.attempt,
      generation: request.lease.generation,
      planDigest: request.lease.planDigest,
      sourceCommit: request.lease.startingFrontier,
      originMainSha: request.lease.originMainSha,
      pinnedLocalDevSha: request.lease.pinnedLocalDevSha,
      producerTeam: request.lease.team,
      functionalOwner: request.lease.functionalOwner,
      acceptanceOwner: request.lease.acceptanceOwner,
      acceptanceRequirements: request.lease.acceptanceRequirements,
      claimIdentities,
      acceptedProviderEvidence,
      artifactIdentity,
      artifactDigest:
        ModuleEvidenceBoundary.moduleDeliveryEvidenceArtifactDigest(
          digestRequest,
        ),
      verdict: ModuleDeliveryEvidenceVerdict.TerminalSuccess,
      evidence,
    };
  }

  static acceptEvidence(
    request: EvidenceSubmissionRequest,
  ): AcceptedEvidenceResult {
    const submission =
      ModuleDeliveryAdmissionScenario.evidenceSubmission(request);
    const verification: ModuleDeliveryEvidenceSubmissionVerification = {
      authority: request.runtime.authority,
      acceptedPlan: request.runtime.accepted,
      repositoryRoot: fixture.sourceRoot,
      state: request.runtime.state,
      submission,
      lease: request.lease,
      authorizedProviderEvidence: request.acceptedEvidence,
    };
    const evidence =
      ModuleGenerationAuthority.verifyModuleDeliveryEvidenceSubmission(
        verification,
      );
    const stateRequest: CreateModuleDeliveryAdmissionStateRequest = {
      authority: request.runtime.authority,
      acceptedPlan: request.runtime.accepted,
      headCommit: request.runtime.state.headCommit,
      integratedWriterFrontiers: [],
      acceptedEvidence: [...request.acceptedEvidence, evidence],
    };
    const state =
      ModuleGenerationAuthority.createModuleDeliveryAdmissionState(
        stateRequest,
      );
    const dispositionRequest: RecordModuleDeliveryAttemptDispositionRequest = {
      authority: request.runtime.authority,
      state,
      lease: request.lease,
      outcome: {
        kind: ModuleDeliveryAttemptDispositionKind.Accepted,
        conclusion: ModuleDeliveryGenerationFenceKind.Accepted,
      },
    };
    ModuleGenerationAuthority.recordModuleDeliveryAttemptDisposition(
      dispositionRequest,
    );
    return { evidence, state };
  }
}

export const fixture =
  ModuleDeliveryWorktreeTestSupportScenario.createGitFixture();

export const ORIGIN_MAIN_SHA = fixture.originMainSha;

export const PINNED_LOCAL_DEV_SHA = fixture.pinnedLocalDevSha;

export const SOURCE = fixture.sourceCommit;

export const ROOT = 'nook-app/nook-platform/nook-core';

export type Runtime = {
  readonly accepted: ValidatedModuleDeliveryPlan;
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly state: ModuleDeliveryAdmissionState;
};

export type WriteNodeRequest = {
  readonly taskId: string;
  readonly dependencies: readonly string[];
  readonly path: string;
};

export type LeaseRequest = {
  readonly runtime: Runtime;
  readonly taskId: string;
};

export type GenerationPlanRequest = {
  readonly sourceCommit: string;
  readonly generation: number;
  readonly includeGamma: boolean;
};

export type CancelledLeaseRequest = Readonly<{
  runtime: Runtime;
  lease: ModuleDeliveryAttemptLease;
}>;

export type GenerationRestartRequest = {
  readonly runtime: Runtime;
  readonly acceptedPlan: ValidatedModuleDeliveryPlan;
};

export type GenerationPlanUpdate = {
  readonly generation: number;
  readonly nodes: ModuleDeliveryPlanV5['nodes'];
};

export type EvidenceSubmissionRequest = {
  readonly runtime: Runtime;
  readonly lease: ModuleDeliveryAttemptLease;
  readonly acceptedEvidence: readonly AcceptedModuleDeliveryEvidence[];
};

export type AcceptedEvidenceResult = Readonly<{
  evidence: AcceptedModuleDeliveryEvidence;
  state: ModuleDeliveryAdmissionState;
}>;

export const alphaRequest: WriteNodeRequest = {
  taskId: 'alpha',
  dependencies: [],
  path: 'alpha',
};

export const betaRequest: WriteNodeRequest = {
  taskId: 'beta',
  dependencies: [],
  path: 'beta',
};

export const gammaRequest: WriteNodeRequest = {
  taskId: 'gamma',
  dependencies: [],
  path: 'gamma',
};

export const consumerRequest: WriteNodeRequest = {
  taskId: 'consumer',
  dependencies: ['alpha'],
  path: 'consumer',
};

export const alpha = ModuleDeliveryAdmissionScenario.writeNode(alphaRequest);

export const beta = ModuleDeliveryAdmissionScenario.writeNode(betaRequest);

export const gamma = ModuleDeliveryAdmissionScenario.writeNode(gammaRequest);

export const consumer =
  ModuleDeliveryAdmissionScenario.writeNode(consumerRequest);

export const edge: ModuleDeliveryEdgeContract = {
  providerTaskId: 'alpha',
  consumerTaskId: 'consumer',
  capability: 'alpha capability',
  publicTypes: ['AlphaResult'],
  errors: ['AlphaError'],
  behaviorInvariants: ['Deterministic behavior.'],
  securityInvariants: ['Provider-owned state.'],
  compatibilityExpectations: ['Compatible consumer.'],
  owningTests: ['alpha contract test'],
};

export const PLAN: ModuleDeliveryPlanV5 = {
  version: 5,
  featureBranch: 'codex/module-delivery-test',
  generation: 1,
  sourceCommit: SOURCE,
  originMainSha: ORIGIN_MAIN_SHA,
  pinnedLocalDevSha: PINNED_LOCAL_DEV_SHA,
  maxAgentDepth: 3,
  maxAttempts: 2,
  parentOwnedResources: REQUIRED_PARENT_OWNED_RESOURCES,
  parentJoin: {
    kind: ModuleDeliveryJoinKind.DirectCommits,
    owner: 'delivery-owner',
    validationCommands: ['task loom:verify'],
  },
  nodes: [consumer, gamma, beta, alpha],
  edgeContracts: [edge],
};
