import { expect, test } from 'bun:test';
import {
  AgentAttemptParentKind,
  WorkflowResultKind,
} from '../../src/agent-workflow/domain.ts';
import type {
  ModuleDevelopmentPlanTaskOutput,
  ModuleExpertContinuation,
  ModuleExpertTaskOutput,
  WorkflowTaskOutput,
} from '../../src/agent-workflow/domain.ts';
import {
  decodeWorkflowTaskOutput,
  workflowTaskOutputSchema,
} from '../../src/agent-workflow/structured-result-codec.ts';
import { isRecord } from '../../src/lib/guards.ts';
import type { UntrustedYamlNode } from '../../src/lib/guards.ts';

type MutableYamlMap = Record<string, UntrustedYamlNode>;

test('binds the structured result schema to one task result kind', () => {
  const schema = workflowTaskOutputSchema(WorkflowResultKind.CortexEvidence);
  const properties = schema.properties;
  expect(JSON.stringify(properties)).toContain('cortex-evidence');
  expect(JSON.stringify(properties)).not.toContain('loom-leaf-evidence');
});

test('requires typed continuation fields for module expert evidence', () => {
  const schema = workflowTaskOutputSchema(
    WorkflowResultKind.ModuleExpertEvidence,
  );
  expect(schema.required).toContain('continuation');
  expect(JSON.stringify(schema.properties)).toContain('parentActions');
  expect(JSON.stringify(schema.properties)).toContain('securityInvariants');
  expect(JSON.stringify(schema.properties)).toContain('focusedValidation');
  expect(JSON.stringify(schema.properties)).toContain('unresolvedDecisions');
  expect(JSON.stringify(schema.properties)).not.toContain('cortex-evidence');
});

test('requires typed child authorizations for a module development plan', () => {
  const schema = workflowTaskOutputSchema(
    WorkflowResultKind.ModuleDevelopmentPlan,
  );
  expect(schema.required).toContain('moduleExpertAuthorizations');
  expect(JSON.stringify(schema.properties)).toContain('parent');

  const output = moduleDevelopmentPlanOutput();
  expect(decodeWorkflowTaskOutput(JSON.stringify(output))).toEqual(output);
});

test('rejects missing, duplicate, or invalid module expert authorizations', () => {
  const output = moduleDevelopmentPlanOutput();
  const missingAuthorization = jsonMap(output);
  delete missingAuthorization.moduleExpertAuthorizations;
  const duplicateAuthorization: ModuleDevelopmentPlanTaskOutput = {
    ...output,
    moduleExpertAuthorizations: [
      ...output.moduleExpertAuthorizations,
      ...output.moduleExpertAuthorizations,
    ],
  };
  const invalidDepth = jsonMap(output);
  const authorizationNode = invalidDepth.moduleExpertAuthorizations;
  if (!Array.isArray(authorizationNode) || !isRecord(authorizationNode[0])) {
    throw new Error('Expected an authorization in the test fixture.');
  }
  const authorization = authorizationNode[0] as MutableYamlMap;
  authorization.depth = 4;

  expect(() =>
    decodeWorkflowTaskOutput(JSON.stringify(missingAuthorization)),
  ).toThrow('missing or extra fields');
  expect(() =>
    decodeWorkflowTaskOutput(JSON.stringify(duplicateAuthorization)),
  ).toThrow('must be unique');
  expect(() => decodeWorkflowTaskOutput(JSON.stringify(invalidDepth))).toThrow(
    'identity is invalid',
  );
});

test('rejects extra fields at the structured output boundary', () => {
  const serialized =
    '{"resultKind":"cortex-evidence","summary":"Audited.","findings":[],"notesForParent":[],"artifacts":[],"extra":"not allowed"}';
  expect(() => decodeWorkflowTaskOutput(serialized)).toThrow(
    'missing or extra fields',
  );
});

test('decodes a valid typed task output', () => {
  const output: WorkflowTaskOutput = {
    resultKind: WorkflowResultKind.CortexEvidence,
    summary: 'Audited.',
    materializedViewMarkdown: '# Audit\n\nAudited.',
    findings: [],
    notesForParent: [],
    artifacts: [],
  };
  const decoded = decodeWorkflowTaskOutput(JSON.stringify(output));
  expect(decoded).toEqual(output);
});

