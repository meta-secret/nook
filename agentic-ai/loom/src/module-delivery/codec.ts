import { createHash } from 'node:crypto';
import {
  UntrustedYamlPropertyPresence,
  isRecord,
  untrustedYamlProperty,
} from '../lib/guards.ts';
import {
  fieldNamesOf,
  type RequestFieldVocabulary,
} from '../codec/field-vocabulary.ts';
import { AgentAttemptParentKind } from '../agent-workflow/domain.ts';
import { MODULE_EXPERT_CATALOG } from '../module-experts/catalog.ts';
import type {
  UntrustedYamlMap,
  UntrustedYamlNode,
  UntrustedYamlPropertyArgs,
} from '../lib/guards.ts';
import {
  MODULE_DELIVERY_PLAN_VERSION,
  ModuleDeliveryBaselineKind,
  ModuleDeliveryCompatibilityStatus,
  ModuleDeliveryEvidenceInputSchema,
  ModuleDeliveryIssueCode,
  ModuleDeliveryJoinKind,
  ModuleDeliveryTaskKind,
  ModuleDeliveryWorkspaceKind,
  moduleDeliveryTaskTeam,
} from './domain.ts';
import { TeamKey } from '../team-agents/catalog.ts';
import type {
  CompatibleModuleDeliveryPlanDecode,
  ModuleDeliveryBaseline,
  ModuleDeliveryEdgeContract,
  ModuleDeliveryIssue,
  ModuleDeliveryNodeV2,
  ModuleDeliveryParentJoin,
  ModuleDeliveryPlanV2,
  ModuleDeliveryExpectedProducerIdentity,
  ModuleDeliveryEvidenceInputContract,
  RejectedCompatibleModuleDeliveryPlan,
} from './domain.ts';

const MAX_SERIALIZED_PLAN_BYTES = 262_144;

type ModulePlanObjectDecodeRequest = {
  readonly record: UntrustedYamlMap;
  readonly path: string;
};

type ModulePlanIndexedNodeRequest = {
  readonly value: UntrustedYamlNode;
  readonly index: number;
  readonly legacy: boolean;
};

type ModulePlanTransportList = readonly UntrustedYamlNode[];

type ModuleDeliveryTeamDecodeRequest = {
  readonly value: string;
  readonly path: string;
};
type ModulePlanIndexedProducerRequest = {
  readonly value: UntrustedYamlNode;
  readonly index: number;
  readonly path: string;
};
type ModulePlanResourceDecodeRequest = ModulePlanObjectDecodeRequest & {
  readonly legacy: boolean;
  readonly readOnly: boolean;
};
type ModulePlanAcceptanceDecodeRequest = ModulePlanObjectDecodeRequest & {
  readonly legacy: boolean;
};
type LegacyTaskTeamRequest = {
  readonly kind: string;
  readonly expert: string;
  readonly moduleRoot: string;
};
type ModulePlanDigestNodeLookup = {
  readonly plan: ModuleDeliveryPlanV2;
  readonly taskId: string;
};
type ModulePlanDigestContractLookup = {
  readonly plan: ModuleDeliveryPlanV2;
  readonly key: string;
};

