import { createHash } from 'node:crypto';
import {
  isValidTaskResourceClaim,
  taskResourcePatternsOverlap,
} from '../agent-workflow/domain.ts';
import type { TaskResourcePatternPair } from '../agent-workflow/domain.ts';
import { MODULE_EXPERT_CATALOG } from '../module-experts/catalog.ts';
import type { ModuleExpertProfile } from '../module-experts/catalog.ts';
import { decodeModuleDeliveryPlan } from './codec.ts';
import {
  MAX_MODULE_DELIVERY_AGENT_DEPTH,
  MAX_MODULE_DELIVERY_ATTEMPTS,
  MAX_MODULE_DELIVERY_CONCURRENCY,
  MAX_MODULE_DELIVERY_NODES,
  REQUIRED_PARENT_OWNED_RESOURCES,
  ModuleDeliveryBaselineKind,
  ModuleDeliveryIssueCode,
  ModuleDeliveryTaskKind,
  ModuleDeliveryValidationStatus,
} from './domain.ts';
import type {
  ModuleDeliveryEdgeContract,
  ModuleDeliveryIssue,
  ModuleDeliveryNode,
  ModuleDeliveryPlan,
  ModuleDeliveryPlanValidation,
} from './domain.ts';

type ValidationState = {
  readonly plan: ModuleDeliveryPlan;
  readonly issues: ModuleDeliveryIssue[];
  readonly nodesById: Map<string, ModuleDeliveryNode>;
};

type DependencyReachability = ReadonlyMap<string, ReadonlySet<string>>;

type NodeValidationRequest = {
  readonly state: ValidationState;
  readonly path: string;
  readonly node: ModuleDeliveryNode;
};

type IssueRequest = {
  readonly state: ValidationState;
  readonly code: ModuleDeliveryIssueCode;
  readonly path: string;
  readonly message: string;
};

type UniqueListRequest = {
  readonly state: ValidationState;
  readonly path: string;
  readonly values: readonly string[];
};

type ModuleScopeRequest = {
  readonly state: ValidationState;
  readonly path: string;
  readonly node: ModuleDeliveryNode;
  readonly profile: ModuleExpertProfile;
};

type ResourceClaimScopeRequest = {
  readonly claim: string;
  readonly moduleRoot: string;
};

type ProfileProtectedWriteRequest = ModuleScopeRequest & {
  readonly claim: string;
};

type NodePair = {
  readonly first: ModuleDeliveryNode;
  readonly second: ModuleDeliveryNode;
};

type ResourceConflictRequest = NodePair & {
  readonly reachability: DependencyReachability;
};

type ClaimPair = {
  readonly first: readonly string[];
  readonly second: readonly string[];
};

type ReachabilityRequest = {
  readonly state: ValidationState;
  readonly order: readonly string[];
};

type ConcurrentClaimsRequest = {
  readonly state: ValidationState;
  readonly reachability: DependencyReachability;
};

type ClaimListValidationRequest = {
  readonly state: ValidationState;
  readonly path: string;
  readonly claims: readonly string[];
};

type ContractListsValidationRequest = {
  readonly state: ValidationState;
  readonly index: number;
  readonly contract: ModuleDeliveryEdgeContract;
};

type EdgeIdentity = {
  readonly providerTaskId: string;
  readonly consumerTaskId: string;
};

type ModuleDeliveryTopology = {
  readonly order: readonly string[];
  readonly waves: readonly (readonly string[])[];
  readonly reachability: DependencyReachability;
};

type DigestNodeLookup = {
  readonly plan: ModuleDeliveryPlan;
  readonly taskId: string;
};

type DigestContractLookup = {
  readonly plan: ModuleDeliveryPlan;
  readonly key: string;
};

export function decodeAndValidateModuleDeliveryPlan(
  serialized: string,
): ModuleDeliveryPlanValidation {
  const decoded = decodeModuleDeliveryPlan(serialized);
  if (decoded.status === ModuleDeliveryValidationStatus.Rejected)
    return decoded;
  return validateDecodedModuleDeliveryPlan(decoded.plan);
}

