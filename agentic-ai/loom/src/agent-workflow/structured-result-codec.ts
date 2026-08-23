import {
  AgentAttemptParentKind,
  WorkflowArtifactKind,
  WorkflowFindingSeverity,
  WorkflowResultKind,
} from './domain.ts';
import type {
  ModuleExpertContinuation,
  ModuleExpertAuthorization,
  WorkflowArtifactReference,
  WorkflowFinding,
  WorkflowTaskOutput,
} from './domain.ts';
import {
  UntrustedYamlPropertyPresence,
  isRecord,
  untrustedYamlProperty,
} from '../lib/guards.ts';
import {
  decodeStructuralTaskOutput,
  isStructuralResultKind,
  structuralTaskOutputSchema,
} from './structural-result-codec.ts';
import type {
  UntrustedYamlMap,
  UntrustedYamlNode,
  UntrustedYamlPropertyArgs,
} from '../lib/guards.ts';

export const MAX_MATERIALIZED_VIEW_MARKDOWN_LENGTH = 65_536;
const MAX_CONTINUATION_ENTRIES = 100;
const MAX_CONTINUATION_ENTRY_LENGTH = 4096;
const MAX_MODULE_EXPERT_AUTHORIZATIONS = 100;

const STANDARD_WORKFLOW_RESULT_KINDS = [
  WorkflowResultKind.CortexEvidence,
  WorkflowResultKind.CortexSynthesis,
  WorkflowResultKind.LoomLeafEvidence,
] as const;

const MODULE_EXPERT_CONTINUATION_FIELDS = [
  'externalApi',
  'dependencies',
  'consumers',
  'behaviorInvariants',
  'securityInvariants',
  'compatibilityInvariants',
  'owningTests',
  'focusedValidation',
  'risks',
  'unresolvedDecisions',
  'parentActions',
] as const;

const MODULE_EXPERT_CONTINUATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: MODULE_EXPERT_CONTINUATION_FIELDS,
  properties: {
    externalApi: continuationSequenceSchema(),
    dependencies: continuationSequenceSchema(),
    consumers: continuationSequenceSchema(),
    behaviorInvariants: continuationSequenceSchema(),
    securityInvariants: continuationSequenceSchema(),
    compatibilityInvariants: continuationSequenceSchema(),
    owningTests: continuationSequenceSchema(),
    focusedValidation: continuationSequenceSchema(),
    risks: continuationSequenceSchema(),
    unresolvedDecisions: continuationSequenceSchema(),
    parentActions: continuationSequenceSchema(),
  },
} as const;

const MODULE_EXPERT_AUTHORIZATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['task', 'expert', 'attempt', 'depth', 'parent'],
  properties: {
    task: { type: 'string', minLength: 1, maxLength: 128 },
    expert: { type: 'string', minLength: 1, maxLength: 128 },
    attempt: { type: 'integer', minimum: 1 },
    depth: { type: 'integer', enum: [2, 3] },
    parent: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'task', 'agent', 'attempt'],
      properties: {
        kind: {
          type: 'string',
          enum: [AgentAttemptParentKind.AgentAttempt],
        },
        task: { type: 'string', minLength: 1, maxLength: 128 },
        agent: { type: 'string', minLength: 1, maxLength: 128 },
        attempt: { type: 'integer', minimum: 1 },
      },
    },
  },
} as const;

export const WORKFLOW_TASK_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'resultKind',
    'summary',
    'materializedViewMarkdown',
    'findings',
    'notesForParent',
    'artifacts',
  ],
  properties: {
    resultKind: { type: 'string', enum: STANDARD_WORKFLOW_RESULT_KINDS },
    summary: { type: 'string', minLength: 1, maxLength: 4096, pattern: '\\S' },
    materializedViewMarkdown: {
      type: 'string',
      minLength: 1,
      maxLength: MAX_MATERIALIZED_VIEW_MARKDOWN_LENGTH,
      pattern: '\\S',
    },
    findings: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'title', 'summary', 'evidence', 'affectedPaths'],
        properties: {
          severity: {
            type: 'string',
            enum: Object.values(WorkflowFindingSeverity),
          },
          title: { type: 'string' },
          summary: { type: 'string', maxLength: 4096 },
          evidence: {
            type: 'array',
            minItems: 1,
            maxItems: 100,
            items: { type: 'string', minLength: 1, pattern: '\\S' },
          },
          affectedPaths: {
            type: 'array',
            maxItems: 100,
            items: { type: 'string' },
          },
        },
      },
    },
    notesForParent: {
      type: 'array',
      maxItems: 100,
      items: { type: 'string' },
    },
    artifacts: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'location', 'description'],
        properties: {
          kind: { type: 'string', enum: Object.values(WorkflowArtifactKind) },
          location: { type: 'string' },
          description: { type: 'string' },
        },
      },
    },
  },
} as const;

