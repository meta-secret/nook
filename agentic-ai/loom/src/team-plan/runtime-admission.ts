import {
  ModuleDeliveryAdmissionSelectionStatus,
  recordModuleDeliveryAttemptLeases,
  selectModuleDeliveryAdmissions,
} from '../module-delivery/index.ts';
import { TEAM_PLAN_JOURNAL_VERSION, TeamPlanEventKind } from './domain.ts';
import { appendTeamPlanEvent } from './journal.ts';
import {
  assertRunningTeamPlanSession,
  assertTeamPlanSessionRepositoryAtSource,
  attemptIdentity,
  attemptKey,
  teamPlanSnapshot,
  withLockedTeamPlanSession,
} from './runtime.ts';

import type { ModuleDeliveryAdmission } from '../module-delivery/admission.ts';
import type {
  TeamPlanEvent,
  TeamPlanJournalRequest,
  TeamPlanLeaseReceipt,
  TeamPlanLeaseRequest,
  TeamPlanSelectionReceipt,
} from './domain.ts';

export async function selectTeamPlan(
  request: TeamPlanJournalRequest,
): Promise<TeamPlanSelectionReceipt> {
  return withLockedTeamPlanSession({
    journalPath: request.journalPath,
    action: async (session) => {
      assertRunningTeamPlanSession(session);
      assertTeamPlanSessionRepositoryAtSource(session);
      const selection = selectModuleDeliveryAdmissions({
        authority: session.authority,
        acceptedPlan: session.acceptedPlan,
        state: session.integrationState.admissionState,
      });
      if (
        selection.status === ModuleDeliveryAdmissionSelectionStatus.Blocked &&
        selection.blockedTaskIds.length === 0
      )
        throw new Error('Team Plan admission selection is inconclusive.');
      return {
        snapshot: teamPlanSnapshot(session),
        admissions: selection.admissions,
        pendingTaskIds: selection.pendingTaskIds,
        blockedTaskIds: selection.blockedTaskIds,
      };
    },
  });
}

export async function leaseTeamPlan(
  request: TeamPlanLeaseRequest,
): Promise<TeamPlanLeaseReceipt> {
  return withLockedTeamPlanSession({
    journalPath: request.journalPath,
    action: async (session) => {
      assertRunningTeamPlanSession(session);
      assertTeamPlanSessionRepositoryAtSource(session);
      const snapshot = teamPlanSnapshot(session);
      if (
        request.runId !== snapshot.runId ||
        request.generation !== snapshot.generation ||
        request.planDigest !== snapshot.planDigest
      )
        throw new Error('Team Plan admission selection is stale.');
      const selection = selectModuleDeliveryAdmissions({
        authority: session.authority,
        acceptedPlan: session.acceptedPlan,
        state: session.integrationState.admissionState,
      });
      const admissions = authorizedAdmissions({
        admissions: selection.admissions,
        taskIds: request.taskIds,
      });
      const recording = recordModuleDeliveryAttemptLeases({
        authority: session.authority,
        state: session.integrationState.admissionState,
        admissions,
      });
      for (const lease of recording.leases) {
        session.activeLeases.set(attemptKey(lease), lease);
      }
      const event: TeamPlanEvent = {
        version: TEAM_PLAN_JOURNAL_VERSION,
        kind: TeamPlanEventKind.Selected,
        sequence: session.journal.events.length + 1,
        attempts: recording.leases.map(attemptIdentity),
      };
      await appendTeamPlanEvent({ journalPath: request.journalPath, event });
      return { snapshot: teamPlanSnapshot(session), leases: recording.leases };
    },
  });
}

function authorizedAdmissions(request: {
  readonly admissions: readonly ModuleDeliveryAdmission[];
  readonly taskIds: readonly string[];
}): readonly ModuleDeliveryAdmission[] {
  if (
    request.taskIds.length === 0 ||
    new Set(request.taskIds).size !== request.taskIds.length
  )
    throw new Error('Team Plan admission authorization is invalid.');
  const authorized = request.taskIds.map((taskId) =>
    request.admissions.find((admission) => admission.taskId === taskId),
  );
  if (authorized.some((admission) => !admission))
    throw new Error('Team Plan admission authorization is stale.');
  return authorized as readonly ModuleDeliveryAdmission[];
}
