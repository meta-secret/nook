import { z } from 'zod';
import {
  AgentAttemptParentKind,
  WorkflowArtifactKind,
  WorkflowFindingSeverity,
  WorkflowResultKind,
} from './domain.ts';
import type { UntrustedYamlMap } from '../lib/guards.ts';
import {
  UntrustedYamlBoundary,
  type UntrustedYamlNode,
} from '../lib/guards.ts';
import { STRUCTURAL_RESULT_SCHEMAS } from './structural-result-codec.ts';
import { parseStructural } from './structural-result-values.ts';

export const MAX_MATERIALIZED_VIEW_MARKDOWN_LENGTH = 65_536;
const MISSING_FIELDS =
  'workflow structured result contains missing or extra fields';
class WorkflowTextValue {
  constructor(private readonly value: string) {}
  hasControlCharacter(): boolean {
    return Array.from(this.value).some((character) => {
      const code = character.charCodeAt(0);
      return (
        code <= 8 ||
        code === 11 ||
        code === 12 ||
        code === 127 ||
        (code >= 14 && code <= 31)
      );
    });
  }
}
const error = (message: string) => ({
  error: (issue: { readonly code: string }) =>
    issue.code === 'invalid_type' && Reflect.get(issue, 'input') === void 0
      ? MISSING_FIELDS
      : message,
});
const exact = { error: MISSING_FIELDS };
const string = z.string(error('workflow structured result expected a string'));
const bounded = string
  .max(4096, 'workflow structured result expected a bounded string')
  .refine(
    (value) => value.trim() !== '',
    'workflow structured result expected a bounded string',
  )
  .meta({ minLength: 1, pattern: '\\S' });
const strings = z.array(
  string,
  error('workflow structured result expected a string array'),
);
const view = string
  .max(
    MAX_MATERIALIZED_VIEW_MARKDOWN_LENGTH,
    'workflow materialized view must be non-empty, bounded Markdown without control characters',
  )
  .refine(
    (value) =>
      value.trim() !== '' &&
      !new WorkflowTextValue(value).hasControlCharacter(),
    'workflow materialized view must be non-empty, bounded Markdown without control characters',
  )
  .meta({ minLength: 1, pattern: '\\S' });
// Metadata retains the existing SDK bounds where legacy runtime admission is looser.
const BASE = {
  summary: bounded,
  materializedViewMarkdown: view,
  findings: z
    .array(
      z.strictObject(
        {
          severity: z.enum(
            WorkflowFindingSeverity,
            error('workflow finding severity is invalid'),
          ),
          title: string,
          summary: string.meta({ maxLength: 4096 }),
          evidence: strings
            .refine(
              (values) =>
                values.length > 0 &&
                values.every((value) => value.trim() !== ''),
              'each workflow finding requires at least one non-empty evidence string',
            )
            .meta({
              minItems: 1,
              maxItems: 100,
              items: { type: 'string', minLength: 1, pattern: '\\S' },
            }),
          affectedPaths: strings.meta({ maxItems: 100 }),
        },
        exact,
      ),
      error('workflow findings must be an array'),
    )
    .meta({ maxItems: 100 }),
  notesForParent: strings.meta({ maxItems: 100 }),
  artifacts: z
    .array(
      z.strictObject(
        {
          kind: z.enum(
            WorkflowArtifactKind,
            error('workflow artifact kind is invalid'),
          ),
          location: string,
          description: string,
        },
        exact,
      ),
      error('workflow artifacts must be an array'),
    )
    .meta({ maxItems: 100 }),
};
const identityMessage = 'module expert authorization identity is invalid';
const id = string
  .max(128, identityMessage)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u, identityMessage);
const positive = z
  .int(error('workflow structured result expected an integer'))
  .positive(identityMessage);
const AUTHORIZATION = z
  .strictObject(
    {
      task: id,
      expert: id,
      attempt: positive,
      depth: z.union([z.literal(2), z.literal(3)], error(identityMessage)),
      parent: z.strictObject(
        {
          kind: z.literal(
            AgentAttemptParentKind.AgentAttempt,
            error(identityMessage),
          ),
          task: id,
          agent: id,
          attempt: positive,
        },
        exact,
      ),
    },
    exact,
  )
  .refine(
    (value) =>
      value.task !== value.parent.task ||
      value.attempt !== value.parent.attempt,
    identityMessage,
  );
const AUTHORIZATIONS = z
  .array(
    AUTHORIZATION,
    error('module development plan requires bounded expert authorizations'),
  )
  .min(1, 'module development plan requires bounded expert authorizations')
  .max(100, 'module development plan requires bounded expert authorizations')
  .refine(
    (values) =>
      new Set(values.map((value) => `${value.task}\u0000${value.attempt}`))
        .size === values.length,
    'module expert authorization journal storage keys must be unique',
  )
  .meta({ uniqueItems: true });
const continuationMessage =
  'module expert continuation fields require bounded non-empty entries';
