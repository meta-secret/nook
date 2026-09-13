import { expect, test } from 'bun:test';
import { TeamKey } from '../../src/team-agents/catalog.ts';
import * as evidenceAuthority from '../../src/module-delivery/authority.ts';
import {
  MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION,
  ModuleDeliveryAttemptDispositionKind,
  ModuleDeliveryEvidenceVerdict,
  ModuleDeliveryGenerationFenceKind,
  ModuleGenerationAuthority,
  ModuleEvidenceBoundary,
} from '../../src/module-delivery/index.ts';
import { ModuleDeliveryWorktreeTestSupportScenario } from './worktree-test-support.ts';
import {
  CORE_ROOT,
  ModuleDeliveryEvidenceScenario,
} from './evidence-test-support.ts';
import type {
  AdmittedLeaseRequest,
  EvidenceSubmissionRequest,
  EvidenceVerificationRequest,
  MutableProviderEvidenceIdentity,
  Runtime,
} from './evidence-test-support.ts';

import type {
  AcceptedModuleDeliveryEvidence,
  CreateModuleDeliveryAdmissionStateRequest,
  CreateModuleDeliveryGenerationAuthorityRequest,
  ModuleDeliveryAcceptedProviderEvidenceIdentity,
  ModuleDeliveryReadOnlyEvidenceSubmission,
} from '../../src/module-delivery/index.ts';
import type { ModuleDeliveryEvidenceDigestRequest } from '../../src/module-delivery/evidence.ts';
import type { AcceptedModuleDeliveryEvidenceRegistration } from '../../src/module-delivery/authority.ts';

test('rejects forged evidence and restores a canonical redacted receipt after restart', () => {
  const active = ModuleDeliveryEvidenceScenario.runtime();
  try {
    const leaseRequest: AdmittedLeaseRequest = {
      runtime: active,
      taskId: active.provider.taskId,
    };
    const lease = ModuleDeliveryEvidenceScenario.admittedLease(leaseRequest);
    const submissionRequest: EvidenceSubmissionRequest = {
      runtime: active,
      lease,
      acceptedProviderEvidence: [],
    };
    const exact = ModuleDeliveryEvidenceScenario.submission(submissionRequest);
    const gitClaimRequest: ModuleDeliveryEvidenceDigestRequest = {
      repositoryRoot: active.fixture.sourceRoot,
      sourceCommit: active.fixture.sourceCommit,
      evidenceSurface: ['git:index'],
    };
    expect(() =>
      ModuleEvidenceBoundary.moduleDeliveryEvidenceClaimIdentities(
        gitClaimRequest,
      ),
    ).toThrow('Git-state evidence claims are unsupported');
    const mutations: readonly ModuleDeliveryReadOnlyEvidenceSubmission[] = [
      { ...exact, taskId: 'forged-task' },
      { ...exact, attempt: 2 },
      { ...exact, generation: 2 },
      { ...exact, planDigest: 'f'.repeat(64) },
      { ...exact, producerTeam: TeamKey.WebDevelopment },
      { ...exact, functionalOwner: TeamKey.DevelopmentCore },
      { ...exact, acceptanceOwner: TeamKey.DevelopmentCore },
      { ...exact, sourceCommit: 'f'.repeat(40) },
      { ...exact, artifactDigest: 'f'.repeat(64) },
      // @ts-expect-error forged verdict intentionally violates the contract
      { ...exact, verdict: 'forged-success' },
      { ...exact, acceptanceRequirements: ['forged acceptance'] },
      {
        ...exact,
        claimIdentities: exact.claimIdentities.map((claim) => ({
          ...claim,
          contentDigest: 'f'.repeat(64),
        })),
      },
    ];
    for (const candidate of mutations) {
      const mutationVerificationRequest: EvidenceVerificationRequest = {
        ...submissionRequest,
        candidate,
      };
      expect(() =>
        ModuleDeliveryEvidenceScenario.verify(mutationVerificationRequest),
      ).toThrow();
    }
    const accepted = ModuleDeliveryEvidenceScenario.verify({
      ...submissionRequest,
      candidate: exact,
    });
    const receipt =
      ModuleGenerationAuthority.moduleDeliveryAcceptedEvidenceIdentity(
        accepted,
      );
    expect('evidence' in receipt).toBe(false);
    const replay = ModuleDeliveryEvidenceScenario.runtime(active.fixture);
    const replayLease = ModuleDeliveryEvidenceScenario.admittedLease({
      runtime: replay,
      taskId: replay.provider.taskId,
    });
    const restored =
      ModuleGenerationAuthority.restoreModuleDeliveryCanonicalEvidenceReceipt({
        authority: replay.authority,
        acceptedPlan: replay.accepted,
        state: replay.state,
        lease: replayLease,
        acceptedEvidence: [],
        receipt,
      });
    expect(restored.evidence.evidence).toEqual([]);
    expect(restored.state.acceptedProviderEvidence).toEqual([receipt]);
    expect(() =>
      ModuleGenerationAuthority.restoreModuleDeliveryCanonicalEvidenceReceipt({
        authority: replay.authority,
        acceptedPlan: replay.accepted,
        state: replay.state,
        lease: replayLease,
        acceptedEvidence: [],
        receipt,
      }),
    ).toThrow('already consumed');

    const forgedEvidence: AcceptedModuleDeliveryEvidence = {
      ...exact,
      sourceProvenanceDigest: 'f'.repeat(64),
      verifiedHeadCommit: active.fixture.sourceCommit,
    };
    const isolatedRegistry =
      evidenceAuthority.ModuleSourceAuthority.createAcceptedModuleDeliveryEvidenceRegistry();
    const isolatedRegistration: AcceptedModuleDeliveryEvidenceRegistration = {
      authority: active.authority,
      evidence: forgedEvidence,
      integratedTaskIds: [],
    };
    isolatedRegistry.register(isolatedRegistration);
    expect('registerAcceptedModuleDeliveryEvidence' in evidenceAuthority).toBe(
      false,
    );
    const forgedStateRequest: CreateModuleDeliveryAdmissionStateRequest = {
      authority: active.authority,
      acceptedPlan: active.accepted,
      headCommit: active.fixture.sourceCommit,
      integratedWriterFrontiers: [],
      acceptedEvidence: [forgedEvidence],
    };
    expect(() =>
      ModuleGenerationAuthority.createModuleDeliveryAdmissionState(
        forgedStateRequest,
      ),
    ).toThrow('evidence authority is invalid');
  } finally {
    ModuleDeliveryWorktreeTestSupportScenario.disposeGitFixture(active.fixture);
  }
});

