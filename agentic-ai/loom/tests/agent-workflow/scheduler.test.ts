import { mkdtemp, rm } from 'node:fs/promises';
import type { RmOptions } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW,
  CortexAuditAgent,
  CortexAuditJoin,
  CortexAuditTask,
} from '../../src/agent-workflow/cortex-workflow.ts';
import {
  LoomLeafKind,
  StaticAgentWorkflowName,
  TaskTerminalKind,
  WorkflowExecutorKind,
  WorkflowResultKind,
  WorkflowTerminalKind,
  noTasks,
} from '../../src/agent-workflow/domain.ts';
import type {
  StaticAgentWorkflowDefinition,
  TaskTerminal,
  WorkflowTaskOutput,
} from '../../src/agent-workflow/domain.ts';
import { WorkflowJournal } from '../../src/agent-workflow/journal.ts';
import type { WorkflowJournalConfiguration } from '../../src/agent-workflow/journal.ts';
import type {
  WorkflowDependencyOutput,
  WorkflowTaskInvocation,
  WorkflowTaskRuntime,
} from '../../src/agent-workflow/runtime.ts';
import { runStaticWorkflow } from '../../src/agent-workflow/scheduler.ts';
import type { StaticWorkflowRunConfiguration } from '../../src/agent-workflow/scheduler.ts';

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const FIXED_TIME = '2026-08-14T05:00:00.000Z';

type ScriptedRuntimeConfiguration = {
  readonly failedTask: CortexAuditTask | false;
};

class ScriptedWorkflowRuntime implements WorkflowTaskRuntime<
  CortexAuditTask,
  CortexAuditAgent
> {
  readonly failedTask: CortexAuditTask | false;
  readonly started: CortexAuditTask[] = [];
  readonly upstreamByTask = new Map<
    CortexAuditTask,
    readonly WorkflowDependencyOutput<CortexAuditTask>[]
  >();
  running = 0;
  maximumRunning = 0;

  constructor(configuration: ScriptedRuntimeConfiguration) {
    this.failedTask = configuration.failedTask;
  }

  async execute(
    invocation: WorkflowTaskInvocation<CortexAuditTask, CortexAuditAgent>,
  ): Promise<TaskTerminal<CortexAuditTask>> {
    this.started.push(invocation.task);
    this.upstreamByTask.set(invocation.task, invocation.upstreamOutputs);
    this.running += 1;
    this.maximumRunning = Math.max(this.maximumRunning, this.running);
    await Bun.sleep(5);
    this.running -= 1;
    if (this.failedTask === invocation.task) {
      return {
        kind: TaskTerminalKind.Failed,
        task: invocation.task,
        attempt: invocation.attempt,
        summary: 'Scripted failure.',
      };
    }
    const resultKind =
      invocation.execution.kind === WorkflowExecutorKind.Agent
        ? invocation.execution.resultKind
        : WorkflowResultKind.LoomLeafEvidence;
    const output: WorkflowTaskOutput = {
      resultKind,
      summary: `${invocation.task} completed.`,
      findings: [],
      notesForParent: [],
      artifacts: [],
    };
    return {
      kind: TaskTerminalKind.Completed,
      task: invocation.task,
      attempt: invocation.attempt,
      threadId: `thread-${invocation.task}`,
      output,
    };
  }
}

type SchedulerFixture = {
  readonly runRoot: string;
  readonly runtime: ScriptedWorkflowRuntime;
  readonly abortController: AbortController;
  readonly configuration: StaticWorkflowRunConfiguration<
    CortexAuditTask,
    CortexAuditAgent,
    CortexAuditJoin
  >;
};

enum LeafOnlyTask {
  Inspect = 'inspect',
}

enum LeafRuntimeMode {
  Complete = 'complete',
  RejectAfterCancellationBarrier = 'reject-after-cancellation-barrier',
}

type LeafRuntimeConfiguration = { readonly mode: LeafRuntimeMode };

