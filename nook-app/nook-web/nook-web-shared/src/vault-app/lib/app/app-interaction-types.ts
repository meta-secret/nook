import type { InviteKeyEntry } from "$lib/vault/invite-join-keys";

export type EnrollmentCodeUseRequest = {
  readonly code: string;
  readonly password: string;
  /** Keys typed for providers whose key this device adds. */
  readonly keys: readonly InviteKeyEntry[];
};

export type ExistingVaultPasswordUnlock = {
  readonly entryId: string;
  readonly password: string;
};
