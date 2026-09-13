import { ModuleEvidenceBoundary } from './evidence.ts';
import type {
  ModuleDeliveryAcceptedProviderEvidenceIdentity,
  ModuleDeliveryAcceptedProviderEvidenceIdentityV1,
} from './evidence.ts';
import { PinnedDevBaseEvidenceContract } from '../lib/base-evidence.ts';
import type { PinnedDevBaseEvidence } from '../lib/base-evidence.ts';
import {
  UntrustedYamlBoundary,
  UntrustedYamlPropertyPresence,
} from '../lib/guards.ts';
import type {
  UntrustedYamlMap,
  UntrustedYamlNode,
  UntrustedYamlPropertyArgs,
} from '../lib/guards.ts';
import type { TeamKey } from '../team-agents/catalog.ts';
import type { ModuleDeliveryOwnerIdentity } from './domain.ts';

export const MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION = 2;
export const LEGACY_MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION = 1;

export enum ModuleDeliveryProviderSubmissionKind {
  Write = 'write',
  ReadOnlyEvidence = 'read-only-evidence',
}

export enum ModuleDeliveryEvidenceVerdict {
  TerminalSuccess = 'terminal-success',
}

export enum ModuleIntegrationPhase {
  AcceptingProviders = 'accepting-providers',
  Finalized = 'finalized',
}

export type ModuleDeliveryReadOnlyEvidenceSubmission = PinnedDevBaseEvidence &
  Readonly<{
    kind: ModuleDeliveryProviderSubmissionKind.ReadOnlyEvidence;
    schemaVersion: typeof MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION;
    taskId: string;
    attempt: number;
    generation: number;
    planDigest: string;
    sourceCommit: string;
    producerTeam: TeamKey;
    functionalOwner: ModuleDeliveryOwnerIdentity;
    acceptanceOwner: ModuleDeliveryOwnerIdentity;
    acceptanceRequirements: readonly string[];
    claimIdentities: readonly ModuleDeliveryEvidenceClaimIdentity[];
    acceptedProviderEvidence: readonly ModuleDeliveryAcceptedProviderEvidenceIdentity[];
    artifactIdentity: string;
    artifactDigest: string;
    verdict: ModuleDeliveryEvidenceVerdict;
    evidence: readonly string[];
  }>;

/** Historical V1 handoff shape. Keep it free of the V2 feature-head field. */
export type ModuleDeliveryReadOnlyEvidenceSubmissionV1 = Readonly<{
  kind: ModuleDeliveryProviderSubmissionKind.ReadOnlyEvidence;
  schemaVersion: typeof LEGACY_MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION;
  taskId: string;
  attempt: number;
  generation: number;
  planDigest: string;
  sourceCommit: string;
  originMainSha: string;
  pinnedLocalDevSha: string;
  producerTeam: TeamKey;
  functionalOwner: ModuleDeliveryOwnerIdentity;
  acceptanceOwner: ModuleDeliveryOwnerIdentity;
  acceptanceRequirements: readonly string[];
  claimIdentities: readonly ModuleDeliveryEvidenceClaimIdentity[];
  acceptedProviderEvidence: readonly ModuleDeliveryAcceptedProviderEvidenceIdentityV1[];
  artifactIdentity: string;
  artifactDigest: string;
  verdict: ModuleDeliveryEvidenceVerdict;
  evidence: readonly string[];
}>;

/** Original evidence needed to reconstruct a redacted V1 provider identity. */
export type ModuleDeliveryEvidenceMigrationPayload = Readonly<{
  taskId: string;
  artifactIdentity: string;
  evidence: readonly string[];
}>;

export type ModuleDeliveryEvidenceMigrationRequest = Readonly<{
  submission: ModuleDeliveryReadOnlyEvidenceSubmissionV1;
  featureHeadSha: string;
  migrationEvidence?: readonly ModuleDeliveryEvidenceMigrationPayload[];
}>;

export type MigrationEvidenceRequiredRequest = Readonly<{
  taskId: string;
  artifactIdentity: string;
  artifactDigest: string;
}>;

/** Signals that a redacted V1 identity cannot be migrated without its evidence. */
export class MigrationEvidenceRequired extends Error {
  readonly kind = 'migration-evidence-required' as const;
  readonly taskId: string;
  readonly artifactIdentity: string;
  readonly artifactDigest: string;