test('canonical redacted receipt replay rejects inconsistent lifecycle fields without key material', () => {
  const active = ModuleDeliveryEvidenceScenario.runtime();
  try {
    const lease = ModuleDeliveryEvidenceScenario.admittedLease({
      runtime: active,
      taskId: active.provider.taskId,
    });
    const accepted = ModuleDeliveryEvidenceScenario.verify({
      runtime: active,
      lease,
      acceptedProviderEvidence: [],
      candidate: ModuleDeliveryEvidenceScenario.submission({
        runtime: active,
        lease,
        acceptedProviderEvidence: [],
      }),
    });
    const receipt =
      ModuleGenerationAuthority.moduleDeliveryAcceptedEvidenceIdentity(
        accepted,
      );
    const inconsistent = [
      { ...receipt, schemaVersion: 1 },
      { ...receipt, generation: 2 },
      { ...receipt, planDigest: 'f'.repeat(64) },
      { ...receipt, taskId: active.providerB.taskId },
      { ...receipt, attempt: 2 },
      { ...receipt, sourceCommit: 'f'.repeat(40) },
      { ...receipt, verifiedHeadCommit: 'f'.repeat(40) },
      { ...receipt, acceptanceRequirements: ['different requirement'] },
      { ...receipt, claimIdentities: [] },
      { ...receipt, acceptedProviderEvidence: [receipt] },
      Object.assign(structuredClone(receipt), { extra: true }),
    ];
    for (const candidate of inconsistent) {
      const replay = ModuleDeliveryEvidenceScenario.runtime(active.fixture);
      const replayLease = ModuleDeliveryEvidenceScenario.admittedLease({
        runtime: replay,
        taskId: replay.provider.taskId,
      });
      expect(() =>
        ModuleGenerationAuthority.restoreModuleDeliveryCanonicalEvidenceReceipt(
          {
            authority: replay.authority,
            acceptedPlan: replay.accepted,
            state: replay.state,
            lease: replayLease,
            acceptedEvidence: [],
            // @ts-expect-error each candidate is deliberately malformed
            receipt: candidate,
          },
        ),
      ).toThrow();
    }
  } finally {
    ModuleDeliveryWorktreeTestSupportScenario.disposeGitFixture(active.fixture);
  }
});

