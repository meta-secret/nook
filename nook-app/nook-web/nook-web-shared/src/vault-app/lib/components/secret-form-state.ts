import type { VaultItemType } from "$lib/nook";

export type SecretTypeSelection =
  | { kind: "choosing-type" }
  | { kind: "editing-fields"; itemType: VaultItemType };