  constructor(request: MigrationEvidenceRequiredRequest) {
    super(
      `Original nested evidence payload is required to reconstruct artifact digest for ${request.taskId}.`,
    );
    this.name = 'MigrationEvidenceRequired';
    this.taskId = request.taskId;
    this.artifactIdentity = request.artifactIdentity;
    this.artifactDigest = request.artifactDigest;
  }
}

/** Handles evidence handoff compatibility without changing historical values. */
export class ModuleDeliveryEvidenceSchema {
  private constructor() {}

  private static readonly CURRENT_FIELDS = [
    'kind',
    'schemaVersion',
    'taskId',
    'attempt',
    'generation',
    'planDigest',
    'sourceCommit',
    'originMainSha',
    'pinnedLocalDevSha',
    'featureHeadSha',
    'producerTeam',
    'functionalOwner',
    'acceptanceOwner',
    'acceptanceRequirements',
    'claimIdentities',
    'acceptedProviderEvidence',
    'artifactIdentity',
    'artifactDigest',
    'verdict',
    'evidence',
  ] as const;

  private static readonly LEGACY_FIELDS = [
    'kind',
    'schemaVersion',
    'taskId',
    'attempt',
    'generation',
    'planDigest',
    'sourceCommit',
    'originMainSha',
    'pinnedLocalDevSha',
    'producerTeam',
    'functionalOwner',
    'acceptanceOwner',
    'acceptanceRequirements',
    'claimIdentities',
    'acceptedProviderEvidence',
    'artifactIdentity',
    'artifactDigest',
    'verdict',
    'evidence',
  ] as const;

  private static readonly IDENTITY_FIELDS = [
    'schemaVersion',
    'generation',
    'planDigest',
    'taskId',
    'attempt',
    'producerTeam',
    'functionalOwner',
    'acceptanceOwner',
    'sourceCommit',
    'originMainSha',
    'pinnedLocalDevSha',
    'verifiedHeadCommit',
    'artifactIdentity',
    'artifactDigest',
    'sourceProvenanceDigest',
    'verdict',
    'claimIdentities',
    'acceptanceRequirements',
    'acceptedProviderEvidence',
  ] as const;

  private static readonly CURRENT_IDENTITY_FIELDS = [
    ...ModuleDeliveryEvidenceSchema.IDENTITY_FIELDS.slice(0, 10),
    'featureHeadSha',
    ...ModuleDeliveryEvidenceSchema.IDENTITY_FIELDS.slice(10),
  ] as const;

  static decodeReadOnlyEvidenceSubmission(
    serialized: string,
  ): ModuleDeliveryReadOnlyEvidenceSubmission {
    const decoded =
      ModuleDeliveryEvidenceSchema.decodeCompatibleReadOnlyEvidenceSubmission(
        serialized,
      );
    if (
      decoded.schemaVersion !== MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION
    )
      throw new Error('Evidence handoff schema version is unsupported.');
    return decoded;
  }

