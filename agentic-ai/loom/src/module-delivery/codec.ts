import {
  UntrustedYamlPropertyPresence,
  isRecord,
  untrustedYamlProperty,
} from '../lib/guards.ts';
import type {
  UntrustedYamlMap,
  UntrustedYamlNode,
  UntrustedYamlPropertyArgs,
} from '../lib/guards.ts';
import {
  MODULE_DELIVERY_PLAN_VERSION,
  ModuleDeliveryBaselineKind,
  ModuleDeliveryIssueCode,
  ModuleDeliveryJoinKind,
  ModuleDeliveryTaskKind,
  ModuleDeliveryValidationStatus,
  ModuleDeliveryWorkspaceKind,
} from './domain.ts';
import type {
  ModuleDeliveryBaseline,
  ModuleDeliveryEdgeContract,
  ModuleDeliveryIssue,
  ModuleDeliveryNode,
  ModuleDeliveryParentJoin,
  ModuleDeliveryPlan,
  RejectedModuleDeliveryPlan,
} from './domain.ts';

const MAX_SERIALIZED_PLAN_BYTES = 262_144;

type ModulePlanObjectDecodeRequest = {
  readonly record: UntrustedYamlMap;
  readonly path: string;
};

type ModulePlanIndexedNodeRequest = {
  readonly value: UntrustedYamlNode;
  readonly index: number;
};

type ModulePlanKeyList = readonly string[];
type ModulePlanTransportList = readonly UntrustedYamlNode[];

class ModulePlanDecodeFailure extends Error {}

class ModulePlanFields {
  readonly record: UntrustedYamlMap;
  readonly path: string;

  constructor(request: ModulePlanObjectDecodeRequest) {
    this.record = request.record;
    this.path = request.path;
  }