const continuationEntries = strings
  .refine(
    (values) =>
      values.length > 0 &&
      values.length <= 100 &&
      new Set(values).size === values.length &&
      values.every(
        (value) =>
          value.trim() !== '' &&
          value.length <= 4096 &&
          !new WorkflowTextValue(value).hasControlCharacter(),
      ),
    continuationMessage,
  )
  .meta({
    minItems: 1,
    maxItems: 100,
    uniqueItems: true,
    items: { type: 'string', minLength: 1, maxLength: 4096, pattern: '\\S' },
  });
const CONTINUATION = z.strictObject(
  {
    externalApi: continuationEntries,
    dependencies: continuationEntries,
    consumers: continuationEntries,
    behaviorInvariants: continuationEntries,
    securityInvariants: continuationEntries,
    compatibilityInvariants: continuationEntries,
    owningTests: continuationEntries,
    focusedValidation: continuationEntries,
    risks: continuationEntries,
    unresolvedDecisions: continuationEntries,
    parentActions: continuationEntries,
  },
  exact,
);
const RESULT_SCHEMAS = {
  [WorkflowResultKind.CortexEvidence]: z.strictObject(
    { ...BASE, resultKind: z.literal(WorkflowResultKind.CortexEvidence) },
    exact,
  ),
  [WorkflowResultKind.ModuleDevelopmentPlan]: z.strictObject(
    {
      ...BASE,
      resultKind: z.literal(WorkflowResultKind.ModuleDevelopmentPlan),
      moduleExpertAuthorizations: AUTHORIZATIONS,
    },
    exact,
  ),
  [WorkflowResultKind.ModuleExpertEvidence]: z.strictObject(
    {
      ...BASE,
      resultKind: z.literal(WorkflowResultKind.ModuleExpertEvidence),
      continuation: CONTINUATION,
    },
    exact,
  ),
  [WorkflowResultKind.StructuralExpertPlan]:
    STRUCTURAL_RESULT_SCHEMAS[WorkflowResultKind.StructuralExpertPlan],
  [WorkflowResultKind.CodeRefactoringEvidence]:
    STRUCTURAL_RESULT_SCHEMAS[WorkflowResultKind.CodeRefactoringEvidence],
  [WorkflowResultKind.CortexRefactoringEvidence]:
    STRUCTURAL_RESULT_SCHEMAS[WorkflowResultKind.CortexRefactoringEvidence],
  [WorkflowResultKind.SystemCoherenceSynthesis]:
    STRUCTURAL_RESULT_SCHEMAS[WorkflowResultKind.SystemCoherenceSynthesis],
};
export type DecodedWorkflowTaskOutput = z.infer<
  (typeof RESULT_SCHEMAS)[keyof typeof RESULT_SCHEMAS]
>;

export class WorkflowResultSchema {
  private constructor() {}
  static readonly STANDARD_WORKFLOW_RESULT_KINDS = [
    WorkflowResultKind.CortexEvidence,
  ] as const;
  static workflowTaskOutputSchema(
    resultKind: WorkflowResultKind,
  ): UntrustedYamlMap {
    return z.toJSONSchema(RESULT_SCHEMAS[resultKind], {
      io: 'input',
      target: 'draft-7',
    }) as UntrustedYamlMap;
  }
  static decodeWorkflowTaskOutput(
    serialized: string,
  ): DecodedWorkflowTaskOutput {
    if (Buffer.byteLength(serialized, 'utf8') > 131_072)
      throw new Error('workflow structured result exceeds 131072 bytes');
    const node = UntrustedYamlBoundary.fromJson(JSON.parse(serialized));
    return this.decodeWorkflowTaskOutputNode(node);
  }
  static decodeWorkflowTaskOutputNode(
    input: UntrustedYamlNode,
  ): DecodedWorkflowTaskOutput {
    const serialized = JSON.stringify(input);
    if (
      typeof serialized === 'string' &&
      Buffer.byteLength(serialized, 'utf8') > 131_072
    )
      throw new Error('workflow structured result exceeds 131072 bytes');
    const envelope = z
      .object(
        {
          resultKind: string.pipe(
            z.enum(WorkflowResultKind, error('workflow resultKind is invalid')),
          ),
        },
        { error: 'workflow output must be an object' },
      )
      .safeParse(input);
    if (!envelope.success)
      throw new Error(
        envelope.error.issues.length > 0
          ? envelope.error.issues[0]!.message
          : 'workflow resultKind is invalid',
      );
    const kind = envelope.data.resultKind;
    const schema = RESULT_SCHEMAS[kind];
    if (kind in STRUCTURAL_RESULT_SCHEMAS)
      return parseStructural<DecodedWorkflowTaskOutput>({ schema, input });
    const decoded = schema.safeParse(input);
    if (!decoded.success)
      throw new Error(
        decoded.error.issues.length > 0
          ? decoded.error.issues[0]!.message
          : MISSING_FIELDS,
      );
    return decoded.data;
  }
}

export const WORKFLOW_TASK_OUTPUT_SCHEMA =
  WorkflowResultSchema.workflowTaskOutputSchema(
    WorkflowResultKind.CortexEvidence,
  );
