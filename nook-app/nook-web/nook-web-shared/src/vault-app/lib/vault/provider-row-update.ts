import type { StorageProvider } from "$lib/auth/providers";
import type { ProviderPersistenceOptions } from "$lib/vault/providers.svelte";
import type { VaultState } from "$lib/vault.svelte";

/** Saves one changed provider row in place of the saved one: the save seals
 * its credentials as every provider save does. */
export class ProviderRowUpdate {
  constructor(private readonly vault: VaultState) {}

  save(row: StorageProvider): ReturnType<VaultState["persistProviders"]> {
    const vault = this.vault;
    const persistence: ProviderPersistenceOptions = {
      replace: true,
      providers: vault.providers.map((saved) =>
        saved.id === row.id ? row : saved,
      ),
    };
    return vault.persistProviders(persistence);
  }
}