function validateDecodedModuleDeliveryPlan(
  plan: ModuleDeliveryPlan,
): ModuleDeliveryPlanValidation {
  const issues: ModuleDeliveryIssue[] = [];
  const nodesById = new Map<string, ModuleDeliveryNode>();
  const state: ValidationState = { plan, issues, nodesById };
  validateLimits(state);
  validateCommit(state);
  validateParentOwnedResources(state);
  indexNodes(state);
  validateNodes(state);
  validateEdgeContracts(state);
  const topology = buildTopology(state);
  if (!topology) return rejected(state);
  const concurrentRequest: ConcurrentClaimsRequest = {
    state,
    reachability: topology.reachability,
  };
  validateConcurrentClaims(concurrentRequest);
  if (issues.length > 0) return rejected(state);
  return {
    status: ModuleDeliveryValidationStatus.Accepted,
    plan,
    planDigest: digestPlan(plan),
    topologicalOrder: topology.order,
    waves: topology.waves,
  };
}

function validateLimits(state: ValidationState): void {
  const checks = [
    {
      path: '$.nodes',
      actual: state.plan.nodes.length,
      maximum: MAX_MODULE_DELIVERY_NODES,
    },
    {
      path: '$.maxConcurrency',
      actual: state.plan.maxConcurrency,
      maximum: MAX_MODULE_DELIVERY_CONCURRENCY,
    },
    {
      path: '$.maxAgentDepth',
      actual: state.plan.maxAgentDepth,
      maximum: MAX_MODULE_DELIVERY_AGENT_DEPTH,
    },
    {
      path: '$.maxAttempts',
      actual: state.plan.maxAttempts,
      maximum: MAX_MODULE_DELIVERY_ATTEMPTS,
    },
  ] as const;
  for (const check of checks) {
    if (check.actual <= 0 || check.actual > check.maximum) {
      const request: IssueRequest = {
        state,
        code: ModuleDeliveryIssueCode.LimitExceeded,
        path: check.path,
        message: `Value must be between 1 and ${check.maximum}.`,
      };
      issue(request);
    }
  }
}

function validateCommit(state: ValidationState): void {
  if (!/^[0-9a-f]{40}$/u.test(state.plan.sourceCommit)) {
    const request: IssueRequest = {
      state,
      code: ModuleDeliveryIssueCode.InvalidField,
      path: '$.sourceCommit',
      message: 'sourceCommit must be an exact lowercase 40-hex commit.',
    };
    issue(request);
  }
}

function validateParentOwnedResources(state: ValidationState): void {
  const uniqueRequest: UniqueListRequest = {
    state,
    path: '$.parentOwnedResources',
    values: state.plan.parentOwnedResources,
  };
  validateUnique(uniqueRequest);
  for (const required of REQUIRED_PARENT_OWNED_RESOURCES) {
    if (!state.plan.parentOwnedResources.includes(required)) {
      const request: IssueRequest = {
        state,
        code: ModuleDeliveryIssueCode.MissingParentOwnedResource,
        path: '$.parentOwnedResources',
        message: `Parent-owned resource ${required} is required.`,
      };
      issue(request);
    }
  }
  const claimRequest: ClaimListValidationRequest = {
    state,
    path: '$.parentOwnedResources',
    claims: state.plan.parentOwnedResources,
  };
  validateClaimList(claimRequest);
}

function indexNodes(state: ValidationState): void {
  for (const [index, node] of state.plan.nodes.entries()) {
    if (state.nodesById.has(node.taskId)) {
      const request: IssueRequest = {
        state,
        code: ModuleDeliveryIssueCode.DuplicateValue,
        path: `$.nodes[${index}].taskId`,
        message: `Duplicate task ID ${node.taskId}.`,
      };
      issue(request);
    } else {
      state.nodesById.set(node.taskId, node);
    }
  }
}

