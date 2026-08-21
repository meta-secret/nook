import { expect, test } from 'bun:test';
import {
  CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW,
  CortexAuditTask,
} from '../../src/agent-workflow/cortex-workflow.ts';
import { WorkflowExecutorKind } from '../../src/agent-workflow/domain.ts';

test('declares executable skill mirrors in the skill audit scope', () => {
  const task =
    CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.tasks[
      CortexAuditTask.AuditDynamicSkillsAndEntryPoints
    ];
  expect(task.resources.read).toContain('.agents/**');
  expect(task.resources.read).toContain('.cursor/**');
  expect(task.resources.read).toContain('.claude/**');
  if (task.execution.kind !== WorkflowExecutorKind.Agent) {
    throw new Error('Skill audit must use an agent executor.');
  }
  expect(task.execution.instruction).toContain('.agents/skills');
  expect(task.execution.instruction).toContain('.cursor executable mirrors');
  expect(task.execution.instruction).toContain('.claude executable mirrors');
});

test('compares design and product claims with owning implementation', () => {
  const task =
    CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.tasks[
      CortexAuditTask.AuditDesignDocsAndProductSpecs
    ];
  expect(task.resources.read).toContain('nook-app/**');
  if (task.execution.kind !== WorkflowExecutorKind.Agent) {
    throw new Error('Architecture audit must use an agent executor.');
  }
  expect(task.execution.instruction).toContain(
    'owning nook-app implementation',
  );
});

test('classifies workflow extraction candidates before synthesis', () => {
  const workflowAudit =
    CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.tasks[
      CortexAuditTask.AuditWorkflowsAndReferences
    ];
  const synthesis =
    CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.tasks[
      CortexAuditTask.SynthesizeFindings
    ];
  if (
    workflowAudit.execution.kind !== WorkflowExecutorKind.Agent ||
    synthesis.execution.kind !== WorkflowExecutorKind.Agent
  ) {
    throw new Error('Workflow extraction review must use agent executors.');
  }
  expect(workflowAudit.execution.instruction).toContain(
    'deterministic leaf candidates',
  );
  expect(workflowAudit.execution.instruction).toContain(
    'compiled workflow candidates',
  );
  expect(workflowAudit.execution.instruction).toContain(
    'safe parallel evidence lanes',
  );
  expect(synthesis.execution.instruction).toContain('delivery-owner actions');
  expect(synthesis.execution.instruction).toContain('parent-owned joins');
});
