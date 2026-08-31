import { TeamKey } from '../team-agents/catalog.ts';
import { assertEvidenceBound } from '../module-delivery/authority.ts';
import { ModuleDeliveryOwner } from '../module-delivery/domain.ts';
import { ModuleDeliveryProviderSubmissionKind } from '../module-delivery/integration-provenance.ts';
import type {
  ModuleDeliveryAdmission,
  ModuleDeliveryAttemptLease,
  ModuleDeliveryGenerationFenceKind,
} from '../module-delivery/admission.ts';
import type {
  ModuleDeliveryAcceptedProviderEvidenceIdentity,
  ModuleDeliveryEvidenceClaimIdentity,
} from '../module-delivery/evidence.ts';
import type { ModuleDeliveryIntegratedWriterFrontierCapability } from '../module-delivery/integration.ts';
import type {
  ModuleDeliveryProviderSubmission,
  ModuleDeliveryReadOnlyEvidenceSubmission,
  ModuleDeliveryWriteProviderSubmission,
} from '../module-delivery/integration-provenance.ts';
import type { ModuleWorktreeHandle } from '../module-delivery/workspace.ts';

export const TEAM_PLAN_JOURNAL_VERSION = 2;

export enum TeamPlanEventKind {
  Started = 'started',
  Restarted = 'restarted',
  Selected = 'selected',
  Recorded = 'recorded',
  Finalized = 'finalized',
}

export enum TeamPlanRecordKind {
  Provider = 'provider',
  AcceptedWrite = 'accepted-write',
  AcceptedEvidence = 'accepted-evidence',
  FinalUnusable = 'final-unusable',
}

export enum TeamPlanRunPhase {
  Running = 'running',
  Finalized = 'finalized',
}

export type TeamPlanStartedEvent = Readonly<{
  version: typeof TEAM_PLAN_JOURNAL_VERSION;
  kind: TeamPlanEventKind.Started;
  sequence: 1;
  runId: string;
  planPath: string;
  planText: string;
  planSha256: string;
  modulePlanDigest: string;
  sourceCommit: string;
  repositoryRoot: string;
  workspaceRoot: string;
  generationRecordLimit: number;
}>;

export type TeamPlanRestartedEvent = Readonly<{
  version: typeof TEAM_PLAN_JOURNAL_VERSION;
  kind: TeamPlanEventKind.Restarted;
  sequence: number;
  planPath: string;
  planText: string;
  planSha256: string;
  modulePlanDigest: string;
  sourceCommit: string;
  generationRecordLimit: number;
}>;

export type TeamPlanSelectedEvent = Readonly<{
  version: typeof TEAM_PLAN_JOURNAL_VERSION;
  kind: TeamPlanEventKind.Selected;
  sequence: number;
  attempts: readonly TeamPlanAttemptIdentity[];
}>;

export type TeamPlanAttemptIdentity = Readonly<{
  taskId: string;
  attempt: number;
  generation: number;
  planDigest: string;
}>;

export type TeamPlanProviderRecord = Readonly<{
  kind: TeamPlanRecordKind.Provider;
  submission: ModuleDeliveryProviderSubmission;
}>;

export type TeamPlanFinalUnusableRecord = Readonly<{
  kind: TeamPlanRecordKind.FinalUnusable;
  taskId: string;
  attempt: number;
  generation: number;
  planDigest: string;
  conclusion:
    | ModuleDeliveryGenerationFenceKind.Cancelled
    | ModuleDeliveryGenerationFenceKind.Failed
    | ModuleDeliveryGenerationFenceKind.Rejected;
}>;

export type TeamPlanAcceptedWriteRecord = Readonly<{
  kind: TeamPlanRecordKind.AcceptedWrite;
  taskId: string;
  attempt: number;
  generation: number;
  planDigest: string;
  baselineCommit: string;
  commit: string;
  acceptedByTeam: ModuleDeliveryWriteProviderSubmission['acceptedByTeam'];
}>;

