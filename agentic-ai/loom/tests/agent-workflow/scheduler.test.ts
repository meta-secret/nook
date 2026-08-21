import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
  TaskTargetKind,
  TaskTerminalKind,
  WorkflowExecutorKind,
  WorkflowResultKind,
  WorkflowTerminalKind,
  MaterializedViewAuthorKind,
  MaterializedViewPresence,
  AgentAttemptParentKind,
  noTasks,
} from '../../src/agent-workflow/domain.ts';
import type { AgentAttemptEvent } from '../../src/agent-workflow/agent-events.ts';
import type {
  StaticAgentWorkflowDefinition,
  TaskTerminal,
  WorkflowTaskOutput,
} from '../../src/agent-workflow/domain.ts';
import { WorkflowEventKind } from '../../src/agent-workflow/events.ts';
import type {
  WorkflowEvent,
  WorkflowEventWithoutMetadata,
} from '../../src/agent-workflow/events.ts';
import { WorkflowJournal } from '../../src/agent-workflow/journal.ts';
import type { WorkflowJournalConfiguration } from '../../src/agent-workflow/journal.ts';
import type {
  WorkflowDependencyOutput,
  WorkflowTaskAttempt,
  WorkflowTaskInvocation,
  WorkflowTaskRuntime,
} from '../../src/agent-workflow/runtime.ts';
import type { TaskStopRequest } from '../../src/agent-workflow/runtime.ts';
import {
  TaskStopReason,
  TaskTeardownKind,
  UnconfirmedTaskTeardownError,
} from '../../src/agent-workflow/runtime.ts';
import { runStaticWorkflow } from '../../src/agent-workflow/scheduler.ts';
import type { StaticWorkflowRunConfiguration } from '../../src/agent-workflow/scheduler.ts';
import {
  createSchedulerFixture as createFixture,
  type ScriptedRuntimeConfiguration,
} from './scheduler-fixture.ts';

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const FIXED_TIME = '2026-08-14T05:00:00.000Z';

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
  readonly stopReasons: TaskStopReason[] = [];

  constructor(configuration: LeafRuntimeConfiguration) {
    this.mode = configuration.mode;
  }

  start(
    invocation: WorkflowTaskInvocation<LeafOnlyTask, never>,
  ): WorkflowTaskAttempt<LeafOnlyTask> {
    const completion = this.execute(invocation);
    const attempt = confirmedAttempt(completion);
    return {
      completion,
      stop: async (request: TaskStopRequest) => {
        this.stopReasons.push(request.reason);
        return attempt.stop(request);
      },
    };
  }

  private async execute(
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
      materializedViewMarkdown: '# Leaf\n\nCompleted.',
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

function confirmedAttempt<TTask extends string>(
  completion: Promise<TaskTerminal<TTask>>,
): WorkflowTaskAttempt<TTask> {
  return {
    completion,
    stop: async (_request: TaskStopRequest) => {
      await completion.catch(() => false);
      return { kind: TaskTeardownKind.Confirmed };
    },
  };
}

enum TeardownDrainTask {
  Entry = 'entry',
  Unsafe = 'unsafe',
  Sibling = 'sibling',
}

class TeardownDrainRuntime implements WorkflowTaskRuntime<
  TeardownDrainTask,
  never
> {
  siblingDrained = false;
  readonly stopReasons = new Map<TeardownDrainTask, TaskStopReason>();

  start(
    invocation: WorkflowTaskInvocation<TeardownDrainTask, never>,
  ): WorkflowTaskAttempt<TeardownDrainTask> {
    if (invocation.task === TeardownDrainTask.Entry) {
      return confirmedAttempt(Promise.resolve(completedDrainTask(invocation)));
    }
    const completion = new Promise<TaskTerminal<TeardownDrainTask>>(() => {});
    return {
      completion,
      stop: async (request: TaskStopRequest) => {
        this.stopReasons.set(invocation.task, request.reason);
        if (invocation.task === TeardownDrainTask.Unsafe) {
          throw new UnconfirmedTaskTeardownError(invocation.task);
        }
        await Bun.sleep(25);
        this.siblingDrained = true;
        return { kind: TaskTeardownKind.Confirmed };
      },
    };
  }
}

function completedDrainTask(
  invocation: WorkflowTaskInvocation<TeardownDrainTask, never>,
): TaskTerminal<TeardownDrainTask> {
  const output: WorkflowTaskOutput = {
    resultKind: WorkflowResultKind.LoomLeafEvidence,
    summary: `${invocation.task} completed.`,
    materializedViewMarkdown: `# ${invocation.task}\n\nCompleted.`,
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

async function createTeardownDrainFixture(): Promise<{
  readonly runRoot: string;
  readonly runtime: TeardownDrainRuntime;
  readonly configuration: StaticWorkflowRunConfiguration<
    TeardownDrainTask,
    never,
    never
  >;
}> {
  const workflow: StaticAgentWorkflowDefinition<
    TeardownDrainTask,
    never,
    never
  > = {
    name: StaticAgentWorkflowName.CortexFullGarbageCollection,
    version: 'teardown-drain-test',
    entry: TeardownDrainTask.Entry,
    materializedViewTask: TeardownDrainTask.Sibling,
    taskNames: [
      TeardownDrainTask.Entry,
      TeardownDrainTask.Unsafe,
      TeardownDrainTask.Sibling,
    ],
    agentNames: [],
    joinNames: [],
    agents: {},
    tasks: {
      [TeardownDrainTask.Entry]: {
        name: TeardownDrainTask.Entry,
        execution: {
          kind: WorkflowExecutorKind.LoomLeaf,
          leaf: LoomLeafKind.VerifyGitBaseline,
        },
        completed: {
          kind: TaskTargetKind.Parallel,
          tasks: [TeardownDrainTask.Unsafe, TeardownDrainTask.Sibling],
        },
        failed: noTasks,
        resources: { read: ['git:HEAD'], write: [] },
        timeoutMs: 1_000,
      },
      [TeardownDrainTask.Unsafe]: {
        name: TeardownDrainTask.Unsafe,
        execution: {
          kind: WorkflowExecutorKind.LoomLeaf,
          leaf: LoomLeafKind.VerifyGitBaseline,
        },
        completed: noTasks,
        failed: noTasks,
        resources: { read: ['git:HEAD'], write: [] },
        timeoutMs: 5,
      },
      [TeardownDrainTask.Sibling]: {
        name: TeardownDrainTask.Sibling,
        execution: {
          kind: WorkflowExecutorKind.LoomLeaf,
          leaf: LoomLeafKind.VerifyGitBaseline,
        },
        completed: noTasks,
        failed: noTasks,
        resources: { read: ['git:HEAD'], write: [] },
        timeoutMs: 60_000,
      },
    },
    joins: {},
  };
  const runRoot = await mkdtemp(join(tmpdir(), 'loom-teardown-drain-'));
  const journalConfiguration: WorkflowJournalConfiguration = {
    runRoot,
    identity: {
      runId: 'teardown-drain-test',
      workflow: workflow.name,
      workflowVersion: workflow.version,
      sourceCommit: SOURCE_COMMIT,
    },
    now: () => FIXED_TIME,
  };
  const journal = new WorkflowJournal<TeardownDrainTask>(journalConfiguration);
  const runtime = new TeardownDrainRuntime();
  const abortController = new AbortController();
  const configuration: StaticWorkflowRunConfiguration<
    TeardownDrainTask,
    never,
    never
  > = {
    workflow,
    runtime,
    journal,
    runId: 'teardown-drain-test',
    sourceCommit: SOURCE_COMMIT,
    workingDirectory: process.cwd(),
    maxConcurrency: 2,
    signal: abortController.signal,
    now: () => FIXED_TIME,
  };
  return { runRoot, runtime, configuration };
}

enum CancellationRaceTask {
  Entry = 'entry',
  Successor = 'successor',
}

enum CancellationRaceOrdering {
  BeforeActivationLease = 'before-activation-lease',
  DuringActivationLease = 'during-activation-lease',
}

type CancellationRaceJournalConfiguration = WorkflowJournalConfiguration & {
  readonly abortController: AbortController;
  readonly ordering: CancellationRaceOrdering;
};

class CancellationRaceJournal extends WorkflowJournal<CancellationRaceTask> {
  readonly abortController: AbortController;
  readonly ordering: CancellationRaceOrdering;
  cancellationTriggered = false;

  constructor(configuration: CancellationRaceJournalConfiguration) {
    super(configuration);
    this.abortController = configuration.abortController;
    this.ordering = configuration.ordering;
  }

  override async append(
    event: WorkflowEventWithoutMetadata<CancellationRaceTask>,
  ): Promise<WorkflowEvent<CancellationRaceTask>> {
    if (this.shouldCancel(event)) {
      this.cancellationTriggered = true;
      this.abortController.abort();
    }
    return super.append(event);
  }

  private shouldCancel(
    event: WorkflowEventWithoutMetadata<CancellationRaceTask>,
  ): boolean {
    if (this.cancellationTriggered) return false;
    if (
      this.ordering === CancellationRaceOrdering.BeforeActivationLease &&
      event.kind === WorkflowEventKind.TaskTerminalRecorded
    ) {
      return event.task === CancellationRaceTask.Entry;
    }
    return (
      this.ordering === CancellationRaceOrdering.DuringActivationLease &&
      event.kind === WorkflowEventKind.TaskEligible &&
      event.task === CancellationRaceTask.Successor
    );
  }
}

class CancellationRaceRuntime implements WorkflowTaskRuntime<
  CancellationRaceTask,
  never
> {
  readonly started: CancellationRaceTask[] = [];

  start(
    invocation: WorkflowTaskInvocation<CancellationRaceTask, never>,
  ): WorkflowTaskAttempt<CancellationRaceTask> {
    this.started.push(invocation.task);
    return confirmedAttempt(
      Promise.resolve(completedCancellationRaceTask(invocation)),
    );
  }
}

function completedCancellationRaceTask(
  invocation: WorkflowTaskInvocation<CancellationRaceTask, never>,
): TaskTerminal<CancellationRaceTask> {
  const output: WorkflowTaskOutput = {
    resultKind: WorkflowResultKind.LoomLeafEvidence,
    summary: `${invocation.task} completed.`,
    materializedViewMarkdown: `# ${invocation.task}\n\nCompleted.`,
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

async function createCancellationRaceFixture(
  ordering: CancellationRaceOrdering,
): Promise<{
  readonly runRoot: string;
  readonly runtime: CancellationRaceRuntime;
  readonly configuration: StaticWorkflowRunConfiguration<
    CancellationRaceTask,
    never,
    never
  >;
}> {
  const workflow: StaticAgentWorkflowDefinition<
    CancellationRaceTask,
    never,
    never
  > = {
    name: StaticAgentWorkflowName.CortexFullGarbageCollection,
    version: `cancellation-race-${ordering}`,
    entry: CancellationRaceTask.Entry,
    materializedViewTask: CancellationRaceTask.Successor,
    taskNames: [CancellationRaceTask.Entry, CancellationRaceTask.Successor],
    agentNames: [],
    joinNames: [],
    agents: {},
    tasks: {
      [CancellationRaceTask.Entry]: {
        name: CancellationRaceTask.Entry,
        execution: {
          kind: WorkflowExecutorKind.LoomLeaf,
          leaf: LoomLeafKind.VerifyGitBaseline,
        },
        completed: {
          kind: TaskTargetKind.Task,
          task: CancellationRaceTask.Successor,
        },
        failed: noTasks,
        resources: { read: ['git:HEAD'], write: [] },
        timeoutMs: 1_000,
      },
      [CancellationRaceTask.Successor]: {
        name: CancellationRaceTask.Successor,
        execution: {
          kind: WorkflowExecutorKind.LoomLeaf,
          leaf: LoomLeafKind.VerifyGitBaseline,
        },
        completed: noTasks,
        failed: noTasks,
        resources: { read: ['git:HEAD'], write: [] },
        timeoutMs: 1_000,
      },
    },
    joins: {},
  };
  const runRoot = await mkdtemp(join(tmpdir(), 'loom-cancellation-race-'));
  const abortController = new AbortController();
  const journalConfiguration: CancellationRaceJournalConfiguration = {
    runRoot,
    identity: {
      runId: `cancellation-race-${ordering}`,
      workflow: workflow.name,
      workflowVersion: workflow.version,
      sourceCommit: SOURCE_COMMIT,
    },
    now: () => FIXED_TIME,
    abortController,
    ordering,
  };
  const journal = new CancellationRaceJournal(journalConfiguration);
  const runtime = new CancellationRaceRuntime();
  const configuration: StaticWorkflowRunConfiguration<
    CancellationRaceTask,
    never,
    never
  > = {
    workflow,
    runtime,
    journal,
    runId: journalConfiguration.identity.runId,
    sourceCommit: SOURCE_COMMIT,
    workingDirectory: process.cwd(),
    maxConcurrency: 1,
    signal: abortController.signal,
    now: () => FIXED_TIME,
  };
  return { runRoot, runtime, configuration };
}

type LeafWorkflowFixtureConfiguration = {
  readonly mode: LeafRuntimeMode;
  readonly timeoutMs: number;
};

type LeafWorkflowFixture = {
  readonly runRoot: string;
  readonly runtime: LeafOnlyRuntime;
  readonly abortController: AbortController;
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
    materializedViewTask: LeafOnlyTask.Inspect,
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
  return { runRoot, runtime, abortController, configuration };
}

describe('static workflow scheduler', () => {
  test('rejects invalid concurrency before starting a run', async () => {
    const runtimeConfiguration: ScriptedRuntimeConfiguration = {
      failedTask: false,
      tamperResultArtifactDuringSynthesis: false,
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
      tamperResultArtifactDuringSynthesis: false,
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
      tamperResultArtifactDuringSynthesis: false,
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
      expect(
        synthesisInputs?.every(
          (entry) => entry.view.presence === MaterializedViewPresence.Recorded,
        ),
      ).toBe(true);
      expect(
        synthesisInputs?.every(
          (entry) =>
            entry.resultArtifact.location.startsWith(
              fixture.configuration.journal.runDirectory,
            ) && /^[0-9a-f]{64}$/.test(entry.resultArtifact.sha256),
        ),
      ).toBe(true);
      const journalEvents = (
        await readFile(fixture.configuration.journal.eventsPath, 'utf8')
      )
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as WorkflowEvent<CortexAuditTask>);
      expect(
        journalEvents.some(
          (event) =>
            event.kind === WorkflowEventKind.RuntimeActivity &&
            event.task === CortexAuditTask.AuditWorkflowsAndReferences,
        ),
      ).toBe(true);
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

  test('aggregates a failed lane after the all-terminal evidence barrier', async () => {
    const runtimeConfiguration: ScriptedRuntimeConfiguration = {
      failedTask: CortexAuditTask.AuditRuntimeTaskAndCi,
      tamperResultArtifactDuringSynthesis: false,
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
      expect(synthesis?.kind).toBe(TaskTerminalKind.Completed);
      expect(mechanical?.kind).toBe(TaskTerminalKind.Completed);
      expect(fixture.runtime.started).toContain(
        CortexAuditTask.SynthesizeFindings,
      );
      const synthesisInputs = fixture.runtime.upstreamByTask.get(
        CortexAuditTask.SynthesizeFindings,
      );
      const failedInput = synthesisInputs?.find(
        (entry) => entry.task === CortexAuditTask.AuditRuntimeTaskAndCi,
      );
      expect(failedInput?.terminalKind).toBe(TaskTerminalKind.Failed);
      expect(failedInput?.materializedViewMarkdown).toContain('Status: failed');
    } finally {
      await rm(fixture.runRoot, removeOptions);
    }
  });

  test('records worker attempts as children of the materializer attempt', async () => {
    const runtimeConfiguration: ScriptedRuntimeConfiguration = {
      failedTask: false,
      tamperResultArtifactDuringSynthesis: false,
    };
    const fixture = await createFixture(runtimeConfiguration);
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      await runStaticWorkflow(fixture.configuration);
      const childEventsPath = join(
        fixture.configuration.journal.runDirectory,
        'agents',
        CortexAuditTask.AuditWorkflowsAndReferences,
        'attempt-1',
        'events.jsonl',
      );
      const rootEventsPath = join(
        fixture.configuration.journal.runDirectory,
        'agents',
        CortexAuditTask.SynthesizeFindings,
        'attempt-1',
        'events.jsonl',
      );
      const childStart = JSON.parse(
        (await readFile(childEventsPath, 'utf8')).split('\n')[0] ?? '',
      ) as AgentAttemptEvent;
      const rootStart = JSON.parse(
        (await readFile(rootEventsPath, 'utf8')).split('\n')[0] ?? '',
      ) as AgentAttemptEvent;

      expect(childStart.depth).toBe(2);
      const expectedChildParent = {
        kind: AgentAttemptParentKind.AgentAttempt,
        task: CortexAuditTask.SynthesizeFindings,
        agent: CortexAuditAgent.FindingSynthesizer,
        attempt: 1,
      } as const;
      expect(childStart.parent).toEqual(expectedChildParent);
      expect(rootStart.depth).toBe(1);
      const expectedRootParent = {
        kind: AgentAttemptParentKind.WorkflowRoot,
      } as const;
      expect(rootStart.parent).toEqual(expectedRootParent);
    } finally {
      await rm(fixture.runRoot, removeOptions);
    }
  });

  test('finalizes a root failure view after dependency integrity rejection', async () => {
    const runtimeConfiguration: ScriptedRuntimeConfiguration = {
      failedTask: false,
      tamperResultArtifactDuringSynthesis: false,
    };
    const fixture = await createFixture(runtimeConfiguration);
    const removeOptions: RmOptions = { recursive: true, force: true };
    const readVerified =
      fixture.configuration.journal.readVerifiedProcessingView.bind(
        fixture.configuration.journal,
      );
    fixture.configuration.journal.readVerifiedProcessingView = async (
      processing,
    ) => {
      const projection =
        processing.view.presence === MaterializedViewPresence.Recorded
          ? processing.view.projection
          : false;
      if (
        projection &&
        projection.path.includes(
          `${CortexAuditTask.AuditWorkflowsAndReferences}/attempt-1/view.md`,
        )
      ) {
        throw new Error('simulated child projection integrity rejection');
      }
      return readVerified(processing);
    };
    try {
      const terminal = await runStaticWorkflow(fixture.configuration);
      expect(terminal.kind).toBe(WorkflowTerminalKind.CompletedWithFailures);
      expect(fixture.runtime.started).not.toContain(
        CortexAuditTask.SynthesizeFindings,
      );
      const synthesis = terminal.taskTerminals.find(
        (task) => task.task === CortexAuditTask.SynthesizeFindings,
      );
      expect(synthesis?.kind).toBe(TaskTerminalKind.Failed);
      expect(terminal.materializedView.presence).toBe(
        MaterializedViewPresence.Recorded,
      );
      if (
        terminal.materializedView.presence === MaterializedViewPresence.Recorded
      ) {
        expect(terminal.materializedView.authorKind).toBe(
          MaterializedViewAuthorKind.LoomRuntime,
        );
        const rootView = await readFile(
          join(
            fixture.configuration.journal.runDirectory,
            terminal.materializedView.projection.path,
          ),
          'utf8',
        );
        expect(rootView).toContain('did not complete');
      }
    } finally {
      await rm(fixture.runRoot, removeOptions);
    }
  });

  test('drains running work without activating successors after cancellation', async () => {
    const runtimeConfiguration: ScriptedRuntimeConfiguration = {
      failedTask: false,
      tamperResultArtifactDuringSynthesis: false,
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
      expect(terminal.materializedView.presence).toBe(
        MaterializedViewPresence.Recorded,
      );
      if (
        terminal.materializedView.presence === MaterializedViewPresence.Recorded
      ) {
        expect(terminal.materializedView.authorKind).toBe(
          MaterializedViewAuthorKind.LoomRuntime,
        );
        const rootView = await readFile(
          join(
            fixture.configuration.journal.runDirectory,
            terminal.materializedView.projection.path,
          ),
          'utf8',
        );
        expect(rootView).toContain('Materializer task synthesize-findings');
      }
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

  test('records timeout only after the runtime confirms teardown', async () => {
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
      expect(elapsedMs).toBeGreaterThanOrEqual(450);
      expect(elapsedMs).toBeLessThan(900);
      expect(terminal.kind).toBe(WorkflowTerminalKind.CompletedWithFailures);
      expect(terminal.taskTerminals[0]?.kind).toBe(TaskTerminalKind.TimedOut);
    } finally {
      await rm(fixture.runRoot, removeOptions);
    }
  });

  test('drains active siblings before propagating unconfirmed teardown', async () => {
    const fixture = await createTeardownDrainFixture();
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      await expect(runStaticWorkflow(fixture.configuration)).rejects.toThrow(
        UnconfirmedTaskTeardownError,
      );
      expect(fixture.runtime.siblingDrained).toBe(true);
      expect(fixture.runtime.stopReasons).toEqual(
        new Map([
          [TeardownDrainTask.Unsafe, TaskStopReason.Timeout],
          [TeardownDrainTask.Sibling, TaskStopReason.WorkflowCancellation],
        ]),
      );
      const events = await readFile(
        fixture.configuration.journal.eventsPath,
        'utf8',
      );
      expect(events).not.toContain('"kind":"workflow-terminal-recorded"');
      expect(events).not.toContain(
        '"task":"unsafe","attempt":1,"terminalKind"',
      );
    } finally {
      await rm(fixture.runRoot, removeOptions);
    }
  });

  test('publishes no activation when cancellation wins before the lease', async () => {
    const fixture = await createCancellationRaceFixture(
      CancellationRaceOrdering.BeforeActivationLease,
    );
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const terminal = await runStaticWorkflow(fixture.configuration);
      expect(terminal.kind).toBe(WorkflowTerminalKind.Cancelled);
      expect(fixture.runtime.started).toEqual([CancellationRaceTask.Entry]);
      const events = await readFile(
        fixture.configuration.journal.eventsPath,
        'utf8',
      );
      expect(events).not.toContain('"kind":"task-eligible","task":"successor"');
      expect(events).not.toContain(
        '"kind":"successors-activated","sourceTask":"entry"',
      );
    } finally {
      await rm(fixture.runRoot, removeOptions);
    }
  });

  test('finishes leased activation before observing concurrent cancellation', async () => {
    const fixture = await createCancellationRaceFixture(
      CancellationRaceOrdering.DuringActivationLease,
    );
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const terminal = await runStaticWorkflow(fixture.configuration);
      expect(terminal.kind).toBe(WorkflowTerminalKind.Cancelled);
      expect(fixture.runtime.started).toEqual([CancellationRaceTask.Entry]);
      const events = await readFile(
        fixture.configuration.journal.eventsPath,
        'utf8',
      );
      expect(events).toContain('"kind":"task-eligible","task":"successor"');
      expect(events).toContain(
        '"kind":"successors-activated","sourceTask":"entry","activatedTasks":["successor"]',
      );
    } finally {
      await rm(fixture.runRoot, removeOptions);
    }
  });

  test('stops running work immediately when the workflow is cancelled', async () => {
    const fixtureRequest: LeafWorkflowFixtureConfiguration = {
      mode: LeafRuntimeMode.RejectAfterCancellationBarrier,
      timeoutMs: 60_000,
    };
    const fixture = await createLeafWorkflowFixture(fixtureRequest);
    const removeOptions: RmOptions = { recursive: true, force: true };
    try {
      const startedAt = performance.now();
      const completion = runStaticWorkflow(fixture.configuration);
      setTimeout(() => fixture.abortController.abort(), 5);
      const terminal = await completion;
      const elapsedMs = performance.now() - startedAt;
      expect(elapsedMs).toBeLessThan(900);
      expect(terminal.kind).toBe(WorkflowTerminalKind.Cancelled);
      expect(terminal.taskTerminals[0]?.kind).toBe(TaskTerminalKind.Cancelled);
      expect(fixture.runtime.stopReasons).toEqual([
        TaskStopReason.WorkflowCancellation,
      ]);
    } finally {
      await rm(fixture.runRoot, removeOptions);
    }
  });
});
