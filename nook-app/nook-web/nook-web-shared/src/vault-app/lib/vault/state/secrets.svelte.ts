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
  get secretTypeFilter(): VaultItemType | undefined {
    return this.secretTypeFilterState.kind === "present"
      ? this.secretTypeFilterState.value
      : undefined;
  }
  set secretTypeFilter(value: VaultItemType | undefined) {
    this.secretTypeFilterState =
      value === undefined ? EMPTY_VALUE : presentValue(value);
  }
}
