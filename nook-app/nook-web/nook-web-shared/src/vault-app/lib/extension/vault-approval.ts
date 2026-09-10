import { err, ok, type Result } from "neverthrow";
import { approve_extension_device, type NookVaultManager } from "$app-wasm";
import {
  NativeVaultStorageFailure,
  VaultStorageFailure,
  VaultStorageFailureKind,
} from "$lib/runtime/storage-failure";
import {
  activeVaultScope,
  providerBelongsToVault,
  seal_auth_providers_for_device_public_key,
  type StorageProvider,
} from "$lib/auth/providers";
import { ActiveVaultKind } from "$lib/vault/state/provider.svelte";
import type { VaultState } from "$lib/vault.svelte";
import { I18N_KEYS } from "../../../generated/i18n-keys";
import {
  ExtensionConnectScope,
  extensionConnectionBrowser,
  type ExtensionConnectRequest,
} from "./connect";
import {
  ExtensionPairingApprovedMessageType,
  type ExtensionPairingApprovedMessage,
} from "$web-shared/extension/runtime-messages";

/** Admits one extension grant against the same live vault throughout preparation. */
export class ExtensionVaultApproval {
  private readonly managerAtStart: Result<
    NookVaultManager,
    VaultStorageFailure
  >;
  private readonly activeVault: VaultState["activeVault"];
  constructor(
    private readonly vault: VaultState,
    private readonly request: ExtensionConnectRequest,
  ) {
    this.managerAtStart = vault.admitManager();
    this.activeVault = vault.activeVault;
  }

  async prepare(): Promise<
    Result<ExtensionPairingApprovedMessage, VaultStorageFailure>
  > {
    const vault = this.vault;
    const request = this.request;
    const manager = this.managerAtStart;
    if (manager.isErr()) return err(manager.error);
    const activeVault = this.activeVault;
    const authorized = await vault.enqueueStorage(async () => {
      const current = this.admitManager();
      if (current.isErr()) return err(current.error);
      try {
        await approve_extension_device(
          current.value,
          request.deviceId,
          request.devicePublicKey,
          request.deviceSigningPublicKey,
          request.deviceLabel,
        );
        return ok(undefined);
      } catch (failure) {
        return err(new NativeVaultStorageFailure(failure));
      }
    });
    if (authorized.isErr()) return err(authorized.error);
    const storeId = await vault.enqueueStorage(() => {
      const current = this.admitManager();
      if (current.isErr()) return err(current.error);
      if (activeVault.kind === ActiveVaultKind.Open)
        return ok(activeVault.storeId);
      try {
        return ok(current.value.vaultStoreId);
      } catch (failure) {
        return err(new NativeVaultStorageFailure(failure));
      }
    });
    if (storeId.isErr()) return err(storeId.error);
    let providers: StorageProvider[] = [];
    if (
      request.scopes.includes(ExtensionConnectScope.SyncProviderCredentials)
    ) {
      const snapshot = await vault.enqueueStorage(async () => {
        const current = this.admitManager();
        if (current.isErr()) return err(current.error);
        try {
          return ok(await current.value.load_auth_providers_snapshot());
        } catch (failure) {
          return err(new NativeVaultStorageFailure(failure));
        }
      });
      if (snapshot.isErr()) return err(snapshot.error);
      try {
        const matching = snapshot.value.providers.filter((provider) =>
          providerBelongsToVault({ provider, storeId: storeId.value }),
        );
        providers = seal_auth_providers_for_device_public_key(
          request.devicePublicKey,
          {
            providers: matching,
            activeVaultStoreId: activeVaultScope(storeId.value),
          },
        ).providers;
      } catch (failure) {
        return err(new NativeVaultStorageFailure(failure));
      }
    }
    const records = await vault.enqueueStorage(async () => {
      const current = this.admitManager();
      if (current.isErr()) return err(current.error);
      try {
        return ok(await current.value.export_event_log_records_js());
      } catch (failure) {
        return err(new NativeVaultStorageFailure(failure));
      }
    });
    if (records.isErr()) return err(records.error);
    try {
      const current = this.admitManager();
      if (current.isErr()) return err(current.error);
      const unnamed = vault.t(I18N_KEYS.LoginVaultPickerUnnamed);
      let vaultName = unnamed;
      let eventLogRecords: ExtensionPairingApprovedMessage["eventLogRecords"];
      try {
        const entry = vault.localVaults.find(
          (entry) => entry.storeId === storeId.value,
        );
        if (entry) vaultName = entry.display_label(unnamed);
        eventLogRecords = records.value.to_array();
      } catch (failure) {
        return err(new NativeVaultStorageFailure(failure));
      }
      return ok({
        type: ExtensionPairingApprovedMessageType.NookExtensionPairingApproved,
        payload: {
          vaultType: "simple",
          deviceId: request.deviceId,
          devicePublicKey: request.devicePublicKey,
          deviceSigningPublicKey: request.deviceSigningPublicKey,
          deviceLabel: request.deviceLabel,
          vaultStoreId: storeId.value,
          vaultName,
          approvedAt: new Date().toISOString(),
          scopes: request.scopes,
          providers,
        },
        eventLogRecords,
      });
    } finally {
      records.value.free();
    }
  }

  private admitManager(): Result<NookVaultManager, VaultStorageFailure> {
    if (this.managerAtStart.isErr()) return err(this.managerAtStart.error);
    const current = this.vault.admitManager();
    if (current.isErr()) return err(current.error);
    if (
      current.value !== this.managerAtStart.value ||
      this.vault.activeVault !== this.activeVault
    ) {
      return err(
        new VaultStorageFailure(VaultStorageFailureKind.GenerationChanged),
      );
    }
    return current;
  }

  admitCompletion(): Result<void, VaultStorageFailure> {
    return this.admitManager().map(() => undefined);
  }

  async deliver(message: ExtensionPairingApprovedMessage) {
    const current = this.admitManager();
    if (current.isErr()) return err(current.error);
    const delivery =
      await extensionConnectionBrowser.deliverExtensionPairingApproval({
        request: this.request,
        message,
      });
    const completion = this.admitCompletion();
    return completion.isErr() ? err(completion.error) : ok(delivery);
  }
}
