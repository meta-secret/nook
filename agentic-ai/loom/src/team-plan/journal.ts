import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

import { LoomFailureCode, loomFailureFromCause } from '../loom-failure.ts';

import {
  ModuleDeliveryValidationStatus,
  decodeAndValidateModuleDeliveryPlan,
} from '../module-delivery/index.ts';
import {
  TEAM_PLAN_JOURNAL_VERSION,
  TeamPlanEventKind,
  TeamPlanRecordKind,
  assertTeamPlanJournalRecord,
} from './domain.ts';
import { runWithTeamPlanJournalLock } from './journal-lock.ts';
import {
  assertMatchingDiscardTombstone,
  canonicalExistingJournalPath,
  canonicalTeamPlanJournalPath,
  pathExists,
  publishDiscardTombstone,
  publishNewJournalFile,
  readBoundedTeamPlanJournal,
  removeDiscardCompletion,
  removeDiscardTombstone,
  replaceJournalFile,
  resumeDiscardTombstone,
  storageHook,
  syncTeamPlanJournalParent,
} from './journal-storage.ts';

export { canonicalTeamPlanJournalPath } from './journal-storage.ts';

import type { TeamPlanEvent, TeamPlanStartedEvent } from './domain.ts';
import type {
  ModuleDeliveryExecutionPrecedence,
  ModuleDeliveryPlanV2,
} from '../module-delivery/index.ts';

export const MAX_TEAM_PLAN_JOURNAL_BYTES = 5_242_880;
const MAX_TEAM_PLAN_PLAN_TEXT_BYTES = 262_144;
const MAX_TEAM_PLAN_PATH_BYTES = 4_096;
const MAX_PLAN_TEXT_JSON_EXPANSION = 2;
const MAX_PATH_JSON_EXPANSION = 6;
const MAX_PLAN_EVENT_FIXED_BYTES = 4_096;
const MAX_TEAM_PLAN_PLAN_EVENT_BYTES =
  MAX_TEAM_PLAN_PLAN_TEXT_BYTES * MAX_PLAN_TEXT_JSON_EXPANSION +
  MAX_TEAM_PLAN_PATH_BYTES * 3 * MAX_PATH_JSON_EXPANSION +
  MAX_PLAN_EVENT_FIXED_BYTES;
const MAX_TEAM_PLAN_RECORD_EVENT_BYTES = 768;
const MAX_TEAM_PLAN_SELECTION_BASE_BYTES = 192;
const MAX_TEAM_PLAN_ATTEMPT_IDENTITY_BYTES = 256;
const MAX_TEAM_PLAN_FINAL_EVENT_BYTES = 256;
const MAX_TEAM_PLAN_GENERATIONS = 5;
const MAX_TEAM_PLAN_RECORDS_PER_GENERATION = 320;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const TASK_ID = /^[a-z][a-z0-9_-]{0,63}$/u;

const TEAM_PLAN_COMMON_FIELDS = 'version|kind|sequence';
const TEAM_PLAN_STARTED_FIELDS = `${TEAM_PLAN_COMMON_FIELDS}|runId|planPath|planText|planSha256|modulePlanDigest|sourceCommit|repositoryRoot|workspaceRoot|generationRecordLimit`;
const TEAM_PLAN_RESTARTED_FIELDS = `${TEAM_PLAN_COMMON_FIELDS}|planPath|planText|planSha256|modulePlanDigest|sourceCommit|generationRecordLimit`;
const TEAM_PLAN_SELECTED_FIELDS = `${TEAM_PLAN_COMMON_FIELDS}|attempts`;
const TEAM_PLAN_RECORDED_FIELDS = `${TEAM_PLAN_COMMON_FIELDS}|record`;
const TEAM_PLAN_FINALIZED_FIELDS = `${TEAM_PLAN_COMMON_FIELDS}|headCommit`;

