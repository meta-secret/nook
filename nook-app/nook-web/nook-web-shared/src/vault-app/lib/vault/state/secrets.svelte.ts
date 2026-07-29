import type { NookSecretListItem, VaultItemType } from "$lib/nook";
enum SecretTypeFilterKind {
  AllTypes = "all-types",
  Filtered = "filtered",
}

type SecretTypeFilter =
  | { kind: SecretTypeFilterKind.AllTypes }
  | { kind: SecretTypeFilterKind.Filtered; itemType: VaultItemType };
export class VaultSecretsState {
  secrets = $state<NookSecretListItem[]>([]);
  secretTotal = $state(0);
  secretPageOffset = $state(0);
  secretPageSize = 50;
  secretQuery = $state("");
  private secretTypeFilterState = $state<SecretTypeFilter>({
    kind: SecretTypeFilterKind.AllTypes,
  });
  get secretTypeFilter(): VaultItemType | void {
    if (this.secretTypeFilterState.kind === SecretTypeFilterKind.Filtered)
      return this.secretTypeFilterState.itemType;
    return;
  }
  set secretTypeFilter(value: VaultItemType) {
    this.secretTypeFilterState = {
      kind: SecretTypeFilterKind.Filtered,
      itemType: value,
    };
  }
  clearSecretTypeFilter(): void {
    this.secretTypeFilterState = { kind: SecretTypeFilterKind.AllTypes };
  }
}