function validateNodes(state: ValidationState): void {
  for (const [index, node] of state.plan.nodes.entries()) {
    const path = `$.nodes[${index}]`;
    const profile = MODULE_EXPERT_CATALOG.find(
      (entry) => entry.name === node.expert,
    );
    if (!profile) {
      const request: IssueRequest = {
        state,
        code: ModuleDeliveryIssueCode.UnknownExpert,
        path: `${path}.expert`,
        message: `Expert ${node.expert} is not registered.`,
      };
      issue(request);
    } else {
      const scopeRequest: ModuleScopeRequest = { state, path, node, profile };
      validateModuleScope(scopeRequest);
    }
    const nodeRequest: NodeValidationRequest = { state, path, node };
    validateNodeLists(nodeRequest);
    validateDependencies(nodeRequest);
    validateTaskKind(nodeRequest);
    validateBaseline(nodeRequest);
    validateAgentDepth(nodeRequest);
    validateClaims(nodeRequest);
    validateExclusions(nodeRequest);
  }
}

function validateModuleScope(request: ModuleScopeRequest): void {
  if (!request.profile.moduleRoots.includes(request.node.moduleRoot)) {
    const issueRequest: IssueRequest = {
      state: request.state,
      code: ModuleDeliveryIssueCode.ModuleOwnershipMismatch,
      path: `${request.path}.moduleRoot`,
      message: `${request.node.moduleRoot} is not a canonical module root for ${request.node.expert}.`,
    };
    issue(issueRequest);
  }
  for (const claim of request.node.resources.write) {
    const scopeRequest: ResourceClaimScopeRequest = {
      claim,
      moduleRoot: request.node.moduleRoot,
    };
    if (!claimIsInsideModuleRoot(scopeRequest)) {
      const issueRequest: IssueRequest = {
        state: request.state,
        code: ModuleDeliveryIssueCode.WriteScopeMismatch,
        path: `${request.path}.resources.write`,
        message: `Write ${claim} escapes canonical module root ${request.node.moduleRoot}.`,
      };
      issue(issueRequest);
    }
    const protectedRequest: ProfileProtectedWriteRequest = {
      ...request,
      claim,
    };
    validateProfileProtectedWrite(protectedRequest);
  }
}

function validateProfileProtectedWrite(
  request: ProfileProtectedWriteRequest,
): void {
  const generatedPaths = request.profile.generatedScopePaths.map(
    (scope) => scope.path,
  );
  const protectedPaths = [...request.profile.excludedPaths, ...generatedPaths];
  for (const protectedPath of protectedPaths) {
    const pair: TaskResourcePatternPair = {
      first: request.claim,
      second: `${protectedPath}/**`,
    };
    if (taskResourcePatternsOverlap(pair)) {
      const issueRequest: IssueRequest = {
        state: request.state,
        code: ModuleDeliveryIssueCode.WriteScopeMismatch,
        path: `${request.path}.resources.write`,
        message: `Write ${request.claim} overlaps expert-protected path ${protectedPath}.`,
      };
      issue(issueRequest);
    }
  }
}

function claimIsInsideModuleRoot(request: ResourceClaimScopeRequest): boolean {
  return (
    request.claim === request.moduleRoot ||
    request.claim.startsWith(`${request.moduleRoot}/`)
  );
}

function validateNodeLists(request: NodeValidationRequest): void {
  const lists = [
    [`${request.path}.dependencies`, request.node.dependencies],
    [`${request.path}.resources.read`, request.node.resources.read],
    [`${request.path}.resources.write`, request.node.resources.write],
    [
      `${request.path}.parentOwnedExclusions`,
      request.node.parentOwnedExclusions,
    ],
    [`${request.path}.acceptance.commands`, request.node.acceptance.commands],
    [`${request.path}.acceptance.evidence`, request.node.acceptance.evidence],
  ] as const;
  for (const [path, values] of lists) {
    const uniqueRequest: UniqueListRequest = {
      state: request.state,
      path,
      values,
    };
    validateUnique(uniqueRequest);
  }
  if (
    request.node.baseline.kind ===
    ModuleDeliveryBaselineKind.IntegratedDependencies
  ) {
    const baselineRequest: UniqueListRequest = {
      state: request.state,
      path: `${request.path}.baseline.providerTaskIds`,
      values: request.node.baseline.providerTaskIds,
    };
    validateUnique(baselineRequest);
  }
}

