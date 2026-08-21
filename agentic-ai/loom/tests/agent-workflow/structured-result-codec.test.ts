import { expect, test } from 'bun:test';
import { WorkflowResultKind } from '../../src/agent-workflow/domain.ts';
import type { WorkflowTaskOutput } from '../../src/agent-workflow/domain.ts';
import {
  decodeWorkflowTaskOutput,
  workflowTaskOutputSchema,
} from '../../src/agent-workflow/structured-result-codec.ts';

test('binds the structured result schema to one task result kind', () => {
  const schema = workflowTaskOutputSchema(WorkflowResultKind.CortexEvidence);
  const properties = schema.properties;
  expect(JSON.stringify(properties)).toContain('cortex-evidence');
  expect(JSON.stringify(properties)).not.toContain('loom-leaf-evidence');
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