export type TeamPlanJournal = Readonly<{
  path: string;
  started: TeamPlanStartedEvent;
  events: readonly TeamPlanEvent[];
  byteLength: number;
  generationRecordLimit: number;
  selectedLeaseCount: number;
  recordedCount: number;
  generationCount: number;
  finalized: boolean;
}>;

export type CreateTeamPlanJournalRequest = Readonly<{
  journalPath: string;
  event: TeamPlanStartedEvent;
  beforePublicationCleanup?: () => void;
}>;

export type AppendTeamPlanEventRequest = Readonly<{
  journalPath: string;
  event: TeamPlanEvent;
  beforeTemporarySync?: () => void;
  afterTemporaryCleanupSync?: () => void;
  beforeParentSync?: () => void;
}>;

export type TeamPlanJournalLockRequest<T> = Readonly<{
  journalPath: string;
  action: (journal: TeamPlanJournal) => Promise<T>;
}>;

type ExactFieldRequest = Readonly<{
  event: TeamPlanEvent;
  fields: readonly string[];
}>;

type TeamPlanGenerationCapacityRequest = Readonly<{
  journalBytes: number;
  planEventBytes: number;
  generationRecordLimit: number;
  generationCount: number;
}>;

export async function createTeamPlanJournal(
  request: CreateTeamPlanJournalRequest,
): Promise<void> {
  const path = await canonicalTeamPlanJournalPath(request.journalPath);
  const serialized = serializeTeamPlanEvent(request.event);
  const journal = decodeTeamPlanJournal({ serialized, path });
  await runWithTeamPlanJournalLock({
    journal,
    identityPath: path,
    action: async () => {
      if (await pathExists(`${path}.discarding`))
        throw new Error('Team Plan journal discard is still in progress.');
      if (await pathExists(`${path}.discarded`)) {
        const completed = await loadTeamPlanJournal(`${path}.discarded`);
        if (!completed.finalized)
          throw new Error('Team Plan discard completion marker is stale.');
        await removeDiscardCompletion(`${path}.discarded`);
      }
      await publishNewJournalFile({
        path,
        serialized,
        beforePublicationCleanup: storageHook(request.beforePublicationCleanup),
      });
    },
  });
}

export async function recoverTeamPlanStartRunId(
  journalPath: string,
): Promise<string | false> {
  const path = await canonicalTeamPlanJournalPath(journalPath);
  const publication = `${path}.publishing`;
  const published = await pathExists(path);
  const publishing = await pathExists(publication);
  if (!published && !publishing) return false;
  const activePath = published ? path : publication;
  const journalFile = await readBoundedTeamPlanJournal({
    path: activePath,
    maximumBytes: MAX_TEAM_PLAN_JOURNAL_BYTES,
    expectedLinkCount: published && publishing ? 2 : 1,
  });
  const journal = decodeTeamPlanJournal({
    serialized: journalFile.serialized,
    path,
  });
  if (journal.events.length !== 1)
    throw new Error('Team Plan start retry is no longer available.');
  return journal.started.runId;
}

export async function loadTeamPlanJournal(
  journalPath: string,
): Promise<TeamPlanJournal> {
  const path = await canonicalExistingJournalPath(journalPath);
  const journalFile = await readBoundedTeamPlanJournal({
    path,
    maximumBytes: MAX_TEAM_PLAN_JOURNAL_BYTES,
    expectedLinkCount: 1,
  });
  return decodeTeamPlanJournal({ serialized: journalFile.serialized, path });
}