  /** Decodes V1 and V2 handoffs while preserving the V1 shape verbatim. */
  static decodeCompatibleReadOnlyEvidenceSubmission(
    serialized: string,
  ):
    | ModuleDeliveryReadOnlyEvidenceSubmission
    | ModuleDeliveryReadOnlyEvidenceSubmissionV1 {
    const transport = UntrustedYamlBoundary.fromJson(JSON.parse(serialized));
    if (!UntrustedYamlBoundary.isRecord(transport))
      throw new Error('Evidence handoff must be an object.');
    const reader = new EvidenceRecordReader(transport);
    const schemaVersion = reader.integer('schemaVersion');
    const legacy =
      schemaVersion === LEGACY_MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION;
    if (
      !legacy &&
      schemaVersion !== MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION
    )
      throw new Error('Evidence handoff schema version is unsupported.');
    reader.exactKeys(
      legacy
        ? ModuleDeliveryEvidenceSchema.LEGACY_FIELDS
        : ModuleDeliveryEvidenceSchema.CURRENT_FIELDS,
    );
    const kind = reader.string('kind');
    if (kind !== ModuleDeliveryProviderSubmissionKind.ReadOnlyEvidence)
      throw new Error('Evidence handoff kind is unsupported.');
    const originMainSha = reader.commit('originMainSha');
    const pinnedLocalDevSha = reader.commit('pinnedLocalDevSha');
    const taskId = reader.string('taskId');
    const attempt = reader.positiveInteger('attempt');
    const generation = reader.positiveInteger('generation');
    const planDigest = reader.sha256('planDigest');
    const sourceCommit = reader.commit('sourceCommit');
    const producerTeam = reader.string('producerTeam') as TeamKey;
    const functionalOwner = reader.string(
      'functionalOwner',
    ) as ModuleDeliveryOwnerIdentity;
    const acceptanceOwner = reader.string(
      'acceptanceOwner',
    ) as ModuleDeliveryOwnerIdentity;
    const acceptanceRequirements = reader.stringList(
      'acceptanceRequirements',
    );
    const claimIdentities = reader.array('claimIdentities').map(
      ModuleDeliveryEvidenceSchema.decodeClaimIdentity,
    );
    const artifactIdentity = reader.string('artifactIdentity');
    const artifactDigest = reader.sha256('artifactDigest');
    const verdict = reader.verdict('verdict');
    const evidence = reader.stringList('evidence');
    const acceptedProviderEvidence = reader
      .array('acceptedProviderEvidence')
      .map((node) =>
        ModuleDeliveryEvidenceSchema.decodeIdentity(node, legacy),
      );
    if (legacy) {
      const submission: ModuleDeliveryReadOnlyEvidenceSubmissionV1 = {
        kind: ModuleDeliveryProviderSubmissionKind.ReadOnlyEvidence,
        schemaVersion: LEGACY_MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION,
        taskId,
        attempt,
        generation,
        planDigest,
        sourceCommit,
        originMainSha,
        pinnedLocalDevSha,
        producerTeam,
        functionalOwner,
        acceptanceOwner,
        acceptanceRequirements,
        claimIdentities,
        acceptedProviderEvidence:
          acceptedProviderEvidence as readonly ModuleDeliveryAcceptedProviderEvidenceIdentityV1[],
        artifactIdentity,
        artifactDigest,
        verdict,
        evidence,
      };
      return submission;
    }
    const featureHeadSha = reader.commit('featureHeadSha');
    const submission: ModuleDeliveryReadOnlyEvidenceSubmission = {
      kind: ModuleDeliveryProviderSubmissionKind.ReadOnlyEvidence,
      schemaVersion: MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION,
      taskId,
      attempt,
      generation,
      planDigest,
      sourceCommit,
      originMainSha,
      pinnedLocalDevSha,
      featureHeadSha,
      producerTeam,
      functionalOwner,
      acceptanceOwner,
      acceptanceRequirements,
      claimIdentities,
      acceptedProviderEvidence:
        acceptedProviderEvidence as readonly ModuleDeliveryAcceptedProviderEvidenceIdentity[],
      artifactIdentity,
      artifactDigest,
      verdict,
      evidence,
    };
    PinnedDevBaseEvidenceContract.assertShape({
      originMainSha,
      pinnedLocalDevSha,
      featureHeadSha,
    });
    return submission;
  }

