import { ProviderSyncOutcome } from "$lib/vault/provider-sync.svelte";
import { NativeVaultStorageFailure } from "$lib/runtime/storage-failure";
import { VaultOperationStale } from "$lib/runtime/vault-operation-stale";
import { err as storageErr, ok as storageOk } from "neverthrow";
import { I18N_KEYS } from "../../../generated/i18n-keys";
import type { VaultState } from "$lib/vault.svelte";
import { browserLogRuntime } from "$lib/runtime/log";
import { JoinEnrollmentState, ProviderSyncFreshness } from "$app-wasm";
import { WorkspaceSection } from "$lib/vault/state/ui.svelte";

const log = browserLogRuntime.createLogger("vault-devices");

/** Owns browser orchestration for one multi device context. */
export class VaultDeviceActions {
  constructor(private readonly state: VaultState) {}

  async refreshDeviceState() {
    const state = this.state;
    return state.manualSync();
  }

  async refreshPendingJoinsFromProviders() {
    const state = this.state;
    const rosterRefresh1 = await state.hydrateMultiDeviceState();
    if (rosterRefresh1.isErr()) {
      state.errorMsg = state.t(rosterRefresh1.error.translationKey);
      return;
    }
  }

  dismissJoinEnrollment() {
    const state = this.state;
    state.joinEnrollmentPrompt = JoinEnrollmentState.None;
  }

  async enrollAndConnect() {
    const state = this.state;
    if (!state.hasManager) return;
    const secretsKey = state.enrollSecretsKey.trim();
    const membersKey = state.enrollMembersKey.trim();
    if (!secretsKey || !membersKey) return;

    state.errorMsg = "";
    state.dismissSuccess();
    state.isVerifying = true;
    try {
      const storageArgs = state.wasmStorageArgs();
      const rawRecords = await state.enqueueStorage(async () => {
        const admittedManager = state.admitManager();
        if (admittedManager.isErr()) return storageErr(admittedManager.error);
        try {
          return storageOk(
            await admittedManager.value.enroll_and_connect(
              storageArgs.mode,
              storageArgs.pat,
              storageArgs.repo,
              secretsKey,
              membersKey,
            ),
          );
        } catch (nativeFailure) {
          return storageErr(new NativeVaultStorageFailure(nativeFailure));
        }
      });
      if (rawRecords.isErr()) {
        state.errorMsg = state.t(rawRecords.error.translationKey);
        return;
      }
      for (const record of rawRecords.value) record.free();
      const loadPageArgs: Parameters<typeof state.loadSecretPage>[0] = {
        query: "",
        requestedOffset: 0,
      };
      const secretRefresh4 = await state.loadSecretPage(loadPageArgs);
      if (secretRefresh4.isErr()) {
        state.errorMsg = state.t(secretRefresh4.error.translationKey);
        return;
      }
      if (secretRefresh4.value instanceof VaultOperationStale) return;
      const unlocked = state.markVaultUnlocked();
      if (unlocked.isErr()) {
        state.errorMsg = state.t(unlocked.error.translationKey);
        return;
      }
      state.enrollSecretsKey = "";
      state.enrollMembersKey = "";
      const savedProvider2 = await state.ensureProviderSaved();
      if (savedProvider2.isErr()) {
        state.errorMsg = state.t(savedProvider2.error.translationKey);
        return;
      }
      const rosterRefresh6 = await state.hydrateMultiDeviceState();
      if (rosterRefresh6.isErr()) {
        state.errorMsg = state.t(rosterRefresh6.error.translationKey);
        return;
      }
      const synchronized = await state.syncFromStorage(
        ProviderSyncFreshness.Scheduled,
      );
      if (synchronized.isErr()) {
        state.errorMsg = state.t(synchronized.error.translationKey);
        return;
      }
      if (synchronized.value !== ProviderSyncOutcome.Synced) return;
      state.showSuccess(state.t(I18N_KEYS.ToastsEnrolledConnected));
      log.info("enrolled and connected");
      state.joinEnrollmentPrompt = JoinEnrollmentState.None;
      state.openSection(WorkspaceSection.Vault);
      state.startIdleSessionTracking();
    } catch (e) {
      state.errorMsg =
        e instanceof Error ? e.message : "Failed to enroll with vault keys.";
    } finally {
      state.isVerifying = false;
    }
  }
}