export function workflowTaskOutputSchema(
  resultKind: WorkflowResultKind,
): UntrustedYamlMap {
  if (isStructuralResultKind(resultKind)) {
    const structuralRequest = {
      baseSchema: WORKFLOW_TASK_OUTPUT_SCHEMA,
      resultKind,
    };
    return structuralTaskOutputSchema(structuralRequest);
  }
  if (resultKind === WorkflowResultKind.ModuleDevelopmentPlan) {
    return {
      ...WORKFLOW_TASK_OUTPUT_SCHEMA,
      required: [
        ...WORKFLOW_TASK_OUTPUT_SCHEMA.required,
        'moduleExpertAuthorizations',
      ],
      properties: {
        ...WORKFLOW_TASK_OUTPUT_SCHEMA.properties,
        resultKind: { type: 'string', enum: [resultKind] },
        moduleExpertAuthorizations: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_MODULE_EXPERT_AUTHORIZATIONS,
          uniqueItems: true,
          items: MODULE_EXPERT_AUTHORIZATION_SCHEMA,
        },
      },
    };
  }
  if (resultKind === WorkflowResultKind.ModuleExpertEvidence) {
    return {
      ...WORKFLOW_TASK_OUTPUT_SCHEMA,
      required: [...WORKFLOW_TASK_OUTPUT_SCHEMA.required, 'continuation'],
      properties: {
        ...WORKFLOW_TASK_OUTPUT_SCHEMA.properties,
        resultKind: { type: 'string', enum: [resultKind] },
        continuation: MODULE_EXPERT_CONTINUATION_SCHEMA,
      },
    };
  }
  return {
    ...WORKFLOW_TASK_OUTPUT_SCHEMA,
    properties: {
      ...WORKFLOW_TASK_OUTPUT_SCHEMA.properties,
      resultKind: { type: 'string', enum: [resultKind] },
    },
  };
}

type RecordKeys = readonly [UntrustedYamlMap, readonly string[]];
type RecordProperty = readonly [UntrustedYamlMap, string];

