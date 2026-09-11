export enum ExpertIsolationFailureKind {
  Authentication = 'isolationAuthentication',
  Cleanup = 'isolationCleanup',
  SourceCommit = 'isolationSourceCommit',
  Profile = 'isolationProfile',
  Snapshot = 'isolationSnapshot',
  ContextFiles = 'isolationContextFiles',
  Storage = 'isolationStorage',
}

export type ExpertIsolationFailure = {
  readonly kind: ExpertIsolationFailureKind;
  readonly message: string;
};