  static migrateReadOnlyEvidenceSubmission(
    request: ModuleDeliveryEvidenceMigrationRequest,
  ): ModuleDeliveryReadOnlyEvidenceSubmission {
    const { submission, featureHeadSha, migrationEvidence } = request;
    if (
      submission.schemaVersion !==
      LEGACY_MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION
    )
      throw new Error('Only evidence handoff schema 1 can be migrated.');
    const legacyArtifactDigest =
      ModuleDeliveryEvidenceSchema.identityArtifactDigest({
        artifactIdentity: submission.artifactIdentity,
        acceptanceRequirements: submission.acceptanceRequirements,
        acceptedProviderEvidence:
          submission.acceptedProviderEvidence as readonly ModuleDeliveryAcceptedProviderEvidenceIdentityV1[],
        evidence: submission.evidence,
      });
    if (legacyArtifactDigest !== submission.artifactDigest)
      throw new Error('Historical evidence artifact digest is invalid.');
    const evidenceByTaskId = new Map<
      string,
      ModuleDeliveryEvidenceMigrationPayload
    >();
    migrationEvidence?.forEach((payload) => {
      if (evidenceByTaskId.has(payload.taskId))
        throw new Error(
          `Historical migration evidence is duplicated for ${payload.taskId}.`,
        );
      evidenceByTaskId.set(payload.taskId, payload);
    });
    const migrateIdentity = (
      identity: ModuleDeliveryAcceptedProviderEvidenceIdentityV1,
    ): ModuleDeliveryAcceptedProviderEvidenceIdentity => {
      if (
        identity.schemaVersion !==
        LEGACY_MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION
      )
        throw new Error('Historical nested evidence schema version is invalid.');
      const payload = evidenceByTaskId.get(identity.taskId);
      if (
        !payload ||
        payload.artifactIdentity !== identity.artifactIdentity
      )
        throw new MigrationEvidenceRequired({
          taskId: identity.taskId,
          artifactIdentity: identity.artifactIdentity,
          artifactDigest: identity.artifactDigest,
        });
      const legacyDigest = ModuleDeliveryEvidenceSchema.identityArtifactDigest({
        artifactIdentity: identity.artifactIdentity,
        evidence: payload.evidence,
        acceptanceRequirements: identity.acceptanceRequirements,
        acceptedProviderEvidence: identity.acceptedProviderEvidence,
      });
      if (legacyDigest !== identity.artifactDigest)
        throw new Error('Historical evidence artifact digest is invalid.');
      const acceptedProviderEvidence = identity.acceptedProviderEvidence.map(
        migrateIdentity,
      );
      const migrated: ModuleDeliveryAcceptedProviderEvidenceIdentity = {
        schemaVersion: MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION,
        generation: identity.generation,
        planDigest: identity.planDigest,
        taskId: identity.taskId,
        attempt: identity.attempt,
        producerTeam: identity.producerTeam,
        functionalOwner: identity.functionalOwner,
        acceptanceOwner: identity.acceptanceOwner,
        sourceCommit: identity.sourceCommit,
        originMainSha: identity.originMainSha,
        pinnedLocalDevSha: identity.pinnedLocalDevSha,
        featureHeadSha,
        verifiedHeadCommit: identity.verifiedHeadCommit,
        artifactIdentity: identity.artifactIdentity,
        artifactDigest: identity.artifactDigest,
        sourceProvenanceDigest: identity.sourceProvenanceDigest,
        verdict: identity.verdict,
        claimIdentities: identity.claimIdentities,
        acceptanceRequirements: identity.acceptanceRequirements,
        acceptedProviderEvidence,
      };
      return {
        ...migrated,
        artifactDigest: ModuleDeliveryEvidenceSchema.identityArtifactDigest({
          artifactIdentity: migrated.artifactIdentity,
          evidence: payload.evidence,
          acceptanceRequirements: migrated.acceptanceRequirements,
          acceptedProviderEvidence: migrated.acceptedProviderEvidence,
        }),
      };
    };
    const acceptedProviderEvidence = submission.acceptedProviderEvidence.map(
      migrateIdentity,
    );
    const migrated: ModuleDeliveryReadOnlyEvidenceSubmission = {
      kind: ModuleDeliveryProviderSubmissionKind.ReadOnlyEvidence,
      schemaVersion: MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION,
      taskId: submission.taskId,
      attempt: submission.attempt,
      generation: submission.generation,
      planDigest: submission.planDigest,
      sourceCommit: submission.sourceCommit,
      originMainSha: submission.originMainSha,
      pinnedLocalDevSha: submission.pinnedLocalDevSha,
      featureHeadSha,
      producerTeam: submission.producerTeam,
      functionalOwner: submission.functionalOwner,
      acceptanceOwner: submission.acceptanceOwner,
      acceptanceRequirements: submission.acceptanceRequirements,
      claimIdentities: submission.claimIdentities,
      acceptedProviderEvidence,
      artifactIdentity: submission.artifactIdentity,
      artifactDigest: ModuleDeliveryEvidenceSchema.identityArtifactDigest({
        artifactIdentity: submission.artifactIdentity,
        evidence: submission.evidence,
        acceptanceRequirements: submission.acceptanceRequirements,
        acceptedProviderEvidence,
      }),
      verdict: submission.verdict,
      evidence: submission.evidence,
    };
    PinnedDevBaseEvidenceContract.assertShape({
      originMainSha: migrated.originMainSha,
      pinnedLocalDevSha: migrated.pinnedLocalDevSha,
      featureHeadSha: migrated.featureHeadSha,
    });
    return migrated;
  }