export async function appendTeamPlanEvent(
  request: AppendTeamPlanEventRequest,
): Promise<void> {
  let path: string;
  let current: Awaited<ReturnType<typeof readBoundedTeamPlanJournal>>;
  try {
    path = await canonicalExistingJournalPath(request.journalPath);
    current = await readBoundedTeamPlanJournal({
      path,
      maximumBytes: MAX_TEAM_PLAN_JOURNAL_BYTES,
      expectedLinkCount: 1,
    });
  } catch (cause) {
    throw loomFailureFromCause({
      code: LoomFailureCode.TeamPlanStorageFailed,
      cause: cause instanceof Error ? cause : new Error('Journal read failed.'),
    });
  }
  const candidate = `${current.serialized}${serializeTeamPlanEvent(request.event)}`;
  decodeTeamPlanJournal({ serialized: candidate, path });
  try {
    await replaceJournalFile({
      path,
      serialized: candidate,
      mode: current.mode,
      beforeTemporarySync: storageHook(request.beforeTemporarySync),
      afterTemporaryCleanupSync: storageHook(request.afterTemporaryCleanupSync),
      beforeParentSync: storageHook(request.beforeParentSync),
    });
  } catch (cause) {
    throw loomFailureFromCause({
      code: LoomFailureCode.TeamPlanStorageFailed,
      cause:
        cause instanceof Error ? cause : new Error('Journal append failed.'),
    });
  }
}

export async function withTeamPlanJournalLock<T>(
  request: TeamPlanJournalLockRequest<T>,
): Promise<T> {
  return withTeamPlanJournalLockIdentity(request);
}

async function withTeamPlanJournalLockIdentity<T>(
  request: TeamPlanJournalLockRequest<T> &
    Readonly<{ lockIdentityPath?: string }>,
): Promise<T> {
  const journal = await loadTeamPlanJournal(request.journalPath);
  return runWithTeamPlanJournalLock({
    journal,
    identityPath: request.lockIdentityPath ?? journal.path,
    action: async () => {
      const lockedJournal = await loadTeamPlanJournal(request.journalPath);
      if (
        lockedJournal.path !== journal.path ||
        lockedJournal.started.runId !== journal.started.runId ||
        lockedJournal.started.repositoryRoot !== journal.started.repositoryRoot
      )
        throw new Error(
          'Team Plan journal identity changed while acquiring its lock.',
        );
      return request.action(lockedJournal);
    },
  });
}

export async function discardTeamPlanJournal(
  request: Readonly<{
    journalPath: string;
    expectedRunId: string;
    discardArtifacts: (state: {
      readonly journal: TeamPlanJournal;
      readonly artifactsMayAlreadyBeDiscarded: boolean;
    }) => Promise<void>;
    beforeParentSync?: () => void;
  }>,
): Promise<void> {
  const path = await canonicalTeamPlanJournalPath(request.journalPath);
  const tombstone = `${path}.discarding`;
  const completion = `${path}.discarded`;
  const sourcePresent = await pathExists(path);
  const tombstonePresent = await pathExists(tombstone);
  if (!sourcePresent && !tombstonePresent && (await pathExists(completion))) {
    const completed = await loadTeamPlanJournal(completion);
    if (
      !completed.finalized ||
      completed.started.runId !== request.expectedRunId
    )
      throw new Error('Team Plan discard completion marker is stale.');
    await syncTeamPlanJournalParent({
      path: completion,
      beforeParentSync: storageHook(request.beforeParentSync),
    });
    return;
  }
  const artifactsMayAlreadyBeDiscarded = !sourcePresent;
  const activePath = sourcePresent && !tombstonePresent ? path : tombstone;
  let lockJournal: TeamPlanJournal;
  if (sourcePresent && tombstonePresent) {
    await assertMatchingDiscardTombstone({ path, tombstone });
    const journalFile = await readBoundedTeamPlanJournal({
      path: tombstone,
      maximumBytes: MAX_TEAM_PLAN_JOURNAL_BYTES,
      expectedLinkCount: 2,
    });
    lockJournal = {
      ...decodeTeamPlanJournal({ serialized: journalFile.serialized, path }),
      path,
    };
  } else {
    const loaded = await loadTeamPlanJournal(activePath);
    lockJournal = { ...loaded, path };
  }
  await runWithTeamPlanJournalLock({
    journal: lockJournal,
    identityPath: path,
    action: async () => {
      if (!lockJournal.finalized)
        throw new Error('Only a finalized Team Plan run may be discarded.');
      if (lockJournal.started.runId !== request.expectedRunId)
        throw new Error('Team Plan discard run identity is stale.');
      if ((await pathExists(path)) && (await pathExists(tombstone)))
        await resumeDiscardTombstone({ path, tombstone });
      const loaded = await loadTeamPlanJournal(activePath);
      const journal = { ...loaded, path };
      if (journal.started.runId !== request.expectedRunId)
        throw new Error('Team Plan discard run identity is stale.');
      if (!journal.finalized) throw new Error('Team Plan is not finalized.');
      if (activePath === path)
        await publishDiscardTombstone({
          path,
          tombstone,
          beforeParentSync: storageHook(request.beforeParentSync),
        });
      await request.discardArtifacts({
        journal,
        artifactsMayAlreadyBeDiscarded,
      });
      await removeDiscardTombstone({
        path: tombstone,
        completion,
        beforeParentSync: storageHook(request.beforeParentSync),
      });
    },
  });
}