class LeafOnlyRuntime implements WorkflowTaskRuntime<LeafOnlyTask, never> {
  readonly mode: LeafRuntimeMode;
  sawAgentProfile = false;

  constructor(configuration: LeafRuntimeConfiguration) {
    this.mode = configuration.mode;
  }

  async execute(
    invocation: WorkflowTaskInvocation<LeafOnlyTask, never>,
  ): Promise<TaskTerminal<LeafOnlyTask>> {
    this.sawAgentProfile = 'agentProfile' in invocation;
    if (this.mode === LeafRuntimeMode.RejectAfterCancellationBarrier) {
      await Bun.sleep(500);
      throw new Error('late read-only worker rejection');
    }
    const output: WorkflowTaskOutput = {
      resultKind: WorkflowResultKind.LoomLeafEvidence,
      summary: 'Leaf completed.',
      findings: [],
      notesForParent: [],
      artifacts: [],
    };
    return {
      kind: TaskTerminalKind.Completed,
      task: invocation.task,
      attempt: invocation.attempt,
      threadId: 'loom-leaf',
      output,
    };
  }
}

type LeafWorkflowFixtureConfiguration = {
  readonly mode: LeafRuntimeMode;
  readonly timeoutMs: number;
};

type LeafWorkflowFixture = {
  readonly runRoot: string;
  readonly runtime: LeafOnlyRuntime;
  readonly configuration: StaticWorkflowRunConfiguration<
    LeafOnlyTask,
    never,
    never
  >;
};

async function createLeafWorkflowFixture(
  request: LeafWorkflowFixtureConfiguration,
): Promise<LeafWorkflowFixture> {
  const workflow: StaticAgentWorkflowDefinition<LeafOnlyTask, never, never> = {
    name: StaticAgentWorkflowName.CortexFullGarbageCollection,
    version: 'leaf-only-test',
    entry: LeafOnlyTask.Inspect,
    taskNames: [LeafOnlyTask.Inspect],
    agentNames: [],
    joinNames: [],
    agents: {},
    tasks: {
      [LeafOnlyTask.Inspect]: {
        name: LeafOnlyTask.Inspect,
        execution: {
          kind: WorkflowExecutorKind.LoomLeaf,
          leaf: LoomLeafKind.VerifyGitBaseline,
        },
        completed: noTasks,
        failed: noTasks,
        resources: { read: ['git:HEAD'], write: [] },
        timeoutMs: request.timeoutMs,
      },
    },
    joins: {},
  };
  const runRoot = await mkdtemp(join(tmpdir(), 'loom-leaf-scheduler-'));
  const journalConfiguration: WorkflowJournalConfiguration = {
    runRoot,
    identity: {
      runId: 'leaf-scheduler-test',
      workflow: workflow.name,
      workflowVersion: workflow.version,
      sourceCommit: SOURCE_COMMIT,
    },
    now: () => FIXED_TIME,
  };
  const journal = new WorkflowJournal<LeafOnlyTask>(journalConfiguration);
  const runtimeConfiguration: LeafRuntimeConfiguration = { mode: request.mode };
  const runtime = new LeafOnlyRuntime(runtimeConfiguration);
  const abortController = new AbortController();
  const configuration: StaticWorkflowRunConfiguration<
    LeafOnlyTask,
    never,
    never
  > = {
    workflow,
    runtime,
    journal,
    runId: 'leaf-scheduler-test',
    sourceCommit: SOURCE_COMMIT,
    workingDirectory: process.cwd(),
    maxConcurrency: 1,
    signal: abortController.signal,
    now: () => FIXED_TIME,
  };
  return { runRoot, runtime, configuration };
}

