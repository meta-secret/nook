export enum WorkflowValidationStatus {
  Valid = 'valid',
  Invalid = 'invalid',
}

export enum WorkflowValidationIssueKind {
  DuplicateRegistryName = 'duplicate-registry-name',
  RegistryMismatch = 'registry-mismatch',
  InvalidEntry = 'invalid-entry',
  InvalidMaterializedViewTask = 'invalid-materialized-view-task',
  InvalidReference = 'invalid-reference',
  InvalidParallelTarget = 'invalid-parallel-target',
  InvalidResourceClaim = 'invalid-resource-claim',
  InvalidJoin = 'invalid-join',
  DuplicateScheduling = 'duplicate-scheduling',
  ResourceConflict = 'resource-conflict',
  UnsupportedCapability = 'unsupported-capability',
  InsufficientTimeout = 'insufficient-timeout',
  Cycle = 'cycle',
  UnreachableNode = 'unreachable-node',
}

export type WorkflowValidationIssue = {
  readonly kind: WorkflowValidationIssueKind;
  readonly message: string;
};

export type WorkflowValidation =
  | { readonly status: WorkflowValidationStatus.Valid }
  | {
      readonly status: WorkflowValidationStatus.Invalid;
      readonly issues: readonly WorkflowValidationIssue[];
    };
