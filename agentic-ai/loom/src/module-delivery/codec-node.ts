import { AgentAttemptParentKind } from '../agent-workflow/domain.ts';
import { UntrustedYamlBoundary } from '../lib/guards.ts';
import { MODULE_EXPERT_CATALOG } from '../module-experts/catalog.ts';
import { TeamKey, TeamAuthorityCatalog } from '../team-agents/catalog.ts';
import {
  CORTEX_TEAM_WRITER_EXPERT,
  MAX_MODULE_DELIVERY_EDGE_CONTRACTS,
  MAX_MODULE_DELIVERY_EXPECTED_PRODUCERS,
  MAX_MODULE_DELIVERY_NODES,
  ModuleDeliveryBaselineKind,
  ModuleDeliveryEvidenceInputSchema,
  ModuleDeliveryJoinKind,
  ModuleDeliveryOwner,
  ModuleDeliveryTaskKind,
  ModuleDeliveryWorkspaceKind,
  ModuleTaskOwnership,
  ModuleDeliveryIssueCode,
} from './domain.ts';
import type {
  ModuleDeliveryBaseline,
  ModuleDeliveryCortexAuthoring,
  ModuleDeliveryEdgeContract,
  ModuleDeliveryEvidenceInputContract,
  ModuleDeliveryExpectedProducerIdentity,
  ModuleDeliveryNodeV2,
  ModuleDeliveryParentJoin,
  LegacyModuleDeliveryNode,
} from './domain.ts';
import {
  LegacyModulePlanAcceptanceField,
  LegacyModulePlanReadOnlyNodeField,
  LegacyModulePlanResourceField,
  LegacyModulePlanWriteNodeField,
  ModulePlanAcceptanceField,
  ModulePlanAttemptLineageField,
  ModulePlanCortexAuthoringField,
  ModulePlanCortexWriteNodeField,
  ModulePlanEdgeField,
  ModulePlanEvidenceInputField,
  ModulePlanExpectedProducerField,
  ModulePlanIntegratedBaselineField,
  ModulePlanParentJoinField,
  ModulePlanReadOnlyNodeField,
  ModulePlanResourceField,
  ModulePlanRootLineageField,
  ModulePlanSourceBaselineField,
  ModulePlanSynthesisNodeField,
  ModulePlanWorkspaceField,
  ModulePlanWriteNodeField,
} from './codec-schema.ts';
import {
  ModulePlanDecodeFailure,
  ModulePlanFields,
} from './codec-fields.ts';
import type {
  ModulePlanAcceptanceDecodeRequest,
  ModuleDeliveryOwnerDecodeRequest,
  ModuleDeliveryTeamDecodeRequest,
  LegacyTaskTeamRequest,
  ModulePlanIndexedNodeRequest,
  ModulePlanIndexedProducerRequest,
  ModulePlanNodeListRequest,
  ModulePlanResourceDecodeRequest,
} from './codec-schema.ts';
import {
  CortexAuthoringResources,
  CortexSkillAuthorization,
} from './cortex-authoring-codec.ts';
import type { CortexAuthoringResourceCompositionRequest } from './cortex-authoring-codec.ts';
import type {
  ModulePlanObjectDecodeRequest,
  ModulePlanTransportList,
} from './codec-fields.ts';

/** Owns decoding of module delivery plan nodes and their nested contracts. */
export class ModuleDeliveryPlanNodeCodec {
  private constructor() {}

  static decodeParentJoin(
    request: ModulePlanObjectDecodeRequest,
  ): ModuleDeliveryParentJoin {
    const fields = new ModulePlanFields(request);
    fields.requireExactKeys(ModulePlanParentJoinField);
    if (fields.string('kind') !== ModuleDeliveryJoinKind.DirectCommits) {
      ModuleDeliveryPlanNodeCodec.fail(
        `${request.path}.kind: unsupported parent join.`,
      );
    }
    return {
      kind: ModuleDeliveryJoinKind.DirectCommits,
      owner: fields.identifier('owner'),
      validationCommands: fields.nonEmptyStringList('validationCommands'),
    };
  }