export function decodeWorkflowTaskOutput(
  serialized: string,
): WorkflowTaskOutput {
  if (Buffer.byteLength(serialized, 'utf8') > 131_072) {
    invalidOutput('workflow structured result exceeds 131072 bytes');
  }
  const node = JSON.parse(serialized) as UntrustedYamlNode;
  if (!isRecord(node)) {
    invalidOutput('workflow output must be an object');
  }
  const resultKindValue = stringValue(readProperty([node, 'resultKind']));
  if (
    !Object.values(WorkflowResultKind).includes(
      resultKindValue as WorkflowResultKind,
    )
  ) {
    invalidOutput('workflow resultKind is invalid');
  }
  const resultKind = resultKindValue as WorkflowResultKind;
  if (isStructuralResultKind(resultKind)) {
    const structuralRequest = { node, resultKind };
    return decodeStructuralTaskOutput(structuralRequest);
  }
  const isModuleExpertEvidence =
    resultKindValue === WorkflowResultKind.ModuleExpertEvidence;
  const isModuleDevelopmentPlan =
    resultKindValue === WorkflowResultKind.ModuleDevelopmentPlan;
  assertExactKeys([
    node,
    isModuleExpertEvidence
      ? [
          'resultKind',
          'summary',
          'materializedViewMarkdown',
          'findings',
          'notesForParent',
          'artifacts',
          'continuation',
        ]
      : isModuleDevelopmentPlan
        ? [
            'resultKind',
            'summary',
            'materializedViewMarkdown',
            'findings',
            'notesForParent',
            'artifacts',
            'moduleExpertAuthorizations',
          ]
        : [
            'resultKind',
            'summary',
            'materializedViewMarkdown',
            'findings',
            'notesForParent',
            'artifacts',
          ],
  ]);
  const materializedViewMarkdown = stringValue(
    readProperty([node, 'materializedViewMarkdown']),
  );
  if (
    materializedViewMarkdown.trim() === '' ||
    materializedViewMarkdown.length > MAX_MATERIALIZED_VIEW_MARKDOWN_LENGTH ||
    containsForbiddenControlCharacter(materializedViewMarkdown)
  ) {
    invalidOutput(
      'workflow materialized view must be non-empty, bounded Markdown without control characters',
    );
  }
  const outputFields = {
    summary: boundedNonBlankString(readProperty([node, 'summary'])),
    materializedViewMarkdown,
    findings: decodeFindings(readProperty([node, 'findings'])),
    notesForParent: stringSequence(readProperty([node, 'notesForParent'])),
    artifacts: decodeArtifacts(readProperty([node, 'artifacts'])),
  };
  if (isModuleDevelopmentPlan) {
    return {
      ...outputFields,
      resultKind: WorkflowResultKind.ModuleDevelopmentPlan,
      moduleExpertAuthorizations: decodeModuleExpertAuthorizations(
        readProperty([node, 'moduleExpertAuthorizations']),
      ),
    };
  }
  if (!isModuleExpertEvidence) {
    return {
      ...outputFields,
      resultKind: resultKindValue as
        | WorkflowResultKind.CortexEvidence
        | WorkflowResultKind.CortexSynthesis
        | WorkflowResultKind.LoomLeafEvidence,
    };
  }
  return {
    ...outputFields,
    resultKind: WorkflowResultKind.ModuleExpertEvidence,
    continuation: decodeModuleExpertContinuation(
      readProperty([node, 'continuation']),
    ),
  };
}

function decodeModuleExpertAuthorizationFields(
  node: UntrustedYamlMap,
): ModuleExpertAuthorization {
  const task = stringValue(readProperty([node, 'task']));
  const expert = stringValue(readProperty([node, 'expert']));
  const attempt = integerValue(readProperty([node, 'attempt']));
  const depth = integerValue(readProperty([node, 'depth']));
  const parentNode = readProperty([node, 'parent']);
  if (!isRecord(parentNode)) {
    invalidOutput('expert authorization parent must be an object');
  }
  assertExactKeys([parentNode, ['kind', 'task', 'agent', 'attempt']]);
  const parentKind = stringValue(readProperty([parentNode, 'kind']));
  const parentTask = stringValue(readProperty([parentNode, 'task']));
  const parentAgent = stringValue(readProperty([parentNode, 'agent']));
  const parentAttempt = integerValue(readProperty([parentNode, 'attempt']));
  if (
    parentKind !== AgentAttemptParentKind.AgentAttempt ||
    !safeIdentifier(task) ||
    !safeIdentifier(expert) ||
    !safeIdentifier(parentTask) ||
    !safeIdentifier(parentAgent) ||
    attempt < 1 ||
    parentAttempt < 1 ||
    (depth !== 2 && depth !== 3) ||
    (task === parentTask && attempt === parentAttempt)
  ) {
    invalidOutput('expert authorization identity is invalid');
  }
  return {
    task,
    expert,
    attempt,
    depth,
    parent: {
      kind: AgentAttemptParentKind.AgentAttempt,
      task: parentTask,
      agent: parentAgent,
      attempt: parentAttempt,
    },
  };
}

function decodeModuleExpertAuthorizations(
  node: UntrustedYamlNode,
): readonly ModuleExpertAuthorization[] {
  if (
    !Array.isArray(node) ||
    node.length === 0 ||
    node.length > MAX_MODULE_EXPERT_AUTHORIZATIONS
  ) {
    invalidOutput(
      'module development plan requires bounded expert authorizations',
    );
  }
  const authorizations = node.map((entry) =>
    decodeModuleExpertAuthorization(entry),
  );
  if (
    new Set(
      authorizations.map((entry) => `${entry.task}\u0000${entry.attempt}`),
    ).size !== authorizations.length
  ) {
    invalidOutput(
      'module expert authorization journal storage keys must be unique',
    );
  }
  return authorizations;
}

