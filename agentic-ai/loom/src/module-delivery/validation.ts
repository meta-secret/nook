import {
  AgentAttemptParentKind,
  isValidTaskResourceClaim,
  taskResourcePatternsOverlap,
} from '../agent-workflow/domain.ts';
import type { TaskResourcePatternPair } from '../agent-workflow/domain.ts';
import { MODULE_EXPERT_CATALOG } from '../module-experts/catalog.ts';
import {
  cortexWriteAuthorized,
  expectedParentOwnedExclusions,
  isPureCortexTask,
  validateCortexAuthoring as cortexAuthoringFindings,
} from './cortex-authoring-validation.ts';
import { validateModuleScope as moduleScopeFindings } from './module-scope-validation.ts';
import { cortexContextPrecedence } from './cortex-context-topology.ts';
import type { ModuleScopeValidationRequest } from './module-scope-validation.ts';
import type {
  CortexAuthoringValidationRequest,
  CortexWriteAuthorizationRequest,
  ParentOwnedExclusionsRequest,
} from './cortex-authoring-validation.ts';
import {
  decodeCompatibleModuleDeliveryPlan,
  moduleDeliveryPlanDigest,
} from './codec.ts';
import {
  MODULE_DELIVERY_PLAN_VERSION,
  MAX_MODULE_DELIVERY_AGENT_DEPTH,
  MAX_MODULE_DELIVERY_ATTEMPTS,
  MAX_MODULE_DELIVERY_CONCURRENCY,
  MAX_MODULE_DELIVERY_NODES,
  ordinaryTaskWriteAuthorized,
  REQUIRED_PARENT_OWNED_RESOURCES,
  CORTEX_TEAM_WRITER_EXPERT,
  ModuleDeliveryBaselineKind,
  ModuleDeliveryCompatibilityStatus,
  ModuleDeliveryExecutionPrecedenceReason,
  ModuleDeliveryIssueCode,
  ModuleDeliveryTaskKind,
  ModuleDeliveryTaskProfile,
  ModuleDeliveryValidationStatus,
} from './domain.ts';
import type {
  ModuleDeliveryEdgeContract,
  ModuleDeliveryIssue,
  ModuleDeliveryNodeV2,
  ModuleDeliveryPlanV2,
  ModuleDeliveryPlanValidation,
  ModuleDeliveryExecutionPrecedence,
  RejectedModuleDeliveryPlan,
} from './domain.ts';
import * as claimContainment from './resource-claim-containment.ts';

type ValidationState = {
  readonly plan: ModuleDeliveryPlanV2;
  readonly issues: ModuleDeliveryIssue[];
  readonly nodesById: Map<string, ModuleDeliveryNodeV2>;
};

