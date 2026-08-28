import { TeamKey } from '../team-agents/catalog.ts';
import type { AgentAttemptParent } from '../agent-workflow/domain.ts';

export const MODULE_DELIVERY_PLAN_VERSION = 2;
export type ModuleDeliveryPlanInputVersion =
  1 | typeof MODULE_DELIVERY_PLAN_VERSION;
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
  EvidenceSynthesis = 'evidence-synthesis',
  Write = 'write',
}

export type ModuleDeliveryTaskTeamRequest = {
  readonly kind: ModuleDeliveryTaskKind;
  readonly moduleRoot: string;
  readonly expertContextPaths: readonly string[];
};

export function moduleDeliveryTaskTeam(
  request: ModuleDeliveryTaskTeamRequest,
): TeamKey | false {
  if (request.kind === ModuleDeliveryTaskKind.Write) {
    if (request.moduleRoot.startsWith('nook-app/nook-platform/'))
      return TeamKey.DevelopmentCore;
    if (request.moduleRoot.startsWith('nook-app/nook-web/'))
      return TeamKey.WebDevelopment;
    return false;
  }
  if (request.expertContextPaths.includes('.cortex/teams/ai/AGENTS.md'))
    return TeamKey.Ai;
  if (request.expertContextPaths.includes('.cortex/teams/web-dev/AGENTS.md'))
    return TeamKey.WebDevelopment;
  if (request.expertContextPaths.includes('.cortex/teams/dev-core/AGENTS.md'))
    return TeamKey.DevelopmentCore;
  return false;
}

export enum ModuleDeliveryEvidenceInputSchema {
  AcceptedProviderEvidenceV1 = 'accepted-provider-evidence-v1',
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
  readonly evidenceSurface: readonly string[];
};

export type ModuleDeliveryAcceptance = {
  readonly commands: readonly string[];
  readonly evidence: readonly string[];
};

export type ModuleDeliveryExpectedProducerIdentity = {
  readonly taskId: string;
  readonly team: TeamKey;
  readonly functionalOwner: TeamKey;
  readonly acceptanceOwner: TeamKey;
};

export type ModuleDeliveryEvidenceInputContract = {
  readonly schema: ModuleDeliveryEvidenceInputSchema;
  readonly expectedProducers: readonly ModuleDeliveryExpectedProducerIdentity[];
};

