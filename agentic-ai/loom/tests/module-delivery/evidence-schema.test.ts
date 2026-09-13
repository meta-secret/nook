import { expect, test } from 'bun:test';
import {
  LEGACY_MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION,
  MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION,
  MigrationEvidenceRequired,
  ModuleDeliveryEvidenceDecodeError,
  ModuleDeliveryEvidenceSchema,
  ModuleDeliveryEvidenceVerdict,
  ModuleEvidenceBoundary,
  MAX_MODULE_DELIVERY_EVIDENCE_ARRAY_ENTRIES,
  MAX_MODULE_DELIVERY_EVIDENCE_DEPTH,
  MAX_MODULE_DELIVERY_EVIDENCE_HANDOFF_BYTES,
  MAX_MODULE_DELIVERY_EVIDENCE_IDENTITIES,
  MAX_MODULE_DELIVERY_EVIDENCE_OBJECT_KEYS,
  MAX_MODULE_DELIVERY_EVIDENCE_STRING_CODE_UNITS,
} from '../../src/module-delivery/index.ts';
import { ModuleDeliveryWorktreeTestSupportScenario } from './worktree-test-support.ts';
import { ModuleDeliveryEvidenceScenario } from './evidence-test-support.ts';

import type {
  ModuleDeliveryAcceptedProviderEvidenceIdentity,
  ModuleDeliveryAcceptedProviderEvidenceIdentityV1,
  ModuleDeliveryEvidenceMigrationPayload,
  ModuleDeliveryReadOnlyEvidenceSubmissionV1,
} from '../../src/module-delivery/index.ts';

