import { expect, test } from 'bun:test';
import {
  CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW,
  CortexAuditTask,
} from '../../src/agent-workflow/cortex-workflow.ts';
import { WorkflowExecutorKind } from '../../src/agent-workflow/domain.ts';
import { CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION } from '../../src/agent-workflow/agent-attempt-version.ts';

test('uses the current adapter-bearing attempt journal schema', () => {
  expect(CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.version).toBe(
    CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION,
  );
});

test('audits canonical skills without granting harness mirror scope', () => {
  const task =
    CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.tasks[
      CortexAuditTask.AuditDynamicSkillsAndEntryPoints
    ];
  expect(task.resources.read).toEqual([
    '.cortex/**',
    '.codex/hooks.json',
    '.cursor/rules.md',
    '.github/prompts/**',
    'AGENTS.md',
    'CODEX.md',
    'README.md',
  ]);
  if (task.execution.kind !== WorkflowExecutorKind.Agent) {
    throw new Error('Skill audit must use an agent executor.');
  }
  expect(task.execution.instruction).toContain('prohibited harness mirrors');
  expect(task.execution.instruction).toContain('duplicate semantic authority');
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
  expect(task.execution.instruction).toContain('owning implementation');
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