function validateDependencies(request: NodeValidationRequest): void {
  for (const dependency of request.node.dependencies) {
    if (dependency === request.node.taskId) {
      const issueRequest: IssueRequest = {
        state: request.state,
        code: ModuleDeliveryIssueCode.SelfDependency,
        path: `${request.path}.dependencies`,
        message: `Task ${request.node.taskId} cannot depend on itself.`,
      };
      issue(issueRequest);
    } else if (!request.state.nodesById.has(dependency)) {
      const issueRequest: IssueRequest = {
        state: request.state,
        code: ModuleDeliveryIssueCode.MissingDependency,
        path: `${request.path}.dependencies`,
        message: `Dependency ${dependency} does not exist.`,
      };
      issue(issueRequest);
    }
  }
}

function validateTaskKind(request: NodeValidationRequest): void {
  const writes = request.node.resources.write.length;
  if (request.node.kind === ModuleDeliveryTaskKind.ReadOnly && writes !== 0) {
    const issueRequest: IssueRequest = {
      state: request.state,
      code: ModuleDeliveryIssueCode.InvalidField,
      path: `${request.path}.resources.write`,
      message: 'Read-only tasks must have an empty write list.',
    };
    issue(issueRequest);
  }
  if (request.node.kind === ModuleDeliveryTaskKind.Write && writes === 0) {
    const issueRequest: IssueRequest = {
      state: request.state,
      code: ModuleDeliveryIssueCode.InvalidField,
      path: `${request.path}.resources.write`,
      message: 'Write tasks must claim at least one write resource.',
    };
    issue(issueRequest);
  }
}

function validateBaseline(request: NodeValidationRequest): void {
  if (request.node.dependencies.length === 0) {
    if (
      request.node.baseline.kind !== ModuleDeliveryBaselineKind.SourceCommit ||
      request.node.baseline.sourceCommit !== request.state.plan.sourceCommit
    ) {
      const issueRequest: IssueRequest = {
        state: request.state,
        code: ModuleDeliveryIssueCode.BaselineMismatch,
        path: `${request.path}.baseline`,
        message: 'Independent tasks require the exact plan source baseline.',
      };
      issue(issueRequest);
    }
    return;
  }
  if (
    request.node.baseline.kind !==
    ModuleDeliveryBaselineKind.IntegratedDependencies
  ) {
    const issueRequest: IssueRequest = {
      state: request.state,
      code: ModuleDeliveryIssueCode.BaselineMismatch,
      path: `${request.path}.baseline`,
      message: 'Dependent tasks require an integrated-dependencies baseline.',
    };
    issue(issueRequest);
    return;
  }
  const actual = [...request.node.baseline.providerTaskIds].sort();
  const expected = [...request.node.dependencies].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const issueRequest: IssueRequest = {
      state: request.state,
      code: ModuleDeliveryIssueCode.BaselineMismatch,
      path: `${request.path}.baseline.providerTaskIds`,
      message: 'Integrated baseline providers must exactly match dependencies.',
    };
    issue(issueRequest);
  }
}

function validateAgentDepth(request: NodeValidationRequest): void {
  if (
    request.node.agentDepthLimit < 1 ||
    request.node.agentDepthLimit > request.state.plan.maxAgentDepth
  ) {
    const issueRequest: IssueRequest = {
      state: request.state,
      code: ModuleDeliveryIssueCode.LimitExceeded,
      path: `${request.path}.agentDepthLimit`,
      message: 'Task agent depth must inherit the plan bound.',
    };
    issue(issueRequest);
  }
}

