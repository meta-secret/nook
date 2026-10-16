import { untrack } from "svelte";
import { I18N_KEYS } from "../../../../generated/i18n-keys";
import type { VaultState } from "$lib/vault.svelte";
import { ActiveVaultKind } from "$lib/vault/state/provider.svelte";
import { IdentityDirectoryLoadKind } from "$lib/components/devices-access/identity-directory-view";
import { IdentityDirectoryLoader } from "./identity-directory-loader.svelte";
import {
  IdentityCardProjection,
  type IdentityCardSource,
  type IdentityLocalVault,
} from "./identity-card-model";

/**
 * The identity directory and this browser's vaults, projected into cards.
 * Construct it while a component initializes: it re-reads the directory and
 * the unlocked identity's control log whenever this browser's vaults change.
 */
export class IdentityCards {
  readonly loader: IdentityDirectoryLoader;

  constructor(private readonly vault: VaultState) {
    this.loader = new IdentityDirectoryLoader(vault);
    $effect(() => {
      void vault.hasManager;
      void vault.isAuthenticated;
      void vault.deviceProtectionStatus;
      void vault.localVaults.length;
      void vault.activeVault.kind;
      void this.loader.reload();
    });
    // Vaults the unlocked identity's log lists, stored here or not: read
    // again whenever this browser's vault catalog changes.
    $effect(() => {
      if (!vault.isAuthenticated) return;
      void vault.localVaults.length;
      void untrack(() => vault.identityControl.loadSnapshot());
    });
  }

  get localVaults(): IdentityLocalVault[] {
    const unnamedLabel = this.vault.t(I18N_KEYS.LoginVaultPickerUnnamed);
    return this.vault.localVaults.map((entry) => {
      const local: IdentityLocalVault = {
        storeId: entry.storeId,
        label: entry.display_label(unnamedLabel),
      };
      return local;
    });
  }

  private get currentLogVaults(): string[] {
    const snapshot = this.vault.identityControl.snapshot;
    return this.vault.isAuthenticated && snapshot !== false
      ? snapshot.vaults.map((entry) => entry.storeId)
      : [];
  }

  get projection(): IdentityCardProjection {
    const state = this.loader.state;
    const activeVault = this.vault.activeVault;
    const source: IdentityCardSource = {
      identities:
        state.kind === IdentityDirectoryLoadKind.Ready
          ? state.view.identities
          : [],
      localVaults: this.localVaults,
      currentLogVaults: this.currentLogVaults,
      openStoreId:
        activeVault.kind === ActiveVaultKind.Open ? activeVault.storeId : "",
      authenticated: this.vault.isAuthenticated,
      identityUnlocked:
        this.vault.isAuthenticated || this.vault.deviceProtectionReady,
    };
    return new IdentityCardProjection(source);
  }
}