test('decodes complete module expert continuation data', () => {
  const output: ModuleExpertTaskOutput = {
    resultKind: WorkflowResultKind.ModuleExpertEvidence,
    summary: 'Module boundary inspected.',
    materializedViewMarkdown: '# Module boundary\n\nInspected.',
    findings: [],
    notesForParent: [],
    artifacts: [],
    continuation: moduleExpertContinuation(),
  };

  expect(decodeWorkflowTaskOutput(JSON.stringify(output))).toEqual(output);
});

test('rejects module expert prose without complete continuation data', () => {
  const missingContinuation = {
    resultKind: WorkflowResultKind.ModuleExpertEvidence,
    summary: 'Module boundary inspected.',
    materializedViewMarkdown: '# External API\n\nAll prose headings present.',
    findings: [],
    notesForParent: [],
    artifacts: [],
  };
  const emptyParentActions = {
    ...missingContinuation,
    resultKind: WorkflowResultKind.ModuleExpertEvidence,
    continuation: {
      ...moduleExpertContinuation(),
      parentActions: [],
    },
  };

  expect(() =>
    decodeWorkflowTaskOutput(JSON.stringify(missingContinuation)),
  ).toThrow('missing or extra fields');
  expect(() =>
    decodeWorkflowTaskOutput(JSON.stringify(emptyParentActions)),
  ).toThrow('require bounded non-empty entries');
});

test('rejects every missing or extra module expert result field', () => {
  const output = moduleExpertOutput();
  const outputFields = [
    'resultKind',
    'summary',
    'materializedViewMarkdown',
    'findings',
    'notesForParent',
    'artifacts',
    'continuation',
  ];
  for (const field of outputFields) {
    const malformed = jsonMap(output);
    delete malformed[field];
    expect(() => decodeWorkflowTaskOutput(JSON.stringify(malformed))).toThrow();
  }

  const extraOutputField = jsonMap(output);
  extraOutputField.implementationPlan = ['Not part of evidence.'];
  expect(() =>
    decodeWorkflowTaskOutput(JSON.stringify(extraOutputField)),
  ).toThrow('missing or extra fields');
});

test('rejects every missing or extra continuation field', () => {
  const output = moduleExpertOutput();
  const continuationFields = Object.keys(output.continuation);
  for (const field of continuationFields) {
    const malformed = jsonMap(output);
    const continuation = continuationMap(malformed);
    delete continuation[field];
    expect(() => decodeWorkflowTaskOutput(JSON.stringify(malformed))).toThrow(
      'missing or extra fields',
    );
  }

  const malformed = jsonMap(output);
  const continuation = continuationMap(malformed);
  continuation.implementationPlan = ['Not a registered continuation field.'];
  expect(() => decodeWorkflowTaskOutput(JSON.stringify(malformed))).toThrow(
    'missing or extra fields',
  );
});

test('rejects malformed, duplicate, controlled, and unbounded continuation entries', () => {
  const tooManyEntries: string[] = [];
  for (let index = 0; index < 101; index += 1) {
    tooManyEntries.push(`Entry ${index}`);
  }
  const invalidValues: readonly UntrustedYamlNode[] = [
    'not-an-array',
    [],
    ['   '],
    ['duplicate', 'duplicate'],
    ['controlled\u0000entry'],
    ['x'.repeat(4097)],
    tooManyEntries,
  ];

  for (const invalidValue of invalidValues) {
    const malformed = jsonMap(moduleExpertOutput());
    const continuation = continuationMap(malformed);
    continuation.externalApi = invalidValue;
    expect(() => decodeWorkflowTaskOutput(JSON.stringify(malformed))).toThrow();
  }
});

test('rejects continuation data on standard workflow evidence', () => {
  const standardOutput: WorkflowTaskOutput = {
    resultKind: WorkflowResultKind.CortexEvidence,
    summary: 'Audited.',
    materializedViewMarkdown: '# Audit\n\nAudited.',
    findings: [],
    notesForParent: [],
    artifacts: [],
  };
  const output = jsonMap(standardOutput);
  const moduleOutput = jsonMap(moduleExpertOutput());
  const continuation = moduleOutput.continuation;
  if (!continuation) {
    throw new Error('Expected module expert continuation in the test fixture.');
  }
  output.continuation = continuation;

  expect(() => decodeWorkflowTaskOutput(JSON.stringify(output))).toThrow(
    'missing or extra fields',
  );
});