export type TeamPlanAcceptedEvidenceRecord = Readonly<{
  kind: TeamPlanRecordKind.AcceptedEvidence;
  taskId: string;
  attempt: number;
  generation: number;
  planDigest: string;
  artifactObject: string;
  artifactSha256: string;
}>;

export type TeamPlanRecord =
  TeamPlanProviderRecord | TeamPlanFinalUnusableRecord;

export type TeamPlanJournalRecord =
  | TeamPlanFinalUnusableRecord
  | TeamPlanAcceptedWriteRecord
  | TeamPlanAcceptedEvidenceRecord;

export type TeamPlanRecordedEvent = Readonly<{
  version: typeof TEAM_PLAN_JOURNAL_VERSION;
  kind: TeamPlanEventKind.Recorded;
  sequence: number;
  record: TeamPlanJournalRecord;
}>;

export type TeamPlanFinalizedEvent = Readonly<{
  version: typeof TEAM_PLAN_JOURNAL_VERSION;
  kind: TeamPlanEventKind.Finalized;
  sequence: number;
  headCommit: string;
}>;

export type TeamPlanEvent =
  | TeamPlanStartedEvent
  | TeamPlanRestartedEvent
  | TeamPlanSelectedEvent
  | TeamPlanRecordedEvent
  | TeamPlanFinalizedEvent;

export type TeamPlanStartRequest = Readonly<{
  planPath: string;
  journalPath: string;
  repositoryRoot: string;
}>;

export type TeamPlanJournalRequest = Readonly<{
  journalPath: string;
}>;

export type TeamPlanDiscardRequest = TeamPlanJournalRequest &
  Readonly<{ runId: string }>;
export type TeamPlanLeaseRequest = TeamPlanJournalRequest &
  Readonly<{ taskIds: readonly string[] }>;

export type TeamPlanRestartRequest = TeamPlanJournalRequest &
  Readonly<{ planPath: string }>;

export type TeamPlanRecordRequest = TeamPlanJournalRequest &
  Readonly<{
    record: TeamPlanRecord;
  }>;

export type TeamPlanSnapshot = Readonly<{
  runId: string;
  phase: TeamPlanRunPhase;
  generation: number;
  planDigest: string;
  planSha256: string;
  sourceCommit: string;
  headCommit: string;
  activeLeases: readonly ModuleDeliveryAttemptLease[];
  integratedWriterFrontiers: readonly ModuleDeliveryIntegratedWriterFrontierCapability[];
  acceptedProviderEvidence: readonly ModuleDeliveryAcceptedProviderEvidenceIdentity[];
}>;

export type TeamPlanSelectionReceipt = Readonly<{
  snapshot: TeamPlanSnapshot;
  admissions: readonly ModuleDeliveryAdmission[];
  pendingTaskIds: readonly string[];
  blockedTaskIds: readonly string[];
}>;

export type TeamPlanLeaseReceipt = Readonly<{
  snapshot: TeamPlanSnapshot;
  leases: readonly ModuleDeliveryAttemptLease[];
}>;

type TextFields = Readonly<{ values: readonly string[] }>;
type NumberFields = Readonly<{ values: readonly number[] }>;
type StrictRecordValue =
  | TeamPlanJournalRecord
  | TeamPlanRecord
  | ModuleDeliveryProviderSubmission
  | ModuleDeliveryWriteProviderSubmission['handoff']
  | ModuleWorktreeHandle
  | ModuleDeliveryEvidenceClaimIdentity
  | ModuleDeliveryAcceptedProviderEvidenceIdentity;
type KeyAssertion = readonly [StrictRecordValue, string];

export function assertTeamPlanRecord(record: TeamPlanRecord): void {
  if (!record || typeof record !== 'object') invalidRecord();
  if (
    record.kind === TeamPlanRecordKind.Provider &&
    record.submission?.kind ===
      ModuleDeliveryProviderSubmissionKind.ReadOnlyEvidence &&
    Array.isArray(record.submission.acceptedProviderEvidence)
  )
    assertEvidenceBound(record.submission.acceptedProviderEvidence);
  JSON.stringify(record);
  if (record.kind === TeamPlanRecordKind.Provider) {
    if (!record.submission) invalidRecord();
    assertKeys([record, 'kind|submission']);
    assertProviderSubmission(record.submission);
    return;
  }
  if (record.kind !== TeamPlanRecordKind.FinalUnusable) invalidRecord();
  assertTeamPlanJournalRecord(record);
}

