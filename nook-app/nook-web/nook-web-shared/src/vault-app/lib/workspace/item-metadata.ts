import type { NookSecretListItem, SecretType } from "$lib/nook";

/** A screen owns only copied public metadata; the vault frees WASM pages on refresh. */
export interface WorkspaceItem {
  readonly id: string;
  readonly type: SecretType;
  readonly displayTitle: string;
  readonly summary: string;
}

export function workspaceItem(item: NookSecretListItem): WorkspaceItem {
  return {
    id: item.id,
    type: item.type,
    displayTitle: item.displayTitle,
    summary: item.summary,
  };
}
