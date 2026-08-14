import { expect, test } from 'bun:test';
import {
  buildAgentWorkflowPlan,
  parseCommandLine,
} from '../../src/agent-workflow/cli.ts';
import { CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW } from '../../src/agent-workflow/cortex-workflow.ts';
import {
  AgentWorkspacePolicy,
  TaskTargetKind,
  WorkflowExecutorKind,
} from '../../src/agent-workflow/domain.ts';
import { WorkflowValidationStatus } from '../../src/agent-workflow/validation.ts';

test('renders the complete validated static graph in plan output', () => {
  const plan = buildAgentWorkflowPlan(CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW);
  const serialized = JSON.stringify(plan);

  expect(plan.connectivity.validationStatus).toBe(
    WorkflowValidationStatus.Valid,
  );
  expect(plan.tasks).toHaveLength(
    CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.taskNames.length,
  );
  expect(plan.agents).toHaveLength(
    CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.agentNames.length,
  );
  expect(plan.joins).toHaveLength(
    CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.joinNames.length,
  );
  expect(plan.connectivity.taskTransitions).toHaveLength(
    CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.taskNames.length * 2,
  );
  expect(serialized).toContain(TaskTargetKind.Parallel);
  expect(serialized).toContain('evidence-collected');
  expect(serialized).toContain('arrivals');
  expect(serialized).toContain(WorkflowExecutorKind.Agent);
  expect(serialized).toContain(WorkflowExecutorKind.LoomLeaf);
  expect(serialized).toContain('timeoutMs');
  expect(serialized).toContain('resources');
  expect(serialized).toContain(AgentWorkspacePolicy.ReadOnly);
  expect(serialized).toContain('reasoningEffort');
});

test('accepts an explicit repository working directory', () => {
  const commandLineTokens: readonly string[] = [
    'cortex-full-garbage-collection',
    '--baseline',
    '1111111111111111111111111111111111111111',
    '--working-directory',
    '/tmp/nook-repository-root',
    '--plan',
  ];
  const commandLine = parseCommandLine(commandLineTokens);

  expect(commandLine).not.toBe(false);
  if (commandLine === false) {
    throw new Error('Expected a valid agent workflow command line.');
  }
  expect(commandLine.workingDirectory).toBe('/tmp/nook-repository-root');
});
