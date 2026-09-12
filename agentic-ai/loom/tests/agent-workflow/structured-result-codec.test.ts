import { expect, test } from 'bun:test';
import assert from 'node:assert/strict';

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

import { WorkflowResultSchema } from '../../src/agent-workflow/structured-result-codec.ts';

import { UntrustedYamlBoundary } from '../../src/lib/guards.ts';

import type { UntrustedYamlNode } from '../../src/lib/guards.ts';

export class AgentWorkflowStructuredResultCodecScenario {
  private constructor(private readonly request: UntrustedYamlNode) {}

  static moduleExpertContinuation(): ModuleExpertContinuation {
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

  static moduleDevelopmentPlanOutput(): ModuleDevelopmentPlanTaskOutput {
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

  static moduleExpertOutput(): ModuleExpertTaskOutput {
    return {
      resultKind: WorkflowResultKind.ModuleExpertEvidence,
      summary: 'Module boundary inspected.',
      materializedViewMarkdown: '# Module boundary\n\nInspected.',
      findings: [],
      notesForParent: [],
      artifacts: [],
      continuation:
        AgentWorkflowStructuredResultCodecScenario.moduleExpertContinuation(),
    };
  }

  static jsonMap(value: UntrustedYamlNode): MutableYamlMap {
    return new AgentWorkflowStructuredResultCodecScenario(value).execute();
  }

  private execute(): MutableYamlMap {
    const value = this.request;
    const parsed = UntrustedYamlBoundary.fromHost(
      JSON.parse(JSON.stringify(value)),
    );
    if (!UntrustedYamlBoundary.isRecord(parsed))
      throw new Error('Expected a JSON map in the test fixture.');
    const result: MutableYamlMap = {};
    for (const [key, entry] of Object.entries(parsed)) result[key] = entry;
    return result;
  }

  static continuationMap(output: MutableYamlMap): MutableYamlMap {
    const continuation = output.continuation;
    if (!continuation || !UntrustedYamlBoundary.isRecord(continuation)) {
      throw new Error('Expected a continuation map in the test fixture.');
    }
    const result: MutableYamlMap = {};
    for (const [key, entry] of Object.entries(continuation))
      result[key] = entry;
    return result;
  }
}

type MutableYamlMap = Record<string, UntrustedYamlNode>;

test('binds the structured result schema to one task result kind', () => {
  const schema = WorkflowResultSchema.workflowTaskOutputSchema(
    WorkflowResultKind.CortexEvidence,
  );
  const properties = schema.properties;
  expect(JSON.stringify(properties)).toContain('cortex-evidence');
  expect(JSON.stringify(properties)).not.toContain('loom-leaf-evidence');
});

test('requires typed continuation fields for module expert evidence', () => {
  const schema = WorkflowResultSchema.workflowTaskOutputSchema(
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
  const schema = WorkflowResultSchema.workflowTaskOutputSchema(
    WorkflowResultKind.ModuleDevelopmentPlan,
  );
  expect(schema.required).toContain('moduleExpertAuthorizations');
  expect(JSON.stringify(schema.properties)).toContain('parent');

  const output =
    AgentWorkflowStructuredResultCodecScenario.moduleDevelopmentPlanOutput();
  assert.deepEqual(
    WorkflowResultSchema.decodeWorkflowTaskOutput(JSON.stringify(output)),
    output,
  );
});

test('rejects missing, duplicate, or invalid module expert authorizations', () => {
  const output =
    AgentWorkflowStructuredResultCodecScenario.moduleDevelopmentPlanOutput();
  const missingAuthorization =
    AgentWorkflowStructuredResultCodecScenario.jsonMap(output);
  delete missingAuthorization.moduleExpertAuthorizations;
  const duplicateAuthorization: ModuleDevelopmentPlanTaskOutput = {
    ...output,
    moduleExpertAuthorizations: [
      ...output.moduleExpertAuthorizations,
      ...output.moduleExpertAuthorizations,
    ],
  };
  const firstAuthorization = output.moduleExpertAuthorizations[0];
  if (!firstAuthorization) {
    throw new Error('Expected an authorization in the test fixture.');
  }
  const collidingStorageKey: ModuleDevelopmentPlanTaskOutput = {
    ...output,
    moduleExpertAuthorizations: [
      firstAuthorization,
      {
        ...firstAuthorization,
        expert: 'web_expert',
        parent: {
          kind: AgentAttemptParentKind.AgentAttempt,
          task: 'alternate-parent',
          agent: 'alternate-owner',
          attempt: 2,
        },
      },
    ],
  };
  const childReusesParentStorageKey: ModuleDevelopmentPlanTaskOutput = {
    ...output,
    moduleExpertAuthorizations: [
      {
        ...firstAuthorization,
        task: firstAuthorization.parent.task,
        expert: 'different_expert',
        attempt: firstAuthorization.parent.attempt,
      },
    ],
  };
  const invalidDepth =
    AgentWorkflowStructuredResultCodecScenario.jsonMap(output);
  if (!('moduleExpertAuthorizations' in invalidDepth))
    throw new Error('Expected module expert authorizations.');
  const authorizationNode = invalidDepth.moduleExpertAuthorizations;
  if (
    !UntrustedYamlBoundary.isList(authorizationNode) ||
    !authorizationNode[0] ||
    !UntrustedYamlBoundary.isRecord(authorizationNode[0])
  ) {
    throw new Error('Expected an authorization in the test fixture.');
  }
  const authorizationNodeValue = authorizationNode[0];
  if (!authorizationNodeValue) throw new Error('Authorization is missing.');
  const authorization: MutableYamlMap = {};
  for (const [key, entry] of Object.entries(authorizationNodeValue))
    authorization[key] = entry;
  authorization.depth = 4;

  expect(() =>
    WorkflowResultSchema.decodeWorkflowTaskOutput(
      JSON.stringify(missingAuthorization),
    ),
  ).toThrow('missing or extra fields');
  expect(() =>
    WorkflowResultSchema.decodeWorkflowTaskOutput(
      JSON.stringify(duplicateAuthorization),
    ),
  ).toThrow('journal storage keys must be unique');
  expect(() =>
    WorkflowResultSchema.decodeWorkflowTaskOutput(
      JSON.stringify(collidingStorageKey),
    ),
  ).toThrow('journal storage keys must be unique');
  expect(() =>
    WorkflowResultSchema.decodeWorkflowTaskOutput(
      JSON.stringify(childReusesParentStorageKey),
    ),
  ).toThrow('identity is invalid');
  expect(() =>
    WorkflowResultSchema.decodeWorkflowTaskOutput(JSON.stringify(invalidDepth)),
  ).toThrow('identity is invalid');
});

test('rejects extra fields at the structured output boundary', () => {
  const serialized =
    '{"resultKind":"cortex-evidence","summary":"Audited.","findings":[],"notesForParent":[],"artifacts":[],"extra":"not allowed"}';
  expect(() =>
    WorkflowResultSchema.decodeWorkflowTaskOutput(serialized),
  ).toThrow('missing or extra fields');
});

test('reports the invalid field type at the structured output boundary', () => {
  const valid = {
    resultKind: WorkflowResultKind.CortexEvidence,
    summary: 'Audited.',
    materializedViewMarkdown: '# Audit\n\nAudited.',
    findings: [],
    notesForParent: [],
    artifacts: [],
  };

  expect(() =>
    WorkflowResultSchema.decodeWorkflowTaskOutputNode({
      ...valid,
      summary: 123,
    }),
  ).toThrow('workflow structured result expected a string');
  expect(() =>
    WorkflowResultSchema.decodeWorkflowTaskOutputNode({
      ...valid,
      findings: {},
    }),
  ).toThrow('workflow findings must be an array');
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
  const decoded = WorkflowResultSchema.decodeWorkflowTaskOutput(
    JSON.stringify(output),
  );
  assert.deepEqual(decoded, output);
});

test('decodes complete module expert continuation data', () => {
  const output: ModuleExpertTaskOutput = {
    resultKind: WorkflowResultKind.ModuleExpertEvidence,
    summary: 'Module boundary inspected.',
    materializedViewMarkdown: '# Module boundary\n\nInspected.',
    findings: [],
    notesForParent: [],
    artifacts: [],
    continuation:
      AgentWorkflowStructuredResultCodecScenario.moduleExpertContinuation(),
  };

  assert.deepEqual(
    WorkflowResultSchema.decodeWorkflowTaskOutput(JSON.stringify(output)),
    output,
  );
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
      ...AgentWorkflowStructuredResultCodecScenario.moduleExpertContinuation(),
      parentActions: [],
    },
  };

  expect(() =>
    WorkflowResultSchema.decodeWorkflowTaskOutput(
      JSON.stringify(missingContinuation),
    ),
  ).toThrow('missing or extra fields');
  expect(() =>
    WorkflowResultSchema.decodeWorkflowTaskOutput(
      JSON.stringify(emptyParentActions),
    ),
  ).toThrow('require bounded non-empty entries');
});

test('rejects every missing or extra module expert result field', () => {
  const output =
    AgentWorkflowStructuredResultCodecScenario.moduleExpertOutput();
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
    const malformed =
      AgentWorkflowStructuredResultCodecScenario.jsonMap(output);
    delete malformed[field];
    expect(() =>
      WorkflowResultSchema.decodeWorkflowTaskOutput(JSON.stringify(malformed)),
    ).toThrow();
  }

  const extraOutputField =
    AgentWorkflowStructuredResultCodecScenario.jsonMap(output);
  extraOutputField.implementationPlan = ['Not part of evidence.'];
  expect(() =>
    WorkflowResultSchema.decodeWorkflowTaskOutput(
      JSON.stringify(extraOutputField),
    ),
  ).toThrow('missing or extra fields');
});

