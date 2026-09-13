import { AgentAttemptParentKind } from '../../src/agent-workflow/domain.ts';
import { TeamKey } from '../../src/team-agents/catalog.ts';
import {
  REQUIRED_PARENT_OWNED_RESOURCES,
  ModuleDeliveryBaselineKind,
  ModuleDeliveryEvidenceInputSchema,
  ModuleDeliveryEvidenceVerdict,
  ModuleDeliveryJoinKind,
  ModuleDeliveryProviderSubmissionKind,
  MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION,
  ModuleDeliveryTaskKind,
  ModuleDeliveryTaskProfile,
  ModuleDeliveryValidationStatus,
  ModuleDeliveryWorkspaceKind,
  ModuleGenerationAuthority,
  ModuleDeliveryPlanDecoder,
  ModuleEvidenceBoundary,
} from '../../src/module-delivery/index.ts';
import { ModuleDeliveryWorktreeTestSupportScenario } from './worktree-test-support.ts';

import type {
  AcceptedModuleDeliveryEvidence,
  CreateModuleDeliveryAdmissionStateRequest,
  CreateModuleDeliveryGenerationAuthorityRequest,
  ModuleDeliveryAdmissionState,
  ModuleDeliveryAttemptLease,
  ModuleDeliveryEdgeContract,
  ModuleDeliveryEvidenceArtifactDigestRequest,
  ModuleDeliveryEvidenceSynthesisNodeV2,
  ModuleDeliveryGenerationAuthority,
  ModuleDeliveryPlanV4,
  ModuleDeliveryReadOnlyEvidenceSubmission,
  ModuleDeliveryReadOnlyNodeV2,
  ModuleDeliveryWriteNodeV2,
  RecordModuleDeliveryAttemptLeasesRequest,
  SelectModuleDeliveryAdmissionsRequest,
  ValidatedModuleDeliveryPlan,
} from '../../src/module-delivery/index.ts';
import type {
  ModuleDeliveryEvidenceDigestRequest,
  ModuleDeliveryEvidenceSubmissionVerification,
} from '../../src/module-delivery/evidence.ts';
import type { GitFixture } from './worktree-test-support.ts';

export class ModuleDeliveryEvidenceScenario {
  private constructor(private readonly request: EvidenceEdgeRequest) {}

  static edge(request: EvidenceEdgeRequest): ModuleDeliveryEdgeContract {
    return new ModuleDeliveryEvidenceScenario(request).execute();
  }

  private execute(): ModuleDeliveryEdgeContract {
    const request = this.request;
    const { providerTaskId, consumerTaskId } = request;
    return {
      providerTaskId,
      consumerTaskId,
      capability: 'accepted provider evidence',
      publicTypes: ['AcceptedModuleDeliveryEvidence'],
      errors: ['EvidenceRejected'],
      behaviorInvariants: ['Evidence identity is exact.'],
      securityInvariants: ['Only accepted evidence is synthesized.'],
      compatibilityExpectations: ['Schema v1 migrates without mutation.'],
      owningTests: ['evidence authority tests'],
    };
  }

