import {
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
} from './domain.ts';
import type {
  AgentAttemptParent,
  ParentAgentAttempt,
  WorkflowRootParent,
} from './domain.ts';
import {
  DELEGATION_PLAN_SCHEMA_VERSION,
  DelegationBarrierPolicy,
  DelegationRunEventKind,
  validateDelegationPlan,
} from './delegation-domain.ts';
import type {
  DelegationAdmissionRequest,
  DelegationAttemptDeclaration,
  DelegationAttemptIdentity,
  DelegationPlan,
  DelegationRunEvent,
  DelegationRunEventMetadata,
  DelegationTerminalBarrier,
} from './delegation-domain.ts';
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

const PLAN_FIELDS = [
  'schemaVersion',
  'workflow',
  'runId',
  'sourceCommit',
  'rootMaterializer',
  'attempts',
] as const;
const IDENTITY_FIELDS = ['task', 'agent', 'attempt'] as const;
const DECLARATION_FIELDS = [
  'identity',
  'depth',
  'parent',
  'terminalBarrier',
] as const;
const ROOT_PARENT_FIELDS = ['kind'] as const;
const ATTEMPT_PARENT_FIELDS = ['kind', 'task', 'agent', 'attempt'] as const;
const BARRIER_FIELDS = ['policy', 'attempts'] as const;
const PLAN_EVENT_FIELDS = [
  'kind',
  'runId',
  'sourceCommit',
  'planSha256',
  'sequence',
  'occurredAt',
  'attemptCount',
  'rootMaterializer',
] as const;
const ADMISSION_EVENT_FIELDS = [
  'kind',
  'runId',
  'sourceCommit',
  'planSha256',
  'sequence',
  'occurredAt',
  'declaration',
] as const;
const ADMISSION_REQUEST_FIELDS = [
  'runId',
  'sourceCommit',
  'identity',
  'depth',
  'parent',
] as const;

export function decodeDelegationPlan(serialized: string): DelegationPlan {
  const transport = JSON.parse(serialized) as UntrustedYamlNode;
  const reader = new RecordReader(requireRecord(transport));
  assertExactKeys(reader.record)(PLAN_FIELDS);
  if (reader.string('schemaVersion') !== DELEGATION_PLAN_SCHEMA_VERSION)
    throw new Error('Delegation plan schema version is unsupported.');
  if (reader.string('workflow') !== DelegatedAgentWorkflowName.AgentWork)
    throw new Error('Delegation plan workflow is unsupported.');
  const plan: DelegationPlan = {
    schemaVersion: DELEGATION_PLAN_SCHEMA_VERSION,
    workflow: DelegatedAgentWorkflowName.AgentWork,
    runId: reader.string('runId'),
    sourceCommit: reader.string('sourceCommit'),
    rootMaterializer: decodeIdentity(reader.node('rootMaterializer')),
    attempts: reader.array('attempts').map(decodeAttemptDeclaration),
  };
  validateDelegationPlan(plan);
  return plan;
}

export function decodeDelegationAdmissionRequest(
  serialized: string,
): DelegationAdmissionRequest {
  const transport = JSON.parse(serialized) as UntrustedYamlNode;
  const reader = new RecordReader(requireRecord(transport));
  assertExactKeys(reader.record)(ADMISSION_REQUEST_FIELDS);
  return {
    runId: reader.string('runId'),
    sourceCommit: reader.string('sourceCommit'),
    identity: decodeIdentity(reader.node('identity')),
    depth: reader.number('depth'),
    parent: decodeParent(reader.node('parent')),
  };
}

export function decodeDelegationRunEvent(
  serialized: string,
): DelegationRunEvent {
  const transport = JSON.parse(serialized) as UntrustedYamlNode;
  const reader = new RecordReader(requireRecord(transport));
  const metadata = decodeRunEventMetadata(reader);
  const kind = reader.string('kind');
  if (kind === DelegationRunEventKind.PlanDeclared) {
    assertExactKeys(reader.record)(PLAN_EVENT_FIELDS);
    return {
      ...metadata,
      kind: DelegationRunEventKind.PlanDeclared,
      attemptCount: reader.number('attemptCount'),
      rootMaterializer: decodeIdentity(reader.node('rootMaterializer')),
    };
  }
  if (kind === DelegationRunEventKind.AttemptAdmitted) {
    assertExactKeys(reader.record)(ADMISSION_EVENT_FIELDS);
    return {
      ...metadata,
      kind: DelegationRunEventKind.AttemptAdmitted,
      declaration: decodeAttemptDeclaration(reader.node('declaration')),
    };
  }
  throw new Error('Delegation run event kind is unsupported.');
}