  static decodeNodes(
    request: ModulePlanNodeListRequest & { readonly legacy: true },
  ): readonly LegacyModuleDeliveryNode[];
  static decodeNodes(
    request: ModulePlanNodeListRequest & { readonly legacy: false },
  ): readonly ModuleDeliveryNodeV2[];
  static decodeNodes(
    request: ModulePlanNodeListRequest,
  ): readonly (LegacyModuleDeliveryNode | ModuleDeliveryNodeV2)[] {
    ModuleDeliveryPlanNodeCodec.assertCollectionLimit(
      {
        values: request.values,
        path: '$.nodes',
        maximum: MAX_MODULE_DELIVERY_NODES,
      },
    );
    if (request.legacy) {
      const nodes: LegacyModuleDeliveryNode[] = [];
      for (const [index, value] of request.values.entries()) {
        const nodeRequest: ModulePlanIndexedNodeRequest & {
          readonly legacy: true;
        } = {
          value,
          index,
          legacy: true,
        };
        nodes.push(ModuleDeliveryPlanNodeCodec.decodeNode(nodeRequest));
      }
      return nodes;
    }
    const nodes: ModuleDeliveryNodeV2[] = [];
    for (const [index, value] of request.values.entries()) {
      const nodeRequest: ModulePlanIndexedNodeRequest & {
        readonly legacy: false;
      } = {
        value,
        index,
        legacy: false,
      };
      nodes.push(ModuleDeliveryPlanNodeCodec.decodeNode(nodeRequest));
    }
    return nodes;
  }