  private static decodeClaimIdentity(
    node: UntrustedYamlNode,
  ): ModuleDeliveryEvidenceClaimIdentity {
    const reader = new EvidenceRecordReader(
      ModuleDeliveryEvidenceSchema.requireRecord(node),
    );
    reader.exactKeys(['claim', 'contentDigest']);
    return {
      claim: reader.string('claim'),
      contentDigest: reader.sha256('contentDigest'),
    };
  }

  private static decodeIdentity(
    node: UntrustedYamlNode,
    legacy: boolean,
  ):
    | ModuleDeliveryAcceptedProviderEvidenceIdentity
    | ModuleDeliveryAcceptedProviderEvidenceIdentityV1 {
    const reader = new EvidenceRecordReader(
      ModuleDeliveryEvidenceSchema.requireRecord(node),
    );
    reader.exactKeys(
      legacy
        ? ModuleDeliveryEvidenceSchema.IDENTITY_FIELDS
        : ModuleDeliveryEvidenceSchema.CURRENT_IDENTITY_FIELDS,
    );
    const generation = reader.positiveInteger('generation');
    const planDigest = reader.sha256('planDigest');
    const taskId = reader.string('taskId');
    const attempt = reader.positiveInteger('attempt');
    const producerTeam = reader.string('producerTeam') as TeamKey;
    const functionalOwner = reader.string(
      'functionalOwner',
    ) as ModuleDeliveryOwnerIdentity;
    const acceptanceOwner = reader.string(
      'acceptanceOwner',
    ) as ModuleDeliveryOwnerIdentity;
    const sourceCommit = reader.commit('sourceCommit');
    const originMainSha = reader.commit('originMainSha');
    const pinnedLocalDevSha = reader.commit('pinnedLocalDevSha');
    const featureHeadSha = legacy ? undefined : reader.commit('featureHeadSha');
    const verifiedHeadCommit = reader.commit('verifiedHeadCommit');
    const artifactIdentity = reader.string('artifactIdentity');
    const artifactDigest = reader.sha256('artifactDigest');
    const sourceProvenanceDigest = reader.sha256('sourceProvenanceDigest');
    const verdict = reader.verdict('verdict');
    const claimIdentities = reader.array('claimIdentities').map(
      ModuleDeliveryEvidenceSchema.decodeClaimIdentity,
    );
    const acceptanceRequirements = reader.stringList('acceptanceRequirements');
    const acceptedProviderEvidence = reader
      .array('acceptedProviderEvidence')
      .map((child) => ModuleDeliveryEvidenceSchema.decodeIdentity(child, legacy));
    if (featureHeadSha !== undefined)
      PinnedDevBaseEvidenceContract.assertShape({
        originMainSha,
        pinnedLocalDevSha,
        featureHeadSha,
      });
    if (legacy) {
      return {
        schemaVersion: LEGACY_MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION,
        generation,
        planDigest,
        taskId,
        attempt,
        producerTeam,
        functionalOwner,
        acceptanceOwner,
        sourceCommit,
        originMainSha,
        pinnedLocalDevSha,
        verifiedHeadCommit,
        artifactIdentity,
        artifactDigest,
        sourceProvenanceDigest,
        verdict,
        claimIdentities,
        acceptanceRequirements,
        acceptedProviderEvidence:
          acceptedProviderEvidence as readonly ModuleDeliveryAcceptedProviderEvidenceIdentityV1[],
      };
    }
    const currentFeatureHeadSha = featureHeadSha;
    if (currentFeatureHeadSha === undefined)
      throw new Error('Evidence handoff feature head is missing.');
    return {
      schemaVersion: MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION,
      generation,
      planDigest,
      taskId,
      attempt,
      producerTeam,
      functionalOwner,
      acceptanceOwner,
      sourceCommit,
      originMainSha,
      pinnedLocalDevSha,
      featureHeadSha: currentFeatureHeadSha,
      verifiedHeadCommit,
      artifactIdentity,
      artifactDigest,
      sourceProvenanceDigest,
      verdict,
      claimIdentities,
      acceptanceRequirements,
      acceptedProviderEvidence:
        acceptedProviderEvidence as readonly ModuleDeliveryAcceptedProviderEvidenceIdentity[],
    };
  }