  static runtime(existingFixture?: GitFixture): Runtime {
    let fixture = existingFixture;
    if (!fixture)
      fixture = ModuleDeliveryWorktreeTestSupportScenario.createGitFixture();
    const provider: ModuleDeliveryReadOnlyNodeV2 = {
      kind: ModuleDeliveryTaskKind.ReadOnly,
      taskId: 'core-evidence',
      team: TeamKey.DevelopmentCore,
      functionalOwner: TeamKey.Ai,
      acceptanceOwner: TeamKey.Ai,
      parentLineage: { kind: AgentAttemptParentKind.WorkflowRoot },
      expert: 'core_expert',
      moduleRoot: CORE_ROOT,
      consumerOutcome: 'AI receives accepted core evidence.',
      baseline: {
        kind: ModuleDeliveryBaselineKind.SourceCommit,
        sourceCommit: fixture.pinnedLocalDevSha,
      },
      agentDepthLimit: 2,
      dependencies: [],
      resources: {
        read: [`${CORE_ROOT}/**`],
        write: [],
        evidenceSurface: [`${CORE_ROOT}/**`],
      },
      parentOwnedExclusions: REQUIRED_PARENT_OWNED_RESOURCES,
      acceptance: {
        commands: ['task core:evidence'],
        evidence: ['Core evidence is complete.'],
      },
    };
    const providerB: ModuleDeliveryReadOnlyNodeV2 = {
      ...provider,
      taskId: 'web-evidence',
      team: TeamKey.WebDevelopment,
      expert: 'web_expert',
      moduleRoot: WEB_ROOT,
      resources: { read: [WEB_ROOT], write: [], evidenceSurface: [WEB_ROOT] },
      acceptance: {
        commands: ['task web:evidence'],
        evidence: ['Web evidence is complete.'],
      },
    };
    const synthesis: ModuleDeliveryEvidenceSynthesisNodeV2 = {
      kind: ModuleDeliveryTaskKind.EvidenceSynthesis,
      taskId: 'evidence-synthesis',
      team: TeamKey.DevelopmentCore,
      functionalOwner: TeamKey.Ai,
      acceptanceOwner: TeamKey.Ai,
      parentLineage: { kind: AgentAttemptParentKind.WorkflowRoot },
      expert: 'core_expert',
      moduleRoot: CORE_ROOT,
      consumerOutcome: 'Accepted provider evidence is synthesized.',
      baseline: {
        kind: ModuleDeliveryBaselineKind.IntegratedDependencies,
        providerTaskIds: [provider.taskId, providerB.taskId],
      },
      agentDepthLimit: 2,
      dependencies: [provider.taskId, providerB.taskId],
      resources: { read: [], write: [], evidenceSurface: [] },
      parentOwnedExclusions: REQUIRED_PARENT_OWNED_RESOURCES,
      acceptance: {
        commands: ['task synthesis:test'],
        evidence: ['Synthesis is deterministic.'],
      },
      evidenceInput: {
        schema: ModuleDeliveryEvidenceInputSchema.AcceptedProviderEvidenceV1,
        expectedProducers: [
          {
            taskId: provider.taskId,
            team: provider.team,
            functionalOwner: provider.functionalOwner,
            acceptanceOwner: provider.acceptanceOwner,
          },
          {
            taskId: providerB.taskId,
            team: providerB.team,
            functionalOwner: providerB.functionalOwner,
            acceptanceOwner: providerB.acceptanceOwner,
          },
        ],
      },
    };
    const edgeRequest: EvidenceEdgeRequest = {
      providerTaskId: provider.taskId,
      consumerTaskId: synthesis.taskId,
    };
    const edgeBRequest: EvidenceEdgeRequest = {
      providerTaskId: providerB.taskId,
      consumerTaskId: synthesis.taskId,
    };
    const plan: ModuleDeliveryPlanV4 = {
      version: 4,
      generation: 1,
      sourceCommit: fixture.sourceCommit,
      originMainSha: fixture.originMainSha,
      pinnedLocalDevSha: fixture.pinnedLocalDevSha,
      featureHeadSha: fixture.pinnedLocalDevSha,
      maxAgentDepth: 2,
      maxAttempts: 2,
      parentOwnedResources: REQUIRED_PARENT_OWNED_RESOURCES,
      parentJoin: {
        kind: ModuleDeliveryJoinKind.DirectCommits,
        owner: 'delivery-owner',
        validationCommands: ['task loom:verify'],
      },
      nodes: [synthesis, providerB, provider],
      edgeContracts: [
        ModuleDeliveryEvidenceScenario.edge(edgeRequest),
        ModuleDeliveryEvidenceScenario.edge(edgeBRequest),
      ],
    };
    const result = ModuleDeliveryPlanDecoder.decodeAndValidate(
      JSON.stringify(plan),
    );
    if (result.status !== ModuleDeliveryValidationStatus.Accepted)
      throw new Error(JSON.stringify(result.issues));
    const authorityRequest: CreateModuleDeliveryGenerationAuthorityRequest = {
      acceptedPlan: result,
      repositoryRoot: fixture.sourceRoot,
      expectedLineage: result.plan.nodes.map((node) => ({
        taskId: node.taskId,
        parentLineage: node.parentLineage,
      })),
    };
    const authority =
      ModuleGenerationAuthority.createModuleDeliveryGenerationAuthority(
        authorityRequest,
      );
    const stateRequest: CreateModuleDeliveryAdmissionStateRequest = {
      authority,
      acceptedPlan: result,
      headCommit: fixture.sourceCommit,
      integratedWriterFrontiers: [],
      acceptedEvidence: [],
    };
    const state =
      ModuleGenerationAuthority.createModuleDeliveryAdmissionState(
        stateRequest,
      );
    return {
      fixture,
      accepted: result,
      authority,
      state,
      provider,
      providerB,
      synthesis,
    };
  }