test('requires non-empty evidence on every structured finding', () => {
  const noEvidence =
    '{"resultKind":"cortex-evidence","summary":"Audited.","materializedViewMarkdown":"# Audit","findings":[{"severity":"error","title":"Missing evidence","summary":"No evidence was supplied.","evidence":[],"affectedPaths":[]}],"notesForParent":[],"artifacts":[]}';
  const blankEvidence =
    '{"resultKind":"cortex-evidence","summary":"Audited.","materializedViewMarkdown":"# Audit","findings":[{"severity":"error","title":"Blank evidence","summary":"Only blank evidence was supplied.","evidence":["   "],"affectedPaths":[]}],"notesForParent":[],"artifacts":[]}';
  expect(() => decodeWorkflowTaskOutput(noEvidence)).toThrow(
    'at least one non-empty evidence string',
  );
  expect(() => decodeWorkflowTaskOutput(blankEvidence)).toThrow(
    'at least one non-empty evidence string',
  );
});

test('requires a bounded non-empty semantic materialized view', () => {
  const blankView =
    '{"resultKind":"cortex-evidence","summary":"Audited.","materializedViewMarkdown":"   ","findings":[],"notesForParent":[],"artifacts":[]}';
  const oversizedOutput: WorkflowTaskOutput = {
    resultKind: WorkflowResultKind.CortexEvidence,
    summary: 'Audited.',
    materializedViewMarkdown: 'x'.repeat(65_537),
    findings: [],
    notesForParent: [],
    artifacts: [],
  };

  expect(() => decodeWorkflowTaskOutput(blankView)).toThrow(
    'non-empty, bounded Markdown',
  );
  expect(() =>
    decodeWorkflowTaskOutput(JSON.stringify(oversizedOutput)),
  ).toThrow('non-empty, bounded Markdown');
});

function moduleExpertContinuation(): ModuleExpertContinuation {
  return {
    externalApi: ['PublicFacade::inspect exposes the supported operation.'],
    dependencies: ['CoreTypes supplies the stable input DTO.'],
    consumers: ['WASM bindings consume PublicFacade.'],
    behaviorInvariants: ['The operation preserves the domain transition.'],
    securityInvariants: ['Sensitive values remain inside the Rust boundary.'],
    compatibilityInvariants: ['The generated binding shape remains stable.'],
    owningTests: ['The provider behavior suite owns the contract.'],
    focusedValidation: ['Run the focused behavior and binding tests.'],
    risks: ['No material implementation risks were found.'],
    unresolvedDecisions: ['No unresolved decisions were found.'],
    parentActions: ['Implement the consumer against PublicFacade only.'],
  };
}

function moduleDevelopmentPlanOutput(): ModuleDevelopmentPlanTaskOutput {
  return {
    resultKind: WorkflowResultKind.ModuleDevelopmentPlan,
    summary: 'Reviewed module plan.',
    materializedViewMarkdown: '# Module plan\n\nReviewed.',
    findings: [],
    notesForParent: [],
    artifacts: [],
    moduleExpertAuthorizations: [
      {
        task: 'inspect-core-contract',
        expert: 'core_expert',
        attempt: 1,
        depth: 2,
        parent: {
          kind: AgentAttemptParentKind.AgentAttempt,
          task: 'feature-synthesis',
          agent: 'delivery-owner',
          attempt: 1,
        },
      },
    ],
  };
}

function moduleExpertOutput(): ModuleExpertTaskOutput {
  return {
    resultKind: WorkflowResultKind.ModuleExpertEvidence,
    summary: 'Module boundary inspected.',
    materializedViewMarkdown: '# Module boundary\n\nInspected.',
    findings: [],
    notesForParent: [],
    artifacts: [],
    continuation: moduleExpertContinuation(),
  };
}

function jsonMap(value: UntrustedYamlNode): MutableYamlMap {
  return JSON.parse(JSON.stringify(value)) as MutableYamlMap;
}

function continuationMap(output: MutableYamlMap): MutableYamlMap {
  const continuation = output.continuation;
  if (!continuation || !isRecord(continuation)) {
    throw new Error('Expected a continuation map in the test fixture.');
  }
  return continuation as MutableYamlMap;
}
