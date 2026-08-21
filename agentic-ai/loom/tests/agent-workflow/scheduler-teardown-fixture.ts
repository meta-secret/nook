import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  JoinCompletionPolicy,
  LoomLeafKind,
  StaticAgentWorkflowName,
  TaskTargetKind,
  TaskTerminalKind,
  WorkflowExecutorKind,
  WorkflowResultKind,
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
  WorkflowTaskAttempt,
  WorkflowTaskInvocation,
  WorkflowTaskRuntime,
} from '../../src/agent-workflow/runtime.ts';
import {
  TaskStopReason,
  TaskTeardownKind,
  UnconfirmedTaskTeardownError,
} from '../../src/agent-workflow/runtime.ts';
import type { StaticWorkflowRunConfiguration } from '../../src/agent-workflow/scheduler.ts';

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const FIXED_TIME = '2026-08-14T05:00:00.000Z';

export enum TeardownDrainTask {
  Entry = 'entry',
  Unsafe = 'unsafe',
  Sibling = 'sibling',
  Materialize = 'materialize',
}

enum TeardownDrainJoin {
  WorkersStopped = 'workers-stopped',
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
      const completion = Promise.resolve(completedDrainTask(invocation));
      return confirmedAttempt(completion);
    }
    const completion = new Promise<TaskTerminal<TeardownDrainTask>>(() => {});
    return {
      completion,
      stop: async (request) => {
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

function confirmedAttempt<TTask extends string>(
  completion: Promise<TaskTerminal<TTask>>,
): WorkflowTaskAttempt<TTask> {
  return {
    completion,
    stop: async () => {
      await completion.catch(() => false);
      return { kind: TaskTeardownKind.Confirmed };
    },
  };
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

export async function createTeardownDrainFixture(): Promise<{
  readonly runRoot: string;
  readonly runtime: TeardownDrainRuntime;
  readonly configuration: StaticWorkflowRunConfiguration<
    TeardownDrainTask,
    never,
    TeardownDrainJoin
  >;
}> {
  const workflow = teardownDrainWorkflow();
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
    TeardownDrainJoin
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

function teardownDrainWorkflow(): StaticAgentWorkflowDefinition<
  TeardownDrainTask,
  never,
  TeardownDrainJoin
> {
  const joinTarget = {
    kind: TaskTargetKind.Join,
    join: TeardownDrainJoin.WorkersStopped,
  } as const;
  const unsafeRequest: WorkerTaskRequest = {
    task: TeardownDrainTask.Unsafe,
    timeoutMs: 5,
    joinTarget,
  };
  const siblingRequest: WorkerTaskRequest = {
    task: TeardownDrainTask.Sibling,
    timeoutMs: 60_000,
    joinTarget,
  };
  return {
    name: StaticAgentWorkflowName.CortexFullGarbageCollection,
    version: 'teardown-drain-test',
    entry: TeardownDrainTask.Entry,
    materializedViewTask: TeardownDrainTask.Materialize,
    taskNames: Object.values(TeardownDrainTask),
    agentNames: [],
    joinNames: [TeardownDrainJoin.WorkersStopped],
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
      [TeardownDrainTask.Unsafe]: workerTask(unsafeRequest),
      [TeardownDrainTask.Sibling]: workerTask(siblingRequest),
      [TeardownDrainTask.Materialize]: {
        name: TeardownDrainTask.Materialize,
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
    joins: {
      [TeardownDrainJoin.WorkersStopped]: {
        name: TeardownDrainJoin.WorkersStopped,
        policy: JoinCompletionPolicy.AllTerminal,
        arrivals: [TeardownDrainTask.Unsafe, TeardownDrainTask.Sibling],
        completed: {
          kind: TaskTargetKind.Task,
          task: TeardownDrainTask.Materialize,
        },
      },
    },
  };
}

type WorkerTaskRequest = {
  readonly task: TeardownDrainTask;
  readonly timeoutMs: number;
  readonly joinTarget: {
    readonly kind: TaskTargetKind.Join;
    readonly join: TeardownDrainJoin;
  };
};

function workerTask(request: WorkerTaskRequest) {
  return {
    name: request.task,
    execution: {
      kind: WorkflowExecutorKind.LoomLeaf,
      leaf: LoomLeafKind.VerifyGitBaseline,
    },
    completed: request.joinTarget,
    failed: request.joinTarget,
    resources: { read: ['git:HEAD'], write: [] },
    timeoutMs: request.timeoutMs,
  } as const;
}
