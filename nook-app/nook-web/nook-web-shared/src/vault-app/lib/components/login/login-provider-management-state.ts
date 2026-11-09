import { PickerRow } from "$lib/components/provider-picker-state";

/** The local-folder row is hidden while a Sentinel vault delivers its
 * shares. */
export class LocalFolderPickerRow {
  static of(deliveringShares: boolean): PickerRow {
    switch (deliveringShares) {
      case true:
        return PickerRow.Hidden;
      case false:
        return PickerRow.Offered;
    }
  }
}
