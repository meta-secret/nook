import type {
  ValidationState,
  NodeValidationRequest,
  IssueRequest,
  UniqueListRequest,
  ClaimPair,
  ClaimListValidationRequest,
  ContractListsValidationRequest,
  EdgeIdentity,
  ModuleDeliveryTopology,
  ExecutionTopologyRequest,
  AddExecutionConstraintRequest,
} from './plan-validation-context.ts';
import {
  AgentAttemptParentKind,
  TaskResourceClaim,
} from '../agent-workflow/domain.ts';

import type { TaskResourcePatternPair } from '../agent-workflow/domain.ts';

import { MODULE_EXPERT_CATALOG } from '../module-experts/catalog.ts';

import { CortexAuthoringPolicy } from './cortex-authoring-validation.ts';

import { ModuleScope } from './module-scope-validation.ts';

import { CortexContextTopology } from './cortex-context-topology.ts';

import type { ModuleScopeValidationRequest } from './module-scope-validation.ts';

import type {
  CortexAuthoringValidationRequest,
  CortexWriteAuthorizationRequest,
  ParentOwnedExclusionsRequest,
} from './cortex-authoring-validation.ts';

import { ModuleDeliveryPlanSchema } from './codec.ts';

import {
  MODULE_DELIVERY_PLAN_VERSION,
  MAX_MODULE_DELIVERY_AGENT_DEPTH,
  MAX_MODULE_DELIVERY_ATTEMPTS,
  MAX_MODULE_DELIVERY_CONCURRENCY,
  MAX_MODULE_DELIVERY_NODES,
  REQUIRED_PARENT_OWNED_RESOURCES,
  CORTEX_TEAM_WRITER_EXPERT,
  ModuleDeliveryBaselineKind,
  ModuleDeliveryCompatibilityStatus,
  ModuleDeliveryExecutionPrecedenceReason,
  ModuleDeliveryIssueCode,
  ModuleDeliveryTaskKind,
  ModuleDeliveryTaskProfile,
  ModuleDeliveryValidationStatus,
  ModuleTaskOwnership,
} from './domain.ts';

import type {
  ModuleDeliveryIssue,
  ModuleDeliveryNodeV2,
  ModuleDeliveryPlanV2,
  ModuleDeliveryPlanValidation,
  ModuleDeliveryExecutionPrecedence,
  RejectedModuleDeliveryPlan,
} from './domain.ts';

import * as claimContainment from './resource-claim-containment.ts';

export class ModuleDeliveryPlanDecoder {
  private constructor(private readonly request: string) {}
  static decodeAndValidate(serialized: string): ModuleDeliveryPlanValidation {
    return new ModuleDeliveryPlanDecoder(serialized).execute();
  }
  private execute(): ModuleDeliveryPlanValidation {
    const serialized = this.request;
    const decoded =
      ModuleDeliveryPlanSchema.decodeCompatibleModuleDeliveryPlan(serialized);
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
    return this.validateDecodedModuleDeliveryPlan(decoded.plan);
  }

  private validateDecodedModuleDeliveryPlan(
    plan: ModuleDeliveryPlanV2,
  ): ModuleDeliveryPlanValidation {
    const issues: ModuleDeliveryIssue[] = [];
    const nodesById = new Map<string, ModuleDeliveryNodeV2>();
    const state: ValidationState = { plan, issues, nodesById };
    this.validateLimits(state);
    this.validateCommit(state);
    this.validateParentOwnedResources(state);
    this.indexNodes(state);
    this.validateNodes(state);
    this.validateEdgeContracts(state);
    const topology = this.buildTopology(state);
    if (!topology) return this.rejected(state);
    if (issues.length > 0) return this.rejected(state);
    return {
      status: ModuleDeliveryValidationStatus.Accepted,
      inputVersion: MODULE_DELIVERY_PLAN_VERSION,
      plan,
      planDigest: ModuleDeliveryPlanSchema.moduleDeliveryPlanDigest(plan),
      topologicalOrder: topology.order,
      waves: topology.waves,
      executionPrecedence: topology.executionPrecedence,
    };
  }

