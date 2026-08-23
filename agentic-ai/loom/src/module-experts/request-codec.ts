import { AgentAttemptParentKind } from '../agent-workflow/domain.ts';
import type { AgentAttemptParent } from '../agent-workflow/domain.ts';
import { MAX_AGENT_HIERARCHY_DEPTH } from '../agent-workflow/hierarchy.ts';
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

const MAX_REQUEST_BYTES = 65_536;
const MAX_INSTRUCTION_LENGTH = 16_384;

export type ModuleExpertInvocationRequest = {
  readonly runId: string;
  readonly expert: string;
  readonly sourceCommit: string;
  readonly task: string;
  readonly attempt: number;
  readonly depth: number;
  readonly parent: AgentAttemptParent;
  readonly instruction: string;
};

type ModuleExpertRequestProperty = {
  readonly record: UntrustedYamlMap;
  readonly key: string;
};

type ParentLineageValidation = {
  readonly task: string;
  readonly expert: string;
  readonly attempt: number;
  readonly depth: number;
  readonly parent: AgentAttemptParent;
};

export function decodeModuleExpertInvocationRequest(
  serialized: string,
): ModuleExpertInvocationRequest {
  if (Buffer.byteLength(serialized, 'utf8') > MAX_REQUEST_BYTES) {
    invalidRequest();
  }
  let node: UntrustedYamlNode;
  try {
    node = JSON.parse(serialized) as UntrustedYamlNode;
  } catch {
    invalidRequest();
  }
  if (!isRecord(node)) invalidRequest();
  const expectedKeys = [
    'attempt',
    'depth',
    'expert',
    'instruction',
    'parent',
    'runId',
    'sourceCommit',
    'task',
  ];
  const actualKeys = Object.keys(node).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    invalidRequest();
  }
  const runIdProperty: ModuleExpertRequestProperty = {
    record: node,
    key: 'runId',
  };
  const expertProperty: ModuleExpertRequestProperty = {
    record: node,
    key: 'expert',
  };
  const sourceCommitProperty: ModuleExpertRequestProperty = {
    record: node,
    key: 'sourceCommit',
  };
  const taskProperty: ModuleExpertRequestProperty = {
    record: node,
    key: 'task',
  };
  const instructionProperty: ModuleExpertRequestProperty = {
    record: node,
    key: 'instruction',
  };
  const attemptProperty: ModuleExpertRequestProperty = {
    record: node,
    key: 'attempt',
  };
  const depthProperty: ModuleExpertRequestProperty = {
    record: node,
    key: 'depth',
  };
  const parentProperty: ModuleExpertRequestProperty = {
    record: node,
    key: 'parent',
  };
  const runId = requiredString(runIdProperty);
  const expert = requiredString(expertProperty);
  const sourceCommit = requiredString(sourceCommitProperty);
  const task = requiredString(taskProperty);
  const instruction = requiredString(instructionProperty);
  const attempt = requiredNumber(attemptProperty);
  const depth = requiredNumber(depthProperty);
  const parent = requiredParent(parentProperty);
  const lineageValidation: ParentLineageValidation = {
    task,
    expert,
    attempt,
    depth,
    parent,
  };
  if (
    !safeIdentifier(runId) ||
    !safeIdentifier(expert) ||
    !/^[0-9a-f]{40}$/u.test(sourceCommit) ||
    !safeIdentifier(task) ||
    !validParentLineage(lineageValidation) ||
    instruction.trim() === '' ||
    instruction.length > MAX_INSTRUCTION_LENGTH ||
    containsForbiddenControl(instruction)
  ) {
    invalidRequest();
  }
  return {
    runId,
    expert,
    sourceCommit,
    task,
    attempt,
    depth,
    parent,
    instruction,
  };
}

export function validatedModuleExpertInvocationRequest(
  request: ModuleExpertInvocationRequest,
): ModuleExpertInvocationRequest {
  let serialized: string;
  try {
    const encoded = JSON.stringify(request);
    if (typeof encoded !== 'string') invalidRequest();
    serialized = encoded;
  } catch {
    invalidRequest();
  }
  return decodeModuleExpertInvocationRequest(serialized);
}