  static writeRuntime(fixture: GitFixture): WriteRuntime {
    const writer: ModuleDeliveryWriteNodeV2 = {
      kind: ModuleDeliveryTaskKind.Write,
      taskId: 'core-writer',
      team: TeamKey.DevelopmentCore,
      functionalOwner: TeamKey.Ai,
      acceptanceOwner: TeamKey.Ai,
      parentLineage: { kind: AgentAttemptParentKind.WorkflowRoot },
      expert: ModuleDeliveryTaskProfile.Ordinary,
      moduleRoot: CORE_ROOT,
      consumerOutcome: 'The bounded core change is delivered.',
      baseline: {
        kind: ModuleDeliveryBaselineKind.SourceCommit,
        sourceCommit: fixture.pinnedLocalDevSha,
      },
      agentDepthLimit: 1,
      dependencies: [],
      resources: {
        read: [],
        write: [`${CORE_ROOT}/src/lib.rs`],
        evidenceSurface: [],
      },
      parentOwnedExclusions: REQUIRED_PARENT_OWNED_RESOURCES,
      acceptance: {
        commands: ['task core:test'],
        evidence: ['Core tests pass.'],
      },
      workspace: {
        kind: ModuleDeliveryWorkspaceKind.SharedCheckout,
        expectedCommitHandoff: true,
      },
    };
    const plan: ModuleDeliveryPlanV4 = {
      version: 4,
      generation: 1,
      sourceCommit: fixture.sourceCommit,
      originMainSha: fixture.originMainSha,
      pinnedLocalDevSha: fixture.pinnedLocalDevSha,
      featureHeadSha: fixture.pinnedLocalDevSha,
      maxAgentDepth: 1,
      maxAttempts: 2,
      parentOwnedResources: REQUIRED_PARENT_OWNED_RESOURCES,
      parentJoin: {
        kind: ModuleDeliveryJoinKind.DirectCommits,
        owner: 'delivery-owner',
        validationCommands: ['task loom:verify'],
      },
      nodes: [writer],
      edgeContracts: [],
    };
    const accepted = ModuleDeliveryPlanDecoder.decodeAndValidate(
      JSON.stringify(plan),
    );
    if (accepted.status !== ModuleDeliveryValidationStatus.Accepted)
      throw new Error(JSON.stringify(accepted.issues));
    const authority =
      ModuleGenerationAuthority.createModuleDeliveryGenerationAuthority({
        acceptedPlan: accepted,
        repositoryRoot: fixture.sourceRoot,
        expectedLineage: [
          { taskId: writer.taskId, parentLineage: writer.parentLineage },
        ],
      });
    const state = ModuleGenerationAuthority.createModuleDeliveryAdmissionState({
      authority,
      acceptedPlan: accepted,
      headCommit: fixture.sourceCommit,
      integratedWriterFrontiers: [],
      acceptedEvidence: [],
    });
    return { accepted, authority, state, writer };
  }

  static admittedLease(
    request: AdmittedLeaseRequest,
  ): ModuleDeliveryAttemptLease {
    const { runtime, taskId } = request;
    const selectionRequest: SelectModuleDeliveryAdmissionsRequest = {
      authority: runtime.authority,
      acceptedPlan: runtime.accepted,
      state: runtime.state,
    };
    const selection =
      ModuleGenerationAuthority.selectModuleDeliveryAdmissions(
        selectionRequest,
      );
    const admission = selection.admissions.find(
      (entry) => entry.taskId === taskId,
    );
    if (!admission) throw new Error(`Admission ${taskId} is missing.`);
    const leaseRequest: RecordModuleDeliveryAttemptLeasesRequest = {
      authority: runtime.authority,
      state: runtime.state,
      admissions: [admission],
    };
    const lease =
      ModuleGenerationAuthority.recordModuleDeliveryAttemptLeases(leaseRequest)
        .leases[0];
    if (!lease) throw new Error(`Lease ${taskId} is missing.`);
    return lease;
  }