enum ModulePlanRootField {
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
enum LegacyModulePlanRootField {
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
enum ModulePlanParentJoinField {
  Kind = 'kind',
  Owner = 'owner',
  ValidationCommands = 'validationCommands',
}
enum ModulePlanReadOnlyNodeField {
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
enum ModulePlanWriteNodeField {
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
enum LegacyModulePlanReadOnlyNodeField {
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
enum LegacyModulePlanWriteNodeField {
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
enum ModulePlanSynthesisNodeField {
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
enum ModulePlanWorkspaceField {
  ExpectedCommitHandoff = 'expectedCommitHandoff',
  Kind = 'kind',
}
enum ModulePlanSourceBaselineField {
  Kind = 'kind',
  SourceCommit = 'sourceCommit',
}
enum ModulePlanIntegratedBaselineField {
  Kind = 'kind',
  ProviderTaskIds = 'providerTaskIds',
}
enum ModulePlanResourceField {
  EvidenceSurface = 'evidenceSurface',
  Read = 'read',
  Write = 'write',
}
enum ModulePlanAcceptanceField {
  Commands = 'commands',
  Evidence = 'evidence',
}
enum LegacyModulePlanResourceField {
  Read = 'read',
  Write = 'write',
}
enum LegacyModulePlanAcceptanceField {
  Commands = 'commands',
  Evidence = 'evidence',
}
enum ModulePlanEdgeField {
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
enum ModulePlanRootLineageField {
  Kind = 'kind',
}
enum ModulePlanAttemptLineageField {
  Agent = 'agent',
  Attempt = 'attempt',
  Kind = 'kind',
  Task = 'task',
}
enum ModulePlanEvidenceInputField {
  ExpectedProducers = 'expectedProducers',
  Schema = 'schema',
}
enum ModulePlanExpectedProducerField {
  AcceptanceOwner = 'acceptanceOwner',
  FunctionalOwner = 'functionalOwner',
  TaskId = 'taskId',
  Team = 'team',
}

class ModulePlanDecodeFailure extends Error {}

class ModulePlanFields {
  readonly record: UntrustedYamlMap;
  readonly path: string;

  constructor(request: ModulePlanObjectDecodeRequest) {
    this.record = request.record;
    this.path = request.path;
  }

  requireExactKeys<FieldName extends string>(
    vocabulary: RequestFieldVocabulary<FieldName>,
  ): void {
    const actual = Object.keys(this.record).sort();
    const expected = [...fieldNamesOf(vocabulary)].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      fail(`${this.path}: expected exactly ${expected.join(', ')}.`);
    }
  }

  string(key: string): string {
    const value = this.value(key);
    if (
      typeof value !== 'string' ||
      value.trim() === '' ||
      value.length > 4096 ||
      hasControlCharacter(value)
    ) {
      fail(`${this.path}.${key}: expected a bounded non-empty string.`);
    }
    return value;
  }

  identifier(key: string): string {
    const value = this.string(key);
    if (!/^[a-z][a-z0-9_-]{0,63}$/u.test(value)) {
      fail(`${this.path}.${key}: expected a stable lowercase identifier.`);
    }
    return value;
  }

  positiveInteger(key: string): number {
    const value = this.value(key);
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value <= 0
    ) {
      fail(`${this.path}.${key}: expected a positive integer.`);
    }
    return value;
  }

  trueValue(key: string): true {
    if (this.value(key) !== true) {
      fail(`${this.path}.${key}: expected true.`);
    }
    return true;
  }

  nonEmptyStringList(key: string): readonly string[] {
    const values = this.stringList(key);
    if (values.length === 0) {
      fail(`${this.path}.${key}: expected a non-empty string array.`);
    }
    return values;
  }

  stringList(key: string): readonly string[] {
    const value = this.value(key);
    if (!Array.isArray(value) || value.length > 128) {
      fail(`${this.path}.${key}: expected a bounded string array.`);
    }
    for (const entry of value) {
      if (
        typeof entry !== 'string' ||
        entry.trim() === '' ||
        entry.length > 4096 ||
        hasControlCharacter(entry)
      ) {
        fail(`${this.path}.${key}: expected bounded non-empty entries.`);
      }
    }
    return value;
  }

  recordField(key: string): UntrustedYamlMap {
    const value = this.value(key);
    if (!isRecord(value)) fail(`${this.path}.${key}: expected an object.`);
    return value;
  }

  nodeList(key: string): ModulePlanTransportList {
    const value = this.value(key);
    if (!Array.isArray(value) || value.length === 0) {
      fail(`${this.path}.${key}: expected a non-empty array.`);
    }
    return value;
  }

  list(key: string): ModulePlanTransportList {
    const value = this.value(key);
    if (!Array.isArray(value)) fail(`${this.path}.${key}: expected an array.`);
    return value;
  }