  private static decodeNode(
    request: ModulePlanIndexedNodeRequest & { readonly legacy: true },
  ): LegacyModuleDeliveryNode;
  private static decodeNode(
    request: ModulePlanIndexedNodeRequest & { readonly legacy: false },
  ): ModuleDeliveryNodeV2;
  private static decodeNode(
    request: ModulePlanIndexedNodeRequest,
  ): LegacyModuleDeliveryNode | ModuleDeliveryNodeV2 {
    const path = `$.nodes[${request.index}]`;
    if (!UntrustedYamlBoundary.isRecord(request.value))
      ModuleDeliveryPlanNodeCodec.fail(`${path}: node must be an object.`);
    const fieldRequest: ModulePlanObjectDecodeRequest = {
      record: request.value,
      path,
    };
    const fields = new ModulePlanFields(fieldRequest);
    const kind = fields.string('kind');
    if (request.legacy) {
      if (kind === ModuleDeliveryTaskKind.Write) {
        fields.requireExactKeys(LegacyModulePlanWriteNodeField);
      } else if (kind === ModuleDeliveryTaskKind.ReadOnly) {
        fields.requireExactKeys(LegacyModulePlanReadOnlyNodeField);
      } else {
        ModuleDeliveryPlanNodeCodec.fail(
          `${path}.kind: legacy plans only support read-only and write tasks.`,
        );
      }
    } else if (kind === ModuleDeliveryTaskKind.Write) {
      if (Object.hasOwn(request.value, 'cortexAuthoring'))
        fields.requireExactKeys(ModulePlanCortexWriteNodeField);
      else fields.requireExactKeys(ModulePlanWriteNodeField);
    } else if (kind === ModuleDeliveryTaskKind.ReadOnly) {
      fields.requireExactKeys(ModulePlanReadOnlyNodeField);
    } else if (kind === ModuleDeliveryTaskKind.EvidenceSynthesis) {
      fields.requireExactKeys(ModulePlanSynthesisNodeField);
    } else {
      ModuleDeliveryPlanNodeCodec.fail(`${path}.kind: unsupported task kind.`);
    }
    const resourceRequest: ModulePlanObjectDecodeRequest = {
      record: fields.recordField('resources'),
      path: `${path}.resources`,
    };
    const acceptanceRequest: ModulePlanObjectDecodeRequest = {
      record: fields.recordField('acceptance'),
      path: `${path}.acceptance`,
    };
    const baselineRequest: ModulePlanObjectDecodeRequest = {
      record: fields.recordField('baseline'),
      path: `${path}.baseline`,
    };
    const expert = fields.identifier('expert');
    const moduleRoot = fields.string('moduleRoot');
    const legacyTeamRequest: LegacyTaskTeamRequest = {
      kind,
      expert,
      moduleRoot,
    };
    const teamRequest: ModuleDeliveryTeamDecodeRequest = {
      value: request.legacy
        ? ModuleDeliveryPlanNodeCodec.legacyTaskTeam(legacyTeamRequest)
        : fields.string('team'),
      path,
    };
    const allowGizmoPrime =
      !request.legacy &&
      kind === ModuleDeliveryTaskKind.Write &&
      teamRequest.value === TeamKey.Ai &&
      expert === CORTEX_TEAM_WRITER_EXPERT &&
      moduleRoot === TeamAuthorityCatalog.teamCortexRoot(TeamKey.Ai) &&
      Object.hasOwn(request.value, 'cortexAuthoring');
    const functionalOwnerRequest: ModuleDeliveryOwnerDecodeRequest = {
      value: request.legacy
        ? teamRequest.value
        : fields.string('functionalOwner'),
      path: `${path}.functionalOwner`,
      allowGizmoPrime,
    };
    const acceptanceOwnerRequest: ModuleDeliveryOwnerDecodeRequest = {
      value: request.legacy
        ? teamRequest.value
        : fields.string('acceptanceOwner'),
      path: `${path}.acceptanceOwner`,
      allowGizmoPrime,
    };
    const parentLineageRequest: ModulePlanObjectDecodeRequest = {
      record: request.legacy
        ? request.value
        : fields.recordField('parentLineage'),
      path: `${path}.parentLineage`,
    };
    const parentLineage = request.legacy
      ? { kind: AgentAttemptParentKind.WorkflowRoot as const }
      : ModuleDeliveryPlanNodeCodec.decodeParentLineage(parentLineageRequest);
    const resourceClaimsRequest: ModulePlanResourceDecodeRequest = {
      ...resourceRequest,
      legacy: request.legacy,
      readOnly: kind === ModuleDeliveryTaskKind.ReadOnly,
    };
    const acceptanceDecodeRequest: ModulePlanAcceptanceDecodeRequest = {
      ...acceptanceRequest,
      legacy: request.legacy,
    };
    const common = {
      taskId: fields.identifier('taskId'),
      team: ModuleDeliveryPlanNodeCodec.decodeTeam(teamRequest),
      functionalOwner: ModuleDeliveryPlanNodeCodec.decodeOwner(
        functionalOwnerRequest,
      ),
      acceptanceOwner: ModuleDeliveryPlanNodeCodec.decodeOwner(
        acceptanceOwnerRequest,
      ),
      parentLineage,
      expert,
      moduleRoot,
      consumerOutcome: fields.string('consumerOutcome'),
      baseline: ModuleDeliveryPlanNodeCodec.decodeBaseline(baselineRequest),
      agentDepthLimit: fields.positiveInteger('agentDepthLimit'),
      dependencies: fields.stringList('dependencies'),
      resources: ModuleDeliveryPlanNodeCodec.decodeResourceClaims(
        resourceClaimsRequest,
      ),
      parentOwnedExclusions: fields.nonEmptyStringList('parentOwnedExclusions'),
      acceptance: ModuleDeliveryPlanNodeCodec.decodeAcceptance(
        acceptanceDecodeRequest,
      ),
    };
    if (kind === ModuleDeliveryTaskKind.ReadOnly) {
      return { kind: ModuleDeliveryTaskKind.ReadOnly, ...common };
    }
    if (kind === ModuleDeliveryTaskKind.EvidenceSynthesis) {
      const inputRequest: ModulePlanObjectDecodeRequest = {
        record: fields.recordField('evidenceInput'),
        path: `${path}.evidenceInput`,
      };
      return {
        kind: ModuleDeliveryTaskKind.EvidenceSynthesis,
        ...common,
        evidenceInput:
          ModuleDeliveryPlanNodeCodec.decodeEvidenceInput(inputRequest),
      };
    }
    const workspaceRequest: ModulePlanObjectDecodeRequest = {
      record: fields.recordField('workspace'),
      path: `${path}.workspace`,
    };
    const workspaceFields = new ModulePlanFields(workspaceRequest);
    workspaceFields.requireExactKeys(ModulePlanWorkspaceField);
    if (
      workspaceFields.string('kind') !==
      ModuleDeliveryWorkspaceKind.SharedCheckout
    ) {
      ModuleDeliveryPlanNodeCodec.fail(
        `${path}.workspace.kind: unsupported workspace kind.`,
      );
    }
    const workspace = {
      kind: ModuleDeliveryWorkspaceKind.SharedCheckout,
      expectedCommitHandoff: workspaceFields.trueValue('expectedCommitHandoff'),
    } as const;
    if (!Object.hasOwn(request.value, 'cortexAuthoring')) {
      return {
        kind: ModuleDeliveryTaskKind.Write,
        ...common,
        workspace,
      };
    }
    const cortexAuthoringRequest: ModulePlanObjectDecodeRequest = {
      record: fields.recordField('cortexAuthoring'),
      path: `${path}.cortexAuthoring`,
    };
    const cortexAuthoring = ModuleDeliveryPlanNodeCodec.decodeCortexAuthoring(
      cortexAuthoringRequest,
    );
    if (new Set(common.resources.read).size !== common.resources.read.length)
      ModuleDeliveryPlanNodeCodec.fail(
        `${path}.resources.read: authored read claims must be unique.`,
      );
    const resourceCompositionRequest: CortexAuthoringResourceCompositionRequest =
      {
        team: common.team,
        resources: common.resources,
        cortexAuthoring,
        path: `${path}.cortexAuthoring`,
      };
    const unauthorizedSkill = CortexSkillAuthorization.rejectUnauthorized(
      resourceCompositionRequest,
    );
    if (unauthorizedSkill !== false)
      ModuleDeliveryPlanNodeCodec.fail(
        `${path}.cortexAuthoring.selectedSkillPaths: ${unauthorizedSkill} was not authorized by the submitted read claims.`,
      );
    const resources = CortexAuthoringResources.compose(
      resourceCompositionRequest,
    );
    if (resources.read.length > 128)
      ModuleDeliveryPlanNodeCodec.fail(
        `${path}.resources.read: composed read claims exceed 128 entries.`,
      );
    return {
      kind: ModuleDeliveryTaskKind.Write,
      ...common,
      resources,
      cortexAuthoring,
      workspace,
    };
  }

