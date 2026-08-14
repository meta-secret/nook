import {
  WorkflowArtifactKind,
  WorkflowFindingSeverity,
  WorkflowResultKind,
} from './domain.ts';
import type {
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

export const WORKFLOW_TASK_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'resultKind',
    'summary',
    'findings',
    'notesForParent',
    'artifacts',
  ],
  properties: {
    resultKind: { type: 'string', enum: Object.values(WorkflowResultKind) },
    summary: { type: 'string' },
    findings: {
      type: 'array',
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
          summary: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
          affectedPaths: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    notesForParent: { type: 'array', items: { type: 'string' } },
    artifacts: {
      type: 'array',
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
  const node = JSON.parse(serialized) as UntrustedYamlNode;
  if (!isRecord(node)) {
    invalidOutput('workflow output must be an object');
  }
  assertExactKeys([
    node,
    ['resultKind', 'summary', 'findings', 'notesForParent', 'artifacts'],
  ]);
  const resultKindValue = stringValue(readProperty([node, 'resultKind']));
  if (
    !Object.values(WorkflowResultKind).includes(
      resultKindValue as WorkflowResultKind,
    )
  ) {
    invalidOutput('workflow resultKind is invalid');
  }
  return {
    resultKind: resultKindValue as WorkflowResultKind,
    summary: stringValue(readProperty([node, 'summary'])),
    findings: decodeFindings(readProperty([node, 'findings'])),
    notesForParent: stringSequence(readProperty([node, 'notesForParent'])),
    artifacts: decodeArtifacts(readProperty([node, 'artifacts'])),
  };
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
      evidence: stringSequence(readProperty([entry, 'evidence'])),
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

function stringSequence(node: UntrustedYamlNode): readonly string[] {
  if (
    !Array.isArray(node) ||
    !node.every((entry) => typeof entry === 'string')
  ) {
    invalidOutput('workflow structured result expected a string array');
  }
  return node as readonly string[];
}

function invalidOutput(message: string): never {
  throw new Error(message);
}