export function assertTeamPlanJournalRecord(
  record: TeamPlanJournalRecord,
): void {
  if (!record || typeof record !== 'object') invalidRecord();
  JSON.stringify(record);
  if (record.kind === TeamPlanRecordKind.AcceptedWrite) {
    assertKeys([
      record,
      'kind|taskId|attempt|generation|planDigest|baselineCommit|commit|acceptedByTeam',
    ]);
    assertTextFields({
      values: [
        record.taskId,
        record.planDigest,
        record.baselineCommit,
        record.commit,
        record.acceptedByTeam,
      ],
    });
    assertNumberFields({ values: [record.attempt, record.generation] });
    assertOwner(record.acceptedByTeam);
    return;
  }
  if (record.kind === TeamPlanRecordKind.AcceptedEvidence) {
    assertKeys([
      record,
      'kind|taskId|attempt|generation|planDigest|artifactObject|artifactSha256',
    ]);
    assertTextFields({
      values: [
        record.taskId,
        record.planDigest,
        record.artifactObject,
        record.artifactSha256,
      ],
    });
    assertNumberFields({ values: [record.attempt, record.generation] });
    return;
  }
  if (record.kind === TeamPlanRecordKind.FinalUnusable) {
    assertKeys([
      record,
      'kind|taskId|attempt|generation|planDigest|conclusion',
    ]);
    assertTextFields({
      values: [record.taskId, record.planDigest, record.conclusion],
    });
    assertNumberFields({ values: [record.attempt, record.generation] });
    if (!['cancelled', 'failed', 'rejected'].includes(record.conclusion))
      invalidRecord();
    return;
  }
  invalidRecord();
}

export function assertTeamPlanAcceptedEvidenceReceipt(
  receipt: ModuleDeliveryAcceptedProviderEvidenceIdentity,
): void {
  assertEvidenceIdentity(receipt);
}

function assertProviderSubmission(
  submission: ModuleDeliveryProviderSubmission,
): void {
  if (!submission || typeof submission !== 'object') invalidRecord();
  if (submission.kind === 'write') {
    assertKeys([submission, 'kind|generation|acceptedByTeam|verdict|handoff']);
    assertNumberFields({ values: [submission.generation] });
    assertTextFields({
      values: [submission.acceptedByTeam, submission.verdict],
    });
    assertOwner(submission.acceptedByTeam);
    assertWriteHandoff(submission.handoff);
    return;
  }
  assertReadOnlySubmission(submission);
}

function assertWriteHandoff(
  handoff: ModuleDeliveryWriteProviderSubmission['handoff'],
): void {
  if (!handoff || typeof handoff !== 'object') invalidRecord();
  assertKeys([
    handoff,
    'taskId|attempt|planDigest|baselineCommit|commit|workspace',
  ]);
  assertTextFields({
    values: [
      handoff.taskId,
      handoff.planDigest,
      handoff.baselineCommit,
      handoff.commit,
    ],
  });
  assertNumberFields({ values: [handoff.attempt] });
  assertWorkspace(handoff.workspace);
}

function assertWorkspace(workspace: ModuleWorktreeHandle): void {
  if (!workspace || typeof workspace !== 'object') invalidRecord();
  assertKeys([
    workspace,
    'sourceRepositoryRoot|ownedWorkspaceRoot|worktreePath|worktreeAdminDirectory|gitCommonDirectory|worktreeId|planDigest|taskId|attempt|baselineCommit',
  ]);
  const { attempt, ...text } = workspace;
  assertNumberFields({ values: [attempt] });
  assertTextFields({ values: Object.values(text) });
}

