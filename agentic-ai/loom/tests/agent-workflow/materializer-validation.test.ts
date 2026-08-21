import { describe, expect, test } from 'bun:test';
import {
  AgentReasoningEffort,
  AgentWorkspacePolicy,
  LoomLeafKind,
  StaticAgentWorkflowName,
  TaskTargetKind,
  WorkflowExecutorKind,
  WorkflowResultKind,
  noTasks,
} from '../../src/agent-workflow/domain.ts';
import type { StaticAgentWorkflowDefinition } from '../../src/agent-workflow/domain.ts';
import { materializerTopologyValidationMessages } from '../../src/agent-workflow/materializer-validation.ts';

enum TestTask {
  Worker = 'worker',
  Intermediate = 'intermediate',
  Materializer = 'materializer',
}

enum TestAgent {
  Worker = 'worker-agent',
  Materializer = 'materializer-agent',
}

describe('materializer topology validation', () => {
  test('rejects an intermediate Loom leaf on an agent evidence path', () => {
    const workflow: StaticAgentWorkflowDefinition<TestTask, TestAgent, never> =
      {
        name: StaticAgentWorkflowName.CortexFullGarbageCollection,
        version: 'intermediate-leaf-test',
        entry: TestTask.Worker,
        materializedViewTask: TestTask.Materializer,
        taskNames: [
          TestTask.Worker,
          TestTask.Intermediate,
          TestTask.Materializer,
        ],
        agentNames: [TestAgent.Worker, TestAgent.Materializer],
        joinNames: [],
        agents: {
          [TestAgent.Worker]: {
            name: TestAgent.Worker,
            instructionPrefix: 'Inspect evidence.',
            workspacePolicy: AgentWorkspacePolicy.ReadOnly,
            reasoningEffort: AgentReasoningEffort.Medium,
          },
          [TestAgent.Materializer]: {
            name: TestAgent.Materializer,
            instructionPrefix: 'Aggregate evidence.',
            workspacePolicy: AgentWorkspacePolicy.ReadOnly,
            reasoningEffort: AgentReasoningEffort.Medium,
          },
        },
        tasks: {
          [TestTask.Worker]: {
            name: TestTask.Worker,
            execution: {
              kind: WorkflowExecutorKind.Agent,
              agent: TestAgent.Worker,
              instruction: 'Inspect.',
              resultKind: WorkflowResultKind.CortexEvidence,
            },
            completed: {
              kind: TaskTargetKind.Task,
              task: TestTask.Intermediate,
            },
            failed: { kind: TaskTargetKind.Task, task: TestTask.Intermediate },
            resources: { read: [], write: [] },
            timeoutMs: 1_000,
          },
          [TestTask.Intermediate]: {
            name: TestTask.Intermediate,
            execution: {
              kind: WorkflowExecutorKind.LoomLeaf,
              leaf: LoomLeafKind.CortexAudit,
              includeDensityLint: false,
            },
            completed: {
              kind: TaskTargetKind.Task,
              task: TestTask.Materializer,
            },
            failed: { kind: TaskTargetKind.Task, task: TestTask.Materializer },
            resources: { read: [], write: [] },
            timeoutMs: 1_000,
          },
          [TestTask.Materializer]: {
            name: TestTask.Materializer,
            execution: {
              kind: WorkflowExecutorKind.Agent,
              agent: TestAgent.Materializer,
              instruction: 'Aggregate.',
              resultKind: WorkflowResultKind.CortexSynthesis,
            },
            completed: noTasks,
            failed: noTasks,
            resources: { read: [], write: [] },
            timeoutMs: 1_000,
          },
        },
        joins: {},
      };
    const adjacency = new Map<string, ReadonlySet<string>>([
      ['task:worker', new Set(['task:intermediate'])],
      ['task:intermediate', new Set(['task:materializer'])],
      ['task:materializer', new Set()],
    ]);
    const request = {
      workflow,
      adjacency,
      taskNode: (task: string): string => `task:${task}`,
    };
    expect(materializerTopologyValidationMessages(request)).toContain(
      'agent task worker reaches intermediate task intermediate; intermediate executors cannot preserve agent evidence',
    );
  });
});