export function assertTeamPlanGenerationCapacity(
  request: TeamPlanGenerationCapacityRequest,
): void {
  if (
    !Number.isSafeInteger(request.generationRecordLimit) ||
    request.generationRecordLimit < 1
  )
    throw new Error('Team Plan generation record capacity is invalid.');
  if (
    !Number.isSafeInteger(request.generationCount) ||
    request.generationCount < 1 ||
    request.generationCount > MAX_TEAM_PLAN_GENERATIONS
  )
    throw new Error('Team Plan generation limit is exhausted.');
  const remainingGenerationCount =
    MAX_TEAM_PLAN_GENERATIONS - request.generationCount;
  if (
    request.journalBytes +
      request.planEventBytes +
      generationMutationBudget(request.generationRecordLimit) +
      remainingGenerationCount * maximumGenerationBudget() +
      MAX_TEAM_PLAN_FINAL_EVENT_BYTES >
    MAX_TEAM_PLAN_JOURNAL_BYTES
  )
    throw new Error('Team Plan generation cannot fit its durable journal.');
}

export function teamPlanEventBytes(event: TeamPlanEvent): number {
  return Buffer.byteLength(serializeTeamPlanEvent(event));
}

export function teamPlanSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function decodeTeamPlanJournal(request: {
  readonly serialized: string;
  readonly path: string;
}): TeamPlanJournal {
  const { serialized, path } = request;
  const bytes = Buffer.byteLength(serialized);
  if (bytes > MAX_TEAM_PLAN_JOURNAL_BYTES || !serialized.endsWith('\n'))
    throw new Error('Team Plan journal is oversized or noncanonical.');
  const lines = serialized.slice(0, -1).split('\n');
  if (lines.length === 0 || lines.some((line) => line.length === 0))
    throw new Error('Team Plan journal is empty or noncanonical.');
  const events: TeamPlanEvent[] = [];
  for (const line of lines)
    events.push(
      decodeTeamPlanEvent({ line, expectedSequence: events.length + 1 }),
    );
  const started = events[0];
  if (!started || started.kind !== TeamPlanEventKind.Started)
    throw new Error('Team Plan journal must begin with one start event.');
  const counters = journalGenerationCounters(events);
  if (!counters.finalized)
    assertRemainingJournalCapacity({ journalBytes: bytes, ...counters });
  return {
    path,
    started,
    events: Object.freeze(events),
    byteLength: bytes,
    ...counters,
  };
}

type DecodeTeamPlanEventRequest = Readonly<{
  line: string;
  expectedSequence: number;
}>;