function validateClaims(request: NodeValidationRequest): void {
  const readRequest: ClaimListValidationRequest = {
    state: request.state,
    path: `${request.path}.resources.read`,
    claims: request.node.resources.read,
  };
  const writeRequest: ClaimListValidationRequest = {
    state: request.state,
    path: `${request.path}.resources.write`,
    claims: request.node.resources.write,
  };
  validateClaimList(readRequest);
  validateClaimList(writeRequest);
  for (const write of request.node.resources.write) {
    for (const protectedClaim of request.state.plan.parentOwnedResources) {
      const pair: TaskResourcePatternPair = {
        first: write,
        second: protectedClaim,
      };
      if (taskResourcePatternsOverlap(pair)) {
        const issueRequest: IssueRequest = {
          state: request.state,
          code: ModuleDeliveryIssueCode.ParentOwnedWrite,
          path: `${request.path}.resources.write`,
          message: `Write ${write} overlaps parent-owned resource ${protectedClaim}.`,
        };
        issue(issueRequest);
      }
    }
  }
}

function validateClaimList(request: ClaimListValidationRequest): void {
  for (const [index, claim] of request.claims.entries()) {
    if (!isValidTaskResourceClaim(claim)) {
      const issueRequest: IssueRequest = {
        state: request.state,
        code: ModuleDeliveryIssueCode.InvalidField,
        path: `${request.path}[${index}]`,
        message: `Invalid resource claim ${claim}.`,
      };
      issue(issueRequest);
    }
  }
}

function validateExclusions(request: NodeValidationRequest): void {
  const actual = [...request.node.parentOwnedExclusions].sort();
  const expected = [...request.state.plan.parentOwnedResources].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const issueRequest: IssueRequest = {
      state: request.state,
      code: ModuleDeliveryIssueCode.InvalidField,
      path: `${request.path}.parentOwnedExclusions`,
      message: 'Each node must repeat the complete parent-owned exclusion set.',
    };
    issue(issueRequest);
  }
}

function validateEdgeContracts(state: ValidationState): void {
  const expected = new Set<string>();
  for (const node of state.plan.nodes) {
    for (const dependency of node.dependencies) {
      const identity: EdgeIdentity = {
        providerTaskId: dependency,
        consumerTaskId: node.taskId,
      };
      expected.add(edgeKey(identity));
    }
  }
  const actual = new Set<string>();
  for (const [index, contract] of state.plan.edgeContracts.entries()) {
    const identity: EdgeIdentity = {
      providerTaskId: contract.providerTaskId,
      consumerTaskId: contract.consumerTaskId,
    };
    const key = edgeKey(identity);
    if (actual.has(key)) {
      const request: IssueRequest = {
        state,
        code: ModuleDeliveryIssueCode.DuplicateValue,
        path: `$.edgeContracts[${index}]`,
        message: `Duplicate edge contract ${key}.`,
      };
      issue(request);
    }
    actual.add(key);
    if (!expected.has(key)) {
      const request: IssueRequest = {
        state,
        code: ModuleDeliveryIssueCode.UnexpectedEdgeContract,
        path: `$.edgeContracts[${index}]`,
        message: `Contract ${key} does not match a dependency edge.`,
      };
      issue(request);
    }
    const listRequest: ContractListsValidationRequest = {
      state,
      index,
      contract,
    };
    validateContractLists(listRequest);
  }
  for (const key of expected) {
    if (!actual.has(key)) {
      const request: IssueRequest = {
        state,
        code: ModuleDeliveryIssueCode.MissingEdgeContract,
        path: '$.edgeContracts',
        message: `Dependency edge ${key} has no contract.`,
      };
      issue(request);
    }
  }
}

function validateContractLists(request: ContractListsValidationRequest): void {
  const lists = [
    request.contract.publicTypes,
    request.contract.errors,
    request.contract.behaviorInvariants,
    request.contract.securityInvariants,
    request.contract.compatibilityExpectations,
    request.contract.owningTests,
  ];
  for (const [listIndex, values] of lists.entries()) {
    const uniqueRequest: UniqueListRequest = {
      state: request.state,
      path: `$.edgeContracts[${request.index}].lists[${listIndex}]`,
      values,
    };
    validateUnique(uniqueRequest);
  }
}