  private static identityArtifactDigest(
    request: Readonly<{
      artifactIdentity: string;
      evidence: readonly string[];
      acceptanceRequirements: readonly string[];
      acceptedProviderEvidence:
        | readonly ModuleDeliveryAcceptedProviderEvidenceIdentity[]
        | readonly ModuleDeliveryAcceptedProviderEvidenceIdentityV1[];
    }>,
  ): string {
    return ModuleEvidenceBoundary.moduleDeliveryEvidenceArtifactDigest({
      artifactIdentity: request.artifactIdentity,
      evidence: request.evidence,
      acceptanceRequirements: request.acceptanceRequirements,
      acceptedProviderEvidence:
        request.acceptedProviderEvidence as readonly ModuleDeliveryAcceptedProviderEvidenceIdentity[],
    });
  }

  private static requireRecord(node: UntrustedYamlNode): UntrustedYamlMap {
    if (!UntrustedYamlBoundary.isRecord(node))
      throw new Error('Evidence handoff nested value must be an object.');
    return node;
  }
}


class EvidenceRecordReader {
  readonly record: UntrustedYamlMap;

  constructor(record: UntrustedYamlMap) {
    this.record = record;
  }

  node(key: string): UntrustedYamlNode {
    const propertyInput: UntrustedYamlPropertyArgs = {
      record: this.record,
      key,
    };
    const property = UntrustedYamlBoundary.property(propertyInput);
    if (property.presence === UntrustedYamlPropertyPresence.Absent)
      throw new Error(`Evidence handoff field is missing: ${key}`);
    return property.value;
  }

  string(key: string): string {
    const value = this.node(key);
    if (typeof value !== 'string')
      throw new Error(`Evidence handoff field must be a string: ${key}`);
    return value;
  }

  integer(key: string): number {
    const value = this.node(key);
    if (typeof value !== 'number' || !Number.isSafeInteger(value))
      throw new Error(`Evidence handoff field must be an integer: ${key}`);
    return value;
  }

  positiveInteger(key: string): number {
    const value = this.integer(key);
    if (value < 1)
      throw new Error(`Evidence handoff field must be positive: ${key}`);
    return value;
  }

  commit(key: string): string {
    const value = this.string(key);
    if (!/^[0-9a-f]{40}$/u.test(value))
      throw new Error(`Evidence handoff commit is invalid: ${key}`);
    return value;
  }

  sha256(key: string): string {
    const value = this.string(key);
    if (!/^[0-9a-f]{64}$/u.test(value))
      throw new Error(`Evidence handoff digest is invalid: ${key}`);
    return value;
  }

  stringList(key: string): readonly string[] {
    const value = this.node(key);
    if (!UntrustedYamlBoundary.isList(value) ||
        value.some((entry) => typeof entry !== 'string'))
      throw new Error(`Evidence handoff field must be a string list: ${key}`);
    return value as readonly string[];
  }

  array(key: string): readonly UntrustedYamlNode[] {
    const value = this.node(key);
    if (!UntrustedYamlBoundary.isList(value))
      throw new Error(`Evidence handoff field must be an array: ${key}`);
    return value;
  }

  verdict(key: string): ModuleDeliveryEvidenceVerdict {
    const value = this.string(key);
    if (value !== ModuleDeliveryEvidenceVerdict.TerminalSuccess)
      throw new Error(`Evidence handoff verdict is unsupported: ${key}`);
    return ModuleDeliveryEvidenceVerdict.TerminalSuccess;
  }

  exactKeys(expected: readonly string[]): void {
    const actual = new Set(Object.keys(this.record));
    if (
      actual.size !== expected.length ||
      expected.some((key) => !actual.has(key))
    )
      throw new Error('Evidence handoff contains unsupported fields.');
  }
}

