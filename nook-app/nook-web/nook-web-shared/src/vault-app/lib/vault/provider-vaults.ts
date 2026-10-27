import type { LocalVaultOccupancy, NookImportResult, StoreId } from "$app-wasm";
import { err, ok, type Result } from "neverthrow";
import { I18N_KEYS } from "../../../generated/i18n-keys";
import {
  NativeVaultStorageFailure,
  type VaultStorageFailure,
} from "$lib/runtime/storage-failure";
import type { VaultState } from "$lib/vault.svelte";
import { ActiveVaultKind } from "$lib/vault/state/provider.svelte";

export enum EmptyVaultReplacementKind {
  Idle = "idle",
  /** Confirmed: once the chosen vault is imported, the empty one goes. */
  Pending = "pending",
}

/** The empty vault this device swaps for one a provider holds. */
export interface EmptyVaultSwap {
  readonly emptyStoreId: StoreId;
  readonly replacementStoreId: StoreId;
}

export type EmptyVaultReplacementPlan =
  | { readonly kind: EmptyVaultReplacementKind.Idle }
  | ({ readonly kind: EmptyVaultReplacementKind.Pending } & EmptyVaultSwap);

export enum ProviderVaultImportStart {
  /** The login screen imports the chosen vault on Connect & sync. */
  ConnectNow = "connect-now",
  /** The identity locks; the login screen continues the import. */
  AfterLock = "after-lock",
  Refused = "refused",
}

/**
 * Owns what the setup and recovery screens do with the vaults a provider
 * already holds. Rust lists and classifies them; this only routes the
 * user's choice into the existing import flow.
 */
export class ProviderVaultActions {
  constructor(private readonly vault: VaultState) {}

  /** The vault open on this device, for the empty-vault replacement offer. */
  localVaultOccupancy(): LocalVaultOccupancy {
    const vault = this.vault;
    const active = vault.activeVault;
    if (!vault.isAuthenticated || active.kind !== ActiveVaultKind.Open)
      return { state: "closed" };
    return {
      state: "open",
      storeId: active.storeId,
      itemCount: vault.secretTotal,
      identityAppCount: vault.identityControl.memberCount(
        vault.vaultMembers.length,
      ),
    };
  }

  /**
   * Import another identity's vault as a separate vault. The login screen
   * imports it through the existing recovery flow with this vault chosen;
   * the unlocked workspace locks first and the login screen continues, as
   * "Import from sync provider" does. A vault that cannot be opened there
   * fails visibly in that flow.
   */
  importSeparately(storeId: StoreId): ProviderVaultImportStart {
    const vault = this.vault;
    if (vault.isAuthenticated) {
      vault.cancelAddProvider();
      vault.vaultImportOpen = true;
      void vault.lockVault();
      return ProviderVaultImportStart.AfterLock;
    }
    if (!vault.loginRequiresExistingVault) vault.beginExistingVaultOpen();
    const chosen = vault.chooseRemoteVault(storeId);
    if (chosen.isErr()) {
      vault.errorMsg = vault.t(chosen.error.translationKey);
      return ProviderVaultImportStart.Refused;
    }
    return ProviderVaultImportStart.ConnectNow;
  }

  /**
   * After the user confirmed it: import the chosen vault, then delete the
   * empty open vault it replaces. Nothing is merged; the empty vault holds
   * no records and no other app.
   */
  replaceEmptyVault(swap: EmptyVaultSwap): ProviderVaultImportStart {
    const plan: EmptyVaultReplacementPlan = {
      kind: EmptyVaultReplacementKind.Pending,
      ...swap,
    };
    this.vault.emptyVaultReplacement = plan;
    return this.importSeparately(swap.replacementStoreId);
  }

  /** Once the chosen vault is open, delete the empty vault it replaces. */
  async completeEmptyVaultReplacement(): Promise<void> {
    const vault = this.vault;
    const plan = vault.emptyVaultReplacement;
    if (plan.kind !== EmptyVaultReplacementKind.Pending) return;
    const active = vault.activeVault;
    if (
      !vault.isAuthenticated ||
      active.kind !== ActiveVaultKind.Open ||
      active.storeId !== plan.replacementStoreId
    )
      return;
    vault.emptyVaultReplacement = { kind: EmptyVaultReplacementKind.Idle };
    const deleted = await vault.identityControl.deleteVaultEverywhere(
      plan.emptyStoreId,
    );
    if (deleted.isOk())
      vault.showSuccess(vault.t(I18N_KEYS.ProviderVaultsReplaced));
  }
}