function edgeKey(request: EdgeIdentity): string {
  return `${request.providerTaskId}->${request.consumerTaskId}`;
}

function buildTopology(state: ValidationState): ModuleDeliveryTopology | false {
  if (
    state.issues.some(
      (entry) =>
        entry.code === ModuleDeliveryIssueCode.MissingDependency ||
        entry.code === ModuleDeliveryIssueCode.SelfDependency ||
        entry.code === ModuleDeliveryIssueCode.DuplicateValue,
    )
  )
    return false;
  const remaining = new Set(state.nodesById.keys());
  const completed = new Set<string>();
  const order: string[] = [];
  const waves: string[][] = [];
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter(
        (taskId) =>
          state.nodesById
            .get(taskId)
            ?.dependencies.every((dependency) => completed.has(dependency)) ===
          true,
      )
      .sort();
    if (ready.length === 0) {
      const cycle = [...remaining].sort().join(', ');
      const request: IssueRequest = {
        state,
        code: ModuleDeliveryIssueCode.DependencyCycle,
        path: '$.nodes',
        message: `Dependency cycle includes: ${cycle}.`,
      };
      issue(request);
      return false;
    }
    waves.push(ready);
    for (const taskId of ready) {
      remaining.delete(taskId);
      completed.add(taskId);
      order.push(taskId);
    }
  }
  const reachabilityRequest: ReachabilityRequest = { state, order };
  return { order, waves, reachability: buildReachability(reachabilityRequest) };
}

function buildReachability(
  request: ReachabilityRequest,
): DependencyReachability {
  const result = new Map<string, ReadonlySet<string>>();
  for (const taskId of request.order) {
    const node = request.state.nodesById.get(taskId);
    const dependencies = new Set<string>();
    if (node)
      for (const dependency of node.dependencies) {
        dependencies.add(dependency);
        const ancestors = result.get(dependency);
        if (ancestors)
          for (const ancestor of ancestors) dependencies.add(ancestor);
      }
    result.set(taskId, dependencies);
  }
  return result;
}

function validateConcurrentClaims(request: ConcurrentClaimsRequest): void {
  const taskIds = request.state.plan.nodes.map((node) => node.taskId).sort();
  for (let firstIndex = 0; firstIndex < taskIds.length; firstIndex += 1) {
    const firstId = taskIds[firstIndex];
    if (!firstId) continue;
    const first = request.state.nodesById.get(firstId);
    if (!first) continue;
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < taskIds.length;
      secondIndex += 1
    ) {
      const secondId = taskIds[secondIndex];
      if (!secondId) continue;
      const second = request.state.nodesById.get(secondId);
      if (!second) continue;
      const conflictRequest: ResourceConflictRequest = {
        first,
        second,
        reachability: request.reachability,
      };
      if (!nodesAreOrdered(conflictRequest) && nodesConflict(conflictRequest)) {
        const issueRequest: IssueRequest = {
          state: request.state,
          code: ModuleDeliveryIssueCode.ResourceConflict,
          path: '$.nodes',
          message: `Concurrent tasks ${first.taskId} and ${second.taskId} have overlapping resource claims.`,
        };
        issue(issueRequest);
      }
    }
  }
}

function nodesAreOrdered(request: ResourceConflictRequest): boolean {
  return (
    request.reachability
      .get(request.first.taskId)
      ?.has(request.second.taskId) === true ||
    request.reachability
      .get(request.second.taskId)
      ?.has(request.first.taskId) === true
  );
}

function nodesConflict(pair: NodePair): boolean {
  const writeWrite: ClaimPair = {
    first: pair.first.resources.write,
    second: pair.second.resources.write,
  };
  const firstWriteRead: ClaimPair = {
    first: pair.first.resources.write,
    second: pair.second.resources.read,
  };
  const secondWriteRead: ClaimPair = {
    first: pair.second.resources.write,
    second: pair.first.resources.read,
  };
  return (
    claimsOverlap(writeWrite) ||
    claimsOverlap(firstWriteRead) ||
    claimsOverlap(secondWriteRead)
  );
}

