import { err, ok, type Result } from "neverthrow";
import {
  NativeVaultStorageFailure,
  VaultStorageFailure,
  VaultStorageFailureKind,
} from "$lib/runtime/storage-failure";
import type { VaultState } from "$lib/vault.svelte";
import {
  ExtensionKeyringProvidersMessageType,
  type ExtensionKeyringProvidersMessage,
} from "$web-shared/extension/keyring-providers-message";
import {
  extensionConnectionBrowser,
  InstalledExtensionRuntimeKind,
} from "./connect";

/** The open vault whose engine seals the hand-over. */
type KeyringProvidersVault = Pick<
  VaultState,
  "enqueueStorage" | "admitManager"
>;

export enum KeyringProvidersHandOverOutcome {
  /** No extension is installed here, or the keyring has no other app. */
  NotRequired = "not-required",
  Delivered = "delivered",
}

/**
 * After this app's sync providers change, hand the keyring's remote
 * providers to the browser extension installed here, so it syncs through
 * them without setting any up. Rust seals one copy to each other app of the
 * keyring, with that app's key from the keyring's log; the extension takes
 * the copy sealed to a key it holds.
 */
export class KeyringProvidersHandOver {
  constructor(private readonly vault: KeyringProvidersVault) {}

  async deliver(): Promise<
    Result<KeyringProvidersHandOverOutcome, VaultStorageFailure>
  > {
    const installed =
      extensionConnectionBrowser.readInstalledExtensionRuntimeId();
    if (installed.kind === InstalledExtensionRuntimeKind.NotInstalled)
      return ok(KeyringProvidersHandOverOutcome.NotRequired);
    const shares = await this.vault.enqueueStorage(async () => {
      const manager = this.vault.admitManager();
      if (manager.isErr()) return err(manager.error);
      try {
        return ok(await manager.value.keyring_provider_shares());
      } catch (failure) {
        return err(new NativeVaultStorageFailure(failure));
      }
    });
    if (shares.isErr()) return err(shares.error);
    if (shares.value.apps.length === 0)
      return ok(KeyringProvidersHandOverOutcome.NotRequired);
    const message: ExtensionKeyringProvidersMessage = {
      type: ExtensionKeyringProvidersMessageType.NookExtensionKeyringProviders,
      payload: shares.value,
    };
    const delivery: Parameters<
      typeof extensionConnectionBrowser.deliverKeyringProviders
    >[0] = { extensionRuntimeId: installed.extensionRuntimeId, message };
    const delivered =
      await extensionConnectionBrowser.deliverKeyringProviders(delivery);
    return delivered
      ? ok(KeyringProvidersHandOverOutcome.Delivered)
      : err(
          new VaultStorageFailure(
            VaultStorageFailureKind.ExtensionProvidersHandOverFailed,
          ),
        );
  }
}