  private value(key: string): UntrustedYamlNode {
    const propertyRequest: UntrustedYamlPropertyArgs = {
      record: this.record,
      key,
    };
    const property = untrustedYamlProperty(propertyRequest);
    if (property.presence === UntrustedYamlPropertyPresence.Absent) {
      fail(`${this.path}.${key}: required field is missing.`);
    }
    return property.value;
  }
}

export function decodeCompatibleModuleDeliveryPlan(
  serialized: string,
): CompatibleModuleDeliveryPlanDecode {
  if (Buffer.byteLength(serialized, 'utf8') > MAX_SERIALIZED_PLAN_BYTES) {
    const request: RejectedModulePlanRequest = {
      code: ModuleDeliveryIssueCode.LimitExceeded,
      message: 'Plan transport exceeds 262144 bytes.',
    };
    return rejected(request);
  }
  let node: UntrustedYamlNode;
  try {
    node = JSON.parse(serialized) as UntrustedYamlNode;
  } catch {
    const request: RejectedModulePlanRequest = {
      code: ModuleDeliveryIssueCode.MalformedTransport,
      message: 'Plan must be valid JSON.',
    };
    return rejected(request);
  }
  try {
    return decodePlanRoot(node);
  } catch (error) {
    if (error instanceof ModulePlanDecodeFailure) {
      const request: RejectedModulePlanRequest = {
        code: ModuleDeliveryIssueCode.InvalidField,
        message: error.message,
      };
      return rejected(request);
    }
    throw error;
  }
}

function decodePlanRoot(
  node: UntrustedYamlNode,
): CompatibleModuleDeliveryPlanDecode {
  if (!isRecord(node)) fail('Plan root must be an object.');
  const fieldRequest: ModulePlanObjectDecodeRequest = {
    record: node,
    path: '$',
  };
  const fields = new ModulePlanFields(fieldRequest);
  const version = fields.positiveInteger('version');
  if (version !== 1 && version !== MODULE_DELIVERY_PLAN_VERSION)
    fail('$.version: plan version must be 1 or 2.');
  const legacy = version === 1;
  if (legacy) fields.requireExactKeys(LegacyModulePlanRootField);
  else fields.requireExactKeys(ModulePlanRootField);
  const parentJoinRequest: ModulePlanObjectDecodeRequest = {
    record: fields.recordField('parentJoin'),
    path: '$.parentJoin',
  };
  const nodeListRequest: ModulePlanNodeListRequest = {
    values: fields.nodeList('nodes'),
    legacy,
  };
  const plan: ModuleDeliveryPlanV2 = {
    version: MODULE_DELIVERY_PLAN_VERSION,
    generation: legacy ? 1 : fields.positiveInteger('generation'),
    sourceCommit: fields.string('sourceCommit'),
    maxConcurrency: fields.positiveInteger('maxConcurrency'),
    maxAgentDepth: fields.positiveInteger('maxAgentDepth'),
    maxAttempts: fields.positiveInteger('maxAttempts'),
    parentOwnedResources: fields.nonEmptyStringList('parentOwnedResources'),
    parentJoin: decodeParentJoin(parentJoinRequest),
    nodes: decodeNodes(nodeListRequest),
    edgeContracts: decodeEdgeContracts(fields.list('edgeContracts')),
  };
  return {
    status: ModuleDeliveryCompatibilityStatus.Decoded,
    inputVersion: version,
    plan,
  };
}

function decodeParentJoin(
  request: ModulePlanObjectDecodeRequest,
): ModuleDeliveryParentJoin {
  const fields = new ModulePlanFields(request);
  fields.requireExactKeys(ModulePlanParentJoinField);
  if (fields.string('kind') !== ModuleDeliveryJoinKind.OrderedCommitHandoffs) {
    fail(`${request.path}.kind: unsupported parent join.`);
  }
  return {
    kind: ModuleDeliveryJoinKind.OrderedCommitHandoffs,
    owner: fields.identifier('owner'),
    validationCommands: fields.nonEmptyStringList('validationCommands'),
  };
}

type ModulePlanNodeListRequest = {
  readonly values: ModulePlanTransportList;
  readonly legacy: boolean;
};

function decodeNodes(
  request: ModulePlanNodeListRequest,
): readonly ModuleDeliveryNodeV2[] {
  const nodes: ModuleDeliveryNodeV2[] = [];
  for (const [index, value] of request.values.entries()) {
    const nodeRequest: ModulePlanIndexedNodeRequest = {
      value,
      index,
      legacy: request.legacy,
    };
    nodes.push(decodeNode(nodeRequest));
  }
  return nodes;
}

function decodeNode(
  request: ModulePlanIndexedNodeRequest,
): ModuleDeliveryNodeV2 {
  const path = `$.nodes[${request.index}]`;
  if (!isRecord(request.value)) fail(`${path}: node must be an object.`);
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
      fail(
        `${path}.kind: legacy plans only support read-only and write tasks.`,
      );
    }
  } else if (kind === ModuleDeliveryTaskKind.Write) {
    fields.requireExactKeys(ModulePlanWriteNodeField);
  } else if (kind === ModuleDeliveryTaskKind.ReadOnly) {
    fields.requireExactKeys(ModulePlanReadOnlyNodeField);
  } else if (kind === ModuleDeliveryTaskKind.EvidenceSynthesis) {
    fields.requireExactKeys(ModulePlanSynthesisNodeField);
  } else {
    fail(`${path}.kind: unsupported task kind.`);
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
      ? legacyTaskTeam(legacyTeamRequest)
      : fields.string('team'),
    path,
  };
  const functionalOwnerRequest: ModuleDeliveryTeamDecodeRequest = {
    value: request.legacy
      ? teamRequest.value
      : fields.string('functionalOwner'),
    path: `${path}.functionalOwner`,
  };
  const acceptanceOwnerRequest: ModuleDeliveryTeamDecodeRequest = {
    value: request.legacy
      ? teamRequest.value
      : fields.string('acceptanceOwner'),
    path: `${path}.acceptanceOwner`,
  };
  const parentLineageRequest: ModulePlanObjectDecodeRequest = {
    record: request.legacy
      ? request.value
      : fields.recordField('parentLineage'),
    path: `${path}.parentLineage`,
  };
  const parentLineage = request.legacy
    ? { kind: AgentAttemptParentKind.WorkflowRoot as const }
    : decodeParentLineage(parentLineageRequest);
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
    team: decodeTeam(teamRequest),
    functionalOwner: decodeTeam(functionalOwnerRequest),
    acceptanceOwner: decodeTeam(acceptanceOwnerRequest),
    parentLineage,
    expert,
    moduleRoot,
    consumerOutcome: fields.string('consumerOutcome'),
    baseline: decodeBaseline(baselineRequest),
    agentDepthLimit: fields.positiveInteger('agentDepthLimit'),
    dependencies: fields.stringList('dependencies'),
    resources: decodeResourceClaims(resourceClaimsRequest),
    parentOwnedExclusions: fields.nonEmptyStringList('parentOwnedExclusions'),
    acceptance: decodeAcceptance(acceptanceDecodeRequest),
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
      evidenceInput: decodeEvidenceInput(inputRequest),
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
    ModuleDeliveryWorkspaceKind.IsolatedWorktree
  ) {
    fail(`${path}.workspace.kind: unsupported workspace kind.`);
  }
  return {
    kind: ModuleDeliveryTaskKind.Write,
    ...common,
    workspace: {
      kind: ModuleDeliveryWorkspaceKind.IsolatedWorktree,
      expectedCommitHandoff: workspaceFields.trueValue('expectedCommitHandoff'),
    },
  };
}

function decodeBaseline(
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
  fail(`${request.path}.kind: unsupported baseline kind.`);
}

function decodeResourceClaims(
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

function decodeTeam(request: ModuleDeliveryTeamDecodeRequest): TeamKey {
  const teams = Object.values(TeamKey);
  if (!teams.includes(request.value as TeamKey)) {
    fail(`${request.path}.team: unsupported team identity.`);
  }
  return request.value as TeamKey;
}

function legacyTaskTeam(request: LegacyTaskTeamRequest): TeamKey {
  const profile = MODULE_EXPERT_CATALOG.find(
    ({ name }) => name === request.expert,
  );
  const taskKind = Object.values(ModuleDeliveryTaskKind).find(
    (candidate) => candidate === request.kind,
  );
  if (!taskKind) return TeamKey.Ai;
  const teamRequest = {
    kind: taskKind,
    moduleRoot: request.moduleRoot,
    expertContextPaths: profile?.canonicalContextPaths ?? [],
  };
  const team = moduleDeliveryTaskTeam(teamRequest);
  return team === false ? TeamKey.Ai : team;
}

function decodeParentLineage(
  request: ModulePlanObjectDecodeRequest,
): ModuleDeliveryNodeV2['parentLineage'] {
  const fields = new ModulePlanFields(request);
  const kind = fields.string('kind');
  if (kind === AgentAttemptParentKind.WorkflowRoot) {
    fields.requireExactKeys(ModulePlanRootLineageField);
    return { kind: AgentAttemptParentKind.WorkflowRoot };
  }
  if (kind !== AgentAttemptParentKind.AgentAttempt) {
    fail(`${request.path}.kind: unsupported parent lineage kind.`);
  }
  fields.requireExactKeys(ModulePlanAttemptLineageField);
  return {
    kind: AgentAttemptParentKind.AgentAttempt,
    task: fields.identifier('task'),
    agent: fields.identifier('agent'),
    attempt: fields.positiveInteger('attempt'),
  };
}

function decodeEvidenceInput(
  request: ModulePlanObjectDecodeRequest,
): ModuleDeliveryEvidenceInputContract {
  const fields = new ModulePlanFields(request);
  fields.requireExactKeys(ModulePlanEvidenceInputField);
  const schema = fields.string('schema');
  if (schema !== ModuleDeliveryEvidenceInputSchema.AcceptedProviderEvidenceV1) {
    fail(`${request.path}.schema: unsupported evidence input schema.`);
  }
  const values = fields.nodeList('expectedProducers');
  const expectedProducers: ModuleDeliveryExpectedProducerIdentity[] = [];
  for (const [index, value] of values.entries()) {
    const producerRequest: ModulePlanIndexedProducerRequest = {
      value,
      index,
      path: request.path,
    };
    expectedProducers.push(decodeExpectedProducer(producerRequest));
  }
  return {
    schema: ModuleDeliveryEvidenceInputSchema.AcceptedProviderEvidenceV1,
    expectedProducers,
  };
}

function decodeExpectedProducer(
  request: ModulePlanIndexedProducerRequest,
): ModuleDeliveryExpectedProducerIdentity {
  const path = `${request.path}.expectedProducers[${request.index}]`;
  if (!isRecord(request.value)) fail(`${path}: expected an object.`);
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
  const functionalOwnerRequest: ModuleDeliveryTeamDecodeRequest = {
    value: fields.string('functionalOwner'),
    path: `${path}.functionalOwner`,
  };
  const acceptanceOwnerRequest: ModuleDeliveryTeamDecodeRequest = {
    value: fields.string('acceptanceOwner'),
    path: `${path}.acceptanceOwner`,
  };
  return {
    taskId: fields.identifier('taskId'),
    team: decodeTeam(teamRequest),
    functionalOwner: decodeTeam(functionalOwnerRequest),
    acceptanceOwner: decodeTeam(acceptanceOwnerRequest),
  };
}

function decodeAcceptance(
  request: ModulePlanAcceptanceDecodeRequest,
): ModuleDeliveryNodeV2['acceptance'] {
  const fields = new ModulePlanFields(request);
  if (request.legacy) fields.requireExactKeys(LegacyModulePlanAcceptanceField);
  else fields.requireExactKeys(ModulePlanAcceptanceField);
  const evidence = fields.nonEmptyStringList('evidence');
  return {
    commands: fields.nonEmptyStringList('commands'),
    evidence,
  };
}

function decodeEdgeContracts(
  values: ModulePlanTransportList,
): readonly ModuleDeliveryEdgeContract[] {
  const contracts: ModuleDeliveryEdgeContract[] = [];
  for (const [index, value] of values.entries()) {
    const path = `$.edgeContracts[${index}]`;
    if (!isRecord(value)) fail(`${path}: edge contract must be an object.`);
    const request: ModulePlanObjectDecodeRequest = { record: value, path };
    contracts.push(decodeEdgeContract(request));
  }
  return contracts;
}

function decodeEdgeContract(
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

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function fail(message: string): never {
  throw new ModulePlanDecodeFailure(message);
}

type RejectedModulePlanRequest = {
  readonly code: ModuleDeliveryIssueCode;
  readonly message: string;
};

function rejected(
  request: RejectedModulePlanRequest,
): RejectedCompatibleModuleDeliveryPlan {
  const issue: ModuleDeliveryIssue = {
    code: request.code,
    path: '$',
    message: request.message,
  };
  return {
    status: ModuleDeliveryCompatibilityStatus.Rejected,
    issues: [issue],
  };
}

export function moduleDeliveryPlanDigest(plan: ModuleDeliveryPlanV2): string {
  const nodes = plan.nodes
    .map(({ taskId }) => taskId)
    .sort()
    .map((taskId) => {
      const lookup: ModulePlanDigestNodeLookup = { plan, taskId };
      return digestNode(lookup);
    });
  const edgeContracts = plan.edgeContracts
    .map((contract) => `${contract.providerTaskId}->${contract.consumerTaskId}`)
    .sort()
    .map((key) => {
      const lookup: ModulePlanDigestContractLookup = { plan, key };
      return digestContract(lookup);
    });
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

function digestNode(lookup: ModulePlanDigestNodeLookup) {
  const node = lookup.plan.nodes.find(({ taskId }) => taskId === lookup.taskId);
  if (!node) throw new Error(`Validated task ${lookup.taskId} is missing.`);
  const expectedProducers =
    node.kind === ModuleDeliveryTaskKind.EvidenceSynthesis
      ? node.evidenceInput.expectedProducers
          .map(({ taskId }) => taskId)
          .sort()
          .map((taskId) => {
            const producer = node.evidenceInput.expectedProducers.find(
              (candidate) => candidate.taskId === taskId,
            );
            if (!producer)
              throw new Error(`Validated producer ${taskId} is missing.`);
            return producer;
          })
      : [];
  return {
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
      evidenceSurface: [...node.resources.evidenceSurface].sort(),
    },
    parentOwnedExclusions: [...node.parentOwnedExclusions].sort(),
    acceptance: {
      commands: node.acceptance.commands,
      evidence: [...node.acceptance.evidence].sort(),
    },
    ...(node.kind === ModuleDeliveryTaskKind.EvidenceSynthesis
      ? {
          evidenceInput: { ...node.evidenceInput, expectedProducers },
        }
      : {}),
  };
}

function digestContract(lookup: ModulePlanDigestContractLookup) {
  const contract = lookup.plan.edgeContracts.find(
    (candidate) =>
      `${candidate.providerTaskId}->${candidate.consumerTaskId}` === lookup.key,
  );
  if (!contract)
    throw new Error(`Validated edge contract ${lookup.key} is missing.`);
  return {
    ...contract,
    publicTypes: [...contract.publicTypes].sort(),
    errors: [...contract.errors].sort(),
    behaviorInvariants: [...contract.behaviorInvariants].sort(),
    securityInvariants: [...contract.securityInvariants].sort(),
    compatibilityExpectations: [...contract.compatibilityExpectations].sort(),
    owningTests: [...contract.owningTests].sort(),
  };
}