  private static decodeCortexAuthoring(
    request: ModulePlanObjectDecodeRequest,
  ): ModuleDeliveryCortexAuthoring {
    const fields = new ModulePlanFields(request);
    fields.requireExactKeys(ModulePlanCortexAuthoringField);
    return {
      selectedSkillPaths: fields.stringList('selectedSkillPaths'),
      sharedWriteClaims: fields.stringList('sharedWriteClaims'),
    };
  }

  private static decodeBaseline(
    request: ModulePlanObjectDecodeRequest,
  ): ModuleDeliveryBaseline {
    const fields = new ModulePlanFields(request);
    const kind = fields.string('kind');
    if (kind === ModuleDeliveryBaselineKind.SourceCommit) {
      fields.requireExactKeys(ModulePlanSourceBaselineField);
      return {
        kind: ModuleDeliveryBaselineKind.SourceCommit,
        sourceCommit: fields.string('sourceCommit'),
      };
    }
    if (kind === ModuleDeliveryBaselineKind.IntegratedDependencies) {
      fields.requireExactKeys(ModulePlanIntegratedBaselineField);
      return {
        kind: ModuleDeliveryBaselineKind.IntegratedDependencies,
        providerTaskIds: fields.nonEmptyStringList('providerTaskIds'),
      };
    }
    ModuleDeliveryPlanNodeCodec.fail(
      `${request.path}.kind: unsupported baseline kind.`,
    );
  }

  private static decodeResourceClaims(
    request: ModulePlanResourceDecodeRequest,
  ): ModuleDeliveryNodeV2['resources'] {
    const fields = new ModulePlanFields(request);
    if (request.legacy) fields.requireExactKeys(LegacyModulePlanResourceField);
    else fields.requireExactKeys(ModulePlanResourceField);
    const read = fields.stringList('read');
    return {
      read,
      write: fields.stringList('write'),
      evidenceSurface: request.legacy
        ? request.readOnly
          ? read
          : []
        : fields.stringList('evidenceSurface'),
    };
  }

