import { err, ok, type Result } from "neverthrow";
import {
  NativeVaultStorageFailure,
  type VaultStorageFailure,
} from "$lib/runtime/storage-failure";
import type { SyncActionsContext } from "$lib/vault/action-contexts";
import { browserLogRuntime } from "$lib/runtime/log";
import { I18N_KEYS } from "../../../generated/i18n-keys";
import { VaultAccessStatus, type NookVaultSyncResult } from "$lib/nook";
import {
  is_vault_session_locked,
  JoinEnrollmentState,
  NookVaultSyncAccessState,
  UnauthenticatedSyncDecision,
} from "$app-wasm";

const log = browserLogRuntime.createLogger("vault-sync");

interface ApplyVaultSyncResultRequest {
  readonly result: NookVaultSyncResult;
}

/** Owns browser orchestration for one sync runtime context. */
export class VaultSyncRuntimeActions {
  constructor(private readonly state: SyncActionsContext) {}

  applyVaultSyncResult({
    result,
  }: ApplyVaultSyncResultRequest): Result<void, VaultStorageFailure> {
    try {
      const state = this.state;
      if (state.isAuthenticated) {
        let joins: NookVaultSyncResult["pendingJoins"];
        try {
          joins = result.pendingJoins;
        } catch (failure) {
          return err(new NativeVaultStorageFailure(failure));
        }
        let members: NookVaultSyncResult["vaultMembers"];
        try {
          members = result.vaultMembers;
        } catch (failure) {
          for (const join of joins) join.free();
          return err(new NativeVaultStorageFailure(failure));
        }
        for (const join of state.pendingJoins) join.free();
        for (const member of state.vaultMembers) member.free();
        state.pendingJoins = joins;
        state.vaultMembers = members;
        return ok();
      }

      let decision: UnauthenticatedSyncDecision;
      try {
        const accessAssessed =
          result.accessState === NookVaultSyncAccessState.Assessed;
        const accessStatus = accessAssessed
          ? result.accessStatus
          : VaultAccessStatus.NewVault;
        decision = state.clientPolicy.unauthenticated_sync_decision(
          result.changed,
          accessAssessed,
          accessStatus,
          state.joinEnrollmentPrompt,
          state.awaitingJoinApproval,
        );
      } catch (failure) {
        return err(new NativeVaultStorageFailure(failure));
      }
      switch (decision) {
        case UnauthenticatedSyncDecision.Approved:
          state.joinEnrollmentPrompt = JoinEnrollmentState.None;
          state.showSuccess(state.t(I18N_KEYS.ToastsDeviceApproved));
          return this.scheduleAutoConnectAfterApproval();
        case UnauthenticatedSyncDecision.AutoConnect:
          return this.scheduleAutoConnectAfterApproval();
        case UnauthenticatedSyncDecision.MarkJoinPending:
          state.joinEnrollmentPrompt = JoinEnrollmentState.Pending;
          state.awaitingJoinApproval = true;
          break;
        case UnauthenticatedSyncDecision.Ignore:
          break;
      }
      return ok();
    } finally {
      result.free();
    }
  }

  scheduleAutoConnectAfterApproval(): Result<void, VaultStorageFailure> {
    const state = this.state;
    let shouldConnect: boolean;
    try {
      shouldConnect = state.clientPolicy.should_auto_connect_after_approval(
        state.isAuthenticated,
        state.isVerifying,
        state.loginPasswordPrompt,
        state.sessionExpiredByIdle,
        is_vault_session_locked(),
      );
    } catch (failure) {
      return err(new NativeVaultStorageFailure(failure));
    }
    if (!shouldConnect) return ok();
    log.info("scheduling auto-connect after join approval");
    setTimeout(() => {
      if (state.isAuthenticated || state.isVerifying) return;
      void state.loadDb();
    }, 0);
    return ok();
  }
}
