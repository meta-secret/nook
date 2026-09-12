import {
  ModuleDeliveryExecutionPrecedenceReason,
  ModuleDeliveryIssueCode,
} from './domain.ts';

import type {
  ModuleDeliveryEdgeContract,
  ModuleDeliveryIssue,
  ModuleDeliveryNodeV2,
  ModuleDeliveryPlanV2,
  ModuleDeliveryExecutionPrecedence,
} from './domain.ts';

export type ValidationState = {
  readonly plan: ModuleDeliveryPlanV2;
  readonly issues: ModuleDeliveryIssue[];
  readonly nodesById: Map<string, ModuleDeliveryNodeV2>;
};

export type DependencyReachability = ReadonlyMap<string, ReadonlySet<string>>;

export type ExecutionDependencies = ReadonlyMap<string, ReadonlySet<string>>;

export type NodeValidationRequest = {
  readonly state: ValidationState;
  readonly path: string;
  readonly node: ModuleDeliveryNodeV2;
};

export type IssueRequest = {
  readonly state: ValidationState;
  readonly code: ModuleDeliveryIssueCode;
  readonly path: string;
  readonly message: string;
};

export type UniqueListRequest = {
  readonly state: ValidationState;
  readonly path: string;
  readonly values: readonly string[];
};

export type ClaimPair = {
  readonly first: readonly string[];
  readonly second: readonly string[];
};

export type ConcurrentClaimsRequest = {
  readonly state: ValidationState;
  readonly reachability: DependencyReachability;
};

export type ClaimListValidationRequest = {
  readonly state: ValidationState;
  readonly path: string;
  readonly claims: readonly string[];
};

export type ContractListsValidationRequest = {
  readonly state: ValidationState;
  readonly index: number;
  readonly contract: ModuleDeliveryEdgeContract;
};

export type EdgeIdentity = {
  readonly providerTaskId: string;
  readonly consumerTaskId: string;
};

export type ModuleDeliveryTopology = {
  readonly order: readonly string[];
  readonly waves: readonly (readonly string[])[];
  readonly reachability: DependencyReachability;
  readonly executionPrecedence: readonly ModuleDeliveryExecutionPrecedence[];
};

export type ExecutionTopologyRequest = {
  readonly state: ValidationState;
  readonly dependencies: Map<string, Set<string>>;
  readonly constraints: ModuleDeliveryExecutionPrecedence[];
};

export type AddExecutionConstraintRequest = {
  readonly request: ExecutionTopologyRequest;
  readonly predecessorTaskId: string;
  readonly successorTaskId: string;
  readonly reason: ModuleDeliveryExecutionPrecedenceReason;
};