function decodeTeamPlanEvent(
  request: DecodeTeamPlanEventRequest,
): TeamPlanEvent {
  const event = JSON.parse(request.line) as TeamPlanEvent;
  if (
    !event ||
    event.version !== TEAM_PLAN_JOURNAL_VERSION ||
    event.sequence !== request.expectedSequence ||
    !Object.values(TeamPlanEventKind).includes(event.kind)
  )
    throw new Error('Team Plan journal event identity is invalid.');
  const fields = fieldsFor(event.kind);
  const exactFieldRequest: ExactFieldRequest = { event, fields };
  assertExactFields(exactFieldRequest);
  assertEventSize({ event, serialized: `${request.line}\n` });
  if (event.kind === TeamPlanEventKind.Recorded)
    assertTeamPlanJournalRecord(event.record);
  if (
    (event.kind === TeamPlanEventKind.Started ||
      event.kind === TeamPlanEventKind.Restarted) &&
    (!Number.isSafeInteger(event.generationRecordLimit) ||
      event.generationRecordLimit < 1)
  )
    throw new Error('Team Plan generation record capacity is invalid.');
  if (
    event.kind === TeamPlanEventKind.Selected &&
    (!Array.isArray(event.attempts) || event.attempts.length === 0)
  )
    throw new Error('Team Plan selected leases are invalid.');
  assertStrictEventIdentity(event);
  return event;
}

function assertStrictEventIdentity(event: TeamPlanEvent): void {
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 1)
    throw new Error('Team Plan journal sequence is invalid.');
  if (
    event.kind === TeamPlanEventKind.Started ||
    event.kind === TeamPlanEventKind.Restarted
  ) {
    if (
      !isAbsolute(event.planPath) ||
      (event.kind === TeamPlanEventKind.Started && !SHA256.test(event.runId)) ||
      teamPlanSha256(event.planText) !== event.planSha256 ||
      !SHA256.test(event.planSha256) ||
      !SHA256.test(event.modulePlanDigest) ||
      !COMMIT.test(event.sourceCommit) ||
      (event.kind === TeamPlanEventKind.Started &&
        (!isAbsolute(event.repositoryRoot) || !isAbsolute(event.workspaceRoot)))
    )
      throw new Error('Team Plan reviewed plan event identity is invalid.');
    const validation = decodeAndValidateModuleDeliveryPlan(event.planText);
    if (
      validation.status !== ModuleDeliveryValidationStatus.Accepted ||
      validation.planDigest !== event.modulePlanDigest ||
      validation.plan.sourceCommit !== event.sourceCommit ||
      validation.plan.nodes.length * validation.plan.maxAttempts !==
        event.generationRecordLimit ||
      event.generationRecordLimit > MAX_TEAM_PLAN_RECORDS_PER_GENERATION
    )
      throw new Error('Team Plan generation record capacity is unproven.');
  } else if (event.kind === TeamPlanEventKind.Selected) {
    const keys = new Set<string>();
    for (const attempt of event.attempts) {
      if (
        JSON.stringify(Object.keys(attempt).sort()) !==
        JSON.stringify(['attempt', 'generation', 'planDigest', 'taskId'])
      )
        throw new Error('Team Plan attempt identity fields are invalid.');
      assertAttemptIdentity(attempt);
      if (keys.has(attempt.taskId))
        throw new Error('Team Plan selection repeats a logical task.');
      keys.add(attempt.taskId);
    }
  } else if (event.kind === TeamPlanEventKind.Recorded) {
    assertAttemptIdentity(event.record);
    if (
      event.record.kind === TeamPlanRecordKind.AcceptedWrite &&
      (!COMMIT.test(event.record.baselineCommit) ||
        !COMMIT.test(event.record.commit))
    )
      throw new Error('Team Plan accepted write identity is invalid.');
    if (
      event.record.kind === TeamPlanRecordKind.AcceptedEvidence &&
      !COMMIT.test(event.record.artifactObject)
    )
      throw new Error('Team Plan accepted evidence identity is invalid.');
  } else if (!COMMIT.test(event.headCommit)) {
    throw new Error('Team Plan final frontier is invalid.');
  }
}