  private validateLimits(state: ValidationState): void {
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
        this.issue(request);
      }
    }
  }

  private validateCommit(state: ValidationState): void {
    if (!/^[0-9a-f]{40}$/u.test(state.plan.sourceCommit)) {
      const request: IssueRequest = {
        state,
        code: ModuleDeliveryIssueCode.InvalidField,
        path: '$.sourceCommit',
        message: 'sourceCommit must be an exact lowercase 40-hex commit.',
      };
      this.issue(request);
    }
  }

  private validateParentOwnedResources(state: ValidationState): void {
    const uniqueRequest: UniqueListRequest = {
      state,
      path: '$.parentOwnedResources',
      values: state.plan.parentOwnedResources,
    };
    this.validateUnique(uniqueRequest);
    for (const required of REQUIRED_PARENT_OWNED_RESOURCES) {
      if (!state.plan.parentOwnedResources.includes(required)) {
        const request: IssueRequest = {
          state,
          code: ModuleDeliveryIssueCode.MissingParentOwnedResource,
          path: '$.parentOwnedResources',
          message: `Parent-owned resource ${required} is required.`,
        };
        this.issue(request);
      }
    }
    const claimRequest: ClaimListValidationRequest = {
      state,
      path: '$.parentOwnedResources',
      claims: state.plan.parentOwnedResources,
    };
    this.validateClaimList(claimRequest);
  }

  private indexNodes(state: ValidationState): void {
    for (const [index, node] of state.plan.nodes.entries()) {
      if (state.nodesById.has(node.taskId)) {
        const request: IssueRequest = {
          state,
          code: ModuleDeliveryIssueCode.DuplicateValue,
          path: `$.nodes[${index}].taskId`,
          message: `Duplicate task ID ${node.taskId}.`,
        };
        this.issue(request);
      } else {
        state.nodesById.set(node.taskId, node);
      }
    }
  }

  private validateNodes(state: ValidationState): void {
    for (const [index, node] of state.plan.nodes.entries()) {
      const path = `$.nodes[${index}]`;
      const nodeRequest: NodeValidationRequest = { state, path, node };
      const profile = MODULE_EXPERT_CATALOG.find(
        (entry) => entry.name === node.expert,
      );
      if (node.expert === ModuleDeliveryTaskProfile.Ordinary)
        this.validateOrdinaryTask(nodeRequest);
      else if (
        !profile &&
        !(
          CortexAuthoringPolicy.isPureCortexTask(node) &&
          node.expert === CORTEX_TEAM_WRITER_EXPERT
        )
      ) {
        const request: IssueRequest = {
          state,
          code: ModuleDeliveryIssueCode.UnknownExpert,
          path: `${path}.expert`,
          message: `Expert ${node.expert} is not registered.`,
        };
        this.issue(request);
      } else if (profile) {
        const scopeRequest: ModuleScopeValidationRequest = {
          path,
          node,
          profile,
        };
        for (const finding of ModuleScope.validate(scopeRequest)) {
          const findingRequest: IssueRequest = { state, ...finding };
          this.issue(findingRequest);
        }
      }
      this.validateOwnership(nodeRequest);
      this.validateNodeLists(nodeRequest);
      this.validateDependencies(nodeRequest);
      this.validateTaskKind(nodeRequest);
      this.validateBaseline(nodeRequest);
      this.validateAgentDepth(nodeRequest);
      const cortexRequest: CortexAuthoringValidationRequest = { node, path };
      for (const finding of CortexAuthoringPolicy.validateCortexAuthoring(
        cortexRequest,
      )) {
        const findingRequest: IssueRequest = { state, ...finding };
        this.issue(findingRequest);
      }
      this.validateClaims(nodeRequest);
      this.validateExclusions(nodeRequest);
    }
  }

  private validateOrdinaryTask(request: NodeValidationRequest): void {
    const { node } = request;
    const writesAuthorized =
      node.kind !== ModuleDeliveryTaskKind.EvidenceSynthesis &&
      (node.kind !== ModuleDeliveryTaskKind.Write ||
        node.resources.write.every(
          (write) =>
            ModuleTaskOwnership.ordinaryTaskWriteAuthorized({
              team: node.team,
              moduleRoot: node.moduleRoot,
              write,
            }) &&
            MODULE_EXPERT_CATALOG.every((profile) =>
              profile.generatedScopePaths.every(
                (scope) =>
                  !TaskResourceClaim.taskResourcePatternsOverlap({
                    first: write,
                    second: `${scope.path}/**`,
                  }),
              ),
            ),
        ));
    if (
      TaskResourceClaim.isValidTaskResourceClaim(node.moduleRoot) &&
      !node.moduleRoot.includes('*') &&
      writesAuthorized
    )
      return;
    this.issue({
      state: request.state,
      code: ModuleDeliveryIssueCode.ModuleOwnershipMismatch,
      path: `${request.path}.moduleRoot`,
      message: 'Ordinary task ownership or bounded scope is invalid.',
    });
  }

  private validateOwnership(request: NodeValidationRequest): void {
    if (
      request.node.parentLineage.kind !== AgentAttemptParentKind.WorkflowRoot
    ) {
      const issueRequest: IssueRequest = {
        state: request.state,
        code: ModuleDeliveryIssueCode.ParentLineageMismatch,
        path: `${request.path}.parentLineage`,
        message: 'Canonical validation requires workflow-root lineage.',
      };
      this.issue(issueRequest);
    }
    if (request.node.acceptanceOwner !== request.node.functionalOwner) {
      const issueRequest: IssueRequest = {
        state: request.state,
        code: ModuleDeliveryIssueCode.AcceptanceOwnershipMismatch,
        path: `${request.path}.acceptanceOwner`,
        message: 'Acceptance owner must be the recorded functional owner.',
      };
      this.issue(issueRequest);
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
      this.issue(issueRequest);
    }
  }

  private validateNodeLists(request: NodeValidationRequest): void {
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
      this.validateUnique(uniqueRequest);
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
      this.validateUnique(baselineRequest);
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
      this.validateUnique(producerRequest);
    }
  }

  private validateDependencies(request: NodeValidationRequest): void {
    for (const dependency of request.node.dependencies) {
      if (dependency === request.node.taskId) {
        const issueRequest: IssueRequest = {
          state: request.state,
          code: ModuleDeliveryIssueCode.SelfDependency,
          path: `${request.path}.dependencies`,
          message: `Task ${request.node.taskId} cannot depend on itself.`,
        };
        this.issue(issueRequest);
      } else if (!request.state.nodesById.has(dependency)) {
        const issueRequest: IssueRequest = {
          state: request.state,
          code: ModuleDeliveryIssueCode.MissingDependency,
          path: `${request.path}.dependencies`,
          message: `Dependency ${dependency} does not exist.`,
        };
        this.issue(issueRequest);
      }
    }
  }

  private validateTaskKind(request: NodeValidationRequest): void {
    const writes = request.node.resources.write.length;
    const evidenceClaims = request.node.resources.evidenceSurface;
    if (request.node.kind !== ModuleDeliveryTaskKind.Write && writes !== 0) {
      const issueRequest: IssueRequest = {
        state: request.state,
        code: ModuleDeliveryIssueCode.InvalidField,
        path: `${request.path}.resources.write`,
        message: 'Non-writing tasks must have an empty write list.',
      };
      this.issue(issueRequest);
    }
    if (request.node.kind === ModuleDeliveryTaskKind.Write && writes === 0) {
      const issueRequest: IssueRequest = {
        state: request.state,
        code: ModuleDeliveryIssueCode.InvalidField,
        path: `${request.path}.resources.write`,
        message: 'Write tasks must claim at least one write resource.',
      };
      this.issue(issueRequest);
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
      this.issue(issueRequest);
    }
    if (request.node.kind === ModuleDeliveryTaskKind.EvidenceSynthesis) {
      this.validateEvidenceSynthesis(request);
    }
    for (const evidenceClaim of claimContainment.ModuleResourceContainment.uncoveredEvidenceClaims(
      request.node.resources,
    )) {
      const issueRequest: IssueRequest = {
        state: request.state,
        code: ModuleDeliveryIssueCode.EvidenceSurfaceMismatch,
        path: `${request.path}.resources.evidenceSurface`,
        message: `Evidence claim ${evidenceClaim} must be covered by a declared repository read claim.`,
      };
      this.issue(issueRequest);
    }
  }

  private validateEvidenceSynthesis(request: NodeValidationRequest): void {
    if (
      request.node.kind !== ModuleDeliveryTaskKind.EvidenceSynthesis ||
      (request.node.resources.read.length === 0 &&
        request.node.resources.write.length === 0 &&
        request.node.resources.evidenceSurface.length === 0)
    ) {
      if (request.node.kind !== ModuleDeliveryTaskKind.EvidenceSynthesis)
        return;
    } else {
      const resourceIssue: IssueRequest = {
        state: request.state,
        code: ModuleDeliveryIssueCode.EvidenceInputMismatch,
        path: `${request.path}.resources`,
        message: 'Evidence synthesis requires empty repository claims.',
      };
      this.issue(resourceIssue);
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
      this.issue(dependencyIssue);
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
        this.issue(identityIssue);
      }
    }
  }

  private validateBaseline(request: NodeValidationRequest): void {
    if (request.node.dependencies.length === 0) {
      if (
        request.node.baseline.kind !==
          ModuleDeliveryBaselineKind.SourceCommit ||
        request.node.baseline.sourceCommit !== request.state.plan.sourceCommit
      ) {
        const issueRequest: IssueRequest = {
          state: request.state,
          code: ModuleDeliveryIssueCode.BaselineMismatch,
          path: `${request.path}.baseline`,
          message: 'Independent tasks require the exact plan source baseline.',
        };
        this.issue(issueRequest);
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
      this.issue(issueRequest);
      return;
    }
    const actual = [...request.node.baseline.providerTaskIds].sort();
    const expected = [...request.node.dependencies].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      const issueRequest: IssueRequest = {
        state: request.state,
        code: ModuleDeliveryIssueCode.BaselineMismatch,
        path: `${request.path}.baseline.providerTaskIds`,
        message:
          'Integrated baseline providers must exactly match dependencies.',
      };
      this.issue(issueRequest);
    }
  }

  private validateAgentDepth(request: NodeValidationRequest): void {
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
      this.issue(issueRequest);
    }
  }

  private validateClaims(request: NodeValidationRequest): void {
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
    this.validateClaimList(evidenceRequest);
    this.validateClaimList(readRequest);
    this.validateClaimList(writeRequest);
    for (const write of request.node.resources.write) {
      for (const protectedClaim of request.state.plan.parentOwnedResources) {
        const pair: TaskResourcePatternPair = {
          first: write,
          second: protectedClaim,
        };
        if (TaskResourceClaim.taskResourcePatternsOverlap(pair)) {
          const authorizationRequest: CortexWriteAuthorizationRequest = {
            node: request.node,
            claim: write,
          };
          if (
            protectedClaim === '.cortex/**' &&
            CortexAuthoringPolicy.cortexWriteAuthorized(authorizationRequest)
          )
            continue;
          const issueRequest: IssueRequest = {
            state: request.state,
            code: ModuleDeliveryIssueCode.ParentOwnedWrite,
            path: `${request.path}.resources.write`,
            message: `Write ${write} overlaps parent-owned resource ${protectedClaim}.`,
          };
          this.issue(issueRequest);
        }
      }
    }
  }

  private validateClaimList(request: ClaimListValidationRequest): void {
    for (const [index, claim] of request.claims.entries()) {
      if (!TaskResourceClaim.isValidTaskResourceClaim(claim)) {
        const issueRequest: IssueRequest = {
          state: request.state,
          code: ModuleDeliveryIssueCode.InvalidField,
          path: `${request.path}[${index}]`,
          message: `Invalid resource claim ${claim}.`,
        };
        this.issue(issueRequest);
      }
    }
  }

  private validateExclusions(request: NodeValidationRequest): void {
    const actual = [...request.node.parentOwnedExclusions].sort();
    const exclusionRequest: ParentOwnedExclusionsRequest = {
      plan: request.state.plan,
      node: request.node,
    };
    const expected = [
      ...CortexAuthoringPolicy.expectedParentOwnedExclusions(exclusionRequest),
    ].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      const issueRequest: IssueRequest = {
        state: request.state,
        code: ModuleDeliveryIssueCode.InvalidField,
        path: `${request.path}.parentOwnedExclusions`,
        message:
          'Each node must repeat the complete parent-owned exclusion set.',
      };
      this.issue(issueRequest);
    }
  }

  private validateEdgeContracts(state: ValidationState): void {
    const expected = new Set<string>();
    for (const node of state.plan.nodes) {
      for (const dependency of node.dependencies) {
        const identity: EdgeIdentity = {
          providerTaskId: dependency,
          consumerTaskId: node.taskId,
        };
        expected.add(this.edgeKey(identity));
      }
    }
    const actual = new Set<string>();
    for (const [index, contract] of state.plan.edgeContracts.entries()) {
      const identity: EdgeIdentity = {
        providerTaskId: contract.providerTaskId,
        consumerTaskId: contract.consumerTaskId,
      };
      const key = this.edgeKey(identity);
      if (actual.has(key)) {
        const request: IssueRequest = {
          state,
          code: ModuleDeliveryIssueCode.DuplicateValue,
          path: `$.edgeContracts[${index}]`,
          message: `Duplicate edge contract ${key}.`,
        };
        this.issue(request);
      }
      actual.add(key);
      if (!expected.has(key)) {
        const request: IssueRequest = {
          state,
          code: ModuleDeliveryIssueCode.UnexpectedEdgeContract,
          path: `$.edgeContracts[${index}]`,
          message: `Contract ${key} does not match a dependency edge.`,
        };
        this.issue(request);
      }
      const listRequest: ContractListsValidationRequest = {
        state,
        index,
        contract,
      };
      this.validateContractLists(listRequest);
    }
    for (const key of expected) {
      if (!actual.has(key)) {
        const request: IssueRequest = {
          state,
          code: ModuleDeliveryIssueCode.MissingEdgeContract,
          path: '$.edgeContracts',
          message: `Dependency edge ${key} has no contract.`,
        };
        this.issue(request);
      }
    }
  }

  private validateContractLists(request: ContractListsValidationRequest): void {
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
      this.validateUnique(uniqueRequest);
    }
  }

  private edgeKey(request: EdgeIdentity): string {
    return `${request.providerTaskId}->${request.consumerTaskId}`;
  }

  private buildTopology(
    state: ValidationState,
  ): ModuleDeliveryTopology | false {
    if (
      state.issues.some(
        (entry) =>
          entry.code === ModuleDeliveryIssueCode.MissingDependency ||
          entry.code === ModuleDeliveryIssueCode.SelfDependency ||
          entry.code === ModuleDeliveryIssueCode.DuplicateValue,
      )
    )
      return false;
    const topologyRequest = this.buildExecutionTopologyRequest(state);
    this.serializeOrdinaryConflicts(topologyRequest);
    return this.topologyForDependencies(topologyRequest);
  }

  private topologyForDependencies(
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
        this.issue(issueRequest);
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
        claimContainment.ModuleResourceContainment.buildModuleDeliveryReachability(
          reachabilityRequest,
        ),
      executionPrecedence:
        claimContainment.ModuleResourceContainment.sortedModuleDeliveryPrecedence(
          request.constraints,
        ),
    };
  }

  private buildExecutionTopologyRequest(
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
        this.addExecutionConstraint(constraint);
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
        if (
          claimContainment.ModuleResourceContainment.resourceClaimListsOverlap(
            overlap,
          )
        ) {
          const constraint = {
            request,
            predecessorTaskId: writer.taskId,
            successorTaskId: provider.taskId,
            reason: ModuleDeliveryExecutionPrecedenceReason.EvidenceHazard,
          };
          this.addExecutionConstraint(constraint);
        }
      }
    }
    for (const precedence of CortexContextTopology.precedence(state.plan)) {
      const constraint = {
        request,
        predecessorTaskId: precedence.writerTaskId,
        successorTaskId: precedence.consumerTaskId,
        reason: ModuleDeliveryExecutionPrecedenceReason.ResourceConflict,
      };
      this.addExecutionConstraint(constraint);
    }
    return request;
  }

  private addExecutionConstraint(value: AddExecutionConstraintRequest): void {
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
          claimContainment.ModuleResourceContainment.moduleDeliveryPrecedenceIdentity(
            candidate,
          ) ===
          claimContainment.ModuleResourceContainment.moduleDeliveryPrecedenceIdentity(
            constraint,
          ),
      )
    )
      value.request.constraints.push(constraint);
  }

  private serializeOrdinaryConflicts(request: ExecutionTopologyRequest): void {
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
        const order = this.topologyForDependencies(request);
        if (!order) return;
        const pair: claimContainment.OrderedModuleDeliveryNodePair = {
          first,
          second,
          reachability: order.reachability,
        };
        if (
          claimContainment.ModuleResourceContainment.moduleDeliveryNodesConflict(
            pair,
          ) &&
          !claimContainment.ModuleResourceContainment.moduleDeliveryNodesAreOrdered(
            pair,
          )
        ) {
          const constraint = {
            request,
            predecessorTaskId: first.taskId,
            successorTaskId: second.taskId,
            reason: ModuleDeliveryExecutionPrecedenceReason.ResourceConflict,
          };
          this.addExecutionConstraint(constraint);
        }
      }
    }
  }

  private validateUnique(request: UniqueListRequest): void {
    const unique = new Set(request.values);
    if (unique.size !== request.values.length) {
      const issueRequest: IssueRequest = {
        state: request.state,
        code: ModuleDeliveryIssueCode.DuplicateValue,
        path: request.path,
        message: 'List values must be unique.',
      };
      this.issue(issueRequest);
    }
  }

  private issue(request: IssueRequest): void {
    const value: ModuleDeliveryIssue = {
      code: request.code,
      path: request.path,
      message: request.message,
    };
    request.state.issues.push(value);
  }

  private rejected(state: ValidationState): ModuleDeliveryPlanValidation {
    return {
      status: ModuleDeliveryValidationStatus.Rejected,
      issues: state.issues,
    };
  }
}