test('canonical receipt replay rejects write leases before consuming state', () => {
  const fixture = ModuleDeliveryWorktreeTestSupportScenario.createGitFixture();
  try {
    const active = ModuleDeliveryEvidenceScenario.writeRuntime(fixture);
    const lease = ModuleDeliveryEvidenceScenario.admittedLease({
      runtime: active,
      taskId: active.writer.taskId,
    });
    const receipt: ModuleDeliveryAcceptedProviderEvidenceIdentity = {
      schemaVersion: MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION,
      generation: lease.generation,
      planDigest: lease.planDigest,
      taskId: lease.taskId,
      attempt: lease.attempt,
      producerTeam: lease.team,
      functionalOwner: lease.functionalOwner,
      acceptanceOwner: lease.acceptanceOwner,
      sourceCommit: lease.startingFrontier,
      originMainSha: lease.originMainSha,
      pinnedLocalDevSha: lease.pinnedLocalDevSha,
      featureHeadSha: lease.pinnedLocalDevSha,
      verifiedHeadCommit: active.state.headCommit,
      artifactIdentity: 'evidence/core-writer.json',
      artifactDigest: 'a'.repeat(64),
      sourceProvenanceDigest: 'b'.repeat(64),
      verdict: ModuleDeliveryEvidenceVerdict.TerminalSuccess,
      claimIdentities: [],
      acceptanceRequirements: lease.acceptanceRequirements,
      acceptedProviderEvidence: [],
    };
    for (let attempt = 0; attempt < 2; attempt += 1)
      expect(() =>
        ModuleGenerationAuthority.restoreModuleDeliveryCanonicalEvidenceReceipt(
          {
            authority: active.authority,
            acceptedPlan: active.accepted,
            state: active.state,
            lease,
            acceptedEvidence: [],
            receipt,
          },
        ),
      ).toThrow('cannot restore write tasks');
  } finally {
    ModuleDeliveryWorktreeTestSupportScenario.disposeGitFixture(fixture);
  }
});

