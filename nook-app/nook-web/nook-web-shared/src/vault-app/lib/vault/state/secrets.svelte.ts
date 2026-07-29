import type { NookSecretListItem, VaultItemType } from "$lib/nook";
type SecretTypeFilter =
  | { kind: "all-types" }
  | { kind: "filtered"; itemType: VaultItemType };
export class VaultSecretsState {
  secrets = $state<NookSecretListItem[]>([]);
  secretTotal = $state(0);
  secretPageOffset = $state(0);
  secretPageSize = 50;
  secretQuery = $state("");
  private secretTypeFilterState = $state<SecretTypeFilter>({
    kind: "all-types",
  });
  get secretTypeFilter(): VaultItemType | void {
    if (this.secretTypeFilterState.kind === "filtered")
      return this.secretTypeFilterState.itemType;
    return;
  }
  set secretTypeFilter(value: VaultItemType) {
    this.secretTypeFilterState = { kind: "filtered", itemType: value };
  }
  clearSecretTypeFilter(): void {
    this.secretTypeFilterState = { kind: "all-types" };
  }
}