function decodeRunEventMetadata(
  reader: RecordReader,
): DelegationRunEventMetadata {
  return {
    runId: reader.string('runId'),
    sourceCommit: reader.string('sourceCommit'),
    planSha256: reader.string('planSha256'),
    sequence: reader.number('sequence'),
    occurredAt: reader.string('occurredAt'),
  };
}

function decodeAttemptDeclaration(
  node: UntrustedYamlNode,
): DelegationAttemptDeclaration {
  const reader = new RecordReader(requireRecord(node));
  assertExactKeys(reader.record)(DECLARATION_FIELDS);
  return {
    identity: decodeIdentity(reader.node('identity')),
    depth: reader.number('depth'),
    parent: decodeParent(reader.node('parent')),
    terminalBarrier: decodeTerminalBarrier(reader.node('terminalBarrier')),
  };
}

function decodeIdentity(node: UntrustedYamlNode): DelegationAttemptIdentity {
  const reader = new RecordReader(requireRecord(node));
  assertExactKeys(reader.record)(IDENTITY_FIELDS);
  return identityFromReader(reader);
}

function identityFromReader(reader: RecordReader): DelegationAttemptIdentity {
  return {
    task: reader.string('task'),
    agent: reader.string('agent'),
    attempt: reader.number('attempt'),
  };
}

function decodeParent(node: UntrustedYamlNode): AgentAttemptParent {
  const reader = new RecordReader(requireRecord(node));
  const kind = reader.string('kind');
  if (kind === AgentAttemptParentKind.WorkflowRoot) {
    assertExactKeys(reader.record)(ROOT_PARENT_FIELDS);
    const parent: WorkflowRootParent = {
      kind: AgentAttemptParentKind.WorkflowRoot,
    };
    return parent;
  }
  if (kind === AgentAttemptParentKind.AgentAttempt) {
    assertExactKeys(reader.record)(ATTEMPT_PARENT_FIELDS);
    const identity = identityFromReader(reader);
    const parent: ParentAgentAttempt = {
      kind: AgentAttemptParentKind.AgentAttempt,
      ...identity,
    };
    return parent;
  }
  throw new Error('Delegation attempt parent kind is unsupported.');
}

function decodeTerminalBarrier(
  node: UntrustedYamlNode,
): DelegationTerminalBarrier {
  const reader = new RecordReader(requireRecord(node));
  assertExactKeys(reader.record)(BARRIER_FIELDS);
  if (reader.string('policy') !== DelegationBarrierPolicy.AllTerminal)
    throw new Error(
      'Delegation terminal barrier must use all-terminal policy.',
    );
  return {
    policy: DelegationBarrierPolicy.AllTerminal,
    attempts: reader.array('attempts').map(decodeIdentity),
  };
}

class RecordReader {
  readonly record: UntrustedYamlMap;
  constructor(record: UntrustedYamlMap) {
    this.record = record;
  }
  node(key: string): UntrustedYamlNode {
    const propertyInput: UntrustedYamlPropertyArgs = {
      record: this.record,
      key,
    };
    const property = untrustedYamlProperty(propertyInput);
    if (property.presence === UntrustedYamlPropertyPresence.Absent)
      throw new Error(`Delegation field is required: ${key}`);
    return property.value;
  }
  string(key: string): string {
    const value = this.node(key);
    if (typeof value !== 'string')
      throw new Error(`Delegation field must be a string: ${key}`);
    return value;
  }
  number(key: string): number {
    const value = this.node(key);
    if (typeof value !== 'number')
      throw new Error(`Delegation field must be a number: ${key}`);
    return value;
  }
  array(key: string): readonly UntrustedYamlNode[] {
    const value = this.node(key);
    if (!Array.isArray(value))
      throw new Error(`Delegation field must be an array: ${key}`);
    return value;
  }
}

function requireRecord(node: UntrustedYamlNode): UntrustedYamlMap {
  if (!isRecord(node))
    throw new Error('Delegation structured value must be an object.');
  return node;
}

function assertExactKeys(
  record: UntrustedYamlMap,
): (expected: readonly string[]) => void {
  return (expected) => {
    const actual = new Set(Object.keys(record));
    if (
      actual.size !== expected.length ||
      expected.some((key) => !actual.has(key))
    )
      throw new Error('Delegation structured value has unsupported fields.');
  };
}
