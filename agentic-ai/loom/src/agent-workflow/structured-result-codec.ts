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
  UntrustedYamlBoundary,
} from '../lib/guards.ts';
import { StructuralResultSchema } from './structural-result-codec.ts';
import type {
  UntrustedYamlMap,
  UntrustedYamlNode,
  UntrustedYamlPropertyArgs,
} from '../lib/guards.ts';

export const MAX_MATERIALIZED_VIEW_MARKDOWN_LENGTH = 65_536;

/** Owns the workflow result schema registry and its capability transitions. */
export class WorkflowResultSchema {
  private constructor() {}
  private static readonly MAX_CONTINUATION_ENTRIES = 100;

  private static readonly MAX_CONTINUATION_ENTRY_LENGTH = 4096;

  private static readonly MAX_MODULE_EXPERT_AUTHORIZATIONS = 100;

  static readonly STANDARD_WORKFLOW_RESULT_KINDS = [
    WorkflowResultKind.CortexEvidence,
  ] as const;

  private static readonly MODULE_EXPERT_CONTINUATION_FIELDS = [
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

  private static readonly MODULE_EXPERT_CONTINUATION_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: WorkflowResultSchema.MODULE_EXPERT_CONTINUATION_FIELDS,
    properties: {
      externalApi: WorkflowResultSchema.continuationSequenceSchema(),
      dependencies: WorkflowResultSchema.continuationSequenceSchema(),
      consumers: WorkflowResultSchema.continuationSequenceSchema(),
      behaviorInvariants: WorkflowResultSchema.continuationSequenceSchema(),
      securityInvariants: WorkflowResultSchema.continuationSequenceSchema(),
      compatibilityInvariants:
        WorkflowResultSchema.continuationSequenceSchema(),
      owningTests: WorkflowResultSchema.continuationSequenceSchema(),
      focusedValidation: WorkflowResultSchema.continuationSequenceSchema(),
      risks: WorkflowResultSchema.continuationSequenceSchema(),
      unresolvedDecisions: WorkflowResultSchema.continuationSequenceSchema(),
      parentActions: WorkflowResultSchema.continuationSequenceSchema(),
    },
  } as const;

