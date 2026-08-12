import type { SyncActionsContext } from "$lib/vault/action-contexts";
import { createLogger, type RuntimeFailure } from "$lib/runtime/log";
import { I18N_KEYS } from "../../../generated/i18n-keys";
import { VaultAccessStatus, type NookVaultSyncResult } from "$lib/nook";
import {
  is_vault_session_locked,
  JoinEnrollmentState,
  NookVaultSyncAccessState,
  UnauthenticatedSyncDecision,
} from "$app-wasm";

const log = createLogger("vault-sync");

type SyncFailureContext = {
  readonly context: string;
  readonly failure: RuntimeFailure;
};

export function syncError({ context }: SyncFailureContext): void {
  log.warn(`${context} failed`);
}

interface ApplyVaultSyncResultRequest {
  readonly state: SyncActionsContext;
  readonly result: NookVaultSyncResult;
}

export function applyVaultSyncResult({
  state,
  result,
}: ApplyVaultSyncResultRequest): void {
  if (state.isAuthenticated) {
    state.pendingJoins = result.pendingJoins;
    state.vaultMembers = result.vaultMembers;
    return;
  }

  const accessAssessed =
    result.accessState === NookVaultSyncAccessState.Assessed;
  const accessStatus = accessAssessed
    ? result.accessStatus
    : VaultAccessStatus.NewVault;
  log.debug("sync result (unauthenticated)");

  if (accessAssessed) {
    log.info("sync state changed (login gate)");
  }

  const decision = state.clientPolicy.unauthenticated_sync_decision(
    result.changed,
    accessAssessed,
    accessStatus,
    state.joinEnrollmentPrompt,
    state.awaitingJoinApproval,
  );
  switch (decision) {
    case UnauthenticatedSyncDecision.Approved:
      state.joinEnrollmentPrompt = JoinEnrollmentState.None;
      state.showSuccess(state.t(I18N_KEYS.ToastsDeviceApproved));
      scheduleAutoConnectAfterApproval(state);
      break;
    case UnauthenticatedSyncDecision.AutoConnect:
      scheduleAutoConnectAfterApproval(state);
      break;
    case UnauthenticatedSyncDecision.MarkJoinPending:
      state.joinEnrollmentPrompt = JoinEnrollmentState.Pending;
      state.awaitingJoinApproval = true;
      break;
    case UnauthenticatedSyncDecision.Ignore:
      break;
  }
}

export function scheduleAutoConnectAfterApproval(
  state: SyncActionsContext,
): void {
  if (
    !state.clientPolicy.should_auto_connect_after_approval(
      state.isAuthenticated,
      state.isVerifying,
      state.loginPasswordPrompt,
      state.sessionExpiredByIdle,
      is_vault_session_locked(),
    )
  ) {
    return;
  }
  log.info("scheduling auto-connect after join approval");
  setTimeout(() => {
    if (state.isAuthenticated || state.isVerifying) return;
    void state.loadDb();
  }, 0);
}
