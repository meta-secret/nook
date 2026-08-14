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
    findings: [],
    notesForParent: [],
    artifacts: [],
  };
  const decoded = decodeWorkflowTaskOutput(JSON.stringify(output));
  expect(decoded).toEqual(output);
});
