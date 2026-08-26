export const MODULE_DELIVERY_PLAN_VERSION = 1;
export const MAX_MODULE_DELIVERY_NODES = 64;
export const MAX_MODULE_DELIVERY_CONCURRENCY = 16;
export const MAX_MODULE_DELIVERY_AGENT_DEPTH = 3;
export const MAX_MODULE_DELIVERY_ATTEMPTS = 5;

export const REQUIRED_PARENT_OWNED_RESOURCES = [
  '.cortex/**',
  '.github/**',
  'Cargo.lock',
  'Taskfile.yml',
  'bun.lock',
  'git:branch',
  'git:index',
  'git:worktree',
  'package.json',
] as const;

export enum ModuleDeliveryTaskKind {
  ReadOnly = 'read-only',
  Write = 'write',
}

export enum ModuleDeliveryWorkspaceKind {
  IsolatedWorktree = 'isolated-worktree',
}

export enum ModuleDeliveryJoinKind {
  OrderedCommitHandoffs = 'ordered-commit-handoffs',
}

export enum ModuleDeliveryBaselineKind {
  SourceCommit = 'source-commit',
  IntegratedDependencies = 'integrated-dependencies',
}

export type SourceCommitBaseline = {
  readonly kind: ModuleDeliveryBaselineKind.SourceCommit;
  readonly sourceCommit: string;
};

export type IntegratedDependenciesBaseline = {
  readonly kind: ModuleDeliveryBaselineKind.IntegratedDependencies;
  readonly providerTaskIds: readonly string[];
};

export type ModuleDeliveryBaseline =
  SourceCommitBaseline | IntegratedDependenciesBaseline;

export type ModuleDeliveryResourceClaims = {
  readonly read: readonly string[];
  readonly write: readonly string[];
};

export type ModuleDeliveryAcceptance = {
  readonly commands: readonly string[];
  readonly evidence: readonly string[];
};

type ModuleDeliveryNodeFields = {
  readonly taskId: string;
  readonly expert: string;
  readonly moduleRoot: string;
  readonly consumerOutcome: string;
  readonly baseline: ModuleDeliveryBaseline;
  readonly agentDepthLimit: number;
  readonly dependencies: readonly string[];
  readonly resources: ModuleDeliveryResourceClaims;
  readonly parentOwnedExclusions: readonly string[];
  readonly acceptance: ModuleDeliveryAcceptance;
};

export type ReadOnlyModuleDeliveryNode = ModuleDeliveryNodeFields & {
  readonly kind: ModuleDeliveryTaskKind.ReadOnly;
};

export type WriteModuleDeliveryNode = ModuleDeliveryNodeFields & {
  readonly kind: ModuleDeliveryTaskKind.Write;
  readonly workspace: {
    readonly kind: ModuleDeliveryWorkspaceKind.IsolatedWorktree;
    readonly expectedCommitHandoff: true;
  };
};

export type ModuleDeliveryNode =
  ReadOnlyModuleDeliveryNode | WriteModuleDeliveryNode;

export type ModuleDeliveryEdgeContract = {
  readonly providerTaskId: string;
  readonly consumerTaskId: string;
  readonly capability: string;
  readonly publicTypes: readonly string[];
  readonly errors: readonly string[];
  readonly behaviorInvariants: readonly string[];
  readonly securityInvariants: readonly string[];
  readonly compatibilityExpectations: readonly string[];
  readonly owningTests: readonly string[];
};

export type ModuleDeliveryParentJoin = {
  readonly kind: ModuleDeliveryJoinKind.OrderedCommitHandoffs;
  readonly owner: string;
  readonly validationCommands: readonly string[];
};

export type ModuleDeliveryPlan = {
  readonly version: typeof MODULE_DELIVERY_PLAN_VERSION;
  readonly sourceCommit: string;
  readonly maxConcurrency: number;
  readonly maxAgentDepth: number;
  readonly maxAttempts: number;
  readonly parentOwnedResources: readonly string[];
  readonly parentJoin: ModuleDeliveryParentJoin;
  readonly nodes: readonly ModuleDeliveryNode[];
  readonly edgeContracts: readonly ModuleDeliveryEdgeContract[];
};

export enum ModuleDeliveryIssueCode {
  MalformedTransport = 'malformed-transport',
  InvalidField = 'invalid-field',
  DuplicateValue = 'duplicate-value',
  UnknownExpert = 'unknown-expert',
  ModuleOwnershipMismatch = 'module-ownership-mismatch',
  WriteScopeMismatch = 'write-scope-mismatch',
  BaselineMismatch = 'baseline-mismatch',
  MissingDependency = 'missing-dependency',
  SelfDependency = 'self-dependency',
  DependencyCycle = 'dependency-cycle',
  MissingEdgeContract = 'missing-edge-contract',
  UnexpectedEdgeContract = 'unexpected-edge-contract',
  ResourceConflict = 'resource-conflict',
  ParentOwnedWrite = 'parent-owned-write',
  MissingParentOwnedResource = 'missing-parent-owned-resource',
  LimitExceeded = 'limit-exceeded',
}

export type ModuleDeliveryIssue = {
  readonly code: ModuleDeliveryIssueCode;
  readonly path: string;
  readonly message: string;
};

export enum ModuleDeliveryValidationStatus {
  Accepted = 'accepted',
  Rejected = 'rejected',
}

export type AcceptedModuleDeliveryPlan = {
  readonly status: ModuleDeliveryValidationStatus.Accepted;
  readonly plan: ModuleDeliveryPlan;
  readonly planDigest: string;
  readonly topologicalOrder: readonly string[];
  readonly waves: readonly (readonly string[])[];
};

export type RejectedModuleDeliveryPlan = {
  readonly status: ModuleDeliveryValidationStatus.Rejected;
  readonly issues: readonly ModuleDeliveryIssue[];
};

export type ModuleDeliveryPlanValidation =
  AcceptedModuleDeliveryPlan | RejectedModuleDeliveryPlan;