function assertReadOnlySubmission(
  submission: ModuleDeliveryReadOnlyEvidenceSubmission,
): void {
  if (submission.kind !== 'read-only-evidence') invalidRecord();
  assertKeys([
    submission,
    'kind|schemaVersion|taskId|attempt|generation|planDigest|sourceCommit|producerTeam|functionalOwner|acceptanceOwner|acceptanceRequirements|claimIdentities|acceptedProviderEvidence|artifactIdentity|artifactDigest|verdict|evidence',
  ]);
  assertNumberFields({
    values: [
      submission.schemaVersion,
      submission.attempt,
      submission.generation,
    ],
  });
  assertTextFields({
    values: [
      submission.kind,
      submission.taskId,
      submission.planDigest,
      submission.sourceCommit,
      submission.producerTeam,
      submission.functionalOwner,
      submission.acceptanceOwner,
      submission.artifactIdentity,
      submission.artifactDigest,
      submission.verdict,
    ],
  });
  assertTextFields({ values: submission.acceptanceRequirements });
  assertTextFields({ values: submission.evidence });
  assertTeam(submission.producerTeam);
  assertOwner(submission.functionalOwner);
  assertOwner(submission.acceptanceOwner);
  if (
    !Array.isArray(submission.claimIdentities) ||
    !Array.isArray(submission.acceptedProviderEvidence)
  )
    invalidRecord();
  for (const claim of submission.claimIdentities) assertClaim(claim);
  for (const identity of submission.acceptedProviderEvidence)
    assertEvidenceIdentity(identity);
}

function assertClaim(claim: ModuleDeliveryEvidenceClaimIdentity): void {
  if (!claim || typeof claim !== 'object') invalidRecord();
  assertKeys([claim, 'claim|contentDigest']);
  assertTextFields({ values: [claim.claim, claim.contentDigest] });
}

function assertEvidenceIdentity(
  identity: ModuleDeliveryAcceptedProviderEvidenceIdentity,
): void {
  if (!identity || typeof identity !== 'object') invalidRecord();
  assertKeys([
    identity,
    'schemaVersion|generation|planDigest|taskId|attempt|producerTeam|functionalOwner|acceptanceOwner|sourceCommit|verifiedHeadCommit|artifactIdentity|artifactDigest|sourceProvenanceDigest|verdict|claimIdentities|acceptanceRequirements|acceptedProviderEvidence',
  ]);
  assertNumberFields({
    values: [identity.schemaVersion, identity.generation, identity.attempt],
  });
  const {
    schemaVersion,
    generation,
    attempt,
    claimIdentities,
    acceptanceRequirements,
    acceptedProviderEvidence,
    ...text
  } = identity;
  assertTextFields({ values: Object.values(text) });
  assertTextFields({ values: acceptanceRequirements });
  assertTeam(identity.producerTeam);
  assertOwner(identity.functionalOwner);
  assertOwner(identity.acceptanceOwner);
  if (
    !Array.isArray(claimIdentities) ||
    !Array.isArray(acceptedProviderEvidence)
  )
    invalidRecord();
  for (const claim of claimIdentities) assertClaim(claim);
  for (const nested of acceptedProviderEvidence) assertEvidenceIdentity(nested);
}

function assertKeys([actual, expected]: KeyAssertion): void {
  if (
    JSON.stringify(Object.keys(actual).sort()) !==
    JSON.stringify(expected.split('|').sort())
  )
    invalidRecord();
}

function assertTextFields(request: TextFields): void {
  if (
    !Array.isArray(request.values) ||
    request.values.some((value) => typeof value !== 'string')
  )
    invalidRecord();
}

function assertNumberFields(request: NumberFields): void {
  if (request.values.some((value) => !Number.isSafeInteger(value) || value < 1))
    invalidRecord();
}

function assertOwner(owner: string): void {
  if (owner !== ModuleDeliveryOwner.GizmoPrime) assertTeam(owner);
}

function assertTeam(team: string): void {
  if (!Object.values(TeamKey).includes(team as TeamKey)) invalidRecord();
}

function invalidRecord(): never {
  throw new Error('Team Plan record fields are invalid.');
}