test('synthesis requires exact nonempty accepted provider evidence identities', () => {
  const active = ModuleDeliveryEvidenceScenario.runtime();
  try {
    const providerLeaseRequest: AdmittedLeaseRequest = {
      runtime: active,
      taskId: active.provider.taskId,
    };
    const providerLease =
      ModuleDeliveryEvidenceScenario.admittedLease(providerLeaseRequest);
    const providerSubmissionRequest: EvidenceSubmissionRequest = {
      runtime: active,
      lease: providerLease,
      acceptedProviderEvidence: [],
    };
    const providerCandidate = ModuleDeliveryEvidenceScenario.submission(
      providerSubmissionRequest,
    );
    const providerVerificationRequest: EvidenceVerificationRequest = {
      ...providerSubmissionRequest,
      candidate: providerCandidate,
    };
    const providerEvidence = ModuleDeliveryEvidenceScenario.verify(
      providerVerificationRequest,
    );
    const prematureDispositionRequest = {
      authority: active.authority,
      state: active.state,
      lease: providerLease,
      outcome: {
        kind: ModuleDeliveryAttemptDispositionKind.Accepted,
        conclusion: ModuleDeliveryGenerationFenceKind.Accepted,
      },
    };
    expect(() =>
      ModuleGenerationAuthority.recordModuleDeliveryAttemptDisposition(
        prematureDispositionRequest,
      ),
    ).toThrow('lease capability');
    const evidenceStateRequest: CreateModuleDeliveryAdmissionStateRequest = {
      authority: active.authority,
      acceptedPlan: active.accepted,
      headCommit: active.fixture.sourceCommit,
      integratedWriterFrontiers: [],
      acceptedEvidence: [providerEvidence],
    };
    const evidenceState =
      ModuleGenerationAuthority.createModuleDeliveryAdmissionState(
        evidenceStateRequest,
      );
    let oversizedRootAccesses = 0;
    const oversizedRoots = Array(129).fill(providerEvidence);
    const oversizedHandler: ProxyHandler<AcceptedModuleDeliveryEvidence[]> = {
      get: (...parameters) => {
        const [target, property] = parameters;
        if (property === 'length') return target.length;
        oversizedRootAccesses += 1;
        throw new Error('Oversized evidence root was accessed.');
      },
    };
    const oversizedEvidence = new Proxy(oversizedRoots, oversizedHandler);
    const oversizedStateRequest: CreateModuleDeliveryAdmissionStateRequest = {
      ...evidenceStateRequest,
      acceptedEvidence: oversizedEvidence,
    };
    expect(() =>
      ModuleGenerationAuthority.createModuleDeliveryAdmissionState(
        oversizedStateRequest,
      ),
    ).toThrow('ancestry is too large');
    expect(oversizedRootAccesses).toBe(0);
    const omittedEvidenceRequest: CreateModuleDeliveryAdmissionStateRequest = {
      ...evidenceStateRequest,
      acceptedEvidence: [],
    };
    expect(() =>
      ModuleGenerationAuthority.createModuleDeliveryAdmissionState(
        omittedEvidenceRequest,
      ),
    ).toThrow('cannot discard proof');
    const providerDispositionRequest = {
      authority: active.authority,
      state: evidenceState,
      lease: providerLease,
      outcome: {
        kind: ModuleDeliveryAttemptDispositionKind.Accepted,
        conclusion: ModuleDeliveryGenerationFenceKind.Accepted,
      },
    };
    const unusableDispositionRequest = {
      ...providerDispositionRequest,
      outcome: {
        kind: ModuleDeliveryAttemptDispositionKind.FinalUnusable,
        conclusion: ModuleDeliveryGenerationFenceKind.Rejected,
      },
    };
    expect(() =>
      ModuleGenerationAuthority.recordModuleDeliveryAttemptDisposition(
        unusableDispositionRequest,
      ),
    ).toThrow('lease capability is invalid');
    ModuleGenerationAuthority.recordModuleDeliveryAttemptDisposition(
      providerDispositionRequest,
    );
    const providerRuntime: Runtime = { ...active, state: evidenceState };
    const providerBLeaseRequest: AdmittedLeaseRequest = {
      runtime: providerRuntime,
      taskId: active.providerB.taskId,
    };
    const providerBLease = ModuleDeliveryEvidenceScenario.admittedLease(
      providerBLeaseRequest,
    );
    const providerBSubmissionRequest: EvidenceSubmissionRequest = {
      runtime: providerRuntime,
      lease: providerBLease,
      acceptedProviderEvidence: [],
    };
    const providerBVerificationRequest: EvidenceVerificationRequest = {
      ...providerBSubmissionRequest,
      candidate: ModuleDeliveryEvidenceScenario.submission(
        providerBSubmissionRequest,
      ),
    };
    const providerBEvidence = ModuleDeliveryEvidenceScenario.verify(
      providerBVerificationRequest,
    );
    const completeStateRequest: CreateModuleDeliveryAdmissionStateRequest = {
      authority: active.authority,
      acceptedPlan: active.accepted,
      headCommit: active.fixture.sourceCommit,
      integratedWriterFrontiers: [],
      acceptedEvidence: [providerEvidence, providerBEvidence],
    };
    const completeState =
      ModuleGenerationAuthority.createModuleDeliveryAdmissionState(
        completeStateRequest,
      );
    const providerBDispositionRequest = {
      ...providerDispositionRequest,
      state: completeState,
      lease: providerBLease,
    };
    ModuleGenerationAuthority.recordModuleDeliveryAttemptDisposition(
      providerBDispositionRequest,
    );
    const synthesisRuntime: Runtime = { ...active, state: completeState };
    const synthesisLeaseRequest: AdmittedLeaseRequest = {
      runtime: synthesisRuntime,
      taskId: active.synthesis.taskId,
    };
    const synthesisLease = ModuleDeliveryEvidenceScenario.admittedLease(
      synthesisLeaseRequest,
    );
    const synthesisSubmissionRequest: EvidenceSubmissionRequest = {
      runtime: synthesisRuntime,
      lease: synthesisLease,
      acceptedProviderEvidence: [providerEvidence, providerBEvidence],
    };
    expect(Object.values(synthesisLease.resources).flat()).toEqual([]);
    const exact = ModuleDeliveryEvidenceScenario.submission(
      synthesisSubmissionRequest,
    );
    const missingInputsVerificationRequest: EvidenceVerificationRequest = {
      runtime: synthesisRuntime,
      lease: synthesisLease,
      candidate: exact,
      acceptedProviderEvidence: [],
    };
    expect(() =>
      ModuleDeliveryEvidenceScenario.verify(missingInputsVerificationRequest),
    ).toThrow('synthesis inputs');
    const reversedSubmissionRequest: EvidenceSubmissionRequest = {
      ...synthesisSubmissionRequest,
      acceptedProviderEvidence: [providerBEvidence, providerEvidence],
    };
    const reversedVerificationRequest: EvidenceVerificationRequest = {
      ...reversedSubmissionRequest,
      candidate: ModuleDeliveryEvidenceScenario.submission(
        reversedSubmissionRequest,
      ),
    };
    expect(() =>
      ModuleDeliveryEvidenceScenario.verify(reversedVerificationRequest),
    ).toThrow('synthesis inputs');
    const mutableIdentity = (
      identity: ModuleDeliveryAcceptedProviderEvidenceIdentity,
    ): MutableProviderEvidenceIdentity => ({
      ...identity,
      acceptedProviderEvidence:
        identity.acceptedProviderEvidence.map(mutableIdentity),
    });
    const mutableIdentities =
      exact.acceptedProviderEvidence.map(mutableIdentity);
    const mutableExact: ModuleDeliveryReadOnlyEvidenceSubmission = {
      ...exact,
      acceptedProviderEvidence: mutableIdentities,
    };
    const synthesisVerificationRequest: EvidenceVerificationRequest = {
      ...synthesisSubmissionRequest,
      candidate: mutableExact,
    };
    const synthesisEvidence = ModuleDeliveryEvidenceScenario.verify(
      synthesisVerificationRequest,
    );
    const retained = mutableIdentities[0];
    const nested = mutableIdentities[1];
    const stored = synthesisEvidence.acceptedProviderEvidence[0];
    if (!retained || !nested || !stored)
      throw new Error('Nested synthesis evidence is missing.');
    const registry =
      evidenceAuthority.ModuleSourceAuthority.createAcceptedModuleDeliveryEvidenceRegistry();
    const artifact = {
      ...exact,
      acceptedProviderEvidence: Array(129).fill(nested),
    };
    const digest = ModuleEvidenceBoundary.moduleDeliveryEvidenceArtifactDigest;
    expect(() => digest(artifact)).toThrow('ancestry is too large');
    const aggregateRoot = structuredClone(retained);
    aggregateRoot.acceptedProviderEvidence = Array.from({ length: 127 }, () =>
      mutableIdentity(nested),
    );
    artifact.acceptedProviderEvidence = [aggregateRoot, nested];
    expect(() => digest(artifact)).toThrow('ancestry is too large');
    retained.acceptedProviderEvidence = [retained];
    artifact.acceptedProviderEvidence = [retained];
    expect(() => digest(artifact)).toThrow('ancestry is cyclic');
    const cyclicEvidence = {
      ...synthesisEvidence,
      acceptedProviderEvidence: [retained],
    };
    const cyclicRegistration: AcceptedModuleDeliveryEvidenceRegistration = {
      authority: active.authority,
      evidence: cyclicEvidence,
      integratedTaskIds: [],
    };
    expect(() => registry.register(cyclicRegistration)).toThrow(
      'ancestry is cyclic',
    );
    retained.acceptedProviderEvidence = [nested];
    expect(stored).not.toEqual(retained);
    for (const evidence of [
      providerEvidence,
      providerBEvidence,
      synthesisEvidence,
    ]) {
      const registration: AcceptedModuleDeliveryEvidenceRegistration = {
        authority: active.authority,
        evidence,
        integratedTaskIds: ['writer-a'],
      };
      registry.register(registration);
    }
    const authorityBRequest: CreateModuleDeliveryGenerationAuthorityRequest = {
      acceptedPlan: active.accepted,
      repositoryRoot: active.fixture.sourceRoot,
      expectedLineage: active.accepted.plan.nodes.map((node) => ({
        taskId: node.taskId,
        parentLineage: node.parentLineage,
      })),
    };
    const authorityB =
      ModuleGenerationAuthority.createModuleDeliveryGenerationAuthority(
        authorityBRequest,
      );
    const evidenceB = structuredClone(providerEvidence);
    const registrationB: AcceptedModuleDeliveryEvidenceRegistration = {
      authority: authorityB,
      evidence: evidenceB,
      integratedTaskIds: [],
    };
    registry.register(registrationB);
    const conflictingEvidence = structuredClone(providerEvidence);
    const conflictingRegistration = {
      ...registrationB,
      authority: active.authority,
      evidence: conflictingEvidence,
    };
    expect(() => registry.register(conflictingRegistration)).toThrow(
      'integration closure is inconsistent',
    );
    const disjointRequest = {
      authority: active.authority,
      acceptedPlan: active.accepted,
      entries: [synthesisEvidence],
      headCommit: 'f'.repeat(40),
      integratedWrites: [
        { taskId: 'writer-a', claims: [`${CORE_ROOT}/**`] },
        { taskId: 'writer-b', claims: ['agentic-ai/**'] },
      ],
    };
    expect(registry.collect(disjointRequest).accepted).toEqual([
      synthesisEvidence,
    ]);
    const overlappingRequest = {
      ...disjointRequest,
      integratedWrites: [
        ...disjointRequest.integratedWrites,
        { taskId: 'writer-c', claims: [`${CORE_ROOT}/**`] },
      ],
    };
    expect(() => registry.collect(overlappingRequest)).toThrow(
      'Accepted evidence is invalid',
    );
  } finally {
    ModuleDeliveryWorktreeTestSupportScenario.disposeGitFixture(active.fixture);
  }
});
