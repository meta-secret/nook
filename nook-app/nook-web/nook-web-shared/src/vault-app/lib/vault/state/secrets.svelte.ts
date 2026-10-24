import { NookSecretTypeFilter, SecretCategory } from "$app-wasm";
import type { NookSecretListItem } from "$lib/nook";
import { VaultSections } from "../secret-sections";

export class VaultSecretsState {
  secrets = $state<NookSecretListItem[]>([]);
  secretTotal = $state(0);
  secretPageOffset = $state(0);
  secretPageSize = 50;
  secretQuery = $state("");
  /** The vault page section; its filters never list the other section's records. */
  secretSection = $state(SecretCategory.Secrets);
  secretTypeFilter = $state(NookSecretTypeFilter.Secrets);

  /** Show every type of the section; the caller reloads the page. */
  selectSecretSection(section: SecretCategory): void {
    this.secretSection = section;
    this.secretTypeFilter = VaultSections.allFilter(section);
  }

  clearSecretTypeFilter(): void {
    this.selectSecretSection(SecretCategory.Secrets);
  }
}
