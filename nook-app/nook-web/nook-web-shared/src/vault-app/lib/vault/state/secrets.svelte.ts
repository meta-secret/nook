import type { NookSecretListItem, VaultItemType } from "$lib/nook";
export class VaultSecretsState {
  secrets = $state<NookSecretListItem[]>([]);
  secretTotal = $state(0);
  secretPageOffset = $state(0);
  secretPageSize = 50;
  secretQuery = $state("");
  secretTypeFilter = $state<VaultItemType>();
}