type DependencyReachability = ReadonlyMap<string, ReadonlySet<string>>;
type ExecutionDependencies = ReadonlyMap<string, ReadonlySet<string>>;
type NodeValidationRequest = {
  readonly state: ValidationState;
  readonly path: string;
  readonly node: ModuleDeliveryNodeV2;
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

type ClaimPair = {
  readonly first: readonly string[];
  readonly second: readonly string[];
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
  readonly executionPrecedence: readonly ModuleDeliveryExecutionPrecedence[];
};

export function decodeAndValidateModuleDeliveryPlan(
  serialized: string,
): ModuleDeliveryPlanValidation {
  const decoded = decodeCompatibleModuleDeliveryPlan(serialized);
  if (decoded.status === ModuleDeliveryCompatibilityStatus.Rejected) {
    const rejection: RejectedModuleDeliveryPlan = {
      status: ModuleDeliveryValidationStatus.Rejected,
      issues: decoded.issues,
    };
    return rejection;
  }
  if (decoded.inputVersion !== MODULE_DELIVERY_PLAN_VERSION) {
    const issue: ModuleDeliveryIssue = {
      code: ModuleDeliveryIssueCode.InvalidField,
      path: '$.version',
      message: 'Canonical validation requires authored plan version 2.',
    };
    const rejection: RejectedModuleDeliveryPlan = {
      status: ModuleDeliveryValidationStatus.Rejected,
      issues: [issue],
    };
    return rejection;
  }
  return validateDecodedModuleDeliveryPlan(decoded.plan);
}

function validateDecodedModuleDeliveryPlan(
  plan: ModuleDeliveryPlanV2,
): ModuleDeliveryPlanValidation {
  const issues: ModuleDeliveryIssue[] = [];
  const nodesById = new Map<string, ModuleDeliveryNodeV2>();
  const state: ValidationState = { plan, issues, nodesById };
  validateLimits(state);
  validateCommit(state);
  validateParentOwnedResources(state);
  indexNodes(state);
  validateNodes(state);
  validateEdgeContracts(state);
  const topology = buildTopology(state);
  if (!topology) return rejected(state);
  if (issues.length > 0) return rejected(state);
  return {
    status: ModuleDeliveryValidationStatus.Accepted,
    inputVersion: MODULE_DELIVERY_PLAN_VERSION,
    plan,
    planDigest: moduleDeliveryPlanDigest(plan),
    topologicalOrder: topology.order,
    waves: topology.waves,
    executionPrecedence: topology.executionPrecedence,
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
    const nodeRequest: NodeValidationRequest = { state, path, node };
    const profile = MODULE_EXPERT_CATALOG.find(
      (entry) => entry.name === node.expert,
    );
    if (node.expert === ModuleDeliveryTaskProfile.Ordinary)
      validateOrdinaryTask(nodeRequest);
    else if (
      !profile &&
      !(isPureCortexTask(node) && node.expert === CORTEX_TEAM_WRITER_EXPERT)
    ) {
      const request: IssueRequest = {
        state,
        code: ModuleDeliveryIssueCode.UnknownExpert,
        path: `${path}.expert`,
        message: `Expert ${node.expert} is not registered.`,
      };
      issue(request);
    } else if (profile) {
      const scopeRequest: ModuleScopeValidationRequest = {
        path,
        node,
        profile,
      };
      for (const finding of moduleScopeFindings(scopeRequest)) {
        const findingRequest: IssueRequest = { state, ...finding };
        issue(findingRequest);
      }
    }
    validateOwnership(nodeRequest);
    validateNodeLists(nodeRequest);
    validateDependencies(nodeRequest);
    validateTaskKind(nodeRequest);
    validateBaseline(nodeRequest);
    validateAgentDepth(nodeRequest);
    const cortexRequest: CortexAuthoringValidationRequest = { node, path };
    for (const finding of cortexAuthoringFindings(cortexRequest)) {
      const findingRequest: IssueRequest = { state, ...finding };
      issue(findingRequest);
    }
    validateClaims(nodeRequest);
    validateExclusions(nodeRequest);
  }
}

function validateOrdinaryTask(request: NodeValidationRequest): void {
  const { node } = request;
  const writesAuthorized =
    node.kind !== ModuleDeliveryTaskKind.EvidenceSynthesis &&
    (node.kind !== ModuleDeliveryTaskKind.Write ||
      node.resources.write.every(
        (write) =>
          ordinaryTaskWriteAuthorized({
            team: node.team,
            moduleRoot: node.moduleRoot,
            write,
          }) &&
          MODULE_EXPERT_CATALOG.every((profile) =>
            profile.generatedScopePaths.every(
              (scope) =>
                !taskResourcePatternsOverlap({
                  first: write,
                  second: `${scope.path}/**`,
                }),
            ),
          ),
      ));
  if (
    isValidTaskResourceClaim(node.moduleRoot) &&
    !node.moduleRoot.includes('*') &&
    writesAuthorized
  )
    return;
  issue({
    state: request.state,
    code: ModuleDeliveryIssueCode.ModuleOwnershipMismatch,
    path: `${request.path}.moduleRoot`,
    message: 'Ordinary task ownership or bounded scope is invalid.',
  });
}

function validateOwnership(request: NodeValidationRequest): void {
  if (request.node.parentLineage.kind !== AgentAttemptParentKind.WorkflowRoot) {
    const issueRequest: IssueRequest = {
      state: request.state,
      code: ModuleDeliveryIssueCode.ParentLineageMismatch,
      path: `${request.path}.parentLineage`,
      message: 'Canonical validation requires workflow-root lineage.',
    };
    issue(issueRequest);
  }
  if (request.node.acceptanceOwner !== request.node.functionalOwner) {
    const issueRequest: IssueRequest = {
      state: request.state,
      code: ModuleDeliveryIssueCode.AcceptanceOwnershipMismatch,
      path: `${request.path}.acceptanceOwner`,
      message: 'Acceptance owner must be the recorded functional owner.',
    };
    issue(issueRequest);
  }
  if (
    request.node.team !== request.node.functionalOwner &&
    request.node.acceptanceOwner === request.node.team
  ) {
    const issueRequest: IssueRequest = {
      state: request.state,
      code: ModuleDeliveryIssueCode.AcceptanceOwnershipMismatch,
      path: `${request.path}.acceptanceOwner`,
      message: 'An expertise-provider team cannot accept its own handoff.',
    };
    issue(issueRequest);
  }
}

function validateNodeLists(request: NodeValidationRequest): void {
  const lists: readonly (readonly [string, readonly string[]])[] = [
    [`${request.path}.dependencies`, request.node.dependencies],
    [`${request.path}.resources.read`, request.node.resources.read],
    [`${request.path}.resources.write`, request.node.resources.write],
    [
      `${request.path}.resources.evidenceSurface`,
      request.node.resources.evidenceSurface,
    ],
    [
      `${request.path}.parentOwnedExclusions`,
      request.node.parentOwnedExclusions,
    ],
    [`${request.path}.acceptance.commands`, request.node.acceptance.commands],
    [`${request.path}.acceptance.evidence`, request.node.acceptance.evidence],
    ...(request.node.kind === ModuleDeliveryTaskKind.Write &&
    request.node.cortexAuthoring
      ? [
          [
            `${request.path}.cortexAuthoring.selectedSkillPaths`,
            request.node.cortexAuthoring.selectedSkillPaths,
          ] as const,
          [
            `${request.path}.cortexAuthoring.sharedWriteClaims`,
            request.node.cortexAuthoring.sharedWriteClaims,
          ] as const,
        ]
      : []),
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
  if (request.node.kind === ModuleDeliveryTaskKind.EvidenceSynthesis) {
    const producerIds = request.node.evidenceInput.expectedProducers.map(
      ({ taskId }) => taskId,
    );
    const producerRequest: UniqueListRequest = {
      state: request.state,
      path: `${request.path}.evidenceInput.expectedProducers`,
      values: producerIds,
    };
    validateUnique(producerRequest);
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
  const evidenceClaims = request.node.resources.evidenceSurface;
  if (request.node.kind !== ModuleDeliveryTaskKind.Write && writes !== 0) {
    const issueRequest: IssueRequest = {
      state: request.state,
      code: ModuleDeliveryIssueCode.InvalidField,
      path: `${request.path}.resources.write`,
      message: 'Non-writing tasks must have an empty write list.',
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
  const evidenceMismatch =
    (request.node.kind === ModuleDeliveryTaskKind.ReadOnly &&
      evidenceClaims.length === 0) ||
    (request.node.kind === ModuleDeliveryTaskKind.Write &&
      evidenceClaims.length !== 0);
  if (evidenceMismatch) {
    const issueRequest: IssueRequest = {
      state: request.state,
      code: ModuleDeliveryIssueCode.EvidenceSurfaceMismatch,
      path: `${request.path}.resources.evidenceSurface`,
      message:
        request.node.kind === ModuleDeliveryTaskKind.ReadOnly
          ? 'Read-only tasks require a non-empty evidence surface.'
          : 'Write tasks must have an empty evidence surface.',
    };
    issue(issueRequest);
  }
  if (request.node.kind === ModuleDeliveryTaskKind.EvidenceSynthesis) {
    validateEvidenceSynthesis(request);
  }
  for (const evidenceClaim of claimContainment.uncoveredEvidenceClaims(
    request.node.resources,
  )) {
    const issueRequest: IssueRequest = {
      state: request.state,
      code: ModuleDeliveryIssueCode.EvidenceSurfaceMismatch,
      path: `${request.path}.resources.evidenceSurface`,
      message: `Evidence claim ${evidenceClaim} must be covered by a declared repository read claim.`,
    };
    issue(issueRequest);
  }
}

function validateEvidenceSynthesis(request: NodeValidationRequest): void {
  if (
    request.node.kind !== ModuleDeliveryTaskKind.EvidenceSynthesis ||
    (request.node.resources.read.length === 0 &&
      request.node.resources.write.length === 0 &&
      request.node.resources.evidenceSurface.length === 0)
  ) {
    if (request.node.kind !== ModuleDeliveryTaskKind.EvidenceSynthesis) return;
  } else {
    const resourceIssue: IssueRequest = {
      state: request.state,
      code: ModuleDeliveryIssueCode.EvidenceInputMismatch,
      path: `${request.path}.resources`,
      message: 'Evidence synthesis requires empty repository claims.',
    };
    issue(resourceIssue);
  }
  if (request.node.kind !== ModuleDeliveryTaskKind.EvidenceSynthesis) return;
  const expectedIds = request.node.evidenceInput.expectedProducers
    .map(({ taskId }) => taskId)
    .sort();
  const dependencyIds = [...request.node.dependencies].sort();
  if (JSON.stringify(expectedIds) !== JSON.stringify(dependencyIds)) {
    const dependencyIssue: IssueRequest = {
      state: request.state,
      code: ModuleDeliveryIssueCode.EvidenceInputMismatch,
      path: `${request.path}.evidenceInput.expectedProducers`,
      message: 'Expected evidence producers must exactly match dependencies.',
    };
    issue(dependencyIssue);
  }
  for (const expected of request.node.evidenceInput.expectedProducers) {
    const producer = request.state.nodesById.get(expected.taskId);
    if (
      !producer ||
      producer.team !== expected.team ||
      producer.functionalOwner !== expected.functionalOwner ||
      producer.acceptanceOwner !== expected.acceptanceOwner
    ) {
      const identityIssue: IssueRequest = {
        state: request.state,
        code: ModuleDeliveryIssueCode.EvidenceInputMismatch,
        path: `${request.path}.evidenceInput.expectedProducers`,
        message: `Expected producer ${expected.taskId} does not match its frozen task identity.`,
      };
      issue(identityIssue);
    }
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
  const evidenceRequest: ClaimListValidationRequest = {
    state: request.state,
    path: `${request.path}.resources.evidenceSurface`,
    claims: request.node.resources.evidenceSurface,
  };
  validateClaimList(evidenceRequest);
  validateClaimList(readRequest);
  validateClaimList(writeRequest);
  for (const write of request.node.resources.write) {
    for (const protectedClaim of request.state.plan.parentOwnedResources) {
      const pair: TaskResourcePatternPair = {
        first: write,
        second: protectedClaim,
      };
      if (taskResourcePatternsOverlap(pair)) {
        const authorizationRequest: CortexWriteAuthorizationRequest = {
          node: request.node,
          claim: write,
        };
        if (
          protectedClaim === '.cortex/**' &&
          cortexWriteAuthorized(authorizationRequest)
        )
          continue;
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
  const exclusionRequest: ParentOwnedExclusionsRequest = {
    plan: request.state.plan,
    node: request.node,
  };
  const expected = [...expectedParentOwnedExclusions(exclusionRequest)].sort();
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
  const topologyRequest = buildExecutionTopologyRequest(state);
  serializeOrdinaryConflicts(topologyRequest);
  return topologyForDependencies(topologyRequest);
}

type ExecutionTopologyRequest = {
  readonly state: ValidationState;
  readonly dependencies: Map<string, Set<string>>;
  readonly constraints: ModuleDeliveryExecutionPrecedence[];
};

function topologyForDependencies(
  request: ExecutionTopologyRequest,
): ModuleDeliveryTopology | false {
  const remaining = new Set(request.state.nodesById.keys());
  const completed = new Set<string>();
  const order: string[] = [];
  const waves: string[][] = [];
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((taskId) => {
        const [dependencies = []] = [request.dependencies.get(taskId)];
        return [...dependencies].every((dependency) =>
          completed.has(dependency),
        );
      })
      .sort();
    if (ready.length === 0) {
      const cycle = [...remaining].sort().join(', ');
      const issueRequest: IssueRequest = {
        state: request.state,
        code: ModuleDeliveryIssueCode.DependencyCycle,
        path: '$.nodes',
        message: `Dependency cycle includes: ${cycle}.`,
      };
      issue(issueRequest);
      return false;
    }
    waves.push(ready);
    for (const taskId of ready) {
      remaining.delete(taskId);
      completed.add(taskId);
      order.push(taskId);
    }
  }
  const reachabilityRequest: claimContainment.ModuleDeliveryReachabilityRequest =
    {
      order,
      dependencies: request.dependencies,
    };
  return {
    order,
    waves,
    reachability:
      claimContainment.buildModuleDeliveryReachability(reachabilityRequest),
    executionPrecedence: claimContainment.sortedModuleDeliveryPrecedence(
      request.constraints,
    ),
  };
}

function buildExecutionTopologyRequest(
  state: ValidationState,
): ExecutionTopologyRequest {
  const dependencies = new Map<string, Set<string>>();
  const request: ExecutionTopologyRequest = {
    state,
    dependencies,
    constraints: [],
  };
  for (const node of state.plan.nodes) {
    dependencies.set(node.taskId, new Set());
    for (const predecessorTaskId of node.dependencies) {
      const constraint = {
        request,
        predecessorTaskId,
        successorTaskId: node.taskId,
        reason: ModuleDeliveryExecutionPrecedenceReason.DeclaredDependency,
      };
      addExecutionConstraint(constraint);
    }
  }
  const writers = state.plan.nodes.filter(
    (node) => node.kind === ModuleDeliveryTaskKind.Write,
  );
  const evidenceProviders = state.plan.nodes.filter(
    (node) => node.kind === ModuleDeliveryTaskKind.ReadOnly,
  );
  for (const provider of evidenceProviders) {
    for (const writer of writers) {
      const overlap: ClaimPair = {
        first: writer.resources.write,
        second: provider.resources.evidenceSurface,
      };
      if (claimContainment.resourceClaimListsOverlap(overlap)) {
        const constraint = {
          request,
          predecessorTaskId: writer.taskId,
          successorTaskId: provider.taskId,
          reason: ModuleDeliveryExecutionPrecedenceReason.EvidenceHazard,
        };
        addExecutionConstraint(constraint);
      }
    }
  }
  for (const precedence of cortexContextPrecedence(state.plan)) {
    const constraint = {
      request,
      predecessorTaskId: precedence.writerTaskId,
      successorTaskId: precedence.consumerTaskId,
      reason: ModuleDeliveryExecutionPrecedenceReason.ResourceConflict,
    };
    addExecutionConstraint(constraint);
  }
  return request;
}

type AddExecutionConstraintRequest = {
  readonly request: ExecutionTopologyRequest;
  readonly predecessorTaskId: string;
  readonly successorTaskId: string;
  readonly reason: ModuleDeliveryExecutionPrecedenceReason;
};

function addExecutionConstraint(value: AddExecutionConstraintRequest): void {
  value.request.dependencies
    .get(value.successorTaskId)
    ?.add(value.predecessorTaskId);
  const predecessor = value.request.state.nodesById.get(
    value.predecessorTaskId,
  );
  const constraint: ModuleDeliveryExecutionPrecedence = {
    predecessorTaskId: value.predecessorTaskId,
    successorTaskId: value.successorTaskId,
    reason: value.reason,
    requiresIntegratedWriterFrontier:
      predecessor?.kind === ModuleDeliveryTaskKind.Write,
  };
  if (
    !value.request.constraints.some(
      (candidate) =>
        claimContainment.moduleDeliveryPrecedenceIdentity(candidate) ===
        claimContainment.moduleDeliveryPrecedenceIdentity(constraint),
    )
  )
    value.request.constraints.push(constraint);
}

function serializeOrdinaryConflicts(request: ExecutionTopologyRequest): void {
  const taskIds = [...request.state.nodesById.keys()].sort();
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
      const order = topologyForDependencies(request);
      if (!order) return;
      const pair: claimContainment.OrderedModuleDeliveryNodePair = {
        first,
        second,
        reachability: order.reachability,
      };
      if (
        claimContainment.moduleDeliveryNodesConflict(pair) &&
        !claimContainment.moduleDeliveryNodesAreOrdered(pair)
      ) {
        const constraint = {
          request,
          predecessorTaskId: first.taskId,
          successorTaskId: second.taskId,
          reason: ModuleDeliveryExecutionPrecedenceReason.ResourceConflict,
        };
        addExecutionConstraint(constraint);
      }
    }
  }
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
