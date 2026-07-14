import type { VaultState } from "$lib/vault.svelte";
import type { NookSecretRecord } from "$lib/nook";
import { createLogger } from "$lib/log";
import { prepareNewLocalVaultSlot } from "$app-wasm";
import * as localLoginActions from "$lib/vault/local-login";

const log = createLogger("vault-lifecycle");

export async function init(state: VaultState) {
  if (state.initPromise) {
    return state.initPromise;
  }
  state.initPromise = state.initOnce();
  return state.initPromise;
}

export function waitForStorageChain(state: VaultState): Promise<void> {
  return state.storageChain.then(() => undefined);
}

export function resetStorageChain(state: VaultState): void {
  state.storageChain = Promise.resolve();
}

export async function createFreshVault(state: VaultState) {
  if (!state.manager) return;
  state.errorMsg = "";
  state.dismissSuccess();
  state.isVerifying = true;
  log.info("creating fresh remote vault", { mode: state.storageMode });
  try {
    await state.initDeviceIdentity();
    const creatingAdditionalVault = state.localVaults.length > 0;
    if (creatingAdditionalVault) {
      await prepareNewLocalVaultSlot();
    }
    const rawRecords = await state.enqueueStorage(async () => {
      if (creatingAdditionalVault) {
        state.manager!.resetVaultSession();
      }
      const connectPromise = state.manager!.connect_fresh(
        ...state.wasmStorageArgs(),
      );
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(
                "Connection timed out. Check your PAT, network, and try again.",
              ),
            ),
          30_000,
        );
      });
      return (await Promise.race([
        connectPromise,
        timeoutPromise,
      ])) as NookSecretRecord[];
    });
    state.secrets = rawRecords;
    state.markVaultUnlocked();
    state.activeVaultStoreId = localLoginActions.requireManagerVaultStoreId(
      state.manager,
    );
    await localLoginActions.refreshLocalVaultCatalog(state);
    await state.ensureProviderSaved();
    await state.syncActiveVaultStoreIdToAuth();
    await state.hydrateMultiDeviceState();
    state.joinEnrollmentPrompt = "none";
    log.info("fresh remote vault created", {
      mode: state.storageMode,
      secrets: rawRecords.length,
    });
    state.showSuccess(state.t("toasts.vault_created"));
    state.startIdleSessionTracking();
  } catch (e: unknown) {
    state.isAuthenticated = false;
    const message =
      e instanceof Error ? e.message : "Failed to create a new vault.";
    log.warn("fresh vault create failed", { error: message });
    state.errorMsg = message;
  } finally {
    state.isVerifying = false;
  }
}
