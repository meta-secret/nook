import { err, ok, type Result } from "neverthrow";
import {
  NativeVaultStorageFailure,
  type VaultStorageFailure,
} from "$lib/runtime/storage-failure";
import type { VaultState } from "$lib/vault.svelte";
import type { ExtensionConnectRequest } from "./connect";
import {
  ExtensionKeyringGrantKind,
  type ExtensionKeyringGrant,
  type ExtensionKeyringVault,
} from "$web-shared/extension/keyring-grant-wire";

export type ExtensionKeyringMembershipRequest = {
  readonly vault: VaultState;
  readonly request: ExtensionConnectRequest;
  /** The vault the approval carries itself; the grant lists the others. */
  readonly approvedStoreId: string;
};

/**
 * The browser extension is an app of the keyring with a key of its own.
 * The web app adds it by the keys its connect request carried, so every
 * vault's DEK is encrypted to that key, and hands it the keyring's log and
 * the records of the keyring's other vaults this browser holds. The
 * extension joins and opens them from those, with no sync provider; the
 * keyring's providers carry the new member to its other apps.
 */
export class ExtensionKeyringMembership {
  constructor(private readonly membership: ExtensionKeyringMembershipRequest) {}

  async grant(): Promise<Result<ExtensionKeyringGrant, VaultStorageFailure>> {
    const { vault, request, approvedStoreId } = this.membership;
    // The keyring's log exists once one of its vaults is open here.
    const refreshed = await vault.identityControl.refresh();
    if (refreshed.isErr()) return err(refreshed.error);
    const added = await vault.enqueueStorage(async () => {
      const manager = vault.admitManager();
      if (manager.isErr()) return err(manager.error);
      try {
        return ok(
          await manager.value.add_identity_member(
            request.deviceId,
            request.devicePublicKey,
            request.deviceSigningPublicKey,
            request.deviceLabel,
          ),
        );
      } catch (failure) {
        return err(new NativeVaultStorageFailure(failure));
      }
    });
    if (added.isErr()) return err(added.error);
    const synced = await vault.identityControl.syncWithMounts();
    if (synced.isErr()) return err(synced.error);
    const snapshot = vault.identityControl.snapshot;
    const identityLabel = snapshot === false ? "" : snapshot.identityLabel;
    const otherStoreIds =
      snapshot === false
        ? []
        : snapshot.vaults
            .map((keyringVault) => keyringVault.storeId)
            .filter((storeId) => storeId !== approvedStoreId);
    return vault.enqueueStorage(async () => {
      const manager = vault.admitManager();
      if (manager.isErr()) return err(manager.error);
      try {
        const log = await manager.value.export_identity_log();
        const vaults: ExtensionKeyringVault[] = [];
        for (const storeId of otherStoreIds) {
          const records =
            await manager.value.export_vault_event_log_records_js(storeId);
          try {
            const eventLogRecords = records.to_array();
            // A vault this browser does not hold reaches the extension
            // through the keyring's sync providers.
            if (eventLogRecords.length === 0) continue;
            const keyringVault: ExtensionKeyringVault = {
              storeId,
              eventLogRecords,
            };
            vaults.push(keyringVault);
          } finally {
            records.free();
          }
        }
        const keyring: ExtensionKeyringGrant = {
          kind: ExtensionKeyringGrantKind.Added,
          identityId: log.identityId,
          identityLabel,
          identityEvents: log.events,
          vaults,
        };
        return ok(keyring);
      } catch (failure) {
        return err(new NativeVaultStorageFailure(failure));
      }
    });
  }
}