  requireExactKeys(keys: ModulePlanKeyList): void {
    const actual = Object.keys(this.record).sort();
    const expected = [...keys].sort();
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

export type ModuleDeliveryPlanDecode =
  | {
      readonly status: ModuleDeliveryValidationStatus.Accepted;
      readonly plan: ModuleDeliveryPlan;
    }
  | RejectedModuleDeliveryPlan;

export function decodeModuleDeliveryPlan(
  serialized: string,
): ModuleDeliveryPlanDecode {
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

function decodePlanRoot(node: UntrustedYamlNode): ModuleDeliveryPlanDecode {
  if (!isRecord(node)) fail('Plan root must be an object.');
  const fieldRequest: ModulePlanObjectDecodeRequest = {
    record: node,
    path: '$',
  };
  const fields = new ModulePlanFields(fieldRequest);
  const rootKeys = [
    'edgeContracts',
    'maxAgentDepth',
    'maxAttempts',
    'maxConcurrency',
    'nodes',
    'parentJoin',
    'parentOwnedResources',
    'sourceCommit',
    'version',
  ];
  fields.requireExactKeys(rootKeys);
  if (fields.positiveInteger('version') !== MODULE_DELIVERY_PLAN_VERSION) {
    fail('$.version: plan version must be 1.');
  }
  const parentJoinRequest: ModulePlanObjectDecodeRequest = {
    record: fields.recordField('parentJoin'),
    path: '$.parentJoin',
  };
  const plan: ModuleDeliveryPlan = {
    version: MODULE_DELIVERY_PLAN_VERSION,
    sourceCommit: fields.string('sourceCommit'),
    maxConcurrency: fields.positiveInteger('maxConcurrency'),
    maxAgentDepth: fields.positiveInteger('maxAgentDepth'),
    maxAttempts: fields.positiveInteger('maxAttempts'),
    parentOwnedResources: fields.nonEmptyStringList('parentOwnedResources'),
    parentJoin: decodeParentJoin(parentJoinRequest),
    nodes: decodeNodes(fields.nodeList('nodes')),
    edgeContracts: decodeEdgeContracts(fields.list('edgeContracts')),
  };
  return { status: ModuleDeliveryValidationStatus.Accepted, plan };
}

function decodeParentJoin(
  request: ModulePlanObjectDecodeRequest,
): ModuleDeliveryParentJoin {
  const fields = new ModulePlanFields(request);
  const keys = ['kind', 'owner', 'validationCommands'];
  fields.requireExactKeys(keys);
  if (fields.string('kind') !== ModuleDeliveryJoinKind.OrderedCommitHandoffs) {
    fail(`${request.path}.kind: unsupported parent join.`);
  }
  return {
    kind: ModuleDeliveryJoinKind.OrderedCommitHandoffs,
    owner: fields.identifier('owner'),
    validationCommands: fields.nonEmptyStringList('validationCommands'),
  };
}

function decodeNodes(
  values: ModulePlanTransportList,
): readonly ModuleDeliveryNode[] {
  const nodes: ModuleDeliveryNode[] = [];
  for (const [index, value] of values.entries()) {
    const request: ModulePlanIndexedNodeRequest = { value, index };
    nodes.push(decodeNode(request));
  }
  return nodes;
}

function decodeNode(request: ModulePlanIndexedNodeRequest): ModuleDeliveryNode {
  const path = `$.nodes[${request.index}]`;
  if (!isRecord(request.value)) fail(`${path}: node must be an object.`);
  const fieldRequest: ModulePlanObjectDecodeRequest = {
    record: request.value,
    path,
  };
  const fields = new ModulePlanFields(fieldRequest);
  const kind = fields.string('kind');
  const commonKeys = [
    'acceptance',
    'agentDepthLimit',
    'baseline',
    'consumerOutcome',
    'dependencies',
    'expert',
    'kind',
    'moduleRoot',
    'parentOwnedExclusions',
    'resources',
    'taskId',
  ];
  if (kind === ModuleDeliveryTaskKind.Write) {
    const writeKeys = [...commonKeys, 'workspace'];
    fields.requireExactKeys(writeKeys);
  } else if (kind === ModuleDeliveryTaskKind.ReadOnly) {
    fields.requireExactKeys(commonKeys);
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
  const common = {
    taskId: fields.identifier('taskId'),
    expert: fields.identifier('expert'),
    moduleRoot: fields.string('moduleRoot'),
    consumerOutcome: fields.string('consumerOutcome'),
    baseline: decodeBaseline(baselineRequest),
    agentDepthLimit: fields.positiveInteger('agentDepthLimit'),
    dependencies: fields.stringList('dependencies'),
    resources: decodeResourceClaims(resourceRequest),
    parentOwnedExclusions: fields.nonEmptyStringList('parentOwnedExclusions'),
    acceptance: decodeAcceptance(acceptanceRequest),
  };
  if (kind === ModuleDeliveryTaskKind.ReadOnly) {
    return { kind: ModuleDeliveryTaskKind.ReadOnly, ...common };
  }
  const workspaceRequest: ModulePlanObjectDecodeRequest = {
    record: fields.recordField('workspace'),
    path: `${path}.workspace`,
  };
  const workspaceFields = new ModulePlanFields(workspaceRequest);
  const workspaceKeys = ['expectedCommitHandoff', 'kind'];
  workspaceFields.requireExactKeys(workspaceKeys);
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
    const keys = ['kind', 'sourceCommit'];
    fields.requireExactKeys(keys);
    return {
      kind: ModuleDeliveryBaselineKind.SourceCommit,
      sourceCommit: fields.string('sourceCommit'),
    };
  }
  if (kind === ModuleDeliveryBaselineKind.IntegratedDependencies) {
    const keys = ['kind', 'providerTaskIds'];
    fields.requireExactKeys(keys);
    return {
      kind: ModuleDeliveryBaselineKind.IntegratedDependencies,
      providerTaskIds: fields.nonEmptyStringList('providerTaskIds'),
    };
  }
  fail(`${request.path}.kind: unsupported baseline kind.`);
}

function decodeResourceClaims(
  request: ModulePlanObjectDecodeRequest,
): ModuleDeliveryNode['resources'] {
  const fields = new ModulePlanFields(request);
  const keys = ['read', 'write'];
  fields.requireExactKeys(keys);
  return {
    read: fields.stringList('read'),
    write: fields.stringList('write'),
  };
}

function decodeAcceptance(
  request: ModulePlanObjectDecodeRequest,
): ModuleDeliveryNode['acceptance'] {
  const fields = new ModulePlanFields(request);
  const keys = ['commands', 'evidence'];
  fields.requireExactKeys(keys);
  return {
    commands: fields.nonEmptyStringList('commands'),
    evidence: fields.nonEmptyStringList('evidence'),
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
  const keys = [
    'behaviorInvariants',
    'capability',
    'compatibilityExpectations',
    'consumerTaskId',
    'errors',
    'owningTests',
    'providerTaskId',
    'publicTypes',
    'securityInvariants',
  ];
  fields.requireExactKeys(keys);
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
): RejectedModuleDeliveryPlan {
  const issue: ModuleDeliveryIssue = {
    code: request.code,
    path: '$',
    message: request.message,
  };
  return { status: ModuleDeliveryValidationStatus.Rejected, issues: [issue] };
}
