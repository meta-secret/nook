import { expect, test } from 'bun:test';
import {
  CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW,
  CortexAuditTask,
} from '../../src/agent-workflow/cortex-workflow.ts';
import { WorkflowExecutorKind } from '../../src/agent-workflow/domain.ts';
import { CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION } from '../../src/agent-workflow/agent-attempt-version.ts';
import { MECHANICAL_CORTEX_AUDIT_MINIMUM_TIMEOUT_MS } from '../../src/agent-workflow/executable-skill-budget.ts';
import {
  EXECUTABLE_SKILL_PROVISIONING_TIMEOUT_MS,
  EXECUTABLE_SKILL_REGISTRY_INSPECTION_TIMEOUT_MS,
  EXECUTABLE_SKILL_TEARDOWN_ATTEMPT_COUNT,
  EXECUTABLE_SKILL_TEARDOWN_ATTEMPT_TIMEOUT_MS,
  EXECUTABLE_SKILL_WORKFLOW_ORCHESTRATION_MARGIN_MS,
} from '../../src/executable-skills/budgets.ts';
import { MAXIMUM_REGISTERED_EXECUTABLE_SKILL_TIMEOUT_MS } from '../../src/executable-skills/registry.ts';

test('uses the current adapter-bearing attempt journal schema', () => {
  expect(CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.version).toBe(
    CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION,
  );
});

test('mechanical audit timeout covers the complete executable-skill lifecycle', () => {
  const task =
    CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.tasks[
      CortexAuditTask.MechanicalCortexAudit
    ];
  expect(task.timeoutMs).toBe(MECHANICAL_CORTEX_AUDIT_MINIMUM_TIMEOUT_MS);
  const boundedPhaseTotal =
    EXECUTABLE_SKILL_REGISTRY_INSPECTION_TIMEOUT_MS +
    EXECUTABLE_SKILL_PROVISIONING_TIMEOUT_MS +
    MAXIMUM_REGISTERED_EXECUTABLE_SKILL_TIMEOUT_MS +
    EXECUTABLE_SKILL_TEARDOWN_ATTEMPT_TIMEOUT_MS *
      EXECUTABLE_SKILL_TEARDOWN_ATTEMPT_COUNT;
  expect(task.timeoutMs - boundedPhaseTotal).toBe(
    EXECUTABLE_SKILL_WORKFLOW_ORCHESTRATION_MARGIN_MS,
  );
});

test('declares agent skill mirrors in the skill audit scope', () => {
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
  expect(task.execution.instruction).toContain('.cursor agent-skill mirrors');
  expect(task.execution.instruction).toContain('.claude agent-skill mirrors');
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
