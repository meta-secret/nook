import { I18N_KEYS } from "../../../generated/i18n-keys";
import type { VaultState } from "$lib/vault.svelte";
import { isoTimestamp, type NookSecretRecord } from "$lib/nook";
import { createLogger } from "$lib/runtime/log";
import { JoinEnrollmentState } from "$app-wasm";
import { EventOutboxTargetKind } from "$lib/vault/sync-operation-state";

const log = createLogger("vault-devices");

export async function refreshDeviceState(state: VaultState) {
  await state.manualSync();
}

export async function refreshPendingJoinsFromProviders(state: VaultState) {
  await state.hydrateMultiDeviceState();
}

export async function approveJoin(state: VaultState, joinDeviceId: string) {
  if (!state.hasManager) return;
  state.errorMsg = "";
  state.dismissSuccess();
  state.isSaving = true;
  try {
    const rawRecords = (await state.enqueueStorage(() =>
      state.requireManager().approve_join_request(joinDeviceId),
    )) as NookSecretRecord[];
    for (const record of rawRecords) record.free();
    await state.refreshSecretsFromSession();
    await state.flushRemoteEventOutboxNow();
    await state.hydrateMultiDeviceState();
    state.pendingJoins = state.pendingJoins.filter(
      (entry) => entry.deviceId !== joinDeviceId,
    );
    await state.fanOutSyncToProviders({ quiet: true });
    state.pendingJoins = state.pendingJoins.filter(
      (entry) => entry.deviceId !== joinDeviceId,
    );
    state.showSuccess(state.t(I18N_KEYS.ToastsDeviceApproved));
    log.info("join request approved", { joinDeviceId });
  } catch (e: unknown) {
    state.errorMsg =
      e instanceof Error ? e.message : "Failed to approve join request.";
  } finally {
    state.isSaving = false;
  }
}

export async function denyJoin(state: VaultState, joinDeviceId: string) {
  if (!state.hasManager) return;
  state.errorMsg = "";
  state.dismissSuccess();
  state.isSaving = true;
  try {
    const rawRecords = (await state.enqueueStorage(() =>
      state.requireManager().deny_join_request(joinDeviceId),
    )) as NookSecretRecord[];
    for (const record of rawRecords) record.free();
    await state.refreshSecretsFromSession();
    await state.hydrateMultiDeviceState();
    state.scheduleFanOutSyncAfterLocalSave();
    state.showSuccess(state.t(I18N_KEYS.ToastsJoinDenied));
  } catch (e: unknown) {
    state.errorMsg =
      e instanceof Error ? e.message : "Failed to deny join request.";
  } finally {
    state.isSaving = false;
  }
}

export async function renameDevice(
  state: VaultState,
  authId: string,
  label: string,
) {
  if (!state.hasManager) return;
  state.errorMsg = "";
  state.dismissSuccess();
  state.isSaving = true;
  try {
    await state.enqueueStorage(() =>
      state.requireManager().rename_vault_member(authId, label),
    );
    await state.hydrateMultiDeviceState();
    state.scheduleFanOutSyncAfterLocalSave();
    state.showSuccess(
      label.trim()
        ? state.t(I18N_KEYS.ToastsDeviceRenamed)
        : state.t(I18N_KEYS.ToastsDeviceNameReset),
    );
  } catch (e: unknown) {
    state.errorMsg =
      e instanceof Error ? e.message : "Failed to rename device.";
    throw e;
  } finally {
    state.isSaving = false;
  }
}

export async function revokeDevice(state: VaultState, authId: string) {
  if (!state.hasManager) return;
  const isSelf = state.vaultMembers.some(
    (member) => member.authId === authId && member.deviceId === state.deviceId,
  );
  state.errorMsg = "";
  state.dismissSuccess();
  state.isSaving = true;
  try {
    const rawRecords = (await state.enqueueStorage(() =>
      state.requireManager().revoke_vault_member(authId),
    )) as NookSecretRecord[];
    if (isSelf) {
      state.clearUnlockedSession();
      state.showSuccess(state.t(I18N_KEYS.ToastsDeviceRemoved));
      return;
    }
    for (const record of rawRecords) record.free();
    await state.refreshSecretsFromSession();
    await state.hydrateMultiDeviceState();
    state.scheduleFanOutSyncAfterLocalSave();
    state.showSuccess(state.t(I18N_KEYS.ToastsDeviceRevoked));
  } catch (e: unknown) {
    state.errorMsg =
      e instanceof Error ? e.message : "Failed to revoke device access.";
    throw e;
  } finally {
    state.isSaving = false;
  }
}

export async function confirmJoinRequest(state: VaultState) {
  if (!state.hasManager) return;
  state.errorMsg = "";
  state.dismissSuccess();
  state.isVerifying = true;
  try {
    const target = state.eventOutboxTarget();
    const storageArgs =
      target.kind === EventOutboxTargetKind.Remote
        ? target.args
        : state.wasmStorageArgs();
    await state.enqueueStorage(() =>
      state
        .requireManager()
        .request_vault_access(...storageArgs, isoTimestamp()),
    );
    await state.ensureProviderSaved();
    state.joinEnrollmentPrompt = JoinEnrollmentState.Pending;
    state.awaitingJoinApproval = true;
  } catch (e: unknown) {
    state.errorMsg =
      e instanceof Error ? e.message : "Failed to request vault access.";
  } finally {
    state.isVerifying = false;
  }
}

export function dismissJoinEnrollment(state: VaultState) {
  state.joinEnrollmentPrompt = JoinEnrollmentState.None;
}

export async function enrollAndConnect(state: VaultState) {
  if (!state.hasManager) return;
  const secretsKey = state.enrollSecretsKey.trim();
  const membersKey = state.enrollMembersKey.trim();
  if (!secretsKey || !membersKey) return;

  state.errorMsg = "";
  state.dismissSuccess();
  state.isVerifying = true;
  try {
    const rawRecords = (await state.enqueueStorage(() =>
      state
        .requireManager()
        .enroll_and_connect(...state.wasmStorageArgs(), secretsKey, membersKey),
    )) as NookSecretRecord[];
    for (const record of rawRecords) record.free();
    await state.loadSecretPage("", 0);
    state.markVaultUnlocked();
    state.enrollSecretsKey = "";
    state.enrollMembersKey = "";
    await state.ensureProviderSaved();
    void state.hydrateMultiDeviceState();
    await state.syncFromStorage();
    state.showSuccess(state.t(I18N_KEYS.ToastsEnrolledConnected));
    log.info("enrolled and connected", {
      secrets: rawRecords.length,
      mode: state.storageMode,
    });
    state.joinEnrollmentPrompt = JoinEnrollmentState.None;
    state.closeSettings();
    state.startIdleSessionTracking();
  } catch (e: unknown) {
    state.errorMsg =
      e instanceof Error ? e.message : "Failed to enroll with vault keys.";
  } finally {
    state.isVerifying = false;
  }
}