  private static decodeTeam(request: ModuleDeliveryTeamDecodeRequest): TeamKey {
    const teams = Object.values(TeamKey);
    const team = teams.find((candidate) => candidate === request.value);
    if (!team) {
      ModuleDeliveryPlanNodeCodec.fail(
        `${request.path}.team: unsupported team identity.`,
      );
    }
    return team;
  }

  private static decodeOwner(request: ModuleDeliveryOwnerDecodeRequest) {
    if (
      request.allowGizmoPrime &&
      request.value === ModuleDeliveryOwner.GizmoPrime
    )
      return ModuleDeliveryOwner.GizmoPrime;
    return ModuleDeliveryPlanNodeCodec.decodeTeam(request);
  }

  private static legacyTaskTeam(request: LegacyTaskTeamRequest): TeamKey {
    const profile = MODULE_EXPERT_CATALOG.find(
      ({ name }) => name === request.expert,
    );
    const taskKind = Object.values(ModuleDeliveryTaskKind).find(
      (candidate) => candidate === request.kind,
    );
    if (!taskKind) return TeamKey.Ai;
    const [defaulted1 = []] = [profile?.canonicalContextPaths];
    const teamRequest = {
      kind: taskKind,
      moduleRoot: request.moduleRoot,
      expertContextPaths: defaulted1,
    };
    const team = ModuleTaskOwnership.moduleDeliveryTaskTeam(teamRequest);
    return team === false ? TeamKey.Ai : team;
  }

  private static decodeParentLineage(
    request: ModulePlanObjectDecodeRequest,
  ): ModuleDeliveryNodeV2['parentLineage'] {
    const fields = new ModulePlanFields(request);
    const kind = fields.string('kind');
    if (kind === AgentAttemptParentKind.WorkflowRoot) {
      fields.requireExactKeys(ModulePlanRootLineageField);
      return { kind: AgentAttemptParentKind.WorkflowRoot };
    }
    if (kind !== AgentAttemptParentKind.AgentAttempt) {
      ModuleDeliveryPlanNodeCodec.fail(
        `${request.path}.kind: unsupported parent lineage kind.`,
      );
    }
    fields.requireExactKeys(ModulePlanAttemptLineageField);
    return {
      kind: AgentAttemptParentKind.AgentAttempt,
      task: fields.identifier('task'),
      agent: fields.identifier('agent'),
      attempt: fields.positiveInteger('attempt'),
    };
  }

  private static decodeEvidenceInput(
    request: ModulePlanObjectDecodeRequest,
  ): ModuleDeliveryEvidenceInputContract {
    const fields = new ModulePlanFields(request);
    fields.requireExactKeys(ModulePlanEvidenceInputField);
    const schema = fields.string('schema');
    if (
      schema !== ModuleDeliveryEvidenceInputSchema.AcceptedProviderEvidenceV1
    ) {
      ModuleDeliveryPlanNodeCodec.fail(
        `${request.path}.schema: unsupported evidence input schema.`,
      );
    }
    const values = fields.nodeList(
      'expectedProducers',
      MAX_MODULE_DELIVERY_EXPECTED_PRODUCERS,
    );
    const expectedProducers: ModuleDeliveryExpectedProducerIdentity[] = [];
    for (const [index, value] of values.entries()) {
      const producerRequest: ModulePlanIndexedProducerRequest = {
        value,
        index,
        path: request.path,
      };
      expectedProducers.push(
        ModuleDeliveryPlanNodeCodec.decodeExpectedProducer(producerRequest),
      );
    }
    return {
      schema: ModuleDeliveryEvidenceInputSchema.AcceptedProviderEvidenceV1,
      expectedProducers,
    };
  }