  static submission(
    request: EvidenceSubmissionRequest,
  ): ModuleDeliveryReadOnlyEvidenceSubmission {
    const { runtime, lease, acceptedProviderEvidence } = request;
    const node = runtime.accepted.plan.nodes.find(
      ({ taskId }) => taskId === lease.taskId,
    );
    if (!node || node.kind === ModuleDeliveryTaskKind.Write)
      throw new Error('Evidence node is missing.');
    const identities = acceptedProviderEvidence.map(
      ModuleGenerationAuthority.moduleDeliveryAcceptedEvidenceIdentity,
    );
    const claimRequest: ModuleDeliveryEvidenceDigestRequest = {
      repositoryRoot: runtime.fixture.sourceRoot,
      sourceCommit: lease.startingFrontier,
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
    const artifactDigestRequest: ModuleDeliveryEvidenceArtifactDigestRequest = {
      artifactIdentity,
      evidence,
      acceptanceRequirements: lease.acceptanceRequirements,
      acceptedProviderEvidence: identities,
    };
    const artifactDigest =
      ModuleEvidenceBoundary.moduleDeliveryEvidenceArtifactDigest(
        artifactDigestRequest,
      );
    return {
      kind: ModuleDeliveryProviderSubmissionKind.ReadOnlyEvidence,
      schemaVersion: MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION,
      taskId: node.taskId,
      attempt: lease.attempt,
      generation: lease.generation,
      planDigest: lease.planDigest,
      sourceCommit: lease.startingFrontier,
      originMainSha: lease.originMainSha,
      pinnedLocalDevSha: lease.pinnedLocalDevSha,
      featureHeadSha: lease.pinnedLocalDevSha,
      producerTeam: lease.team,
      functionalOwner: lease.functionalOwner,
      acceptanceOwner: lease.acceptanceOwner,
      acceptanceRequirements: lease.acceptanceRequirements,
      claimIdentities,
      acceptedProviderEvidence: identities,
      artifactIdentity,
      artifactDigest,
      verdict: ModuleDeliveryEvidenceVerdict.TerminalSuccess,
      evidence,
    };
  }

  static verify(
    request: EvidenceVerificationRequest,
  ): AcceptedModuleDeliveryEvidence {
    const { runtime, lease, candidate, acceptedProviderEvidence } = request;
    const verification: ModuleDeliveryEvidenceSubmissionVerification = {
      authority: runtime.authority,
      acceptedPlan: runtime.accepted,
      repositoryRoot: runtime.fixture.sourceRoot,
      state: runtime.state,
      submission: candidate,
      lease,
      authorizedProviderEvidence: acceptedProviderEvidence,
    };
    return ModuleGenerationAuthority.verifyModuleDeliveryEvidenceSubmission(
      verification,
    );
  }
}

export const CORE_ROOT = 'nook-app/nook-platform/nook-core';

export const WEB_ROOT = 'nook-app/nook-web/nook-web-app';

export type Runtime = {
  readonly fixture: GitFixture;
  readonly accepted: ValidatedModuleDeliveryPlan;
  readonly authority: ModuleDeliveryGenerationAuthority;
  readonly state: ModuleDeliveryAdmissionState;
  readonly provider: ModuleDeliveryReadOnlyNodeV2;
  readonly providerB: ModuleDeliveryReadOnlyNodeV2;
  readonly synthesis: ModuleDeliveryEvidenceSynthesisNodeV2;
};

export type AdmissionRuntime = Pick<Runtime, 'accepted' | 'authority' | 'state'>;

export type WriteRuntime = AdmissionRuntime & {
  readonly writer: ModuleDeliveryWriteNodeV2;
};

export type EvidenceEdgeRequest = {
  readonly providerTaskId: string;
  readonly consumerTaskId: string;
};

export type AdmittedLeaseRequest = {
  readonly runtime: AdmissionRuntime;
  readonly taskId: string;
};

export type EvidenceSubmissionRequest = {
  readonly runtime: Runtime;
  readonly lease: ModuleDeliveryAttemptLease;
  readonly acceptedProviderEvidence: readonly AcceptedModuleDeliveryEvidence[];
};

export type EvidenceVerificationRequest = EvidenceSubmissionRequest & {
  readonly candidate: ModuleDeliveryReadOnlyEvidenceSubmission;
};

export type MutableProviderEvidenceIdentity = Omit<
  ModuleDeliveryAcceptedProviderEvidenceIdentity,
  'acceptedProviderEvidence'
> & { acceptedProviderEvidence: MutableProviderEvidenceIdentity[] };