test('rejects every missing or extra continuation field', () => {
  const output =
    AgentWorkflowStructuredResultCodecScenario.moduleExpertOutput();
  const continuationFields = Object.keys(output.continuation);
  for (const field of continuationFields) {
    const malformed =
      AgentWorkflowStructuredResultCodecScenario.jsonMap(output);
    const continuation =
      AgentWorkflowStructuredResultCodecScenario.continuationMap(malformed);
    delete continuation[field];
    expect(() =>
      WorkflowResultSchema.decodeWorkflowTaskOutput(JSON.stringify(malformed)),
    ).toThrow('missing or extra fields');
  }

  const malformed = AgentWorkflowStructuredResultCodecScenario.jsonMap(output);
  const continuation =
    AgentWorkflowStructuredResultCodecScenario.continuationMap(malformed);
  continuation.implementationPlan = ['Not a registered continuation field.'];
  expect(() =>
    WorkflowResultSchema.decodeWorkflowTaskOutput(JSON.stringify(malformed)),
  ).toThrow('missing or extra fields');
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
    const malformed = AgentWorkflowStructuredResultCodecScenario.jsonMap(
      AgentWorkflowStructuredResultCodecScenario.moduleExpertOutput(),
    );
    const continuation =
      AgentWorkflowStructuredResultCodecScenario.continuationMap(malformed);
    continuation.externalApi = invalidValue;
    expect(() =>
      WorkflowResultSchema.decodeWorkflowTaskOutput(JSON.stringify(malformed)),
    ).toThrow();
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
  const output =
    AgentWorkflowStructuredResultCodecScenario.jsonMap(standardOutput);
  const moduleOutput = AgentWorkflowStructuredResultCodecScenario.jsonMap(
    AgentWorkflowStructuredResultCodecScenario.moduleExpertOutput(),
  );
  const continuation = moduleOutput.continuation;
  if (!continuation) {
    throw new Error('Expected module expert continuation in the test fixture.');
  }
  output.continuation = continuation;

  expect(() =>
    WorkflowResultSchema.decodeWorkflowTaskOutput(JSON.stringify(output)),
  ).toThrow('missing or extra fields');
});

