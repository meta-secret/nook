import {
  WorkflowArtifactKind,
  WorkflowFindingSeverity,
  WorkflowResultKind,
} from './domain.ts';
import type {
  ModuleExpertContinuation,
  WorkflowArtifactReference,
  WorkflowFinding,
  WorkflowTaskOutput,
} from './domain.ts';
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

export const MAX_MATERIALIZED_VIEW_MARKDOWN_LENGTH = 65_536;
const MAX_CONTINUATION_ENTRIES = 100;
const MAX_CONTINUATION_ENTRY_LENGTH = 4096;

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
  const isModuleExpertEvidence =
    resultKindValue === WorkflowResultKind.ModuleExpertEvidence;
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
