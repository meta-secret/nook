import type { NookSecretListItem, VaultItemType } from "$lib/nook";
import {
  EMPTY_VALUE,
  presentValue,
  type ValueState,
} from "../../../../explicit-state";
export class VaultSecretsState {
  secrets = $state<NookSecretListItem[]>([]);
  secretTotal = $state(0);
  secretPageOffset = $state(0);
  secretPageSize = 50;
  secretQuery = $state("");
  private secretTypeFilterState =
    $state<ValueState<VaultItemType>>(EMPTY_VALUE);
  get secretTypeFilter(): VaultItemType | void {
    if (this.secretTypeFilterState.kind === "present")
      return this.secretTypeFilterState.value;
    return;
  }
  set secretTypeFilter(value: VaultItemType | void) {
    this.secretTypeFilterState =
      typeof value === "undefined" ? EMPTY_VALUE : presentValue(value);
  }
  clearSecretTypeFilter(): void {
    this.secretTypeFilterState = EMPTY_VALUE;
  }
}