async function createFixture(
  runtimeConfiguration: ScriptedRuntimeConfiguration,
): Promise<SchedulerFixture> {
  const runRoot = await mkdtemp(join(tmpdir(), 'loom-static-scheduler-'));
  const journalConfiguration: WorkflowJournalConfiguration = {
    runRoot,
    identity: {
      runId: 'scheduler-test',
      workflow: CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.name,
      workflowVersion: CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.version,
      sourceCommit: SOURCE_COMMIT,
    },
    now: () => FIXED_TIME,
  };
  const journal = new WorkflowJournal<CortexAuditTask>(journalConfiguration);
  const runtime = new ScriptedWorkflowRuntime(runtimeConfiguration);
  const abortController = new AbortController();
  const configuration: StaticWorkflowRunConfiguration<
    CortexAuditTask,
    CortexAuditAgent,
    CortexAuditJoin
  > = {
    workflow: CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW,
    runtime,
    journal,
    runId: 'scheduler-test',
    sourceCommit: SOURCE_COMMIT,
    workingDirectory: process.cwd(),
    maxConcurrency: 4,
    signal: abortController.signal,
    now: () => FIXED_TIME,
  };
  return { runRoot, runtime, abortController, configuration };
}

describe('static workflow scheduler', () => {
  test('rejects invalid concurrency before starting a run', async () => {
    const runtimeConfiguration: ScriptedRuntimeConfiguration = {
      failedTask: false,
    };
    const fixture = await createFixture(runtimeConfiguration);
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const invalidConfiguration: StaticWorkflowRunConfiguration<
        CortexAuditTask,
        CortexAuditAgent,
        CortexAuditJoin
      > = {
        ...fixture.configuration,
        maxConcurrency: 0,
      };
      await expect(runStaticWorkflow(invalidConfiguration)).rejects.toThrow(
        'concurrency must be an integer from 1 through 32',
      );
      expect(fixture.runtime.started).toHaveLength(0);
    } finally {
      await rm(fixture.runRoot, removeOptions);
    }
  });

  test('rejects a runner identity that differs from its journal', async () => {
    const runtimeConfiguration: ScriptedRuntimeConfiguration = {
      failedTask: false,
    };
    const fixture = await createFixture(runtimeConfiguration);
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const invalidConfiguration: StaticWorkflowRunConfiguration<
        CortexAuditTask,
        CortexAuditAgent,
        CortexAuditJoin
      > = {
        ...fixture.configuration,
        runId: 'different-run',
      };
      await expect(runStaticWorkflow(invalidConfiguration)).rejects.toThrow(
        'does not match its journal identity',
      );
      expect(fixture.runtime.started).toHaveLength(0);
    } finally {
      await rm(fixture.runRoot, removeOptions);
    }
  });

  test('runs the explicit parallel wave and releases the join once', async () => {
    const runtimeConfiguration: ScriptedRuntimeConfiguration = {
      failedTask: false,
    };
    const fixture = await createFixture(runtimeConfiguration);
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const terminal = await runStaticWorkflow(fixture.configuration);
      expect(terminal.kind).toBe(WorkflowTerminalKind.Completed);
      expect(fixture.runtime.maximumRunning).toBe(4);
      expect(fixture.runtime.started).toHaveLength(
        CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.taskNames.length,
      );
      for (const taskName of CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.taskNames) {
        expect(fixture.runtime.started).toContain(taskName);
      }
      const expectedTaskOrder = [
        ...CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW.taskNames,
      ];
      expect(terminal.taskTerminals.map((task) => task.task)).toEqual(
        expectedTaskOrder,
      );
      expect(
        terminal.taskTerminals.every(
          (task) => task.kind === TaskTerminalKind.Completed,
        ),
      ).toBe(true);
      const synthesisInputs = fixture.runtime.upstreamByTask.get(
        CortexAuditTask.SynthesizeFindings,
      );
      expect(synthesisInputs?.map((entry) => entry.task)).toEqual([
        CortexAuditTask.AuditWorkflowsAndReferences,
        CortexAuditTask.AuditDesignDocsAndProductSpecs,
        CortexAuditTask.AuditDynamicSkillsAndEntryPoints,
        CortexAuditTask.AuditRuntimeTaskAndCi,
        CortexAuditTask.MechanicalCortexAudit,
      ]);
      const mechanicalInputs = fixture.runtime.upstreamByTask.get(
        CortexAuditTask.MechanicalCortexAudit,
      );
      expect(mechanicalInputs?.map((entry) => entry.task)).toEqual([
        CortexAuditTask.ResolveBaseline,
      ]);
    } finally {
      await rm(fixture.runRoot, removeOptions);
    }
  });

  test('records unreached join successors as skipped after a failed lane', async () => {
    const runtimeConfiguration: ScriptedRuntimeConfiguration = {
      failedTask: CortexAuditTask.AuditRuntimeTaskAndCi,
    };
    const fixture = await createFixture(runtimeConfiguration);
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const terminal = await runStaticWorkflow(fixture.configuration);
      expect(terminal.kind).toBe(WorkflowTerminalKind.CompletedWithFailures);
      const synthesis = terminal.taskTerminals.find(
        (task) => task.task === CortexAuditTask.SynthesizeFindings,
      );
      const mechanical = terminal.taskTerminals.find(
        (task) => task.task === CortexAuditTask.MechanicalCortexAudit,
      );
      expect(synthesis?.kind).toBe(TaskTerminalKind.Skipped);
      expect(mechanical?.kind).toBe(TaskTerminalKind.Completed);
      expect(fixture.runtime.started).not.toContain(
        CortexAuditTask.SynthesizeFindings,
      );
    } finally {
      await rm(fixture.runRoot, removeOptions);
    }
  });

  test('drains running work without activating successors after cancellation', async () => {
    const runtimeConfiguration: ScriptedRuntimeConfiguration = {
      failedTask: false,
    };
    const fixture = await createFixture(runtimeConfiguration);
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const completion = runStaticWorkflow(fixture.configuration);
      setTimeout(() => fixture.abortController.abort(), 8);
      const terminal = await completion;
      expect(terminal.kind).toBe(WorkflowTerminalKind.Cancelled);
      expect(fixture.runtime.started).not.toContain(
        CortexAuditTask.SynthesizeFindings,
      );
      const synthesis = terminal.taskTerminals.find(
        (task) => task.task === CortexAuditTask.SynthesizeFindings,
      );
      expect(synthesis?.kind).toBe(TaskTerminalKind.Skipped);
    } finally {
      await rm(fixture.runRoot, removeOptions);
    }
  });

  test('runs a leaf-only workflow without an agent profile', async () => {
    const fixtureRequest: LeafWorkflowFixtureConfiguration = {
      mode: LeafRuntimeMode.Complete,
      timeoutMs: 1_000,
    };
    const fixture = await createLeafWorkflowFixture(fixtureRequest);
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const terminal = await runStaticWorkflow(fixture.configuration);
      expect(terminal.kind).toBe(WorkflowTerminalKind.Completed);
      expect(fixture.runtime.sawAgentProfile).toBe(false);
    } finally {
      await rm(fixture.runRoot, removeOptions);
    }
  });

  test('returns after a bounded timeout barrier and consumes a late rejection', async () => {
    const fixtureRequest: LeafWorkflowFixtureConfiguration = {
      mode: LeafRuntimeMode.RejectAfterCancellationBarrier,
      timeoutMs: 5,
    };
    const fixture = await createLeafWorkflowFixture(fixtureRequest);
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const startedAt = performance.now();
      const terminal = await runStaticWorkflow(fixture.configuration);
      const elapsedMs = performance.now() - startedAt;
      expect(elapsedMs).toBeLessThan(900);
      expect(terminal.kind).toBe(WorkflowTerminalKind.CompletedWithFailures);
      expect(terminal.taskTerminals[0]?.kind).toBe(TaskTerminalKind.TimedOut);
      await Bun.sleep(300);
    } finally {
      await rm(fixture.runRoot, removeOptions);
    }
  });
});
