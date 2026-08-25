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