function assertAttemptIdentity(identity: {
  readonly taskId: string;
  readonly attempt: number;
  readonly generation: number;
  readonly planDigest: string;
}): void {
  if (
    !identity ||
    typeof identity !== 'object' ||
    !TASK_ID.test(identity.taskId) ||
    !Number.isSafeInteger(identity.attempt) ||
    identity.attempt < 1 ||
    !Number.isSafeInteger(identity.generation) ||
    identity.generation < 1 ||
    !SHA256.test(identity.planDigest)
  )
    throw new Error('Team Plan attempt identity is invalid.');
}

function attemptKey(identity: {
  readonly taskId: string;
  readonly attempt: number;
}): string {
  return `${identity.taskId}:${identity.attempt}`;
}

function fieldsFor(kind: TeamPlanEventKind): readonly string[] {
  if (kind === TeamPlanEventKind.Started)
    return TEAM_PLAN_STARTED_FIELDS.split('|');
  if (kind === TeamPlanEventKind.Restarted)
    return TEAM_PLAN_RESTARTED_FIELDS.split('|');
  if (kind === TeamPlanEventKind.Selected)
    return TEAM_PLAN_SELECTED_FIELDS.split('|');
  if (kind === TeamPlanEventKind.Recorded)
    return TEAM_PLAN_RECORDED_FIELDS.split('|');
  if (kind === TeamPlanEventKind.Finalized)
    return TEAM_PLAN_FINALIZED_FIELDS.split('|');
  return TEAM_PLAN_COMMON_FIELDS.split('|');
}

function assertExactFields(request: ExactFieldRequest): void {
  const actual = Object.keys(request.event).sort();
  const expected = [...request.fields].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error('Team Plan journal event fields are invalid.');
}

function serializeTeamPlanEvent(event: TeamPlanEvent): string {
  return `${JSON.stringify(event)}\n`;
}

function assertEventSize(request: {
  readonly event: TeamPlanEvent;
  readonly serialized: string;
}): void {
  const { event, serialized } = request;
  if (
    event.kind === TeamPlanEventKind.Started ||
    event.kind === TeamPlanEventKind.Restarted
  ) {
    assertPlanEventSize({ event, serialized });
    return;
  }
  const bytes = Buffer.byteLength(serialized);
  if (
    event.kind === TeamPlanEventKind.Selected &&
    bytes >
      MAX_TEAM_PLAN_SELECTION_BASE_BYTES +
        event.attempts.length * MAX_TEAM_PLAN_ATTEMPT_IDENTITY_BYTES
  )
    throw new Error('Team Plan selection event is oversized.');
  if (
    event.kind === TeamPlanEventKind.Recorded &&
    bytes > MAX_TEAM_PLAN_RECORD_EVENT_BYTES
  )
    throw new Error('Team Plan record event is oversized.');
  if (
    event.kind === TeamPlanEventKind.Finalized &&
    bytes > MAX_TEAM_PLAN_FINAL_EVENT_BYTES
  )
    throw new Error('Team Plan final event is oversized.');
}

function assertPlanEventSize(request: {
  readonly event: Extract<
    TeamPlanEvent,
    { kind: TeamPlanEventKind.Started | TeamPlanEventKind.Restarted }
  >;
  readonly serialized: string;
}): void {
  const paths =
    request.event.kind === TeamPlanEventKind.Started
      ? [
          request.event.planPath,
          request.event.repositoryRoot,
          request.event.workspaceRoot,
        ]
      : [request.event.planPath];
  if (
    Buffer.byteLength(request.event.planText) > MAX_TEAM_PLAN_PLAN_TEXT_BYTES ||
    paths.some((path) => Buffer.byteLength(path) > MAX_TEAM_PLAN_PATH_BYTES) ||
    Buffer.byteLength(request.serialized) > MAX_TEAM_PLAN_PLAN_EVENT_BYTES
  )
    throw new Error('Team Plan reviewed plan event is oversized.');
}

