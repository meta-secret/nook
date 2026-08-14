import { describe, expect, test } from 'bun:test';
import {
  CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW,
  CortexAuditAgent,
  CortexAuditJoin,
  CortexAuditTask,
} from '../../src/agent-workflow/cortex-workflow.ts';
import {
  LoomLeafKind,
  TaskTargetKind,
  WorkflowExecutorKind,
  isValidTaskResourceClaim,
  noTasks,
  taskResourcePatternsOverlap,
} from '../../src/agent-workflow/domain.ts';
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

enum ExclusiveBranchTask {
  Root = 'root',
  CompletedBranch = 'completed-branch',
  CompletedDescendant = 'completed-descendant',
  FailedBranch = 'failed-branch',
  FailedDescendant = 'failed-descendant',
}
type ExclusiveBranchWorkflow = StaticAgentWorkflowDefinition<
  ExclusiveBranchTask,
  never,
  never
>;

enum SharedOutcomeTask {
  Root = 'root',
  Shared = 'shared',
  CompletedOnly = 'completed-only',
}
type SharedOutcomeWorkflow = StaticAgentWorkflowDefinition<
  SharedOutcomeTask,
  never,
  never
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

  test('returns Invalid when a declared task is absent from the registry', () => {
    const {
      [CortexAuditTask.ResolveBaseline]: omittedTask,
      ...incompleteTasks
    } = CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.tasks;
    expect(omittedTask.name).toBe(CortexAuditTask.ResolveBaseline);
    const workflow = {
      ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW,
      tasks: incompleteTasks,
    } as CortexWorkflow;
    const validation = validateStaticAgentWorkflow(workflow);
    const assertion: WorkflowIssueAssertion = {
      validation,
      kind: WorkflowValidationIssueKind.RegistryMismatch,
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

  test('rejects a descendant that can overlap a parallel sibling', () => {
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
              CortexAuditTask.AuditDesignDocsAndProductSpecs,
              CortexAuditTask.AuditDynamicSkillsAndEntryPoints,
              CortexAuditTask.AuditRuntimeTaskAndCi,
            ],
          },
        },
        [CortexAuditTask.AuditWorkflowsAndReferences]: {
          ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.tasks[
            CortexAuditTask.AuditWorkflowsAndReferences
          ],
          completed: {
            kind: TaskTargetKind.Task,
            task: CortexAuditTask.MechanicalCortexAudit,
          },
        },
        [CortexAuditTask.MechanicalCortexAudit]: {
          ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.tasks[
            CortexAuditTask.MechanicalCortexAudit
          ],
          resources: { read: [], write: ['docs/*.md'] },
        },
        [CortexAuditTask.AuditDesignDocsAndProductSpecs]: {
          ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.tasks[
            CortexAuditTask.AuditDesignDocsAndProductSpecs
          ],
          resources: { read: ['docs/readme.md'], write: [] },
        },
      },
      joins: {
        [CortexAuditJoin.EvidenceCollected]: {
          ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.joins[
            CortexAuditJoin.EvidenceCollected
          ],
          arrivals: [
            CortexAuditTask.MechanicalCortexAudit,
            CortexAuditTask.AuditDesignDocsAndProductSpecs,
            CortexAuditTask.AuditDynamicSkillsAndEntryPoints,
            CortexAuditTask.AuditRuntimeTaskAndCi,
          ],
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

  test('accepts conflicting claims on mutually exclusive outcome branches', () => {
    const leafExecution = {
      kind: WorkflowExecutorKind.LoomLeaf,
      leaf: LoomLeafKind.VerifyGitBaseline,
    } as const;
    const workflow: ExclusiveBranchWorkflow = {
      name: CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.name,
      version: 'exclusive-outcome-test',
      entry: ExclusiveBranchTask.Root,
      taskNames: [
        ExclusiveBranchTask.Root,
        ExclusiveBranchTask.CompletedBranch,
        ExclusiveBranchTask.CompletedDescendant,
        ExclusiveBranchTask.FailedBranch,
        ExclusiveBranchTask.FailedDescendant,
      ],
      agentNames: [],
      joinNames: [],
      agents: {},
      tasks: {
        [ExclusiveBranchTask.Root]: {
          name: ExclusiveBranchTask.Root,
          execution: leafExecution,
          completed: {
            kind: TaskTargetKind.Task,
            task: ExclusiveBranchTask.CompletedBranch,
          },
          failed: {
            kind: TaskTargetKind.Task,
            task: ExclusiveBranchTask.FailedBranch,
          },
          resources: { read: [], write: [] },
          timeoutMs: 1_000,
        },
        [ExclusiveBranchTask.CompletedBranch]: {
          name: ExclusiveBranchTask.CompletedBranch,
          execution: leafExecution,
          completed: {
            kind: TaskTargetKind.Task,
            task: ExclusiveBranchTask.CompletedDescendant,
          },
          failed: noTasks,
          resources: { read: [], write: [] },
          timeoutMs: 1_000,
        },
        [ExclusiveBranchTask.CompletedDescendant]: {
          name: ExclusiveBranchTask.CompletedDescendant,
          execution: leafExecution,
          completed: noTasks,
          failed: noTasks,
          resources: { read: [], write: ['docs/README.md'] },
          timeoutMs: 1_000,
        },
        [ExclusiveBranchTask.FailedBranch]: {
          name: ExclusiveBranchTask.FailedBranch,
          execution: leafExecution,
          completed: {
            kind: TaskTargetKind.Task,
            task: ExclusiveBranchTask.FailedDescendant,
          },
          failed: noTasks,
          resources: { read: [], write: [] },
          timeoutMs: 1_000,
        },
        [ExclusiveBranchTask.FailedDescendant]: {
          name: ExclusiveBranchTask.FailedDescendant,
          execution: leafExecution,
          completed: noTasks,
          failed: noTasks,
          resources: { read: ['docs/README.md'], write: [] },
          timeoutMs: 1_000,
        },
      },
      joins: {},
    };
    const validation = validateStaticAgentWorkflow(workflow);
    const expectedValidation: WorkflowValidation = {
      status: WorkflowValidationStatus.Valid,
    };

    expect(validation).toEqual(expectedValidation);
  });

  test('rejects conflicts when one outcome shares a descendant', () => {
    const leafExecution = {
      kind: WorkflowExecutorKind.LoomLeaf,
      leaf: LoomLeafKind.VerifyGitBaseline,
    } as const;
    const workflow: SharedOutcomeWorkflow = {
      name: CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.name,
      version: 'shared-outcome-test',
      entry: SharedOutcomeTask.Root,
      taskNames: [
        SharedOutcomeTask.Root,
        SharedOutcomeTask.Shared,
        SharedOutcomeTask.CompletedOnly,
      ],
      agentNames: [],
      joinNames: [],
      agents: {},
      tasks: {
        [SharedOutcomeTask.Root]: {
          name: SharedOutcomeTask.Root,
          execution: leafExecution,
          completed: {
            kind: TaskTargetKind.Parallel,
            tasks: [SharedOutcomeTask.Shared, SharedOutcomeTask.CompletedOnly],
          },
          failed: {
            kind: TaskTargetKind.Task,
            task: SharedOutcomeTask.Shared,
          },
          resources: { read: [], write: [] },
          timeoutMs: 1_000,
        },
        [SharedOutcomeTask.Shared]: {
          name: SharedOutcomeTask.Shared,
          execution: leafExecution,
          completed: noTasks,
          failed: noTasks,
          resources: { read: ['docs/README.md'], write: [] },
          timeoutMs: 1_000,
        },
        [SharedOutcomeTask.CompletedOnly]: {
          name: SharedOutcomeTask.CompletedOnly,
          execution: leafExecution,
          completed: noTasks,
          failed: noTasks,
          resources: { read: [], write: ['docs/README.md'] },
          timeoutMs: 1_000,
        },
      },
      joins: {},
    };
    const validation = validateStaticAgentWorkflow(workflow);
    const assertion: WorkflowIssueAssertion = {
      validation,
      kind: WorkflowValidationIssueKind.ResourceConflict,
    };

    expectIssue(assertion);
  });

  test('supports recursive basename resource claims', () => {
    const workflow: CortexWorkflow = {
      ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW,
      tasks: {
        ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.tasks,
        [CortexAuditTask.AuditWorkflowsAndReferences]: {
          ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.tasks[
            CortexAuditTask.AuditWorkflowsAndReferences
          ],
          resources: { read: [], write: ['**/cache'] },
        },
        [CortexAuditTask.AuditDesignDocsAndProductSpecs]: {
          ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.tasks[
            CortexAuditTask.AuditDesignDocsAndProductSpecs
          ],
          resources: { read: ['src/cache/state.json'], write: [] },
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

  test('does not overlap unrelated recursive basename claims', () => {
    const nonOverlappingPairs = [
      { first: 'README.md', second: '**/Taskfile.yml' },
      { first: '**/*.md', second: '**/*.ts' },
    ];

    for (const pair of nonOverlappingPairs) {
      expect(taskResourcePatternsOverlap(pair)).toBe(false);
    }
  });

  test('does not overlap direct globs in different directories', () => {
    const pair = {
      first: 'docs/*.md',
      second: 'docs/nested/*.ts',
    };

    expect(taskResourcePatternsOverlap(pair)).toBe(false);
  });

  test('overlaps nested direct globs when the outer glob owns the directory', () => {
    const broadPair = {
      first: 'docs/*',
      second: 'docs/nested/*.ts',
    } as const;
    const extensionPair = {
      first: 'docs/*.md',
      second: 'docs/nested.md/*.ts',
    } as const;

    expect(taskResourcePatternsOverlap(broadPair)).toBe(true);
    expect(taskResourcePatternsOverlap(extensionPair)).toBe(true);
  });

  test('overlaps recursive basename claims with matching names and extensions', () => {
    const overlappingPairs = [
      { first: 'nook-app/Taskfile.yml', second: '**/Taskfile.yml' },
      { first: 'docs/README.md', second: '**/*.md' },
      { first: '**/cache', second: 'src/cache/state.json' },
      { first: '**/*.md', second: 'docs/readme.md/file.ts' },
      { first: '**/*.md', second: 'docs/*.md' },
    ];

    for (const pair of overlappingPairs) {
      expect(taskResourcePatternsOverlap(pair)).toBe(true);
    }
  });

  test('does not overlap unrelated recursive basenames in exact path segments', () => {
    const literalPair = {
      first: '**/cache',
      second: 'src/state/data.json',
    } as const;
    const extensionPair = {
      first: '**/*.md',
      second: 'docs/readme.txt/file.ts',
    } as const;

    expect(taskResourcePatternsOverlap(literalPair)).toBe(false);
    expect(taskResourcePatternsOverlap(extensionPair)).toBe(false);
  });

  test('overlaps recursive globs with claims that can own ancestor directories', () => {
    const exactDirectoryPair = {
      first: 'docs',
      second: '**/*.ts',
    } as const;
    const dottedExactDirectoryPair = {
      first: '.github',
      second: '**/*.ts',
    } as const;
    const directoryGlobPair = {
      first: 'docs/*.md',
      second: '**/*.ts',
    } as const;

    expect(taskResourcePatternsOverlap(exactDirectoryPair)).toBe(true);
    expect(taskResourcePatternsOverlap(dottedExactDirectoryPair)).toBe(true);
    expect(taskResourcePatternsOverlap(directoryGlobPair)).toBe(true);
  });

  test('rejects unsupported resource claim syntax', () => {
    const workflow: CortexWorkflow = {
      ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW,
      tasks: {
        ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.tasks,
        [CortexAuditTask.AuditWorkflowsAndReferences]: {
          ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.tasks[
            CortexAuditTask.AuditWorkflowsAndReferences
          ],
          resources: { read: ['docs/**/nested.md'], write: [] },
        },
      },
    };
    const validation = validateStaticAgentWorkflow(workflow);
    const assertion: WorkflowIssueAssertion = {
      validation,
      kind: WorkflowValidationIssueKind.InvalidResourceClaim,
    };

    expectIssue(assertion);
  });

  test('rejects noncanonical dot path segments', () => {
    const invalidClaims = [
      'tmp/../docs/README.md',
      './docs/README.md',
      'git:refs/../index',
    ];
    const validClaims = ['tmp/docs/README.md', '.github', '**/*.ts'];

    for (const claim of invalidClaims) {
      expect(isValidTaskResourceClaim(claim)).toBe(false);
    }
    for (const claim of validClaims) {
      expect(isValidTaskResourceClaim(claim)).toBe(true);
    }
  });

  test('returns Invalid for a missing join registry entry', () => {
    const workflow: CortexWorkflow = {
      ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW,
      joins: {} as CortexWorkflow['joins'],
    };
    const validation = validateStaticAgentWorkflow(workflow);
    const assertion: WorkflowIssueAssertion = {
      validation,
      kind: WorkflowValidationIssueKind.RegistryMismatch,
    };

    expectIssue(assertion);
  });

  test('rejects join-to-join routing', () => {
    const workflow: CortexWorkflow = {
      ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW,
      joins: {
        [CortexAuditJoin.EvidenceCollected]: {
          ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.joins[
            CortexAuditJoin.EvidenceCollected
          ],
          completed: {
            kind: TaskTargetKind.Join,
            join: CortexAuditJoin.EvidenceCollected,
          },
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
});
