import type { ExtensionPairedVaultIdentityStatusMessageStatus } from "$web-shared/extension/paired-vault-identity-status";

export type PairedExtensionResumeStatus =
  | typeof ExtensionPairedVaultIdentityStatusMessageStatus.Unavailable
  | typeof ExtensionPairedVaultIdentityStatusMessageStatus.Locked
  | typeof ExtensionPairedVaultIdentityStatusMessageStatus.Unlocked;

export type EnrollmentCodeUseRequest = {
  readonly code: string;
  readonly password: string;
};

export type PairedExtensionDiscoveryRetry = {
  readonly storeId: string;
  readonly discoveringStagedImport: boolean;
};

export type PairedExtensionUnlockPoll = {
  readonly storeId: string;
};

export type ExistingVaultPasswordUnlock = {
  readonly entryId: string;
  readonly password: string;
};