function requiredString(property: ModuleExpertRequestProperty): string {
  const propertyArgs: UntrustedYamlPropertyArgs = {
    record: property.record,
    key: property.key,
  };
  const value = untrustedYamlProperty(propertyArgs);
  if (
    value.presence === UntrustedYamlPropertyPresence.Absent ||
    typeof value.value !== 'string'
  ) {
    invalidRequest();
  }
  return value.value;
}

function requiredNumber(property: ModuleExpertRequestProperty): number {
  const propertyArgs: UntrustedYamlPropertyArgs = {
    record: property.record,
    key: property.key,
  };
  const value = untrustedYamlProperty(propertyArgs);
  if (
    value.presence === UntrustedYamlPropertyPresence.Absent ||
    typeof value.value !== 'number'
  ) {
    invalidRequest();
  }
  return value.value;
}

function requiredParent(
  property: ModuleExpertRequestProperty,
): AgentAttemptParent {
  const propertyArgs: UntrustedYamlPropertyArgs = {
    record: property.record,
    key: property.key,
  };
  const value = untrustedYamlProperty(propertyArgs);
  if (
    value.presence === UntrustedYamlPropertyPresence.Absent ||
    !isRecord(value.value)
  ) {
    invalidRequest();
  }
  const kindProperty: ModuleExpertRequestProperty = {
    record: value.value,
    key: 'kind',
  };
  const kind = requiredString(kindProperty);
  if (kind === AgentAttemptParentKind.WorkflowRoot) {
    if (Object.keys(value.value).length !== 1) invalidRequest();
    return { kind: AgentAttemptParentKind.WorkflowRoot };
  }
  if (
    kind !== AgentAttemptParentKind.AgentAttempt ||
    JSON.stringify(Object.keys(value.value).sort()) !==
      JSON.stringify(['agent', 'attempt', 'kind', 'task'])
  ) {
    invalidRequest();
  }
  const taskProperty: ModuleExpertRequestProperty = {
    record: value.value,
    key: 'task',
  };
  const agentProperty: ModuleExpertRequestProperty = {
    record: value.value,
    key: 'agent',
  };
  const attemptProperty: ModuleExpertRequestProperty = {
    record: value.value,
    key: 'attempt',
  };
  const task = requiredString(taskProperty);
  const agent = requiredString(agentProperty);
  const attempt = requiredNumber(attemptProperty);
  if (
    !safeIdentifier(task) ||
    !safeIdentifier(agent) ||
    !Number.isSafeInteger(attempt) ||
    attempt < 1
  ) {
    invalidRequest();
  }
  return { kind: AgentAttemptParentKind.AgentAttempt, task, agent, attempt };
}

function validParentLineage(validation: ParentLineageValidation): boolean {
  if (validation.parent.kind !== AgentAttemptParentKind.AgentAttempt) {
    return false;
  }
  return (
    Number.isSafeInteger(validation.attempt) &&
    validation.attempt >= 1 &&
    Number.isSafeInteger(validation.depth) &&
    validation.depth >= 2 &&
    validation.depth <= MAX_AGENT_HIERARCHY_DEPTH &&
    safeIdentifier(validation.parent.task) &&
    safeIdentifier(validation.parent.agent) &&
    Number.isSafeInteger(validation.parent.attempt) &&
    validation.parent.attempt >= 1 &&
    (validation.parent.task !== validation.task ||
      validation.parent.agent !== validation.expert ||
      validation.parent.attempt !== validation.attempt)
  );
}

function safeIdentifier(value: string): boolean {
  return value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value);
}

function containsForbiddenControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return (
      code === 127 || (code < 32 && code !== 9 && code !== 10 && code !== 13)
    );
  });
}

function invalidRequest(): never {
  throw new Error('Module expert invocation request is invalid.');
}