  private static readonly MODULE_EXPERT_AUTHORIZATION_SCHEMA = {
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

  static workflowTaskOutputSchema(
    resultKind: WorkflowResultKind,
  ): UntrustedYamlMap {
    if (StructuralResultSchema.isStructuralResultKind(resultKind)) {
      const structuralRequest = {
        baseSchema: WORKFLOW_TASK_OUTPUT_SCHEMA,
        resultKind,
      };
      return StructuralResultSchema.structuralTaskOutputSchema(
        structuralRequest,
      );
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
            maxItems: WorkflowResultSchema.MAX_MODULE_EXPERT_AUTHORIZATIONS,
            uniqueItems: true,
            items: WorkflowResultSchema.MODULE_EXPERT_AUTHORIZATION_SCHEMA,
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
          continuation: WorkflowResultSchema.MODULE_EXPERT_CONTINUATION_SCHEMA,
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

  static decodeWorkflowTaskOutput(serialized: string): WorkflowTaskOutput {
    if (Buffer.byteLength(serialized, 'utf8') > 131_072) {
      WorkflowResultSchema.invalidOutput(
        'workflow structured result exceeds 131072 bytes',
      );
    }
    const node = JSON.parse(serialized) as UntrustedYamlNode;
    if (!UntrustedYamlBoundary.isRecord(node)) {
      WorkflowResultSchema.invalidOutput('workflow output must be an object');
    }
    const resultKindValue = WorkflowResultSchema.stringValue(
      WorkflowResultSchema.readProperty([node, 'resultKind']),
    );
    if (
      !Object.values(WorkflowResultKind).includes(
        resultKindValue as WorkflowResultKind,
      )
    ) {
      WorkflowResultSchema.invalidOutput('workflow resultKind is invalid');
    }
    const resultKind = resultKindValue as WorkflowResultKind;
    if (StructuralResultSchema.isStructuralResultKind(resultKind)) {
      const structuralRequest = { node, resultKind };
      return StructuralResultSchema.decodeStructuralTaskOutput(
        structuralRequest,
      );
    }
    const isModuleExpertEvidence =
      resultKindValue === WorkflowResultKind.ModuleExpertEvidence;
    const isModuleDevelopmentPlan =
      resultKindValue === WorkflowResultKind.ModuleDevelopmentPlan;
    WorkflowResultSchema.assertExactKeys([
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
    const materializedViewMarkdown = WorkflowResultSchema.stringValue(
      WorkflowResultSchema.readProperty([node, 'materializedViewMarkdown']),
    );
    if (
      materializedViewMarkdown.trim() === '' ||
      materializedViewMarkdown.length > MAX_MATERIALIZED_VIEW_MARKDOWN_LENGTH ||
      WorkflowResultSchema.containsForbiddenControlCharacter(
        materializedViewMarkdown,
      )
    ) {
      WorkflowResultSchema.invalidOutput(
        'workflow materialized view must be non-empty, bounded Markdown without control characters',
      );
    }
    const outputFields = {
      summary: WorkflowResultSchema.boundedNonBlankString(
        WorkflowResultSchema.readProperty([node, 'summary']),
      ),
      materializedViewMarkdown,
      findings: WorkflowResultSchema.decodeFindings(
        WorkflowResultSchema.readProperty([node, 'findings']),
      ),
      notesForParent: WorkflowResultSchema.stringSequence(
        WorkflowResultSchema.readProperty([node, 'notesForParent']),
      ),
      artifacts: WorkflowResultSchema.decodeArtifacts(
        WorkflowResultSchema.readProperty([node, 'artifacts']),
      ),
    };
    if (isModuleDevelopmentPlan) {
      return {
        ...outputFields,
        resultKind: WorkflowResultKind.ModuleDevelopmentPlan,
        moduleExpertAuthorizations:
          WorkflowResultSchema.decodeModuleExpertAuthorizations(
            WorkflowResultSchema.readProperty([
              node,
              'moduleExpertAuthorizations',
            ]),
          ),
      };
    }
    if (!isModuleExpertEvidence) {
      return {
        ...outputFields,
        resultKind: resultKindValue as WorkflowResultKind.CortexEvidence,
      };
    }
    return {
      ...outputFields,
      resultKind: WorkflowResultKind.ModuleExpertEvidence,
      continuation: WorkflowResultSchema.decodeModuleExpertContinuation(
        WorkflowResultSchema.readProperty([node, 'continuation']),
      ),
    };
  }

  private static decodeModuleExpertAuthorizationFields(
    node: UntrustedYamlMap,
  ): ModuleExpertAuthorization {
    const task = WorkflowResultSchema.stringValue(
      WorkflowResultSchema.readProperty([node, 'task']),
    );
    const expert = WorkflowResultSchema.stringValue(
      WorkflowResultSchema.readProperty([node, 'expert']),
    );
    const attempt = WorkflowResultSchema.integerValue(
      WorkflowResultSchema.readProperty([node, 'attempt']),
    );
    const depth = WorkflowResultSchema.integerValue(
      WorkflowResultSchema.readProperty([node, 'depth']),
    );
    const parentNode = WorkflowResultSchema.readProperty([node, 'parent']);
    if (!UntrustedYamlBoundary.isRecord(parentNode)) {
      WorkflowResultSchema.invalidOutput(
        'expert authorization parent must be an object',
      );
    }
    WorkflowResultSchema.assertExactKeys([
      parentNode,
      ['kind', 'task', 'agent', 'attempt'],
    ]);
    const parentKind = WorkflowResultSchema.stringValue(
      WorkflowResultSchema.readProperty([parentNode, 'kind']),
    );
    const parentTask = WorkflowResultSchema.stringValue(
      WorkflowResultSchema.readProperty([parentNode, 'task']),
    );
    const parentAgent = WorkflowResultSchema.stringValue(
      WorkflowResultSchema.readProperty([parentNode, 'agent']),
    );
    const parentAttempt = WorkflowResultSchema.integerValue(
      WorkflowResultSchema.readProperty([parentNode, 'attempt']),
    );
    if (
      parentKind !== AgentAttemptParentKind.AgentAttempt ||
      !WorkflowResultSchema.safeIdentifier(task) ||
      !WorkflowResultSchema.safeIdentifier(expert) ||
      !WorkflowResultSchema.safeIdentifier(parentTask) ||
      !WorkflowResultSchema.safeIdentifier(parentAgent) ||
      attempt < 1 ||
      parentAttempt < 1 ||
      (depth !== 2 && depth !== 3) ||
      (task === parentTask && attempt === parentAttempt)
    ) {
      WorkflowResultSchema.invalidOutput(
        'expert authorization identity is invalid',
      );
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

  private static decodeModuleExpertAuthorizations(
    node: UntrustedYamlNode,
  ): readonly ModuleExpertAuthorization[] {
    if (
      !Array.isArray(node) ||
      node.length === 0 ||
      node.length > WorkflowResultSchema.MAX_MODULE_EXPERT_AUTHORIZATIONS
    ) {
      WorkflowResultSchema.invalidOutput(
        'module development plan requires bounded expert authorizations',
      );
    }
    const authorizations = node.map((entry) =>
      WorkflowResultSchema.decodeModuleExpertAuthorization(entry),
    );
    if (
      new Set(
        authorizations.map((entry) => `${entry.task}\u0000${entry.attempt}`),
      ).size !== authorizations.length
    ) {
      WorkflowResultSchema.invalidOutput(
        'module expert authorization journal storage keys must be unique',
      );
    }
    return authorizations;
  }

  private static decodeModuleExpertAuthorization(
    node: UntrustedYamlNode,
  ): ModuleExpertAuthorization {
    if (!UntrustedYamlBoundary.isRecord(node)) {
      WorkflowResultSchema.invalidOutput(
        'module expert authorization must be an object',
      );
    }
    WorkflowResultSchema.assertExactKeys([
      node,
      ['task', 'expert', 'attempt', 'depth', 'parent'],
    ]);
    const task = WorkflowResultSchema.stringValue(
      WorkflowResultSchema.readProperty([node, 'task']),
    );
    const expert = WorkflowResultSchema.stringValue(
      WorkflowResultSchema.readProperty([node, 'expert']),
    );
    const attempt = WorkflowResultSchema.integerValue(
      WorkflowResultSchema.readProperty([node, 'attempt']),
    );
    const depth = WorkflowResultSchema.integerValue(
      WorkflowResultSchema.readProperty([node, 'depth']),
    );
    const parentNode = WorkflowResultSchema.readProperty([node, 'parent']);
    if (!UntrustedYamlBoundary.isRecord(parentNode)) {
      WorkflowResultSchema.invalidOutput(
        'module expert authorization parent must be an object',
      );
    }
    WorkflowResultSchema.assertExactKeys([
      parentNode,
      ['kind', 'task', 'agent', 'attempt'],
    ]);
    const parentKind = WorkflowResultSchema.stringValue(
      WorkflowResultSchema.readProperty([parentNode, 'kind']),
    );
    const parentTask = WorkflowResultSchema.stringValue(
      WorkflowResultSchema.readProperty([parentNode, 'task']),
    );
    const parentAgent = WorkflowResultSchema.stringValue(
      WorkflowResultSchema.readProperty([parentNode, 'agent']),
    );
    const parentAttempt = WorkflowResultSchema.integerValue(
      WorkflowResultSchema.readProperty([parentNode, 'attempt']),
    );
    if (
      parentKind !== AgentAttemptParentKind.AgentAttempt ||
      !WorkflowResultSchema.safeIdentifier(task) ||
      !WorkflowResultSchema.safeIdentifier(expert) ||
      !WorkflowResultSchema.safeIdentifier(parentTask) ||
      !WorkflowResultSchema.safeIdentifier(parentAgent) ||
      attempt < 1 ||
      parentAttempt < 1 ||
      (depth !== 2 && depth !== 3) ||
      (task === parentTask && attempt === parentAttempt)
    ) {
      WorkflowResultSchema.invalidOutput(
        'module expert authorization identity is invalid',
      );
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

  private static continuationSequenceSchema(): UntrustedYamlMap {
    return {
      type: 'array',
      minItems: 1,
      maxItems: WorkflowResultSchema.MAX_CONTINUATION_ENTRIES,
      uniqueItems: true,
      items: {
        type: 'string',
        minLength: 1,
        maxLength: WorkflowResultSchema.MAX_CONTINUATION_ENTRY_LENGTH,
        pattern: '\\S',
      },
    };
  }

  private static decodeModuleExpertContinuation(
    node: UntrustedYamlNode,
  ): ModuleExpertContinuation {
    if (!UntrustedYamlBoundary.isRecord(node)) {
      WorkflowResultSchema.invalidOutput(
        'module expert continuation must be an object',
      );
    }
    WorkflowResultSchema.assertExactKeys([
      node,
      WorkflowResultSchema.MODULE_EXPERT_CONTINUATION_FIELDS,
    ]);
    return {
      externalApi: WorkflowResultSchema.continuationSequence(
        WorkflowResultSchema.readProperty([node, 'externalApi']),
      ),
      dependencies: WorkflowResultSchema.continuationSequence(
        WorkflowResultSchema.readProperty([node, 'dependencies']),
      ),
      consumers: WorkflowResultSchema.continuationSequence(
        WorkflowResultSchema.readProperty([node, 'consumers']),
      ),
      behaviorInvariants: WorkflowResultSchema.continuationSequence(
        WorkflowResultSchema.readProperty([node, 'behaviorInvariants']),
      ),
      securityInvariants: WorkflowResultSchema.continuationSequence(
        WorkflowResultSchema.readProperty([node, 'securityInvariants']),
      ),
      compatibilityInvariants: WorkflowResultSchema.continuationSequence(
        WorkflowResultSchema.readProperty([node, 'compatibilityInvariants']),
      ),
      owningTests: WorkflowResultSchema.continuationSequence(
        WorkflowResultSchema.readProperty([node, 'owningTests']),
      ),
      focusedValidation: WorkflowResultSchema.continuationSequence(
        WorkflowResultSchema.readProperty([node, 'focusedValidation']),
      ),
      risks: WorkflowResultSchema.continuationSequence(
        WorkflowResultSchema.readProperty([node, 'risks']),
      ),
      unresolvedDecisions: WorkflowResultSchema.continuationSequence(
        WorkflowResultSchema.readProperty([node, 'unresolvedDecisions']),
      ),
      parentActions: WorkflowResultSchema.continuationSequence(
        WorkflowResultSchema.readProperty([node, 'parentActions']),
      ),
    };
  }

  private static continuationSequence(
    node: UntrustedYamlNode,
  ): readonly string[] {
    const values = WorkflowResultSchema.stringSequence(node);
    if (
      values.length === 0 ||
      values.length > WorkflowResultSchema.MAX_CONTINUATION_ENTRIES ||
      new Set(values).size !== values.length ||
      values.some(
        (entry) =>
          entry.trim() === '' ||
          entry.length > WorkflowResultSchema.MAX_CONTINUATION_ENTRY_LENGTH ||
          WorkflowResultSchema.containsForbiddenControlCharacter(entry),
      )
    ) {
      WorkflowResultSchema.invalidOutput(
        'module expert continuation fields require bounded non-empty entries',
      );
    }
    return values;
  }

  private static containsForbiddenControlCharacter(value: string): boolean {
    return Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return (
        code === 127 || (code < 32 && code !== 9 && code !== 10 && code !== 13)
      );
    });
  }

  private static decodeFindings(
    node: UntrustedYamlNode,
  ): readonly WorkflowFinding[] {
    if (!Array.isArray(node)) {
      WorkflowResultSchema.invalidOutput('workflow findings must be an array');
    }
    return node.map((entry) => {
      if (!UntrustedYamlBoundary.isRecord(entry)) {
        WorkflowResultSchema.invalidOutput(
          'each workflow finding must be an object',
        );
      }
      WorkflowResultSchema.assertExactKeys([
        entry,
        ['severity', 'title', 'summary', 'evidence', 'affectedPaths'],
      ]);
      const severityValue = WorkflowResultSchema.stringValue(
        WorkflowResultSchema.readProperty([entry, 'severity']),
      );
      if (
        !Object.values(WorkflowFindingSeverity).includes(
          severityValue as WorkflowFindingSeverity,
        )
      ) {
        WorkflowResultSchema.invalidOutput(
          'workflow finding severity is invalid',
        );
      }
      const finding: WorkflowFinding = {
        severity: severityValue as WorkflowFindingSeverity,
        title: WorkflowResultSchema.stringValue(
          WorkflowResultSchema.readProperty([entry, 'title']),
        ),
        summary: WorkflowResultSchema.stringValue(
          WorkflowResultSchema.readProperty([entry, 'summary']),
        ),
        evidence: WorkflowResultSchema.evidenceSequence(
          WorkflowResultSchema.readProperty([entry, 'evidence']),
        ),
        affectedPaths: WorkflowResultSchema.stringSequence(
          WorkflowResultSchema.readProperty([entry, 'affectedPaths']),
        ),
      };
      return finding;
    });
  }

  private static decodeArtifacts(
    node: UntrustedYamlNode,
  ): readonly WorkflowArtifactReference[] {
    if (!Array.isArray(node)) {
      WorkflowResultSchema.invalidOutput('workflow artifacts must be an array');
    }
    return node.map((entry) => {
      if (!UntrustedYamlBoundary.isRecord(entry)) {
        WorkflowResultSchema.invalidOutput(
          'each workflow artifact must be an object',
        );
      }
      WorkflowResultSchema.assertExactKeys([
        entry,
        ['kind', 'location', 'description'],
      ]);
      const kindValue = WorkflowResultSchema.stringValue(
        WorkflowResultSchema.readProperty([entry, 'kind']),
      );
      if (
        !Object.values(WorkflowArtifactKind).includes(
          kindValue as WorkflowArtifactKind,
        )
      ) {
        WorkflowResultSchema.invalidOutput('workflow artifact kind is invalid');
      }
      const artifact: WorkflowArtifactReference = {
        kind: kindValue as WorkflowArtifactKind,
        location: WorkflowResultSchema.stringValue(
          WorkflowResultSchema.readProperty([entry, 'location']),
        ),
        description: WorkflowResultSchema.stringValue(
          WorkflowResultSchema.readProperty([entry, 'description']),
        ),
      };
      return artifact;
    });
  }

  private static assertExactKeys(values: RecordKeys): void {
    const allowed = new Set(values[1]);
    const keys = Object.keys(values[0]);
    if (keys.length !== allowed.size || keys.some((key) => !allowed.has(key))) {
      WorkflowResultSchema.invalidOutput(
        'workflow structured result contains missing or extra fields',
      );
    }
  }

  private static readProperty(values: RecordProperty): UntrustedYamlNode {
    const propertyInput: UntrustedYamlPropertyArgs = {
      record: values[0],
      key: values[1],
    };
    const property = UntrustedYamlBoundary.property(propertyInput);
    if (property.presence === UntrustedYamlPropertyPresence.Absent) {
      WorkflowResultSchema.invalidOutput(
        `workflow structured result is missing ${values[1]}`,
      );
    }
    return property.value;
  }

  private static stringValue(node: UntrustedYamlNode): string {
    if (typeof node !== 'string') {
      WorkflowResultSchema.invalidOutput(
        'workflow structured result expected a string',
      );
    }
    return node;
  }

  private static integerValue(node: UntrustedYamlNode): number {
    if (typeof node !== 'number' || !Number.isSafeInteger(node)) {
      WorkflowResultSchema.invalidOutput(
        'workflow structured result expected an integer',
      );
    }
    return node;
  }

  private static safeIdentifier(value: string): boolean {
    return value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value);
  }

  private static boundedNonBlankString(node: UntrustedYamlNode): string {
    const value = WorkflowResultSchema.stringValue(node);
    if (value.trim() === '' || value.length > 4096) {
      WorkflowResultSchema.invalidOutput(
        'workflow structured result expected a bounded string',
      );
    }
    return value;
  }

  private static stringSequence(node: UntrustedYamlNode): readonly string[] {
    if (
      !Array.isArray(node) ||
      !node.every((entry) => typeof entry === 'string')
    ) {
      WorkflowResultSchema.invalidOutput(
        'workflow structured result expected a string array',
      );
    }
    return node as readonly string[];
  }

  private static evidenceSequence(node: UntrustedYamlNode): readonly string[] {
    const evidence = WorkflowResultSchema.stringSequence(node);
    if (
      evidence.length === 0 ||
      evidence.some((entry) => entry.trim() === '')
    ) {
      WorkflowResultSchema.invalidOutput(
        'each workflow finding requires at least one non-empty evidence string',
      );
    }
    return evidence;
  }

  private static invalidOutput(message: string): never {
    throw new Error(message);
  }
}

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
    resultKind: {
      type: 'string',
      enum: WorkflowResultSchema.STANDARD_WORKFLOW_RESULT_KINDS,
    },
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

type RecordKeys = readonly [UntrustedYamlMap, readonly string[]];
type RecordProperty = readonly [UntrustedYamlMap, string];
