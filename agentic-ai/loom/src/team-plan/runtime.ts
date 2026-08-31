import { randomUUID } from 'node:crypto';
import { mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

import { LoomFailureCode, loomFailureFromCause } from '../loom-failure.ts';
import {
  ModuleDeliveryAdmissionSelectionStatus,
  ModuleDeliveryAttemptDispositionKind,
  ModuleDeliveryEvidenceVerdict,
  ModuleDeliveryGenerationFenceKind,
  ModuleDeliveryProviderSubmissionKind,
  ModuleDeliveryValidationStatus,
  ModuleIntegrationPhase,
  cleanupModuleIntegration,
  cleanupModuleWorktree,
  createModuleDeliveryAdmissionState,
  createModuleDeliveryGenerationAuthority,
  decodeAndValidateModuleDeliveryPlan,
  finalizeModuleDeliveryIntegration,
  integrateVerifiedModuleDeliveryTask,
  moduleDeliveryAcceptedEvidenceIdentity,
  prepareModuleIntegration,
  prepareModuleWorktree,
  recordModuleDeliveryAttemptDisposition,
  recordModuleDeliveryAttemptLeases,
  restartModuleDeliveryGeneration,
  restoreModuleDeliveryIntegrationEvidence,
  selectModuleDeliveryAdmissions,
} from '../module-delivery/index.ts';
import {
  TEAM_PLAN_JOURNAL_VERSION,
  TeamPlanEventKind,
  TeamPlanRecordKind,
  TeamPlanRunPhase,
  assertTeamPlanAcceptedEvidenceReceipt,
  assertTeamPlanRecord,
} from './domain.ts';
import {
  appendTeamPlanEvent,
  assertTeamPlanGenerationCapacity,
  createTeamPlanJournal,
  canonicalTeamPlanJournalPath,
  loadTeamPlanJournal,
  discardTeamPlanJournal,
  teamPlanEventBytes,
  teamPlanSha256,
  withTeamPlanJournalLock,
} from './journal.ts';
import {
  TeamPlanObjectType,
  assertTeamPlanFinalizedHead,
  assertTeamPlanLeaseFrontier,
  assertTeamPlanRef,
  deleteTeamPlanRunRefs,
  pinTeamPlanFinalizedHead,
  pinTeamPlanLeaseFrontier,
  pinTeamPlanRef,
  readBoundedTeamPlanFile,
  teamPlanFinalizedHeadRef,
  teamPlanGitText,
  teamPlanLeaseFrontierRef,
  teamPlanRunRefPrefix,
  teamPlanRunRefsEmpty,
} from './runtime-durability.ts';

import type {
  ModuleDeliveryAttemptLease,
  ModuleDeliveryAcceptedProviderEvidenceIdentity,
  ModuleDeliveryGenerationAuthority,
  ModuleDeliveryProviderSubmission,
  ModuleIntegrationState,
  ValidatedModuleDeliveryPlan,
} from '../module-delivery/index.ts';
import type {
  TeamPlanAcceptedEvidenceRecord,
  TeamPlanAcceptedWriteRecord,
  TeamPlanAttemptIdentity,
  TeamPlanEvent,
  TeamPlanDiscardRequest,
  TeamPlanFinalUnusableRecord,
  TeamPlanJournalRecord,
  TeamPlanJournalRequest,
  TeamPlanRecord,
  TeamPlanRecordRequest,
  TeamPlanRestartedEvent,
  TeamPlanRestartRequest,
  TeamPlanSelectionReceipt,
  TeamPlanSnapshot,
  TeamPlanStartRequest,
  TeamPlanStartedEvent,
} from './domain.ts';
import type { TeamPlanJournal } from './journal.ts';
const MAX_TEAM_PLAN_BYTES = 262_144;

type TeamPlanSession = {
  readonly journal: TeamPlanJournal;
  acceptedPlan: ValidatedModuleDeliveryPlan;
  readonly authority: ModuleDeliveryGenerationAuthority;
  integrationState: ModuleIntegrationState;
  readonly activeLeases: Map<string, ModuleDeliveryAttemptLease>;
  planSha256: string;
  finalized: boolean;
};

type ReplayTeamPlanEventRequest = Readonly<{
  session: TeamPlanSession;
  event: TeamPlanEvent;
}>;

type ExecuteTeamPlanRecordRequest = Readonly<{
  session: TeamPlanSession;
  record: TeamPlanRecord | TeamPlanJournalRecord;
  replay: boolean;
}>;

type LockedTeamPlanSessionRequest<T> = Readonly<{
  journalPath: string;
  action: (session: TeamPlanSession) => Promise<T>;
}>;

type TeamPlanArtifactRun = Pick<TeamPlanSession, 'journal'>;
export async function startTeamPlan(
  request: TeamPlanStartRequest,
): Promise<TeamPlanSnapshot> {
  const repositoryRoot = await realpath(resolve(request.repositoryRoot));
  const journalPath = await canonicalTeamPlanJournalPath(request.journalPath);
  if (
    journalPath === repositoryRoot ||
    journalPath.startsWith(`${repositoryRoot}${sep}`)
  )
    throw new Error('Team Plan journal must be outside the source repository.');
  const plan = await reviewedPlan(request.planPath);
  assertRepositoryAtSource({
    repositoryRoot,
    sourceCommit: plan.accepted.plan.sourceCommit,
  });
  const workspaceRoot = await teamPlanWorkspaceRoot({
    repositoryRoot,
    journalPath,
  });
  const started: TeamPlanStartedEvent = {
    version: TEAM_PLAN_JOURNAL_VERSION,
    kind: TeamPlanEventKind.Started,
    sequence: 1,
    runId: teamPlanSha256(randomUUID()),
    planPath: plan.path,
    planText: plan.text,
    planSha256: plan.sha256,
    modulePlanDigest: plan.accepted.planDigest,
    sourceCommit: plan.accepted.plan.sourceCommit,
    repositoryRoot,
    workspaceRoot,
    generationRecordLimit: generationRecordLimit(plan.accepted),
  };
  const startedBytes = teamPlanEventBytes(started);
  assertTeamPlanGenerationCapacity({
    journalBytes: 0,
    planEventBytes: startedBytes,
    generationRecordLimit: started.generationRecordLimit,
    generationCount: 1,
  });
  const journal: TeamPlanJournal = {
    path: journalPath,
    started,
    events: Object.freeze([started]),
    byteLength: startedBytes,
    generationRecordLimit: started.generationRecordLimit,
    selectedLeaseCount: 0,
    recordedCount: 0,
    generationCount: 1,
    finalized: false,
  };
  const session = await materializeTeamPlanSession(journal);
  const snapshot = teamPlanSnapshot(session);
  cleanupTeamPlanSession(session);
  assertRepositoryAtSource({
    repositoryRoot,
    sourceCommit: plan.accepted.plan.sourceCommit,
  });
  await createTeamPlanJournal({
    journalPath,
    event: started,
  });
  return snapshot;
}

export async function selectTeamPlan(
  request: TeamPlanJournalRequest,
): Promise<TeamPlanSelectionReceipt> {
  return withLockedTeamPlanSession({
    journalPath: request.journalPath,
    action: async (session) => {
      assertRunning(session);
      assertSessionRepositoryAtSource(session);
      const selection = selectModuleDeliveryAdmissions({
        authority: session.authority,
        acceptedPlan: session.acceptedPlan,
        state: session.integrationState.admissionState,
      });
      let leases: readonly ModuleDeliveryAttemptLease[] = Object.freeze([]);
      if (selection.admissions.length > 0) {
        const recording = recordModuleDeliveryAttemptLeases({
          authority: session.authority,
          state: session.integrationState.admissionState,
          admissions: selection.admissions,
        });
        leases = recording.leases;
        for (const lease of leases) {
          pinTeamPlanLeaseFrontier({ run: runIdentity(session), lease });
          session.activeLeases.set(attemptKey(lease), lease);
        }
        const event: TeamPlanEvent = {
          version: TEAM_PLAN_JOURNAL_VERSION,
          kind: TeamPlanEventKind.Selected,
          sequence: session.journal.events.length + 1,
          attempts: leases.map(attemptIdentity),
        };
        await appendTeamPlanEvent({ journalPath: request.journalPath, event });
      }
      if (
        selection.status === ModuleDeliveryAdmissionSelectionStatus.Blocked &&
        selection.blockedTaskIds.length === 0
      )
        throw new Error('Team Plan admission selection is inconclusive.');
      return {
        snapshot: teamPlanSnapshot(session),
        leases,
        pendingTaskIds: selection.pendingTaskIds,
        blockedTaskIds: selection.blockedTaskIds,
      };
    },
  });
}

export async function recordTeamPlan(
  request: TeamPlanRecordRequest,
): Promise<TeamPlanSnapshot> {
  assertTeamPlanRecord(request.record);
  return withLockedTeamPlanSession({
    journalPath: request.journalPath,
    action: async (session) => {
      assertRunning(session);
      assertSessionRepositoryAtSource(session);
      const persisted = executeTeamPlanRecord({
        session,
        record: request.record,
        replay: false,
      });
      const event: TeamPlanEvent = {
        version: TEAM_PLAN_JOURNAL_VERSION,
        kind: TeamPlanEventKind.Recorded,
        sequence: session.journal.events.length + 1,
        record: persisted,
      };
      await appendTeamPlanEvent({ journalPath: request.journalPath, event });
      return teamPlanSnapshot(session);
    },
  });
}

export async function restartTeamPlan(
  request: TeamPlanRestartRequest,
): Promise<TeamPlanSnapshot> {
  return withLockedTeamPlanSession({
    journalPath: request.journalPath,
    action: async (session) => {
      assertRunning(session);
      const plan = await reviewedPlan(request.planPath);
      assertRepositoryAtSource({
        repositoryRoot: session.journal.started.repositoryRoot,
        sourceCommit: plan.accepted.plan.sourceCommit,
      });
      const event: TeamPlanRestartedEvent = {
        version: TEAM_PLAN_JOURNAL_VERSION,
        kind: TeamPlanEventKind.Restarted,
        sequence: session.journal.events.length + 1,
        planPath: plan.path,
        planText: plan.text,
        planSha256: plan.sha256,
        modulePlanDigest: plan.accepted.planDigest,
        sourceCommit: plan.accepted.plan.sourceCommit,
        generationRecordLimit: generationRecordLimit(plan.accepted),
      };
      assertTeamPlanGenerationCapacity({
        journalBytes: session.journal.byteLength,
        planEventBytes: teamPlanEventBytes(event),
        generationRecordLimit: event.generationRecordLimit,
        generationCount: session.journal.generationCount + 1,
      });
      restartTeamPlanSession({ session, event, plan: plan.accepted });
      await appendTeamPlanEvent({ journalPath: request.journalPath, event });
      return teamPlanSnapshot(session);
    },
  });
}

export async function finalizeTeamPlan(
  request: TeamPlanJournalRequest,
): Promise<TeamPlanSnapshot> {
  return withLockedTeamPlanSession({
    journalPath: request.journalPath,
    action: async (session) => {
      if (session.finalized) return teamPlanSnapshot(session);
      assertRunning(session);
      assertSessionRepositoryAtSource(session);
      session.integrationState = finalizedIntegrationState(session);
      session.finalized = true;
      const event: TeamPlanEvent = {
        version: TEAM_PLAN_JOURNAL_VERSION,
        kind: TeamPlanEventKind.Finalized,
        sequence: session.journal.events.length + 1,
        headCommit: session.integrationState.headCommit,
      };
      pinTeamPlanFinalizedHead({
        run: runIdentity(session),
        headCommit: event.headCommit,
      });
      await appendTeamPlanEvent({ journalPath: request.journalPath, event });
      return teamPlanSnapshot(session);
    },
  });
}

export async function discardFinalizedTeamPlan(
  request: TeamPlanDiscardRequest,
): Promise<void> {
  await discardTeamPlanJournal({
    journalPath: request.journalPath,
    expectedRunId: request.runId,
    discardArtifacts: async ({ journal, artifactsMayAlreadyBeDiscarded }) => {
      let session: TeamPlanSession;
      try {
        session = await materializeTeamPlanSession(journal);
      } catch (error) {
        if (
          artifactsMayAlreadyBeDiscarded &&
          runArtifactPrefixEmpty({ journal })
        )
          return;
        throw error;
      }
      try {
        deleteRunArtifactRefs(session);
      } finally {
        cleanupTeamPlanSession(session);
      }
    },
  });
}

async function withLockedTeamPlanSession<T>(
  request: LockedTeamPlanSessionRequest<T>,
): Promise<T> {
  return withTeamPlanJournalLock({
    journalPath: request.journalPath,
    action: async () => {
      const journal = await loadTeamPlanJournal(request.journalPath);
      const session = await materializeTeamPlanSession(journal);
      try {
        return await request.action(session);
      } finally {
        cleanupTeamPlanSession(session);
      }
    },
  });
}

async function materializeTeamPlanSession(
  journal: TeamPlanJournal,
): Promise<TeamPlanSession> {
  const started = journal.started;
  const plan = await assertReviewedPlanEvent(started);
  const expectedWorkspace = await teamPlanWorkspaceRoot({
    repositoryRoot: started.repositoryRoot,
    journalPath: journal.path,
  });
  if ((await realpath(started.workspaceRoot)) !== expectedWorkspace)
    throw new Error('Team Plan workspace root has drifted.');
  const authority = createModuleDeliveryGenerationAuthority({
    acceptedPlan: plan,
    expectedLineage: expectedLineage(plan),
    repositoryRoot: started.repositoryRoot,
  });
  const admissionState = createModuleDeliveryAdmissionState({
    authority,
    acceptedPlan: plan,
    headCommit: started.sourceCommit,
    integratedWriterFrontiers: [],
    acceptedEvidence: [],
  });
  const integrationState = prepareModuleIntegration({
    authority,
    repositoryRoot: started.repositoryRoot,
    workspaceRoot: started.workspaceRoot,
    acceptedPlan: plan,
    admissionState,
  });
  const session: TeamPlanSession = {
    journal,
    acceptedPlan: plan,
    authority,
    integrationState,
    activeLeases: new Map(),
    planSha256: started.planSha256,
    finalized: false,
  };
  try {
    for (const event of journal.events.slice(1))
      await replayTeamPlanEvent({ session, event });
    return session;
  } catch (error) {
    cleanupTeamPlanSession(session);
    throw loomFailureFromCause({
      code: LoomFailureCode.TeamPlanRecoveryFailed,
      cause:
        error instanceof Error ? error : new Error('Journal replay failed.'),
      message: 'Team Plan journal replay failed closed.',
    });
  }
}

async function replayTeamPlanEvent(
  request: ReplayTeamPlanEventRequest,
): Promise<void> {
  const { session, event } = request;
  if (session.finalized)
    throw new Error('Finalized Team Plan journal has trailing events.');
  if (event.kind === TeamPlanEventKind.Selected) {
    const selection = selectModuleDeliveryAdmissions({
      authority: session.authority,
      acceptedPlan: session.acceptedPlan,
      state: session.integrationState.admissionState,
    });
    const recording = recordModuleDeliveryAttemptLeases({
      authority: session.authority,
      state: session.integrationState.admissionState,
      admissions: selection.admissions,
    });
    if (
      JSON.stringify(recording.leases.map(attemptIdentity)) !==
      JSON.stringify(event.attempts)
    )
      throw new Error('Team Plan admission batch is stale or forged.');
    for (const lease of recording.leases) {
      const key = attemptKey(lease);
      if (session.activeLeases.has(key))
        throw new Error('Team Plan repeats an active attempt.');
      assertTeamPlanLeaseFrontier({ run: runIdentity(session), lease });
      session.activeLeases.set(key, lease);
    }
    return;
  }
  if (event.kind === TeamPlanEventKind.Recorded) {
    executeTeamPlanRecord({ session, record: event.record, replay: true });
    return;
  }
  if (event.kind === TeamPlanEventKind.Restarted) {
    const plan = await assertReviewedPlanEvent(event);
    restartTeamPlanSession({ session, event, plan });
    return;
  }
  if (event.kind === TeamPlanEventKind.Finalized) {
    session.integrationState = finalizedIntegrationState(session);
    if (session.integrationState.headCommit !== event.headCommit)
      throw new Error('Team Plan final frontier has drifted.');
    assertTeamPlanFinalizedHead({
      run: runIdentity(session),
      headCommit: event.headCommit,
    });
    session.finalized = true;
    return;
  }
  throw new Error('Team Plan start event may appear only once.');
}

function executeTeamPlanRecord(
  request: ExecuteTeamPlanRecordRequest,
): TeamPlanJournalRecord {
  const identity = recordIdentity(request.record);
  const key = attemptKey(identity);
  const lease = request.session.activeLeases.get(key);
  if (
    !lease ||
    lease.generation !== identity.generation ||
    lease.planDigest !== identity.planDigest
  )
    throw new Error('Team Plan result is stale or was never selected.');
  let persisted: TeamPlanJournalRecord;
  if (request.record.kind === TeamPlanRecordKind.AcceptedWrite) {
    if (!request.replay)
      throw new Error('Accepted write records are internal.');
    replayAcceptedWrite({
      session: request.session,
      lease,
      record: request.record,
    });
    persisted = request.record;
  } else if (request.record.kind === TeamPlanRecordKind.AcceptedEvidence) {
    if (!request.replay)
      throw new Error('Accepted evidence records are internal.');
    replayAcceptedEvidence({
      session: request.session,
      lease,
      record: request.record,
    });
    persisted = request.record;
  } else if (request.record.kind === TeamPlanRecordKind.Provider) {
    if (request.replay)
      throw new Error('Journaled provider records require durable artifacts.');
    persisted = acceptProviderRecord({
      session: request.session,
      lease,
      record: request.record,
    });
  } else {
    assertFinalUnusableRecord(request.record);
    recordModuleDeliveryAttemptDisposition({
      authority: request.session.authority,
      state: request.session.integrationState.admissionState,
      lease,
      outcome: {
        kind: ModuleDeliveryAttemptDispositionKind.FinalUnusable,
        conclusion: request.record.conclusion,
      },
    });
    persisted = request.record;
  }
  request.session.activeLeases.delete(key);
  return persisted;
}

function acceptProviderRecord(request: {
  readonly session: TeamPlanSession;
  readonly lease: ModuleDeliveryAttemptLease;
  readonly record: Extract<
    TeamPlanRecord,
    { kind: TeamPlanRecordKind.Provider }
  >;
}): TeamPlanJournalRecord {
  const { session, lease, record } = request;
  const submission = record.submission;
  session.integrationState = integrateVerifiedModuleDeliveryTask({
    authority: session.authority,
    acceptedPlan: session.acceptedPlan,
    lease,
    state: session.integrationState,
    submission,
  });
  if (submission.kind === ModuleDeliveryProviderSubmissionKind.Write) {
    const accepted: TeamPlanAcceptedWriteRecord = {
      kind: TeamPlanRecordKind.AcceptedWrite,
      taskId: submission.handoff.taskId,
      attempt: submission.handoff.attempt,
      generation: submission.generation,
      planDigest: submission.handoff.planDigest,
      baselineCommit: submission.handoff.baselineCommit,
      commit: submission.handoff.commit,
      acceptedByTeam: submission.acceptedByTeam,
    };
    return pinPersistedRecord({
      session,
      record: accepted,
      artifactObject: accepted.commit,
    });
  }
  const evidence = session.integrationState.acceptedEvidence.find(
    ({ taskId }) => taskId === submission.taskId,
  );
  if (!evidence)
    throw new Error('Accepted provider evidence capability is missing.');
  const serialized = JSON.stringify(
    moduleDeliveryAcceptedEvidenceIdentity(evidence),
  );
  const artifactObject = teamPlanGitText({
    cwd: session.journal.started.repositoryRoot,
    args: ['hash-object', '-w', '--stdin'],
    input: serialized,
  });
  const accepted: TeamPlanAcceptedEvidenceRecord = {
    kind: TeamPlanRecordKind.AcceptedEvidence,
    ...attemptIdentity(record.submission),
    artifactObject,
    artifactSha256: teamPlanSha256(serialized),
  };
  return pinPersistedRecord({ session, record: accepted, artifactObject });
}

function replayAcceptedWrite(request: {
  readonly session: TeamPlanSession;
  readonly lease: ModuleDeliveryAttemptLease;
  readonly record: TeamPlanAcceptedWriteRecord;
}): void {
  const { session, lease, record } = request;
  assertPinnedArtifact({
    session,
    record,
    artifactObject: record.commit,
    objectType: TeamPlanObjectType.Commit,
  });
  const workspace = prepareModuleWorktree({
    repositoryRoot: session.journal.started.repositoryRoot,
    workspaceRoot: session.journal.started.workspaceRoot,
    planDigest: record.planDigest,
    taskId: record.taskId,
    attempt: record.attempt,
    baselineCommit: record.baselineCommit,
  });
  try {
    teamPlanGitText({
      cwd: workspace.worktreePath,
      args: ['reset', '--hard', record.commit],
    });
    session.integrationState = integrateVerifiedModuleDeliveryTask({
      authority: session.authority,
      acceptedPlan: session.acceptedPlan,
      lease,
      state: session.integrationState,
      submission: {
        kind: ModuleDeliveryProviderSubmissionKind.Write,
        generation: record.generation,
        acceptedByTeam: record.acceptedByTeam,
        verdict: ModuleDeliveryEvidenceVerdict.TerminalSuccess,
        handoff: {
          taskId: record.taskId,
          attempt: record.attempt,
          planDigest: record.planDigest,
          baselineCommit: record.baselineCommit,
          commit: record.commit,
          workspace,
        },
      },
    });
  } finally {
    cleanupModuleWorktree({ workspace });
  }
}

function replayAcceptedEvidence(request: {
  readonly session: TeamPlanSession;
  readonly lease: ModuleDeliveryAttemptLease;
  readonly record: TeamPlanAcceptedEvidenceRecord;
}): void {
  const { session, lease, record } = request;
  assertPinnedArtifact({
    session,
    record,
    artifactObject: record.artifactObject,
    objectType: TeamPlanObjectType.Blob,
  });
  const serialized = teamPlanGitText({
    cwd: session.journal.started.repositoryRoot,
    args: ['cat-file', 'blob', record.artifactObject],
  });
  if (teamPlanSha256(serialized) !== record.artifactSha256)
    throw new Error('Team Plan evidence artifact digest is invalid.');
  const artifact = JSON.parse(
    serialized,
  ) as ModuleDeliveryAcceptedProviderEvidenceIdentity;
  assertTeamPlanAcceptedEvidenceReceipt(artifact);
  if (
    JSON.stringify(attemptIdentity(artifact)) !==
    JSON.stringify(attemptIdentity(record))
  )
    throw new Error('Team Plan evidence artifact identity is invalid.');
  session.integrationState = restoreModuleDeliveryIntegrationEvidence({
    authority: session.authority,
    acceptedPlan: session.acceptedPlan,
    lease,
    state: session.integrationState,
    receipt: artifact,
  });
}

function restartTeamPlanSession(request: {
  readonly session: TeamPlanSession;
  readonly event: TeamPlanRestartedEvent;
  readonly plan: ValidatedModuleDeliveryPlan;
}): void {
  const { session, event, plan } = request;
  const admissionState = restartModuleDeliveryGeneration({
    authority: session.authority,
    previousState: session.integrationState.admissionState,
    acceptedPlan: plan,
    expectedLineage: expectedLineage(plan),
  });
  cleanupTeamPlanSession(session);
  session.acceptedPlan = plan;
  session.planSha256 = event.planSha256;
  session.integrationState = prepareModuleIntegration({
    authority: session.authority,
    repositoryRoot: session.journal.started.repositoryRoot,
    workspaceRoot: session.journal.started.workspaceRoot,
    acceptedPlan: plan,
    admissionState,
  });
}

async function reviewedPlan(planPath: string) {
  const { path, text } = await readBoundedTeamPlanFile({
    planPath,
    maximumBytes: MAX_TEAM_PLAN_BYTES,
  });
  return {
    path,
    text,
    sha256: teamPlanSha256(text),
    accepted: acceptedTeamPlan(text),
  };
}

async function assertReviewedPlanEvent(
  event: TeamPlanStartedEvent | TeamPlanRestartedEvent,
): Promise<ValidatedModuleDeliveryPlan> {
  const current = acceptedTeamPlan(event.planText);
  if (
    teamPlanSha256(event.planText) !== event.planSha256 ||
    current.planDigest !== event.modulePlanDigest ||
    current.plan.sourceCommit !== event.sourceCommit ||
    generationRecordLimit(current) !== event.generationRecordLimit
  )
    throw new Error('Team Plan persisted plan bytes are invalid.');
  return current;
}

function pinPersistedRecord(request: {
  readonly session: TeamPlanSession;
  readonly record: TeamPlanJournalRecord;
  readonly artifactObject: string;
}): TeamPlanJournalRecord {
  const { session, record, artifactObject } = request;
  pinTeamPlanRef({
    ...runIdentity(session),
    ref: artifactRefFor({ session, record }),
    object: artifactObject,
  });
  return record;
}

function assertPinnedArtifact(request: {
  readonly session: TeamPlanSession;
  readonly record: TeamPlanJournalRecord;
  readonly artifactObject: string;
  readonly objectType: TeamPlanObjectType;
}): void {
  const { session, record, artifactObject, objectType } = request;
  assertTeamPlanRef({
    ...runIdentity(session),
    ref: artifactRefFor({ session, record }),
    object: artifactObject,
    objectType,
  });
}

function deleteRunArtifactRefs(session: TeamPlanArtifactRun): void {
  const expected = session.journal.events.flatMap((event) => {
    if (event.kind === TeamPlanEventKind.Selected)
      return event.attempts.map((attempt) => ({
        ...runIdentity(session),
        ref: teamPlanLeaseFrontierRef({
          run: runIdentity(session),
          attempt,
        }),
        object: teamPlanGitText({
          cwd: session.journal.started.repositoryRoot,
          args: [
            'rev-parse',
            '--verify',
            teamPlanLeaseFrontierRef({
              run: runIdentity(session),
              attempt,
            }),
          ],
        }),
      }));
    if (event.kind === TeamPlanEventKind.Finalized)
      return [
        {
          ...runIdentity(session),
          ref: teamPlanFinalizedHeadRef(runIdentity(session)),
          object: event.headCommit,
        },
      ];
    if (event.kind === TeamPlanEventKind.Recorded) {
      const record = event.record;
      if (record.kind === TeamPlanRecordKind.AcceptedWrite)
        return [
          {
            ...runIdentity(session),
            ref: artifactRefFor({ session, record }),
            object: record.commit,
          },
        ];
      if (record.kind === TeamPlanRecordKind.AcceptedEvidence)
        return [
          {
            ...runIdentity(session),
            ref: artifactRefFor({ session, record }),
            object: record.artifactObject,
          },
        ];
    }
    return [];
  });
  deleteTeamPlanRunRefs({ run: runIdentity(session), expected });
}

function runArtifactPrefixEmpty(session: TeamPlanArtifactRun): boolean {
  return teamPlanRunRefsEmpty(runIdentity(session));
}

function artifactRefFor(request: {
  readonly session: TeamPlanArtifactRun;
  readonly record: TeamPlanJournalRecord;
}): string {
  const { session, record } = request;
  const identity = recordIdentity(record);
  return `${teamPlanRunRefPrefix(runIdentity(session))}/${identity.generation}/${identity.taskId}/${identity.attempt}/${record.kind}`;
}

function runIdentity(session: TeamPlanArtifactRun) {
  return {
    repositoryRoot: session.journal.started.repositoryRoot,
    runId: session.journal.started.runId,
  };
}

function recordIdentity(
  record: TeamPlanRecord | TeamPlanJournalRecord,
): TeamPlanAttemptIdentity {
  if (record.kind !== TeamPlanRecordKind.Provider)
    return attemptIdentity(record);
  return attemptIdentity(record.submission);
}

function attemptIdentity(
  value:
    | TeamPlanAttemptIdentity
    | ModuleDeliveryAttemptLease
    | ModuleDeliveryProviderSubmission,
): TeamPlanAttemptIdentity {
  if (
    'kind' in value &&
    value.kind === ModuleDeliveryProviderSubmissionKind.Write
  )
    return {
      taskId: value.handoff.taskId,
      attempt: value.handoff.attempt,
      generation: value.generation,
      planDigest: value.handoff.planDigest,
    };
  return {
    taskId: value.taskId,
    attempt: value.attempt,
    generation: value.generation,
    planDigest: value.planDigest,
  };
}

function generationRecordLimit(plan: ValidatedModuleDeliveryPlan): number {
  return plan.plan.nodes.length * plan.plan.maxAttempts;
}

function expectedLineage(plan: ValidatedModuleDeliveryPlan) {
  return plan.plan.nodes.map(({ taskId, parentLineage }) => ({
    taskId,
    parentLineage,
  }));
}

function assertFinalUnusableRecord(record: TeamPlanFinalUnusableRecord): void {
  if (
    record.conclusion !== ModuleDeliveryGenerationFenceKind.Cancelled &&
    record.conclusion !== ModuleDeliveryGenerationFenceKind.Failed &&
    record.conclusion !== ModuleDeliveryGenerationFenceKind.Rejected
  )
    throw new Error('Team Plan terminal failure conclusion is inconclusive.');
}

function finalizedIntegrationState(
  session: TeamPlanSession,
): ModuleIntegrationState {
  const selection = selectModuleDeliveryAdmissions({
    authority: session.authority,
    acceptedPlan: session.acceptedPlan,
    state: session.integrationState.admissionState,
  });
  if (
    selection.status === ModuleDeliveryAdmissionSelectionStatus.Blocked &&
    selection.blockedTaskIds.length > 0
  )
    return session.integrationState;
  return finalizeModuleDeliveryIntegration({
    authority: session.authority,
    acceptedPlan: session.acceptedPlan,
    state: session.integrationState,
  });
}

function teamPlanSnapshot(session: TeamPlanSession): TeamPlanSnapshot {
  const state = session.integrationState.admissionState;
  return Object.freeze({
    runId: session.journal.started.runId,
    phase: session.finalized
      ? TeamPlanRunPhase.Finalized
      : TeamPlanRunPhase.Running,
    generation: state.generation,
    planDigest: state.planDigest,
    planSha256: session.planSha256,
    sourceCommit: session.acceptedPlan.plan.sourceCommit,
    headCommit: session.integrationState.headCommit,
    activeLeases: Object.freeze([...session.activeLeases.values()]),
    integratedWriterFrontiers: state.integratedWriterFrontiers,
    acceptedProviderEvidence: state.acceptedProviderEvidence,
  });
}

function acceptedTeamPlan(planText: string): ValidatedModuleDeliveryPlan {
  const validation = decodeAndValidateModuleDeliveryPlan(planText);
  if (validation.status !== ModuleDeliveryValidationStatus.Accepted)
    throw loomFailureFromCause({
      code: LoomFailureCode.TeamPlanValidationFailed,
      cause: new Error(JSON.stringify(validation.issues)),
      message: 'Team Plan is invalid.',
    });
  return validation;
}

function assertRepositoryAtSource(request: {
  readonly repositoryRoot: string;
  readonly sourceCommit: string;
}): void {
  const root = teamPlanGitText({
    cwd: request.repositoryRoot,
    args: ['rev-parse', '--show-toplevel'],
  });
  const head = teamPlanGitText({
    cwd: request.repositoryRoot,
    args: ['rev-parse', 'HEAD'],
  });
  const status = teamPlanGitText({
    cwd: request.repositoryRoot,
    args: ['status', '--porcelain=v1', '-z'],
  });
  if (
    resolve(root) !== resolve(request.repositoryRoot) ||
    head !== request.sourceCommit ||
    status.length > 0
  )
    throw new Error('Team Plan source repository has drifted.');
}

async function teamPlanWorkspaceRoot(request: {
  readonly repositoryRoot: string;
  readonly journalPath: string;
}): Promise<string> {
  const run = teamPlanSha256(
    `${request.repositoryRoot}\n${resolve(request.journalPath)}`,
  );
  const requested = resolve(tmpdir(), 'nook-team-plan-workspaces', run);
  await mkdir(requested, { recursive: true });
  return realpath(requested);
}

function attemptKey(identity: TeamPlanAttemptIdentity): string {
  return `${identity.taskId}:${identity.attempt}`;
}

function assertRunning(session: TeamPlanSession): void {
  if (
    session.finalized ||
    session.integrationState.phase !== ModuleIntegrationPhase.AcceptingProviders
  )
    throw new Error('Team Plan is already finalized.');
}

function assertSessionRepositoryAtSource(session: TeamPlanSession): void {
  assertRepositoryAtSource({
    repositoryRoot: session.journal.started.repositoryRoot,
    sourceCommit: session.acceptedPlan.plan.sourceCommit,
  });
}

function cleanupTeamPlanSession(session: TeamPlanSession): void {
  cleanupModuleIntegration({
    cleanupHandle: session.integrationState.cleanupHandle,
  });
}