test('migrates nested historical v1 evidence with supplied payload and fails closed without it', () => {
  const active = ModuleDeliveryEvidenceScenario.runtime();
  try {
    const lease = ModuleDeliveryEvidenceScenario.admittedLease({
      runtime: active,
      taskId: active.provider.taskId,
    });
    const current = ModuleDeliveryEvidenceScenario.submission({
      runtime: active,
      lease,
      acceptedProviderEvidence: [],
    });
    const deepestArtifactIdentity = 'evidence/deepest-provider.json';
    const deepestEvidence = ['Deepest provider evidence.'];
    const deepestCurrent: ModuleDeliveryAcceptedProviderEvidenceIdentity = {
      schemaVersion: MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION,
      generation: current.generation,
      planDigest: current.planDigest,
      taskId: 'deepest-provider',
      attempt: current.attempt,
      producerTeam: current.producerTeam,
      functionalOwner: current.functionalOwner,
      acceptanceOwner: current.acceptanceOwner,
      sourceCommit: current.sourceCommit,
      originMainSha: current.originMainSha,
      pinnedLocalDevSha: current.pinnedLocalDevSha,
      verifiedHeadCommit: current.sourceCommit,
      artifactIdentity: deepestArtifactIdentity,
      artifactDigest: '0'.repeat(64),
      sourceProvenanceDigest: 'a'.repeat(64),
      verdict: ModuleDeliveryEvidenceVerdict.TerminalSuccess,
      claimIdentities: [],
      acceptanceRequirements: current.acceptanceRequirements,
      acceptedProviderEvidence: [],
    };
    const deepestCurrentCanonical: ModuleDeliveryAcceptedProviderEvidenceIdentity =
      {
        ...deepestCurrent,
        artifactDigest:
          ModuleEvidenceBoundary.moduleDeliveryEvidenceArtifactDigest({
            artifactIdentity: deepestArtifactIdentity,
            evidence: deepestEvidence,
            acceptanceRequirements: current.acceptanceRequirements,
            acceptedProviderEvidence: [],
          }),
      };
    const nestedArtifactIdentity = 'evidence/nested-provider.json';
    const nestedEvidence = ['Nested provider evidence.'];
    const nestedCurrent: ModuleDeliveryAcceptedProviderEvidenceIdentity = {
      ...deepestCurrentCanonical,
      taskId: 'nested-provider',
      artifactIdentity: nestedArtifactIdentity,
      artifactDigest: '0'.repeat(64),
      acceptedProviderEvidence: [deepestCurrentCanonical],
    };
    const nestedCurrentCanonical: ModuleDeliveryAcceptedProviderEvidenceIdentity =
      {
        ...nestedCurrent,
        artifactDigest:
          ModuleEvidenceBoundary.moduleDeliveryEvidenceArtifactDigest({
            artifactIdentity: nestedArtifactIdentity,
            evidence: nestedEvidence,
            acceptanceRequirements: current.acceptanceRequirements,
            acceptedProviderEvidence: [deepestCurrentCanonical],
          }),
      };
    const historicalIdentity = (
      identity: ModuleDeliveryAcceptedProviderEvidenceIdentity,
    ): ModuleDeliveryAcceptedProviderEvidenceIdentityV1 => {
      return {
        ...identity,
        schemaVersion: LEGACY_MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION,
        acceptedProviderEvidence:
          identity.acceptedProviderEvidence.map(historicalIdentity),
      };
    };
    const historicalDeepest = historicalIdentity(deepestCurrentCanonical);
    const historicalNested = historicalIdentity(nestedCurrentCanonical);
    const historical: ModuleDeliveryReadOnlyEvidenceSubmissionV1 = {
      ...current,
      schemaVersion: LEGACY_MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION,
      acceptedProviderEvidence: [historicalNested],
      artifactDigest:
        ModuleEvidenceBoundary.moduleDeliveryEvidenceArtifactDigest({
          artifactIdentity: current.artifactIdentity,
          evidence: current.evidence,
          acceptanceRequirements: current.acceptanceRequirements,
          acceptedProviderEvidence: [
            historicalNested as unknown as ModuleDeliveryAcceptedProviderEvidenceIdentity,
          ],
        }),
    };
    const before = structuredClone(historical);
    const decoded =
      ModuleDeliveryEvidenceSchema.decodeCompatibleReadOnlyEvidenceSubmission(
        JSON.stringify(historical),
      );
    expect(decoded).toEqual(historical);
    expect(() =>
      ModuleDeliveryEvidenceSchema.migrateReadOnlyEvidenceSubmission({
        submission: historical,
      }),
    ).toThrow(MigrationEvidenceRequired);
    const migrationEvidence: readonly ModuleDeliveryEvidenceMigrationPayload[] =
      [
        {
          taskId: nestedCurrent.taskId,
          artifactIdentity: nestedArtifactIdentity,
          evidence: nestedEvidence,
        },
        {
          taskId: deepestCurrent.taskId,
          artifactIdentity: deepestArtifactIdentity,
          evidence: deepestEvidence,
        },
      ];
    const migrated =
      ModuleDeliveryEvidenceSchema.migrateReadOnlyEvidenceSubmission({
        submission: historical,
        migrationEvidence,
      });
    expect(historical).toEqual(before);
    expect(migrated.schemaVersion).toBe(
      MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION,
    );
    expect(migrated.originMainSha).toBe(historical.originMainSha);
    expect(migrated.pinnedLocalDevSha).toBe(historical.pinnedLocalDevSha);
    expect(Object.hasOwn(migrated, 'featureHeadSha')).toBe(false);
    const migratedNested = migrated.acceptedProviderEvidence[0];
    const migratedDeepest = migratedNested?.acceptedProviderEvidence[0];
    if (!migratedNested || !migratedDeepest)
      throw new Error('Nested migration fixture is missing.');
    expect(migratedDeepest.schemaVersion).toBe(
      MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION,
    );
    expect(Object.hasOwn(migratedDeepest, 'featureHeadSha')).toBe(false);
    const nestedKeys = Object.keys(migratedNested);
    expect(nestedKeys.indexOf('verifiedHeadCommit')).toBe(
      nestedKeys.indexOf('pinnedLocalDevSha') + 1,
    );
    expect(migratedDeepest.artifactDigest).toBe(
      historicalDeepest.artifactDigest,
    );
    expect(migratedNested.artifactDigest).toBe(
      ModuleEvidenceBoundary.moduleDeliveryEvidenceArtifactDigest({
        artifactIdentity: migratedNested.artifactIdentity,
        evidence: nestedEvidence,
        acceptanceRequirements: migratedNested.acceptanceRequirements,
        acceptedProviderEvidence: [migratedDeepest],
      }),
    );
    expect(migratedNested.artifactDigest).not.toBe(
      historicalNested.artifactDigest,
    );
    expect(migrated.artifactDigest).toBe(
      ModuleEvidenceBoundary.moduleDeliveryEvidenceArtifactDigest({
        artifactIdentity: migrated.artifactIdentity,
        evidence: migrated.evidence,
        acceptanceRequirements: migrated.acceptanceRequirements,
        acceptedProviderEvidence: migrated.acceptedProviderEvidence,
      }),
    );
    expect(migrated.artifactDigest).not.toBe(historical.artifactDigest);

    const currentRoundTrip =
      ModuleDeliveryEvidenceSchema.decodeCompatibleReadOnlyEvidenceSubmission(
        JSON.stringify(migrated),
      );
    expect(JSON.stringify(currentRoundTrip)).toBe(JSON.stringify(migrated));
    expect(currentRoundTrip).toEqual(migrated);

    const tamperedDeepest: ModuleDeliveryAcceptedProviderEvidenceIdentityV1 = {
      ...historicalDeepest,
      artifactDigest: 'f'.repeat(64),
    };
    const tamperedNested: ModuleDeliveryAcceptedProviderEvidenceIdentityV1 = {
      ...historicalNested,
      acceptedProviderEvidence: [tamperedDeepest],
    };
    const tamperedRoot: ModuleDeliveryReadOnlyEvidenceSubmissionV1 = {
      ...historical,
      acceptedProviderEvidence: [tamperedNested],
      artifactDigest:
        ModuleEvidenceBoundary.moduleDeliveryEvidenceArtifactDigest({
          artifactIdentity: historical.artifactIdentity,
          evidence: historical.evidence,
          acceptanceRequirements: historical.acceptanceRequirements,
          acceptedProviderEvidence: [
            tamperedNested as unknown as ModuleDeliveryAcceptedProviderEvidenceIdentity,
          ],
        }),
    };
    expect(() =>
      ModuleDeliveryEvidenceSchema.migrateReadOnlyEvidenceSubmission({
        submission: tamperedRoot,
        migrationEvidence,
      }),
    ).toThrow('Historical evidence artifact digest is invalid.');
  } finally {
    ModuleDeliveryWorktreeTestSupportScenario.disposeGitFixture(active.fixture);
  }
});

