export * from './domain.ts';
import { LoomFailureCode, withLoomFailureCode } from '../loom-failure.ts';
import {
  discardFinalizedTeamPlan as discardFinalizedTeamPlanRuntime,
  finalizeTeamPlan as finalizeTeamPlanRuntime,
  recordTeamPlan as recordTeamPlanRuntime,
  restartTeamPlan as restartTeamPlanRuntime,
  startTeamPlan as startTeamPlanRuntime,
} from './runtime.ts';
import {
  leaseTeamPlan as leaseTeamPlanRuntime,
  selectTeamPlan as selectTeamPlanRuntime,
} from './runtime-admission.ts';

import type {
  TeamPlanDiscardRequest,
  TeamPlanFinalizeRequest,
  TeamPlanJournalRequest,
  TeamPlanLeaseReceipt,
  TeamPlanLeaseRequest,
  TeamPlanRecordRequest,
  TeamPlanRestartRequest,
  TeamPlanSelectionReceipt,
  TeamPlanSnapshot,
  TeamPlanStartRequest,
} from './domain.ts';

export function startTeamPlan(
  request: TeamPlanStartRequest,
): Promise<TeamPlanSnapshot> {
  return withLoomFailureCode({
    code: LoomFailureCode.TeamPlanValidationFailed,
    action: () => startTeamPlanRuntime(request),
  });
}

export function selectTeamPlan(
  request: TeamPlanJournalRequest,
): Promise<TeamPlanSelectionReceipt> {
  return withLoomFailureCode({
    code: LoomFailureCode.TeamPlanRecoveryFailed,
    action: () => selectTeamPlanRuntime(request),
  });
}

export function leaseTeamPlan(
  request: TeamPlanLeaseRequest,
): Promise<TeamPlanLeaseReceipt> {
  return withLoomFailureCode({
    code: LoomFailureCode.TeamPlanRecoveryFailed,
    action: () => leaseTeamPlanRuntime(request),
  });
}

export function recordTeamPlan(
  request: TeamPlanRecordRequest,
): Promise<TeamPlanSnapshot> {
  return withLoomFailureCode({
    code: LoomFailureCode.TeamPlanValidationFailed,
    action: () => recordTeamPlanRuntime(request),
  });
}

export function restartTeamPlan(
  request: TeamPlanRestartRequest,
): Promise<TeamPlanSnapshot> {
  return withLoomFailureCode({
    code: LoomFailureCode.TeamPlanRecoveryFailed,
    action: () => restartTeamPlanRuntime(request),
  });
}

export function finalizeTeamPlan(
  request: TeamPlanFinalizeRequest,
): Promise<TeamPlanSnapshot> {
  return withLoomFailureCode({
    code: LoomFailureCode.TeamPlanRecoveryFailed,
    action: () => finalizeTeamPlanRuntime(request),
  });
}

export function discardFinalizedTeamPlan(
  request: TeamPlanDiscardRequest,
): Promise<void> {
  return withLoomFailureCode({
    code: LoomFailureCode.TeamPlanStorageFailed,
    action: () => discardFinalizedTeamPlanRuntime(request),
  });
}