type GenerationCounters = Readonly<{
  generationRecordLimit: number;
  selectedLeaseCount: number;
  recordedCount: number;
  generationCount: number;
  finalized: boolean;
}>;

function journalGenerationCounters(
  events: readonly TeamPlanEvent[],
): GenerationCounters {
  let generationRecordLimit = 0;
  let selectedLeaseCount = 0;
  let recordedCount = 0;
  let generationCount = 0;
  let finalized = false;
  let currentGeneration = 0;
  let currentPlanDigest = '';
  let currentPlan: ModuleDeliveryPlanV2 | false = false;
  let executionPrecedence: readonly ModuleDeliveryExecutionPrecedence[] = [];
  const activeAttempts = new Map<string, string>();
  const latestAttempts = new Map<string, number>();
  const acceptedTasks = new Set<string>();
  const failedAttempts = new Map<string, number>();
  for (const event of events) {
    if (finalized) throw new Error('Team Plan has trailing events.');
    if (
      event.kind === TeamPlanEventKind.Started ||
      event.kind === TeamPlanEventKind.Restarted
    ) {
      const validation = decodeAndValidateModuleDeliveryPlan(event.planText);
      if (validation.status !== ModuleDeliveryValidationStatus.Accepted)
        throw new Error('Team Plan reviewed plan event is invalid.');
      if (
        event.kind === TeamPlanEventKind.Started
          ? generationCount !== 0
          : generationCount === 0 ||
            activeAttempts.size > 0 ||
            validation.plan.generation <= currentGeneration
      )
        throw new Error('Team Plan journal lifecycle is invalid.');
      generationRecordLimit = event.generationRecordLimit;
      generationCount += 1;
      currentGeneration = validation.plan.generation;
      currentPlanDigest = event.modulePlanDigest;
      currentPlan = validation.plan;
      executionPrecedence = validation.executionPrecedence;
      selectedLeaseCount = 0;
      recordedCount = 0;
      const planIds = new Set(validation.plan.nodes.map((node) => node.taskId));
      if (
        [...latestAttempts].some(
          ([taskId, attempt]) =>
            planIds.has(taskId) && attempt > validation.plan.maxAttempts,
        )
      )
        throw new Error(
          'Team Plan replacement attempt limit is below carried history.',
        );
      acceptedTasks.clear();
      failedAttempts.clear();
    } else if (event.kind === TeamPlanEventKind.Selected) {
      for (const attempt of event.attempts) {
        if (!currentPlan)
          throw new Error('Team Plan selection has no active plan.');
        const previousAttempt = latestAttempts.get(attempt.taskId) ?? 0;
        if (
          attempt.generation !== currentGeneration ||
          attempt.planDigest !== currentPlanDigest ||
          !currentPlan.nodes.some(({ taskId }) => taskId === attempt.taskId) ||
          attempt.attempt !== previousAttempt + 1 ||
          attempt.attempt > currentPlan.maxAttempts ||
          activeAttempts.has(attempt.taskId) ||
          acceptedTasks.has(attempt.taskId) ||
          (failedAttempts.get(attempt.taskId) ?? 0) >= currentPlan.maxAttempts
        )
          throw new Error('Team Plan selected attempt is stale or duplicated.');
        activeAttempts.set(attempt.taskId, attemptKey(attempt));
        latestAttempts.set(attempt.taskId, attempt.attempt);
      }
      selectedLeaseCount += event.attempts.length;
    } else if (event.kind === TeamPlanEventKind.Recorded) {
      const key = attemptKey(event.record);
      if (
        event.record.generation !== currentGeneration ||
        event.record.planDigest !== currentPlanDigest ||
        activeAttempts.get(event.record.taskId) !== key
      )
        throw new Error('Team Plan recorded attempt was not active.');
      activeAttempts.delete(event.record.taskId);
      if (
        event.record.kind === TeamPlanRecordKind.AcceptedWrite ||
        event.record.kind === TeamPlanRecordKind.AcceptedEvidence
      )
        acceptedTasks.add(event.record.taskId);
      else failedAttempts.set(event.record.taskId, event.record.attempt);
      recordedCount += 1;
    } else {
      if (activeAttempts.size > 0)
        throw new Error('Team Plan finalization has outstanding attempts.');
      if (!currentPlan)
        throw new Error('Team Plan finalization has no active plan.');
      assertTerminalPlan({
        currentPlan,
        executionPrecedence,
        acceptedTasks,
        failedAttempts,
      });
      finalized = true;
    }
  }
  if (
    generationRecordLimit < 1 ||
    selectedLeaseCount > generationRecordLimit ||
    recordedCount > selectedLeaseCount
  )
    throw new Error('Team Plan journal exceeds its generation event budget.');
  if (generationCount > MAX_TEAM_PLAN_GENERATIONS)
    throw new Error('Team Plan generation limit is exhausted.');
  return {
    generationRecordLimit,
    selectedLeaseCount,
    recordedCount,
    generationCount,
    finalized,
  };
}

