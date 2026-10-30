import { err, ok, type Result } from "neverthrow";
import {
  NativeVaultStorageFailure,
  VaultStorageFailure,
  VaultStorageFailureKind,
} from "$lib/runtime/storage-failure";
import type { NookVaultManager } from "$app-wasm";
import type { VaultState } from "$lib/vault.svelte";
import type { ExtensionConnectRequest } from "./connect";
import type { ExtensionKeyringApproval } from "$web-shared/extension/runtime-messages";
import type { ExtensionKeyringVault } from "$web-shared/extension/keyring-grant-wire";

export type ExtensionKeyringMembershipRequest = {
  readonly vault: VaultState;
  readonly request: ExtensionConnectRequest;
  /** The engine the approval started with, while it is still the open one;
   * a lock or another keyring meanwhile refuses. */
  readonly admitManager: () => Result<NookVaultManager, VaultStorageFailure>;
};

/** The keyring the extension joins: its log and the vaults this browser
 * holds, none for a keyring with no vault yet. */
export type ExtensionKeyringHandOver = Pick<
  ExtensionKeyringApproval,
  "identityId" | "identityLabel" | "identityEvents" | "vaults"
>;

/** The keyring the extension was added to. */
export type ExtensionKeyringMember = {
  readonly identityId: string;
};

/**
 * The browser extension is an app of the keyring with a key of its own.
 * The web app adds it by the keys its connect request carried, so every
 * vault's DEK is encrypted to that key, and hands it the keyring's log and
 * the records of the keyring's vaults this browser holds. The extension
 * joins and opens them from those, with no sync provider; the keyring's
 * providers carry the new member to its other apps. Only the unlocked
 * keyring is needed: no vault has to be open, or exist.
 */
export class ExtensionKeyringMembership {
  constructor(private readonly membership: ExtensionKeyringMembershipRequest) {}

  /** Add the extension to the unlocked keyring and publish the change. */
  async add(): Promise<Result<ExtensionKeyringMember, VaultStorageFailure>> {
    const { vault, request, admitManager } = this.membership;
    // Creates the keyring's log when this browser has none yet.
    const refreshed = await vault.identityControl.refresh();
    if (refreshed.isErr()) return err(refreshed.error);
    const added = await vault.enqueueStorage(async () => {
      const manager = admitManager();
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
    if (snapshot === false)
      return err(
        new VaultStorageFailure(
          VaultStorageFailureKind.ExtensionApprovalContextChanged,
        ),
      );
    const member: ExtensionKeyringMember = { identityId: snapshot.identityId };
    return ok(member);
  }

  /** The keyring's log and its vaults' records, for the keyring `member`
   * names; one switched to meanwhile is not handed over. */
  async handOver(
    member: ExtensionKeyringMember,
  ): Promise<Result<ExtensionKeyringHandOver, VaultStorageFailure>> {
    const { vault, admitManager } = this.membership;
    const snapshot = vault.identityControl.snapshot;
    if (snapshot === false || snapshot.identityId !== member.identityId)
      return err(
        new VaultStorageFailure(
          VaultStorageFailureKind.ExtensionApprovalContextChanged,
        ),
      );
    const storeIds = snapshot.vaults.map(
      (keyringVault) => keyringVault.storeId,
    );
    return vault.enqueueStorage(async () => {
      const manager = admitManager();
      if (manager.isErr()) return err(manager.error);
      try {
        const log = await manager.value.export_identity_log();
        if (log.identityId !== member.identityId)
          return err(
            new VaultStorageFailure(
              VaultStorageFailureKind.ExtensionApprovalContextChanged,
            ),
          );
        const vaults: ExtensionKeyringVault[] = [];
        for (const storeId of storeIds) {
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
        const handOver: ExtensionKeyringHandOver = {
          identityId: log.identityId,
          identityLabel: snapshot.identityLabel,
          identityEvents: log.events,
          vaults,
        };
        return ok(handOver);
      } catch (failure) {
        return err(new NativeVaultStorageFailure(failure));
      }
    });
  }
}