type ModuleDeliveryNodeFields = {
  readonly taskId: string;
  readonly team: TeamKey;
  readonly functionalOwner: TeamKey;
  readonly acceptanceOwner: TeamKey;
  readonly parentLineage: AgentAttemptParent;
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

export type ModuleDeliveryReadOnlyNodeV2 = ModuleDeliveryNodeFields & {
  readonly kind: ModuleDeliveryTaskKind.ReadOnly;
};

export type ModuleDeliveryEvidenceSynthesisNodeV2 = ModuleDeliveryNodeFields & {
  readonly kind: ModuleDeliveryTaskKind.EvidenceSynthesis;
  readonly evidenceInput: ModuleDeliveryEvidenceInputContract;
};

export type ModuleDeliveryWriteNodeV2 = ModuleDeliveryNodeFields & {
  readonly kind: ModuleDeliveryTaskKind.Write;
  readonly workspace: {
    readonly kind: ModuleDeliveryWorkspaceKind.IsolatedWorktree;
    readonly expectedCommitHandoff: true;
  };
};

export type ModuleDeliveryNodeV2 =
  | ModuleDeliveryReadOnlyNodeV2
  | ModuleDeliveryEvidenceSynthesisNodeV2
  | ModuleDeliveryWriteNodeV2;

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

export type ModuleDeliveryPlanV2 = {
  readonly version: typeof MODULE_DELIVERY_PLAN_VERSION;
  readonly generation: number;
  readonly sourceCommit: string;
  readonly maxConcurrency: number;
  readonly maxAgentDepth: number;
  readonly maxAttempts: number;
  readonly parentOwnedResources: readonly string[];
  readonly parentJoin: ModuleDeliveryParentJoin;
  readonly nodes: readonly ModuleDeliveryNodeV2[];
  readonly edgeContracts: readonly ModuleDeliveryEdgeContract[];
};

export type LegacyModuleDeliveryResourceClaims = {
  readonly read: readonly string[];
  readonly write: readonly string[];
};

export type LegacyModuleDeliveryAcceptance = {
  readonly commands: readonly string[];
  readonly evidence: readonly string[];
};

type LegacyModuleDeliveryNodeFields = {
  readonly taskId: string;
  readonly expert: string;
  readonly moduleRoot: string;
  readonly consumerOutcome: string;
  readonly baseline: ModuleDeliveryBaseline;
  readonly agentDepthLimit: number;
  readonly dependencies: readonly string[];
  readonly resources: LegacyModuleDeliveryResourceClaims;
  readonly parentOwnedExclusions: readonly string[];
  readonly acceptance: LegacyModuleDeliveryAcceptance;
};

export type LegacyReadOnlyModuleDeliveryNode =
  LegacyModuleDeliveryNodeFields & {
    readonly kind: ModuleDeliveryTaskKind.ReadOnly;
  };

export type LegacyWriteModuleDeliveryNode = LegacyModuleDeliveryNodeFields & {
  readonly kind: ModuleDeliveryTaskKind.Write;
  readonly workspace: {
    readonly kind: ModuleDeliveryWorkspaceKind.IsolatedWorktree;
    readonly expectedCommitHandoff: true;
  };
};

export type LegacyModuleDeliveryNode =
  LegacyReadOnlyModuleDeliveryNode | LegacyWriteModuleDeliveryNode;

export type LegacyModuleDeliveryPlan = {
  readonly version: 1;
  readonly sourceCommit: string;
  readonly maxConcurrency: number;
  readonly maxAgentDepth: number;
  readonly maxAttempts: number;
  readonly parentOwnedResources: readonly string[];
  readonly parentJoin: ModuleDeliveryParentJoin;
  readonly nodes: readonly LegacyModuleDeliveryNode[];
  readonly edgeContracts: readonly ModuleDeliveryEdgeContract[];
};

export type ReadOnlyModuleDeliveryNode =
  LegacyReadOnlyModuleDeliveryNode | ModuleDeliveryReadOnlyNodeV2;
export type WriteModuleDeliveryNode =
  LegacyWriteModuleDeliveryNode | ModuleDeliveryWriteNodeV2;
export type ModuleDeliveryNode =
  LegacyModuleDeliveryNode | ModuleDeliveryNodeV2;

export type ModuleDeliveryPlanInput =
  LegacyModuleDeliveryPlan | ModuleDeliveryPlanV2;

export type ModuleDeliveryPlan = ModuleDeliveryPlanInput;

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
  EvidenceSurfaceMismatch = 'evidence-surface-mismatch',
  TeamOwnershipMismatch = 'team-ownership-mismatch',
  ParentLineageMismatch = 'parent-lineage-mismatch',
  EvidenceInputMismatch = 'evidence-input-mismatch',
  AcceptanceOwnershipMismatch = 'acceptance-ownership-mismatch',
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

export enum ModuleDeliveryCompatibilityStatus {
  Decoded = 'decoded',
  Rejected = 'rejected',
}

export type DecodedCompatibleModuleDeliveryPlan = {
  readonly status: ModuleDeliveryCompatibilityStatus.Decoded;
  readonly inputVersion: ModuleDeliveryPlanInputVersion;
  readonly plan: ModuleDeliveryPlanV2;
};

export type RejectedCompatibleModuleDeliveryPlan = {
  readonly status: ModuleDeliveryCompatibilityStatus.Rejected;
  readonly issues: readonly ModuleDeliveryIssue[];
};

export type CompatibleModuleDeliveryPlanDecode =
  DecodedCompatibleModuleDeliveryPlan | RejectedCompatibleModuleDeliveryPlan;

export type ValidatedModuleDeliveryPlan = {
  readonly status: ModuleDeliveryValidationStatus.Accepted;
  readonly inputVersion: typeof MODULE_DELIVERY_PLAN_VERSION;
  readonly plan: ModuleDeliveryPlanV2;
  readonly planDigest: string;
  readonly topologicalOrder: readonly string[];
  readonly waves: readonly (readonly string[])[];
  readonly executionPrecedence: readonly ModuleDeliveryExecutionPrecedence[];
};

export enum ModuleDeliveryExecutionPrecedenceReason {
  DeclaredDependency = 'declared-dependency',
  EvidenceHazard = 'evidence-hazard',
  ResourceConflict = 'resource-conflict',
}

export type ModuleDeliveryExecutionPrecedence = {
  readonly predecessorTaskId: string;
  readonly successorTaskId: string;
  readonly reason: ModuleDeliveryExecutionPrecedenceReason;
  readonly requiresIntegratedWriterFrontier: boolean;
};

export type RejectedModuleDeliveryPlan = {
  readonly status: ModuleDeliveryValidationStatus.Rejected;
  readonly issues: readonly ModuleDeliveryIssue[];
};

export type ModuleDeliveryPlanValidation =
  ValidatedModuleDeliveryPlan | RejectedModuleDeliveryPlan;
