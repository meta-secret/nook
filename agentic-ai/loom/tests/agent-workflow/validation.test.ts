import { describe, expect, test } from 'bun:test';
import {
  CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW,
  CortexAuditAgent,
  CortexAuditJoin,
  CortexAuditTask,
} from '../../src/agent-workflow/cortex-workflow.ts';
import { TaskTargetKind, noTasks } from '../../src/agent-workflow/domain.ts';
import {
  WorkflowValidationIssueKind,
  WorkflowValidationStatus,
  validateStaticAgentWorkflow,
} from '../../src/agent-workflow/validation.ts';

import type { StaticAgentWorkflowDefinition } from '../../src/agent-workflow/domain.ts';
import type {
  WorkflowValidation,
  WorkflowValidationIssue,
} from '../../src/agent-workflow/validation.ts';

type CortexWorkflow = StaticAgentWorkflowDefinition<
  CortexAuditTask,
  CortexAuditAgent,
  CortexAuditJoin
>;

type WorkflowIssueAssertion = {
  readonly validation: WorkflowValidation;
  readonly kind: WorkflowValidationIssueKind;
};

function expectIssue(assertion: WorkflowIssueAssertion): void {
  expect(assertion.validation.status).toBe(WorkflowValidationStatus.Invalid);
  if (assertion.validation.status === WorkflowValidationStatus.Invalid) {
    expect(
      assertion.validation.issues.some(
        (issue: WorkflowValidationIssue) => issue.kind === assertion.kind,
      ),
    ).toBe(true);
  }
}

describe('static agent workflow validation', () => {
  test('accepts the compiled Cortex workflow', () => {
    const validation = validateStaticAgentWorkflow(
      CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW,
    );
    const expectedValidation: WorkflowValidation = {
      status: WorkflowValidationStatus.Valid,
    };

    expect(validation).toEqual(expectedValidation);
  });

  test('rejects a missing entry task', () => {
    const workflow: CortexWorkflow = {
      ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW,
      entry: 'missing-entry' as CortexAuditTask,
    };
    const validation = validateStaticAgentWorkflow(workflow);
    const assertion: WorkflowIssueAssertion = {
      validation,
      kind: WorkflowValidationIssueKind.InvalidEntry,
    };

    expectIssue(assertion);
  });

  test('rejects missing task and agent references', () => {
    const workflow: CortexWorkflow = {
      ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW,
      agentNames: [
        CortexAuditAgent.ArchitectureAuditor,
        CortexAuditAgent.RuntimeAuditor,
        CortexAuditAgent.FindingSynthesizer,
      ],
      tasks: {
        ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.tasks,
        [CortexAuditTask.SynthesizeFindings]: {
          ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.tasks[
            CortexAuditTask.SynthesizeFindings
          ],
          completed: {
            kind: TaskTargetKind.Task,
            task: 'missing-task' as CortexAuditTask,
          },
        },
      },
    };
    const validation = validateStaticAgentWorkflow(workflow);
    const assertion: WorkflowIssueAssertion = {
      validation,
      kind: WorkflowValidationIssueKind.InvalidReference,
    };

    expectIssue(assertion);
  });

  test('rejects unreachable declared tasks', () => {
    const workflow: CortexWorkflow = {
      ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW,
      joins: {
        ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.joins,
        [CortexAuditJoin.EvidenceCollected]: {
          ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.joins[
            CortexAuditJoin.EvidenceCollected
          ],
          completed: noTasks,
        },
      },
    };
    const validation = validateStaticAgentWorkflow(workflow);
    const assertion: WorkflowIssueAssertion = {
      validation,
      kind: WorkflowValidationIssueKind.UnreachableNode,
    };

    expectIssue(assertion);
  });

  test('rejects cycles', () => {
    const workflow: CortexWorkflow = {
      ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW,
      tasks: {
        ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.tasks,
        [CortexAuditTask.MechanicalCortexAudit]: {
          ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.tasks[
            CortexAuditTask.MechanicalCortexAudit
          ],
          completed: {
            kind: TaskTargetKind.Task,
            task: CortexAuditTask.ResolveBaseline,
          },
        },
      },
    };
    const validation = validateStaticAgentWorkflow(workflow);
    const assertion: WorkflowIssueAssertion = {
      validation,
      kind: WorkflowValidationIssueKind.Cycle,
    };

    expectIssue(assertion);
  });

  test('rejects duplicate parallel targets', () => {
    const workflow: CortexWorkflow = {
      ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW,
      tasks: {
        ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.tasks,
        [CortexAuditTask.ResolveBaseline]: {
          ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.tasks[
            CortexAuditTask.ResolveBaseline
          ],
          completed: {
            kind: TaskTargetKind.Parallel,
            tasks: [
              CortexAuditTask.AuditWorkflowsAndReferences,
              CortexAuditTask.AuditWorkflowsAndReferences,
            ],
          },
        },
      },
    };
    const validation = validateStaticAgentWorkflow(workflow);
    const assertion: WorkflowIssueAssertion = {
      validation,
      kind: WorkflowValidationIssueKind.InvalidParallelTarget,
    };

    expectIssue(assertion);
  });

  test('rejects an explicit join whose declared arrival has no edge', () => {
    const workflow: CortexWorkflow = {
      ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW,
      tasks: {
        ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.tasks,
        [CortexAuditTask.AuditRuntimeTaskAndCi]: {
          ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.tasks[
            CortexAuditTask.AuditRuntimeTaskAndCi
          ],
          completed: noTasks,
        },
      },
    };
    const validation = validateStaticAgentWorkflow(workflow);
    const assertion: WorkflowIssueAssertion = {
      validation,
      kind: WorkflowValidationIssueKind.InvalidJoin,
    };

    expectIssue(assertion);
  });

  test('rejects a task with two scheduling sources', () => {
    const workflow: CortexWorkflow = {
      ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW,
      tasks: {
        ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.tasks,
        [CortexAuditTask.AuditWorkflowsAndReferences]: {
          ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.tasks[
            CortexAuditTask.AuditWorkflowsAndReferences
          ],
          completed: {
            kind: TaskTargetKind.Task,
            task: CortexAuditTask.MechanicalCortexAudit,
          },
        },
      },
    };
    const validation = validateStaticAgentWorkflow(workflow);
    const assertion: WorkflowIssueAssertion = {
      validation,
      kind: WorkflowValidationIssueKind.DuplicateScheduling,
    };

    expectIssue(assertion);
  });

  test('rejects overlapping write and read claims in one parallel wave', () => {
    const sharedWrite = {
      read: [],
      write: ['.cortex/**'],
    };
    const sharedRead = {
      read: ['.cortex/workflows/**'],
      write: [],
    };
    const workflow: CortexWorkflow = {
      ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW,
      tasks: {
        ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.tasks,
        [CortexAuditTask.AuditWorkflowsAndReferences]: {
          ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.tasks[
            CortexAuditTask.AuditWorkflowsAndReferences
          ],
          resources: sharedWrite,
        },
        [CortexAuditTask.AuditDesignDocsAndProductSpecs]: {
          ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.tasks[
            CortexAuditTask.AuditDesignDocsAndProductSpecs
          ],
          resources: sharedRead,
        },
      },
    };
    const validation = validateStaticAgentWorkflow(workflow);
    const assertion: WorkflowIssueAssertion = {
      validation,
      kind: WorkflowValidationIssueKind.ResourceConflict,
    };

    expectIssue(assertion);
  });
});