function claimsOverlap(request: ClaimPair): boolean {
  return request.first.some((first) =>
    request.second.some((second) => {
      const pair: TaskResourcePatternPair = { first, second };
      return taskResourcePatternsOverlap(pair);
    }),
  );
}

function validateUnique(request: UniqueListRequest): void {
  const unique = new Set(request.values);
  if (unique.size !== request.values.length) {
    const issueRequest: IssueRequest = {
      state: request.state,
      code: ModuleDeliveryIssueCode.DuplicateValue,
      path: request.path,
      message: 'List values must be unique.',
    };
    issue(issueRequest);
  }
}

function digestPlan(plan: ModuleDeliveryPlan): string {
  const taskIds = plan.nodes.map((node) => node.taskId).sort();
  const nodes = taskIds
    .map((taskId) => {
      const lookup: DigestNodeLookup = { plan, taskId };
      return findDigestNode(lookup);
    })
    .map((node) => ({
      ...node,
      baseline:
        node.baseline.kind === ModuleDeliveryBaselineKind.IntegratedDependencies
          ? {
              ...node.baseline,
              providerTaskIds: [...node.baseline.providerTaskIds].sort(),
            }
          : node.baseline,
      dependencies: [...node.dependencies].sort(),
      resources: {
        read: [...node.resources.read].sort(),
        write: [...node.resources.write].sort(),
      },
      parentOwnedExclusions: [...node.parentOwnedExclusions].sort(),
      acceptance: {
        commands: node.acceptance.commands,
        evidence: [...node.acceptance.evidence].sort(),
      },
    }));
  const contractKeys = plan.edgeContracts
    .map((contract) => {
      const identity: EdgeIdentity = {
        providerTaskId: contract.providerTaskId,
        consumerTaskId: contract.consumerTaskId,
      };
      return edgeKey(identity);
    })
    .sort();
  const edgeContracts = contractKeys
    .map((key) => {
      const lookup: DigestContractLookup = { plan, key };
      return findDigestContract(lookup);
    })
    .map((contract) => ({
      ...contract,
      publicTypes: [...contract.publicTypes].sort(),
      errors: [...contract.errors].sort(),
      behaviorInvariants: [...contract.behaviorInvariants].sort(),
      securityInvariants: [...contract.securityInvariants].sort(),
      compatibilityExpectations: [...contract.compatibilityExpectations].sort(),
      owningTests: [...contract.owningTests].sort(),
    }));
  const canonical = {
    ...plan,
    parentOwnedResources: [...plan.parentOwnedResources].sort(),
    parentJoin: {
      ...plan.parentJoin,
      validationCommands: plan.parentJoin.validationCommands,
    },
    nodes,
    edgeContracts,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function findDigestNode(lookup: DigestNodeLookup): ModuleDeliveryNode {
  const node = lookup.plan.nodes.find(
    (candidate) => candidate.taskId === lookup.taskId,
  );
  if (!node) throw new Error(`Validated task ${lookup.taskId} is missing.`);
  return node;
}

function findDigestContract(
  lookup: DigestContractLookup,
): ModuleDeliveryEdgeContract {
  const contract = lookup.plan.edgeContracts.find((candidate) => {
    const identity: EdgeIdentity = {
      providerTaskId: candidate.providerTaskId,
      consumerTaskId: candidate.consumerTaskId,
    };
    return edgeKey(identity) === lookup.key;
  });
  if (!contract)
    throw new Error(`Validated edge contract ${lookup.key} is missing.`);
  return contract;
}

function issue(request: IssueRequest): void {
  const value: ModuleDeliveryIssue = {
    code: request.code,
    path: request.path,
    message: request.message,
  };
  request.state.issues.push(value);
}

function rejected(state: ValidationState): ModuleDeliveryPlanValidation {
  return {
    status: ModuleDeliveryValidationStatus.Rejected,
    issues: state.issues,
  };
}
