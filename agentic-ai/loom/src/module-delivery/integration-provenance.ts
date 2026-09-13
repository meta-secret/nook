import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { ModuleRepositoryGit } from './git-command.ts';
import { FilesystemPathPresence } from './workspace-paths.ts';
import { ModuleWorktree } from './workspace.ts';
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
import { ModuleEvidenceBoundary } from './evidence.ts';
import type {
  ModuleDeliveryAcceptedProviderEvidenceIdentity,
  ModuleDeliveryAcceptedProviderEvidenceIdentityV1,
  ModuleDeliveryEvidenceClaimIdentity,
} from './evidence.ts';
import type { TeamKey } from '../team-agents/catalog.ts';
import {
  PinnedDevBaseEvidenceContract,
  type PinnedDevBaseEvidence,
} from '../lib/base-evidence.ts';
import {
  UntrustedYamlBoundary,
  UntrustedYamlPropertyPresence,
} from '../lib/guards.ts';
import type {
  UntrustedYamlMap,
  UntrustedYamlNode,
  UntrustedYamlPropertyArgs,
} from '../lib/guards.ts';
import type {
  ModuleDeliveryNode,
  ModuleDeliveryOwnerIdentity,
  ValidatedModuleDeliveryPlan,
} from './domain.ts';
import type {
  CleanupModuleWorktreeRequest,
  ModuleWorktreeHandle,
} from './workspace.ts';

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

  private static gitBytes(invocation: ModuleGitInvocation): Buffer {
    return ModuleRepositoryGit.runModuleDeliveryGit(
      ModuleIntegrationProvenanceRegistry.gitRequest(invocation),
    ).stdout;
  }

  private static digestBuffers(buffers: readonly Buffer[]): string {
    const hash = createHash('sha256');
    for (const bytes of buffers) {
      const length = Buffer.allocUnsafe(8);
      length.writeBigUInt64BE(BigInt(bytes.length));
      hash.update(length);
      hash.update(bytes);
    }
    return hash.digest('hex');
  }

  private static nullSeparatedPaths(bytes: Buffer): readonly string[] {
    if (bytes.length === 0) return [];
    if (bytes.at(-1) !== 0) {
      throw new Error('Repository path list requires NUL termination.');
    }
    const paths: string[] = [];
    let start = 0;
    for (let index = 0; index < bytes.length; index += 1) {
      if (bytes[index] !== 0) continue;
      const encoded = bytes.subarray(start, index);
      const path = encoded.toString('utf8');
      if (!Buffer.from(path, 'utf8').equals(encoded)) {
        throw new Error('Repository path is not valid UTF-8.');
      }
      paths.push(path);
      start = index + 1;
    }
    return paths;
  }

  private static assertNoSymlinkAncestor(
    inspection: SymlinkAncestorInspection,
  ): void {
    let parent = dirname(inspection.absolutePath);
    while (parent !== inspection.root) {
      if (lstatSync(parent).isSymbolicLink()) {
        throw new Error('Repository entry has a symlink ancestor.');
      }
      parent = dirname(parent);
    }
  }

  private static entryFingerprint(
    request: EntryFingerprintRequest,
  ): EntryFingerprint {
    const absolutePath = resolve(request.repositoryRoot, request.path);
    const fromRoot = relative(request.repositoryRoot, absolutePath);
    if (fromRoot === '' || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
      throw new Error('Repository entry escapes its root.');
    }
    const ancestorInspection: SymlinkAncestorInspection = {
      root: request.repositoryRoot,
      absolutePath,
    };
    ModuleIntegrationProvenanceRegistry.assertNoSymlinkAncestor(
      ancestorInspection,
    );
    const pathTag = Buffer.from(`path:${request.path}`, 'utf8');
    if (!FilesystemPathPresence.exists(absolutePath)) {
      return {
        content: [pathTag, Buffer.from('content:missing', 'utf8')],
        metadata: [pathTag, Buffer.from('kind:missing', 'utf8')],
      };
    }
    const metadata = lstatSync(absolutePath, BIGINT_STATS_OPTIONS);
    const kind = metadata.isSymbolicLink()
      ? 'symlink'
      : metadata.isFile()
        ? 'file'
        : metadata.isDirectory()
          ? 'directory'
          : 'other';
    const metadataTag = Buffer.from(
      [
        `kind:${kind}`,
        `mode:${metadata.mode.toString(8)}`,
        `dev:${metadata.dev.toString()}`,
        `ino:${metadata.ino.toString()}`,
        `size:${metadata.size.toString()}`,
        `mtime:${metadata.mtimeNs.toString()}`,
        `ctime:${metadata.ctimeNs.toString()}`,
      ].join('|'),
      'utf8',
    );
    if (kind === 'symlink') {
      return {
        content: request.includeContent
          ? [
              pathTag,
              Buffer.from('content:symlink-target', 'utf8'),
              Buffer.from(readlinkSync(absolutePath), 'utf8'),
            ]
          : [],
        metadata: [pathTag, metadataTag],
      };
    }
    if (kind === 'file') {
      return {
        content: request.includeContent
          ? [
              pathTag,
              Buffer.from('content:file-bytes', 'utf8'),
              readFileSync(absolutePath),
            ]
          : [],
        metadata: [pathTag, metadataTag],
      };
    }
    return {
      content: [pathTag, Buffer.from(`content:${kind}`, 'utf8')],
      metadata: [pathTag, metadataTag],
    };
  }

  private static repositoryFingerprint(
    paths: RepositoryPathSet,
  ): RepositoryFingerprint {
    const content: Buffer[] = [];
    const metadata: Buffer[] = [];
    for (const path of [...paths.paths].sort()) {
      const request: EntryFingerprintRequest = {
        repositoryRoot: paths.repositoryRoot,
        path,
        includeContent: paths.includeContent,
      };
      const fingerprint =
        ModuleIntegrationProvenanceRegistry.entryFingerprint(request);
      content.push(...fingerprint.content);
      metadata.push(...fingerprint.metadata);
    }
    return {
      contentDigest: ModuleIntegrationProvenanceRegistry.digestBuffers(content),
      metadataDigest:
        ModuleIntegrationProvenanceRegistry.digestBuffers(metadata),
    };
  }

  private static repositoryPaths(repositoryRoot: string): readonly string[] {
    const trackedInvocation: ModuleGitInvocation = {
      cwd: repositoryRoot,
      args: ['ls-files', '-z'],
    };
    const untrackedInvocation: ModuleGitInvocation = {
      cwd: repositoryRoot,
      args: ['ls-files', '--others', '--exclude-standard', '-z'],
    };
    return [
      ...new Set([
        ...ModuleIntegrationProvenanceRegistry.nullSeparatedPaths(
          ModuleIntegrationProvenanceRegistry.gitBytes(trackedInvocation),
        ),
        ...ModuleIntegrationProvenanceRegistry.nullSeparatedPaths(
          ModuleIntegrationProvenanceRegistry.gitBytes(untrackedInvocation),
        ),
      ]),
    ];
  }

  private static relevantRefsDigest(repositoryRoot: string): string {
    const invocation: ModuleGitInvocation = {
      cwd: repositoryRoot,
      args: [
        'for-each-ref',
        '--sort=refname',
        '--format=%(refname)%00%(objectname)%00%(symref)',
        'refs',
      ],
    };
    const fields: Buffer[] = [];
    for (const record of ModuleIntegrationProvenanceRegistry.gitBytes(
      invocation,
    )
      .toString('utf8')
      .split('\n')) {
      if (record.length === 0) continue;
      const [ref = '', objectId = '', symref = ''] = record.split('\0');
      if (/^refs\/nook\/module-delivery\//u.test(ref)) continue;
      if (ref.length === 0 || objectId.length === 0)
        throw new Error('Repository ref fingerprint record is malformed.');
      fields.push(
        Buffer.from(ref, 'utf8'),
        Buffer.from(objectId, 'ascii'),
        Buffer.from(symref, 'utf8'),
      );
    }
    return ModuleIntegrationProvenanceRegistry.digestBuffers(fields);
  }

  private static captureRepositorySnapshot(
    request: RepositorySnapshotRequest,
  ): SourceRepositorySnapshot {
    const repositoryRoot = request.repositoryRoot;
    const headInvocation: ModuleGitInvocation = {
      cwd: repositoryRoot,
      args: ['rev-parse', '--verify', 'HEAD^{commit}'],
    };
    const branchInvocation: ModuleGitInvocation = {
      cwd: repositoryRoot,
      args: ['symbolic-ref', '--quiet', 'HEAD'],
      allowFailure: true,
    };
    const branch = ModuleRepositoryGit.runModuleDeliveryGit(
      ModuleIntegrationProvenanceRegistry.gitRequest(branchInvocation),
    );
    const indexPathInvocation: ModuleGitInvocation = {
      cwd: repositoryRoot,
      args: ['rev-parse', '--path-format=absolute', '--git-path', 'index'],
    };
    const configInvocation: ModuleGitInvocation = {
      cwd: repositoryRoot,
      args: ['config', '--local', '--null', '--list'],
    };
    const pathSet: RepositoryPathSet = {
      repositoryRoot,
      paths:
        ModuleIntegrationProvenanceRegistry.repositoryPaths(repositoryRoot),
      includeContent: request.includeContent,
    };
    const fingerprint =
      ModuleIntegrationProvenanceRegistry.repositoryFingerprint(pathSet);
    const indexPath = ModuleRepositoryGit.gitText(
      ModuleRepositoryGit.runModuleDeliveryGit(
        ModuleIntegrationProvenanceRegistry.gitRequest(indexPathInvocation),
      ),
    );
    return {
      headCommit: ModuleRepositoryGit.gitText(
        ModuleRepositoryGit.runModuleDeliveryGit(
          ModuleIntegrationProvenanceRegistry.gitRequest(headInvocation),
        ),
      ),
      symbolicHead:
        branch.exitCode === 0
          ? ModuleRepositoryGit.gitText(branch)
          : '(detached)',
      contentDigest: fingerprint.contentDigest,
      metadataDigest: fingerprint.metadataDigest,
      indexDigest: ModuleIntegrationProvenanceRegistry.digestBuffers([
        readFileSync(indexPath),
      ]),
      refsDigest:
        ModuleIntegrationProvenanceRegistry.relevantRefsDigest(repositoryRoot),
      configDigest: ModuleIntegrationProvenanceRegistry.digestBuffers([
        ModuleIntegrationProvenanceRegistry.gitBytes(configInvocation),
      ]),
    };
  }

  static captureSourceSnapshot(
    repositoryRoot: string,
  ): SourceRepositorySnapshot {
    const request: RepositorySnapshotRequest = {
      repositoryRoot,
      includeContent: true,
    };
    return ModuleIntegrationProvenanceRegistry.captureRepositorySnapshot(
      request,
    );
  }

  static assertSourceSnapshot(expectation: SourceSnapshotExpectation): void {
    const request: RepositorySnapshotRequest = {
      repositoryRoot: expectation.repositoryRoot,
      includeContent: false,
    };
    const current =
      ModuleIntegrationProvenanceRegistry.captureRepositorySnapshot(request);
    if (
      current.headCommit !== expectation.expected.headCommit ||
      current.symbolicHead !== expectation.expected.symbolicHead ||
      current.metadataDigest !== expectation.expected.metadataDigest ||
      current.indexDigest !== expectation.expected.indexDigest ||
      current.refsDigest !== expectation.expected.refsDigest ||
      current.configDigest !== expectation.expected.configDigest
    ) {
      throw new Error(
        'Source repository changed after integration preparation.',
      );
    }
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

type ModuleGitInvocation = {
  readonly cwd: string;
  readonly args: readonly string[];
  readonly allowFailure?: boolean;
};

type RepositoryPathSet = {
  readonly repositoryRoot: string;
  readonly paths: readonly string[];
  readonly includeContent: boolean;
};

type RepositoryFingerprint = {
  readonly contentDigest: string;
  readonly metadataDigest: string;
};

type EntryFingerprint = {
  readonly content: readonly Buffer[];
  readonly metadata: readonly Buffer[];
};

type SymlinkAncestorInspection = {
  readonly root: string;
  readonly absolutePath: string;
};

type EntryFingerprintRequest = {
  readonly repositoryRoot: string;
  readonly path: string;
  readonly includeContent: boolean;
};

type RepositorySnapshotRequest = {
  readonly repositoryRoot: string;
  readonly includeContent: boolean;
};
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

const BIGINT_STATS_OPTIONS = { bigint: true } as const;

const INTEGRATION_TASK_ID = 'module-delivery-integration';

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
