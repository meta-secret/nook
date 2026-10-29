export type EnrollmentCodeUseRequest = {
  readonly code: string;
  readonly password: string;
};

export type ExistingVaultPasswordUnlock = {
  readonly entryId: string;
  readonly password: string;
};