export enum ProviderVaultAccessRequest {
  /** The join request is in the vault's subfolder. */
  Saved = "saved",
}

export enum ProviderVaultOpeningKind {
  /** The vault's backup password, typed by the user. */
  BackupPassword = "backup-password",
  /** The key a member granted this device. */
  GrantedKey = "granted-key",
}

/** How the user opens a provider vault to merge it. */
export type ProviderVaultOpening =
  | {
      readonly kind: ProviderVaultOpeningKind.BackupPassword;
      readonly password: string;
    }
  | { readonly kind: ProviderVaultOpeningKind.GrantedKey };

/** One vault of the signed-in Google account's Nook folder. */
export interface GoogleDriveVaultTarget {
  readonly accessToken: string;
  readonly storeId: StoreId;
}

export interface ProviderVaultMerge extends GoogleDriveVaultTarget {
  readonly opening: ProviderVaultOpening;
}

/**
 * Owns what this device does with a Nook-folder vault another identity
 * holds: merge its records into the open vault, or ask its members for
 * access. Rust opens and imports; this routes the calls through the
 * storage queue and reports the outcome.
 */
export class ProviderVaultAccessActions {
  constructor(private readonly vault: VaultState) {}

  /** Copy the vault's records into the open vault; returns how many came in. */
  async mergeIntoOpen(
    request: ProviderVaultMerge,
  ): Promise<Result<number, VaultStorageFailure>> {
    const vault = this.vault;
    vault.errorMsg = "";
    vault.dismissSuccess();
    vault.isSaving = true;
    try {
      const merged = await vault.enqueueStorage(async () => {
        const manager = vault.admitManager();
        if (manager.isErr()) return err(manager.error);
        try {
          const { accessToken, storeId, opening } = request;
          const imported: NookImportResult =
            opening.kind === ProviderVaultOpeningKind.BackupPassword
              ? await manager.value.merge_google_drive_vault_with_password(
                  accessToken,
                  storeId,
                  opening.password,
                )
              : await manager.value.merge_google_drive_vault_with_app_key(
                  accessToken,
                  storeId,
                );
          return ok(imported);
        } catch (failure) {
          return err(new NativeVaultStorageFailure(failure));
        }
      });
      if (merged.isErr()) return err(merged.error);
      const count = merged.value.imported;
      merged.value.free();
      const synchronized = await vault.runFanOutSyncAfterLocalSave();
      if (synchronized.isErr()) return err(synchronized.error);
      const refreshed = await vault.refreshSecretsFromSession();
      if (refreshed.isErr()) return err(refreshed.error);
      const toast: Parameters<typeof vault.t>[0] = {
        key: I18N_KEYS.ProviderVaultsMerged,
        replacements: { count: String(count) },
      };
      vault.showSuccess(vault.t(toast));
      return ok(count);
    } finally {
      vault.isSaving = false;
    }
  }

  /** Write this device's join request into the vault's subfolder. */
  async requestAccess({
    accessToken,
    storeId,
  }: GoogleDriveVaultTarget): Promise<
    Result<ProviderVaultAccessRequest, VaultStorageFailure>
  > {
    const vault = this.vault;
    vault.errorMsg = "";
    vault.dismissSuccess();
    const requested = await vault.enqueueStorage(async () => {
      const manager = vault.admitManager();
      if (manager.isErr()) return err(manager.error);
      try {
        await manager.value.request_google_drive_vault_access(
          accessToken,
          storeId,
        );
        return ok(ProviderVaultAccessRequest.Saved);
      } catch (failure) {
        return err(new NativeVaultStorageFailure(failure));
      }
    });
    if (requested.isErr()) return err(requested.error);
    vault.showSuccess(vault.t(I18N_KEYS.ProviderVaultsAccessRequestedToast));
    return ok(ProviderVaultAccessRequest.Saved);
  }
}
