import type { UntrustedYamlNode } from '../lib/guards.ts';
import type {
  ModulePlanObjectDecodeRequest,
  ModulePlanTransportList,
} from './codec-fields.ts';
import type { ModuleDeliveryIssueCode } from './domain.ts';

export type ModulePlanIndexedNodeRequest = {
  readonly value: UntrustedYamlNode;
  readonly index: number;
  readonly legacy: boolean;
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

export type ModulePlanResourceDecodeRequest = ModulePlanObjectDecodeRequest & {
  readonly legacy: boolean;
  readonly readOnly: boolean;
};

export type ModulePlanAcceptanceDecodeRequest =
  ModulePlanObjectDecodeRequest & {
    readonly legacy: boolean;
  };

export type LegacyTaskTeamRequest = {
  readonly kind: string;
  readonly expert: string;
  readonly moduleRoot: string;
};

export type ModulePlanNodeListRequest = {
  readonly values: ModulePlanTransportList;
  readonly legacy: boolean;
};

export type RejectedModulePlanRequest = {
  readonly code: ModuleDeliveryIssueCode;
  readonly path?: string;
  readonly message: string;
};

export enum ModulePlanRootField {
  EdgeContracts = 'edgeContracts',
  Generation = 'generation',
  MaxAgentDepth = 'maxAgentDepth',
  MaxAttempts = 'maxAttempts',
  MaxConcurrency = 'maxConcurrency',
  Nodes = 'nodes',
  ParentJoin = 'parentJoin',
  ParentOwnedResources = 'parentOwnedResources',
  SourceCommit = 'sourceCommit',
  Version = 'version',
}

export enum ModulePlanV3RootField {
  EdgeContracts = 'edgeContracts',
  Generation = 'generation',
  MaxAgentDepth = 'maxAgentDepth',
  MaxAttempts = 'maxAttempts',
  Nodes = 'nodes',
  ParentJoin = 'parentJoin',
  ParentOwnedResources = 'parentOwnedResources',
  OriginMainSha = 'originMainSha',
  PinnedLocalDevSha = 'pinnedLocalDevSha',
  SourceCommit = 'sourceCommit',
  Version = 'version',
}

export enum ModulePlanV4RootField {
  EdgeContracts = 'edgeContracts',
  Generation = 'generation',
  MaxAgentDepth = 'maxAgentDepth',
  MaxAttempts = 'maxAttempts',
  Nodes = 'nodes',
  ParentJoin = 'parentJoin',
  ParentOwnedResources = 'parentOwnedResources',
  OriginMainSha = 'originMainSha',
  PinnedLocalDevSha = 'pinnedLocalDevSha',
  FeatureHeadSha = 'featureHeadSha',
  SourceCommit = 'sourceCommit',
  Version = 'version',
}

/** Current branch-authoritative plan shape. Feature heads are resolved by Delivery. */
export enum ModulePlanV5RootField {
  EdgeContracts = 'edgeContracts',
  FeatureBranch = 'featureBranch',
  Generation = 'generation',
  MaxAgentDepth = 'maxAgentDepth',
  MaxAttempts = 'maxAttempts',
  Nodes = 'nodes',
  ParentJoin = 'parentJoin',
  ParentOwnedResources = 'parentOwnedResources',
  OriginMainSha = 'originMainSha',
  PinnedLocalDevSha = 'pinnedLocalDevSha',
  SourceCommit = 'sourceCommit',
  Version = 'version',
}

export enum LegacyModulePlanRootField {
  EdgeContracts = 'edgeContracts',
  MaxAgentDepth = 'maxAgentDepth',
  MaxAttempts = 'maxAttempts',
  MaxConcurrency = 'maxConcurrency',
  Nodes = 'nodes',
  ParentJoin = 'parentJoin',
  ParentOwnedResources = 'parentOwnedResources',
  SourceCommit = 'sourceCommit',
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
  AgentDepthLimit = 'agentDepthLimit',
  Baseline = 'baseline',
  ConsumerOutcome = 'consumerOutcome',
  Dependencies = 'dependencies',
  Expert = 'expert',
  FunctionalOwner = 'functionalOwner',
  Kind = 'kind',
  ModuleRoot = 'moduleRoot',
  ParentLineage = 'parentLineage',
  ParentOwnedExclusions = 'parentOwnedExclusions',
  Resources = 'resources',
  TaskId = 'taskId',
  Team = 'team',
}

export enum ModulePlanWriteNodeField {
  Acceptance = 'acceptance',
  AcceptanceOwner = 'acceptanceOwner',
  AgentDepthLimit = 'agentDepthLimit',
  Baseline = 'baseline',
  ConsumerOutcome = 'consumerOutcome',
  Dependencies = 'dependencies',
  Expert = 'expert',
  FunctionalOwner = 'functionalOwner',
  Kind = 'kind',
  ModuleRoot = 'moduleRoot',
  ParentLineage = 'parentLineage',
  ParentOwnedExclusions = 'parentOwnedExclusions',
  Resources = 'resources',
  TaskId = 'taskId',
  Team = 'team',
  Workspace = 'workspace',
}

export enum ModulePlanCortexWriteNodeField {
  Acceptance = 'acceptance',
  AcceptanceOwner = 'acceptanceOwner',
  AgentDepthLimit = 'agentDepthLimit',
  Baseline = 'baseline',
  ConsumerOutcome = 'consumerOutcome',
  CortexAuthoring = 'cortexAuthoring',
  Dependencies = 'dependencies',
  Expert = 'expert',
  FunctionalOwner = 'functionalOwner',
  Kind = 'kind',
  ModuleRoot = 'moduleRoot',
  ParentLineage = 'parentLineage',
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

export enum LegacyModulePlanReadOnlyNodeField {
  Acceptance = 'acceptance',
  AgentDepthLimit = 'agentDepthLimit',
  Baseline = 'baseline',
  ConsumerOutcome = 'consumerOutcome',
  Dependencies = 'dependencies',
  Expert = 'expert',
  Kind = 'kind',
  ModuleRoot = 'moduleRoot',
  ParentOwnedExclusions = 'parentOwnedExclusions',
  Resources = 'resources',
  TaskId = 'taskId',
}

export enum LegacyModulePlanWriteNodeField {
  Acceptance = 'acceptance',
  AgentDepthLimit = 'agentDepthLimit',
  Baseline = 'baseline',
  ConsumerOutcome = 'consumerOutcome',
  Dependencies = 'dependencies',
  Expert = 'expert',
  Kind = 'kind',
  ModuleRoot = 'moduleRoot',
  ParentOwnedExclusions = 'parentOwnedExclusions',
  Resources = 'resources',
  TaskId = 'taskId',
  Workspace = 'workspace',
}

export enum ModulePlanSynthesisNodeField {
  Acceptance = 'acceptance',
  AcceptanceOwner = 'acceptanceOwner',
  AgentDepthLimit = 'agentDepthLimit',
  Baseline = 'baseline',
  ConsumerOutcome = 'consumerOutcome',
  Dependencies = 'dependencies',
  EvidenceInput = 'evidenceInput',
  Expert = 'expert',
  FunctionalOwner = 'functionalOwner',
  Kind = 'kind',
  ModuleRoot = 'moduleRoot',
  ParentLineage = 'parentLineage',
  ParentOwnedExclusions = 'parentOwnedExclusions',
  Resources = 'resources',
  TaskId = 'taskId',
  Team = 'team',
}

export enum ModulePlanWorkspaceField {
  ExpectedCommitHandoff = 'expectedCommitHandoff',
  Kind = 'kind',
}

export enum ModulePlanSourceBaselineField {
  Kind = 'kind',
  SourceCommit = 'sourceCommit',
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

export enum LegacyModulePlanResourceField {
  Read = 'read',
  Write = 'write',
}

export enum LegacyModulePlanAcceptanceField {
  Commands = 'commands',
  Evidence = 'evidence',
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

export enum ModulePlanRootLineageField {
  Kind = 'kind',
}

export enum ModulePlanAttemptLineageField {
  Agent = 'agent',
  Attempt = 'attempt',
  Kind = 'kind',
  Task = 'task',
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