/*
 * Keep the migration fixture's identity payload explicit. Provider identities
 * intentionally carry the artifact digest, not the provider's evidence text.
 * Their canonical migration digest uses the original evidence payload supplied
 * to migration and recursively binds the accepted identity children.
 */
test('current v2 evidence handoff preserves canonical identity property order', () => {
  const active = ModuleDeliveryEvidenceScenario.runtime();
  try {
    const lease = ModuleDeliveryEvidenceScenario.admittedLease({
      runtime: active,
      taskId: active.provider.taskId,
    });
    const current = ModuleDeliveryEvidenceScenario.submission({
      runtime: active,
      lease,
      acceptedProviderEvidence: [],
    });
    const decoded =
      ModuleDeliveryEvidenceSchema.decodeCompatibleReadOnlyEvidenceSubmission(
        JSON.stringify(current),
      );
    expect(JSON.stringify(decoded)).toBe(JSON.stringify(current));
    expect(decoded).toEqual(current);
  } finally {
    ModuleDeliveryWorktreeTestSupportScenario.disposeGitFixture(active.fixture);
  }
});

test('rejects oversized and deeply nested evidence transports before decoding', () => {
  const active = ModuleDeliveryEvidenceScenario.runtime();
  try {
    const lease = ModuleDeliveryEvidenceScenario.admittedLease({
      runtime: active,
      taskId: active.provider.taskId,
    });
    const current = ModuleDeliveryEvidenceScenario.submission({
      runtime: active,
      lease,
      acceptedProviderEvidence: [],
    });
    expect(() =>
      ModuleDeliveryEvidenceSchema.decodeCompatibleReadOnlyEvidenceSubmission(
        JSON.stringify({
          ...current,
          evidence: ['x'.repeat(MAX_MODULE_DELIVERY_EVIDENCE_HANDOFF_BYTES)],
        }),
      ),
    ).toThrow(ModuleDeliveryEvidenceDecodeError);
    expect(() =>
      ModuleDeliveryEvidenceSchema.decodeCompatibleReadOnlyEvidenceSubmission(
        JSON.stringify({
          ...current,
          evidence: [
            'x'.repeat(MAX_MODULE_DELIVERY_EVIDENCE_STRING_CODE_UNITS + 1),
          ],
        }),
      ),
    ).toThrow(ModuleDeliveryEvidenceDecodeError);
    expect(() =>
      ModuleDeliveryEvidenceSchema.decodeCompatibleReadOnlyEvidenceSubmission(
        JSON.stringify({
          ...current,
          ...Object.fromEntries(
            Array.from(
              { length: MAX_MODULE_DELIVERY_EVIDENCE_OBJECT_KEYS },
              (_, index) => [`extra-${index}`, true],
            ),
          ),
        }),
      ),
    ).toThrow(ModuleDeliveryEvidenceDecodeError);
    expect(() =>
      ModuleDeliveryEvidenceSchema.decodeCompatibleReadOnlyEvidenceSubmission(
        JSON.stringify({
          ...current,
          acceptanceRequirements: new Array(
            MAX_MODULE_DELIVERY_EVIDENCE_ARRAY_ENTRIES + 1,
          ).fill('extra'),
        }),
      ),
    ).toThrow(ModuleDeliveryEvidenceDecodeError);
    let deeplyNested: unknown = 'safe';
    for (let depth = 0; depth < MAX_MODULE_DELIVERY_EVIDENCE_DEPTH; depth += 1)
      deeplyNested = [deeplyNested];
    expect(() =>
      ModuleDeliveryEvidenceSchema.decodeCompatibleReadOnlyEvidenceSubmission(
        JSON.stringify({ ...current, evidence: deeplyNested }),
      ),
    ).toThrow(ModuleDeliveryEvidenceDecodeError);
    expect(() =>
      ModuleDeliveryEvidenceSchema.decodeCompatibleReadOnlyEvidenceSubmission(
        JSON.stringify({
          ...current,
          acceptedProviderEvidence: Array.from(
            { length: MAX_MODULE_DELIVERY_EVIDENCE_IDENTITIES },
            () => ({ acceptedProviderEvidence: [{}] }),
          ),
        }),
      ),
    ).toThrow(ModuleDeliveryEvidenceDecodeError);
  } finally {
    ModuleDeliveryWorktreeTestSupportScenario.disposeGitFixture(active.fixture);
  }
});
