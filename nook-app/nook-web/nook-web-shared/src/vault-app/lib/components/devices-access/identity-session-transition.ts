import type { VaultState } from "$lib/vault.svelte";
import { set_vault_session_locked } from "$app-wasm";

/** Clears the vault state owned by the previously selected identity. */
export class IdentitySessionTransition {
  constructor(private readonly vault: VaultState) {}

  clearPriorIdentity(): void {
    set_vault_session_locked(true);
    this.vault.clearUnlockedSession(false);
    this.vault.clearIdentityProviderSession();
    this.vault.localVaultPresent = false;
    this.vault.providersLoaded = false;
  }
}
