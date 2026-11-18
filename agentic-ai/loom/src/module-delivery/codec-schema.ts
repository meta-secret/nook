import type { UntrustedYamlNode } from '../lib/guards.ts';
import type { ModuleDeliveryIssueCode } from './domain.ts';

export type ModulePlanIndexedNodeRequest = {
  readonly value: UntrustedYamlNode;
  readonly index: number;
};

export type ModuleDeliveryTeamDecodeRequest = {
  readonly value: string;
  readonly path: string;
};

export type ModuleDeliveryOwnerDecodeRequest =
  ModuleDeliveryTeamDecodeRequest & {
    readonly allowGizmoPrime: boolean;
  };

export type ModulePlanIndexedProducerRequest = {
  readonly value: UntrustedYamlNode;
  readonly index: number;
  readonly path: string;
};

export type RejectedModulePlanRequest = {
  readonly code: ModuleDeliveryIssueCode;
  readonly path?: string;
  readonly message: string;
};

/** Current branch-authoritative plan shape. Feature heads are resolved by Delivery. */
export enum ModulePlanV7RootField {
  BaseBranch = 'baseBranch',
  EdgeContracts = 'edgeContracts',
  FeatureBranch = 'featureBranch',
  Generation = 'generation',
  Nodes = 'nodes',
  ParentJoin = 'parentJoin',
  ParentOwnedResources = 'parentOwnedResources',
  Version = 'version',
}

export enum ModulePlanParentJoinField {
  Kind = 'kind',
  Owner = 'owner',
  ValidationCommands = 'validationCommands',
}

export enum ModulePlanReadOnlyNodeField {
  Acceptance = 'acceptance',
  AcceptanceOwner = 'acceptanceOwner',
  Baseline = 'baseline',
  ConsumerOutcome = 'consumerOutcome',
  Dependencies = 'dependencies',
  Expert = 'expert',
  FunctionalOwner = 'functionalOwner',
  Kind = 'kind',
  ModuleRoot = 'moduleRoot',
  ParentOwnedExclusions = 'parentOwnedExclusions',
  Resources = 'resources',
  TaskId = 'taskId',
  Team = 'team',
}

export enum ModulePlanWriteNodeField {
  Acceptance = 'acceptance',
  AcceptanceOwner = 'acceptanceOwner',
  Baseline = 'baseline',
  ConsumerOutcome = 'consumerOutcome',
  Dependencies = 'dependencies',
  Expert = 'expert',
  FunctionalOwner = 'functionalOwner',
  Kind = 'kind',
  ModuleRoot = 'moduleRoot',
  ParentOwnedExclusions = 'parentOwnedExclusions',
  Resources = 'resources',
  TaskId = 'taskId',
  Team = 'team',
  Workspace = 'workspace',
}

export enum ModulePlanCortexWriteNodeField {
  Acceptance = 'acceptance',
  AcceptanceOwner = 'acceptanceOwner',
  Baseline = 'baseline',
  ConsumerOutcome = 'consumerOutcome',
  CortexAuthoring = 'cortexAuthoring',
  Dependencies = 'dependencies',
  Expert = 'expert',
  FunctionalOwner = 'functionalOwner',
  Kind = 'kind',
  ModuleRoot = 'moduleRoot',
  ParentOwnedExclusions = 'parentOwnedExclusions',
  Resources = 'resources',
  TaskId = 'taskId',
  Team = 'team',
  Workspace = 'workspace',
}

export enum ModulePlanCortexAuthoringField {
  SelectedSkillPaths = 'selectedSkillPaths',
  SharedWriteClaims = 'sharedWriteClaims',
}

export enum ModulePlanSynthesisNodeField {
  Acceptance = 'acceptance',
  AcceptanceOwner = 'acceptanceOwner',
  Baseline = 'baseline',
  ConsumerOutcome = 'consumerOutcome',
  Dependencies = 'dependencies',
  EvidenceInput = 'evidenceInput',
  Expert = 'expert',
  FunctionalOwner = 'functionalOwner',
  Kind = 'kind',
  ModuleRoot = 'moduleRoot',
  ParentOwnedExclusions = 'parentOwnedExclusions',
  Resources = 'resources',
  TaskId = 'taskId',
  Team = 'team',
}

export enum ModulePlanWorkspaceField {
  Kind = 'kind',
  WorkerBranch = 'workerBranch',
  WorkerRole = 'workerRole',
  WorktreePath = 'worktreePath',
}

export enum ModulePlanFeatureBaselineField {
  Kind = 'kind',
}

export enum ModulePlanIntegratedBaselineField {
  Kind = 'kind',
  ProviderTaskIds = 'providerTaskIds',
}

export enum ModulePlanResourceField {
  EvidenceSurface = 'evidenceSurface',
  Read = 'read',
  Write = 'write',
}

export enum ModulePlanAcceptanceField {
  Commands = 'commands',
  Evidence = 'evidence',
}

export enum ModulePlanAcceptanceCommandField {
  Output = 'output',
  Read = 'read',
  Selector = 'selector',
  Write = 'write',
}

export enum ModulePlanEdgeField {
  BehaviorInvariants = 'behaviorInvariants',
  Capability = 'capability',
  CompatibilityExpectations = 'compatibilityExpectations',
  ConsumerTaskId = 'consumerTaskId',
  Errors = 'errors',
  OwningTests = 'owningTests',
  ProviderTaskId = 'providerTaskId',
  PublicTypes = 'publicTypes',
  SecurityInvariants = 'securityInvariants',
}

export enum ModulePlanEvidenceInputField {
  ExpectedProducers = 'expectedProducers',
  Schema = 'schema',
}

export enum ModulePlanExpectedProducerField {
  AcceptanceOwner = 'acceptanceOwner',
  FunctionalOwner = 'functionalOwner',
  TaskId = 'taskId',
  Team = 'team',
}