  private static decodeExpectedProducer(
    request: ModulePlanIndexedProducerRequest,
  ): ModuleDeliveryExpectedProducerIdentity {
    const path = `${request.path}.expectedProducers[${request.index}]`;
    if (!UntrustedYamlBoundary.isRecord(request.value))
      ModuleDeliveryPlanNodeCodec.fail(`${path}: expected an object.`);
    const fieldRequest: ModulePlanObjectDecodeRequest = {
      record: request.value,
      path,
    };
    const fields = new ModulePlanFields(fieldRequest);
    fields.requireExactKeys(ModulePlanExpectedProducerField);
    const teamRequest: ModuleDeliveryTeamDecodeRequest = {
      value: fields.string('team'),
      path: `${path}.team`,
    };
    const functionalOwnerRequest: ModuleDeliveryOwnerDecodeRequest = {
      value: fields.string('functionalOwner'),
      path: `${path}.functionalOwner`,
      allowGizmoPrime: true,
    };
    const acceptanceOwnerRequest: ModuleDeliveryOwnerDecodeRequest = {
      value: fields.string('acceptanceOwner'),
      path: `${path}.acceptanceOwner`,
      allowGizmoPrime: true,
    };
    return {
      taskId: fields.identifier('taskId'),
      team: ModuleDeliveryPlanNodeCodec.decodeTeam(teamRequest),
      functionalOwner: ModuleDeliveryPlanNodeCodec.decodeOwner(
        functionalOwnerRequest,
      ),
      acceptanceOwner: ModuleDeliveryPlanNodeCodec.decodeOwner(
        acceptanceOwnerRequest,
      ),
    };
  }

  private static decodeAcceptance(
    request: ModulePlanAcceptanceDecodeRequest,
  ): ModuleDeliveryNodeV2['acceptance'] {
    const fields = new ModulePlanFields(request);
    if (request.legacy)
      fields.requireExactKeys(LegacyModulePlanAcceptanceField);
    else fields.requireExactKeys(ModulePlanAcceptanceField);
    const evidence = fields.nonEmptyStringList('evidence');
    return {
      commands: fields.nonEmptyStringList('commands'),
      evidence,
    };
  }

  static decodeEdgeContracts(
    values: ModulePlanTransportList,
  ): readonly ModuleDeliveryEdgeContract[] {
    ModuleDeliveryPlanNodeCodec.assertCollectionLimit(
      {
        values,
        path: '$.edgeContracts',
        maximum: MAX_MODULE_DELIVERY_EDGE_CONTRACTS,
      },
    );
    const contracts: ModuleDeliveryEdgeContract[] = [];
    for (const [index, value] of values.entries()) {
      const path = `$.edgeContracts[${index}]`;
      if (!UntrustedYamlBoundary.isRecord(value))
        ModuleDeliveryPlanNodeCodec.fail(
          `${path}: edge contract must be an object.`,
        );
      const request: ModulePlanObjectDecodeRequest = { record: value, path };
      contracts.push(ModuleDeliveryPlanNodeCodec.decodeEdgeContract(request));
    }
    return contracts;
  }

  private static decodeEdgeContract(
    request: ModulePlanObjectDecodeRequest,
  ): ModuleDeliveryEdgeContract {
    const fields = new ModulePlanFields(request);
    fields.requireExactKeys(ModulePlanEdgeField);
    return {
      providerTaskId: fields.identifier('providerTaskId'),
      consumerTaskId: fields.identifier('consumerTaskId'),
      capability: fields.string('capability'),
      publicTypes: fields.nonEmptyStringList('publicTypes'),
      errors: fields.nonEmptyStringList('errors'),
      behaviorInvariants: fields.nonEmptyStringList('behaviorInvariants'),
      securityInvariants: fields.nonEmptyStringList('securityInvariants'),
      compatibilityExpectations: fields.nonEmptyStringList(
        'compatibilityExpectations',
      ),
      owningTests: fields.nonEmptyStringList('owningTests'),
    };
  }

  private static fail(message: string): never {
    throw new ModulePlanDecodeFailure({ message });
  }

  private static assertCollectionLimit(request: {
    readonly values: ModulePlanTransportList;
    readonly path: string;
    readonly maximum: number;
  }): void {
    if (request.values.length > request.maximum)
      ModuleDeliveryPlanNodeCodec.failLimit({
        path: request.path,
        observed: request.values.length,
        maximum: request.maximum,
      });
  }

  private static failLimit(request: {
    readonly path: string;
    readonly observed: number;
    readonly maximum: number;
  }): never {
    throw new ModulePlanDecodeFailure({
      message: `${request.path}: array contains ${request.observed} entries; maximum is ${request.maximum}.`,
      code: ModuleDeliveryIssueCode.LimitExceeded,
      path: request.path,
    });
  }
}