function assertTerminalPlan(
  request: Readonly<{
    currentPlan: ModuleDeliveryPlanV2;
    executionPrecedence: readonly ModuleDeliveryExecutionPrecedence[];
    acceptedTasks: ReadonlySet<string>;
    failedAttempts: ReadonlyMap<string, number>;
  }>,
): void {
  const failures = new Set(
    [...request.failedAttempts]
      .filter(([, attempt]) => attempt >= request.currentPlan.maxAttempts)
      .map(([taskId]) => taskId),
  );
  const terminal = new Set([...request.acceptedTasks, ...failures]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of request.currentPlan.nodes) {
      if (
        !terminal.has(node.taskId) &&
        request.executionPrecedence.some(
          ({ predecessorTaskId, successorTaskId }) =>
            successorTaskId === node.taskId && failures.has(predecessorTaskId),
        )
      ) {
        terminal.add(node.taskId);
        failures.add(node.taskId);
        changed = true;
      }
    }
  }
  if (request.currentPlan.nodes.some(({ taskId }) => !terminal.has(taskId)))
    throw new Error('Team Plan finalization has nonterminal tasks.');
}

function assertRemainingJournalCapacity(
  request: Readonly<{
    journalBytes: number;
    generationRecordLimit: number;
    selectedLeaseCount: number;
    recordedCount: number;
    generationCount: number;
  }>,
): void {
  const remainingSelections =
    request.generationRecordLimit - request.selectedLeaseCount;
  const remainingRecords =
    request.generationRecordLimit - request.recordedCount;
  const remainingGenerations =
    MAX_TEAM_PLAN_GENERATIONS - request.generationCount;
  const remainingBytes =
    selectionBudget(remainingSelections) +
    remainingRecords * MAX_TEAM_PLAN_RECORD_EVENT_BYTES +
    remainingGenerations * maximumGenerationBudget() +
    MAX_TEAM_PLAN_FINAL_EVENT_BYTES;
  if (request.journalBytes + remainingBytes > MAX_TEAM_PLAN_JOURNAL_BYTES)
    throw new Error('Team Plan journal lacks its proven completion capacity.');
}

function selectionBudget(attemptCount: number): number {
  return (
    attemptCount *
    (MAX_TEAM_PLAN_SELECTION_BASE_BYTES + MAX_TEAM_PLAN_ATTEMPT_IDENTITY_BYTES)
  );
}

function generationMutationBudget(recordLimit: number): number {
  return (
    selectionBudget(recordLimit) +
    recordLimit * MAX_TEAM_PLAN_RECORD_EVENT_BYTES
  );
}

function maximumGenerationBudget(): number {
  return (
    MAX_TEAM_PLAN_PLAN_EVENT_BYTES +
    generationMutationBudget(MAX_TEAM_PLAN_RECORDS_PER_GENERATION)
  );
}