function decodeModuleExpertAuthorization(
  node: UntrustedYamlNode,
): ModuleExpertAuthorization {
  if (!isRecord(node)) {
    invalidOutput('module expert authorization must be an object');
  }
  assertExactKeys([node, ['task', 'expert', 'attempt', 'depth', 'parent']]);
  const task = stringValue(readProperty([node, 'task']));
  const expert = stringValue(readProperty([node, 'expert']));
  const attempt = integerValue(readProperty([node, 'attempt']));
  const depth = integerValue(readProperty([node, 'depth']));
  const parentNode = readProperty([node, 'parent']);
  if (!isRecord(parentNode)) {
    invalidOutput('module expert authorization parent must be an object');
  }
  assertExactKeys([parentNode, ['kind', 'task', 'agent', 'attempt']]);
  const parentKind = stringValue(readProperty([parentNode, 'kind']));
  const parentTask = stringValue(readProperty([parentNode, 'task']));
  const parentAgent = stringValue(readProperty([parentNode, 'agent']));
  const parentAttempt = integerValue(readProperty([parentNode, 'attempt']));
  if (
    parentKind !== AgentAttemptParentKind.AgentAttempt ||
    !safeIdentifier(task) ||
    !safeIdentifier(expert) ||
    !safeIdentifier(parentTask) ||
    !safeIdentifier(parentAgent) ||
    attempt < 1 ||
    parentAttempt < 1 ||
    (depth !== 2 && depth !== 3) ||
    (task === parentTask && attempt === parentAttempt)
  ) {
    invalidOutput('module expert authorization identity is invalid');
  }
  return {
    task,
    expert,
    attempt,
    depth,
    parent: {
      kind: AgentAttemptParentKind.AgentAttempt,
      task: parentTask,
      agent: parentAgent,
      attempt: parentAttempt,
    },
  };
}

function continuationSequenceSchema(): UntrustedYamlMap {
  return {
    type: 'array',
    minItems: 1,
    maxItems: MAX_CONTINUATION_ENTRIES,
    uniqueItems: true,
    items: {
      type: 'string',
      minLength: 1,
      maxLength: MAX_CONTINUATION_ENTRY_LENGTH,
      pattern: '\\S',
    },
  };
}

function decodeModuleExpertContinuation(
  node: UntrustedYamlNode,
): ModuleExpertContinuation {
  if (!isRecord(node)) {
    invalidOutput('module expert continuation must be an object');
  }
  assertExactKeys([node, MODULE_EXPERT_CONTINUATION_FIELDS]);
  return {
    externalApi: continuationSequence(readProperty([node, 'externalApi'])),
    dependencies: continuationSequence(readProperty([node, 'dependencies'])),
    consumers: continuationSequence(readProperty([node, 'consumers'])),
    behaviorInvariants: continuationSequence(
      readProperty([node, 'behaviorInvariants']),
    ),
    securityInvariants: continuationSequence(
      readProperty([node, 'securityInvariants']),
    ),
    compatibilityInvariants: continuationSequence(
      readProperty([node, 'compatibilityInvariants']),
    ),
    owningTests: continuationSequence(readProperty([node, 'owningTests'])),
    focusedValidation: continuationSequence(
      readProperty([node, 'focusedValidation']),
    ),
    risks: continuationSequence(readProperty([node, 'risks'])),
    unresolvedDecisions: continuationSequence(
      readProperty([node, 'unresolvedDecisions']),
    ),
    parentActions: continuationSequence(readProperty([node, 'parentActions'])),
  };
}

function continuationSequence(node: UntrustedYamlNode): readonly string[] {
  const values = stringSequence(node);
  if (
    values.length === 0 ||
    values.length > MAX_CONTINUATION_ENTRIES ||
    new Set(values).size !== values.length ||
    values.some(
      (entry) =>
        entry.trim() === '' ||
        entry.length > MAX_CONTINUATION_ENTRY_LENGTH ||
        containsForbiddenControlCharacter(entry),
    )
  ) {
    invalidOutput(
      'module expert continuation fields require bounded non-empty entries',
    );
  }
  return values;
}

function containsForbiddenControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return (
      code === 127 || (code < 32 && code !== 9 && code !== 10 && code !== 13)
    );
  });
}

function decodeFindings(node: UntrustedYamlNode): readonly WorkflowFinding[] {
  if (!Array.isArray(node)) {
    invalidOutput('workflow findings must be an array');
  }
  return node.map((entry) => {
    if (!isRecord(entry)) {
      invalidOutput('each workflow finding must be an object');
    }
    assertExactKeys([
      entry,
      ['severity', 'title', 'summary', 'evidence', 'affectedPaths'],
    ]);
    const severityValue = stringValue(readProperty([entry, 'severity']));
    if (
      !Object.values(WorkflowFindingSeverity).includes(
        severityValue as WorkflowFindingSeverity,
      )
    ) {
      invalidOutput('workflow finding severity is invalid');
    }
    const finding: WorkflowFinding = {
      severity: severityValue as WorkflowFindingSeverity,
      title: stringValue(readProperty([entry, 'title'])),
      summary: stringValue(readProperty([entry, 'summary'])),
      evidence: evidenceSequence(readProperty([entry, 'evidence'])),
      affectedPaths: stringSequence(readProperty([entry, 'affectedPaths'])),
    };
    return finding;
  });
}

function decodeArtifacts(
  node: UntrustedYamlNode,
): readonly WorkflowArtifactReference[] {
  if (!Array.isArray(node)) {
    invalidOutput('workflow artifacts must be an array');
  }
  return node.map((entry) => {
    if (!isRecord(entry)) {
      invalidOutput('each workflow artifact must be an object');
    }
    assertExactKeys([entry, ['kind', 'location', 'description']]);
    const kindValue = stringValue(readProperty([entry, 'kind']));
    if (
      !Object.values(WorkflowArtifactKind).includes(
        kindValue as WorkflowArtifactKind,
      )
    ) {
      invalidOutput('workflow artifact kind is invalid');
    }
    const artifact: WorkflowArtifactReference = {
      kind: kindValue as WorkflowArtifactKind,
      location: stringValue(readProperty([entry, 'location'])),
      description: stringValue(readProperty([entry, 'description'])),
    };
    return artifact;
  });
}

function assertExactKeys(values: RecordKeys): void {
  const allowed = new Set(values[1]);
  const keys = Object.keys(values[0]);
  if (keys.length !== allowed.size || keys.some((key) => !allowed.has(key))) {
    invalidOutput(
      'workflow structured result contains missing or extra fields',
    );
  }
}

function readProperty(values: RecordProperty): UntrustedYamlNode {
  const propertyInput: UntrustedYamlPropertyArgs = {
    record: values[0],
    key: values[1],
  };
  const property = untrustedYamlProperty(propertyInput);
  if (property.presence === UntrustedYamlPropertyPresence.Absent) {
    invalidOutput(`workflow structured result is missing ${values[1]}`);
  }
  return property.value;
}

function stringValue(node: UntrustedYamlNode): string {
  if (typeof node !== 'string') {
    invalidOutput('workflow structured result expected a string');
  }
  return node;
}

function integerValue(node: UntrustedYamlNode): number {
  if (typeof node !== 'number' || !Number.isSafeInteger(node)) {
    invalidOutput('workflow structured result expected an integer');
  }
  return node;
}

function safeIdentifier(value: string): boolean {
  return value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value);
}

function boundedNonBlankString(node: UntrustedYamlNode): string {
  const value = stringValue(node);
  if (value.trim() === '' || value.length > 4096) {
    invalidOutput('workflow structured result expected a bounded string');
  }
  return value;
}

function stringSequence(node: UntrustedYamlNode): readonly string[] {
  if (
    !Array.isArray(node) ||
    !node.every((entry) => typeof entry === 'string')
  ) {
    invalidOutput('workflow structured result expected a string array');
  }
  return node as readonly string[];
}

function evidenceSequence(node: UntrustedYamlNode): readonly string[] {
  const evidence = stringSequence(node);
  if (evidence.length === 0 || evidence.some((entry) => entry.trim() === '')) {
    invalidOutput(
      'each workflow finding requires at least one non-empty evidence string',
    );
  }
  return evidence;
}

function invalidOutput(message: string): never {
  throw new Error(message);
}