test('requires non-empty evidence on every structured finding', () => {
  const noEvidence =
    '{"resultKind":"cortex-evidence","summary":"Audited.","materializedViewMarkdown":"# Audit","findings":[{"severity":"error","title":"Missing evidence","summary":"No evidence was supplied.","evidence":[],"affectedPaths":[]}],"notesForParent":[],"artifacts":[]}';
  const blankEvidence =
    '{"resultKind":"cortex-evidence","summary":"Audited.","materializedViewMarkdown":"# Audit","findings":[{"severity":"error","title":"Blank evidence","summary":"Only blank evidence was supplied.","evidence":["   "],"affectedPaths":[]}],"notesForParent":[],"artifacts":[]}';
  expect(() =>
    WorkflowResultSchema.decodeWorkflowTaskOutput(noEvidence),
  ).toThrow('at least one non-empty evidence string');
  expect(() =>
    WorkflowResultSchema.decodeWorkflowTaskOutput(blankEvidence),
  ).toThrow('at least one non-empty evidence string');
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

  expect(() =>
    WorkflowResultSchema.decodeWorkflowTaskOutput(blankView),
  ).toThrow('non-empty, bounded Markdown');
  expect(() =>
    WorkflowResultSchema.decodeWorkflowTaskOutput(
      JSON.stringify(oversizedOutput),
    ),
  ).toThrow('non-empty, bounded Markdown');
});
