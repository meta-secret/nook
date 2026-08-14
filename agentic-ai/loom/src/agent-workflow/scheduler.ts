import {
  TaskTargetKind,
  TaskTerminalKind,
  WorkflowExecutorKind,
  WorkflowTerminalKind,
} from './domain.ts';
import { WorkflowEventKind } from './events.ts';
import type {
  AgentProfile,
  GitCommit,
  StaticAgentWorkflowDefinition,
  StaticTaskDefinition,
  TaskOutcomeTarget,
  TaskTerminal,
  WorkflowRunId,
  WorkflowRunTerminal,
  WorkflowTaskOutput,
} from './domain.ts';
import type { WorkflowEventWithoutMetadata } from './events.ts';
import { WorkflowJournal } from './journal.ts';
import { TaskStopReason, UnconfirmedTaskTeardownError } from './runtime.ts';
import type {
  AgentWorkflowTaskInvocation,
  LoomLeafWorkflowTaskInvocation,
  WorkflowDependencyOutput,
  WorkflowTaskInvocation,
  WorkflowTaskRuntime,
} from './runtime.ts';
import {
  validateStaticAgentWorkflow,
  WorkflowValidationStatus,
} from './validation.ts';

export type StaticWorkflowRunConfiguration<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
> = {
  readonly workflow: StaticAgentWorkflowDefinition<TTask, TAgent, TJoin>;
  readonly runtime: WorkflowTaskRuntime<TTask, TAgent>;
  readonly journal: WorkflowJournal<TTask>;
  readonly runId: WorkflowRunId;
  readonly sourceCommit: GitCommit;
  readonly workingDirectory: string;
  readonly maxConcurrency: number;
  readonly signal: AbortSignal;
  readonly now: () => string;
};

type TaskExecutionContext<TTask extends string, TAgent extends string> = {
  readonly task: StaticTaskDefinition<TTask, TAgent, string>;
  readonly agentProfile: AgentProfile<TAgent> | false;
  readonly runtime: WorkflowTaskRuntime<TTask, TAgent>;
  readonly runId: WorkflowRunId;
  readonly sourceCommit: GitCommit;
  readonly workingDirectory: string;
  readonly upstreamOutputs: readonly WorkflowDependencyOutput<TTask>[];
  readonly signal: AbortSignal;
  readonly journal: WorkflowJournal<TTask>;
};

export async function runStaticWorkflow<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
>(
  configuration: StaticWorkflowRunConfiguration<TTask, TAgent, TJoin>,
): Promise<WorkflowRunTerminal<TTask>> {
  const validation = validateStaticAgentWorkflow(configuration.workflow);
  if (validation.status === WorkflowValidationStatus.Invalid) {
    throw new Error(
      `Static workflow is invalid: ${JSON.stringify(validation.issues)}`,
    );
  }
  if (
    !Number.isSafeInteger(configuration.maxConcurrency) ||
    configuration.maxConcurrency < 1 ||
    configuration.maxConcurrency > 32
  ) {
    throw new Error(
      'Static workflow concurrency must be an integer from 1 through 32.',
    );
  }
  if (
    configuration.journal.identity.runId !== configuration.runId ||
    configuration.journal.identity.workflow !== configuration.workflow.name ||
    configuration.journal.identity.workflowVersion !==
      configuration.workflow.version ||
    configuration.journal.identity.sourceCommit !== configuration.sourceCommit
  ) {
    throw new Error(
      'Static workflow configuration does not match its journal identity.',
    );
  }
  await configuration.journal.initialize();
  const startedAt = configuration.now();
  const startedEvent: WorkflowEventWithoutMetadata<TTask> = {
    kind: WorkflowEventKind.WorkflowStarted,
    entry: configuration.workflow.entry,
  };
  await configuration.journal.append(startedEvent);

  const eligible: TTask[] = [];
  const scheduled = new Set<TTask>();
  const completedOutputs = new Map<TTask, WorkflowTaskOutput>();
  const terminals = new Map<TTask, TaskTerminal<TTask>>();
  const joinArrivals = new Map<TJoin, Set<TTask>>();
  const dependencyTasks = new Map<TTask, readonly TTask[]>();
  const running: RunningTask<TTask>[] = [];
  const cancellationGate = new WorkflowCancellationGate(configuration.signal);
  const entryEligibility: EligibilityOperation<TTask> = {
    tasks: [configuration.workflow.entry],
    eligible,
    scheduled,
    dependencyTasks,
    upstreamTasks: [],
    journal: configuration.journal,
  };

  try {
    await makeEligible(entryEligibility);
    while (eligible.length > 0 || running.length > 0) {
      while (
        !cancellationGate.signal.aborted &&
        eligible.length > 0 &&
        running.length < configuration.maxConcurrency
      ) {
        const taskName = eligible.shift();
        if (!taskName) {
          break;
        }
        const task = configuration.workflow.tasks[taskName];
        const agentResolution: AgentResolution<TTask, TAgent, TJoin> = {
          workflow: configuration.workflow,
          task,
        };
        const upstreamOutputs: WorkflowDependencyOutput<TTask>[] = [];
        for (const upstreamTask of dependencyTasks.get(taskName) ?? []) {
          const output = completedOutputs.get(upstreamTask);
          if (output) {
            const dependencyOutput: WorkflowDependencyOutput<TTask> = {
              task: upstreamTask,
              output,
            };
            upstreamOutputs.push(dependencyOutput);
          }
        }
        const executionContext: TaskExecutionContext<TTask, TAgent> = {
          task: task as StaticTaskDefinition<TTask, TAgent, string>,
          agentProfile: resolveAgentProfile(agentResolution),
          runtime: configuration.runtime,
          runId: configuration.runId,
          sourceCommit: configuration.sourceCommit,
          workingDirectory: configuration.workingDirectory,
          upstreamOutputs,
          signal: cancellationGate.signal,
          journal: configuration.journal,
        };
        const runningTask: RunningTask<TTask> = {
          task: taskName,
          completion: executeTask(executionContext),
        };
        running.push(runningTask);
      }
      if (running.length === 0) {
        break;
      }
      const settled = await waitForFirstCompletion(running);
      const runningIndex = running.findIndex(
        (entry) => entry.task === settled.task,
      );
      running.splice(runningIndex, 1);
      const terminal = settled.terminal;
      terminals.set(terminal.task, terminal);
      if (terminal.kind === TaskTerminalKind.Completed) {
        completedOutputs.set(terminal.task, terminal.output);
      }
      let activated: ActivatedTargets<TTask, TJoin> = { tasks: [], joins: [] };
      const activationLease = cancellationGate.acquireActivationLease();
      if (activationLease) {
        try {
          const definition = configuration.workflow.tasks[terminal.task];
          const target =
            terminal.kind === TaskTerminalKind.Completed
              ? definition.completed
              : definition.failed;
          const targetActivation: TargetActivation<TTask, TAgent, TJoin> = {
            sourceTask: terminal.task,
            dependencyTasks: [terminal.task],
            target,
            workflow: configuration.workflow,
            eligible,
            scheduled,
            joinArrivals,
            taskDependencies: dependencyTasks,
            journal: configuration.journal,
          };
          activated = await activateTarget(targetActivation);
          const activationEvent: WorkflowEventWithoutMetadata<TTask> = {
            kind: WorkflowEventKind.SuccessorsActivated,
            sourceTask: terminal.task,
            activatedTasks: activated.tasks,
            arrivedJoins: activated.joins,
          };
          await configuration.journal.append(activationEvent);
        } finally {
          activationLease.release();
        }
      }
    }
  } catch (error) {
    cancellationGate.cancel();
    await drainRunningTasks(running);
    throw error;
  } finally {
    cancellationGate.dispose();
  }

  for (const taskName of configuration.workflow.taskNames) {
    if (terminals.has(taskName)) {
      continue;
    }
    const skippedTerminal: TaskTerminal<TTask> = {
      kind: TaskTerminalKind.Skipped,
      task: taskName,
      attempt: 0,
      summary: configuration.signal.aborted
        ? 'Workflow cancellation prevented this task from starting.'
        : 'No completed or failed route reached this declared task.',
    };
    terminals.set(taskName, skippedTerminal);
    const projection =
      await configuration.journal.projectTaskTerminal(skippedTerminal);
    const skippedEvent: WorkflowEventWithoutMetadata<TTask> = {
      kind: WorkflowEventKind.TaskTerminalRecorded,
      task: taskName,
      attempt: 0,
      terminalKind: TaskTerminalKind.Skipped,
      resultPath: projection.path,
      resultSha256: projection.sha256,
    };
    await configuration.journal.append(skippedEvent);
  }

  const orderedTerminals = configuration.workflow.taskNames.flatMap(
    (taskName) => {
      const terminal = terminals.get(taskName);
      return terminal ? [terminal] : [];
    },
  );
  const terminalResolution: TerminalResolution<TTask> = {
    cancelled: configuration.signal.aborted,
    terminals: orderedTerminals,
  };
  const terminalKind = resolveWorkflowTerminalKind(terminalResolution);
  const runTerminal: WorkflowRunTerminal<TTask> = {
    kind: terminalKind,
    runId: configuration.runId,
    workflow: configuration.workflow.name,
    version: configuration.workflow.version,
    sourceCommit: configuration.sourceCommit,
    taskTerminals: orderedTerminals,
    startedAt,
    finishedAt: configuration.now(),
  };
  const projection =
    await configuration.journal.projectWorkflowTerminal(runTerminal);
  const terminalEvent: WorkflowEventWithoutMetadata<TTask> = {
    kind: WorkflowEventKind.WorkflowTerminalRecorded,
    terminalKind,
    resultPath: projection.path,
    resultSha256: projection.sha256,
  };
  await configuration.journal.append(terminalEvent);
  return runTerminal;
}

type EligibilityOperation<TTask extends string> = {
  readonly tasks: readonly TTask[];
  readonly eligible: TTask[];
  readonly scheduled: Set<TTask>;
  readonly dependencyTasks: Map<TTask, readonly TTask[]>;
  readonly upstreamTasks: readonly TTask[];
  readonly journal: WorkflowJournal<TTask>;
};

type ActivationLease = {
  readonly release: () => void;
};

// Acquiring this lease is the activation transaction's linearization point.
// Earlier cancellation publishes nothing; later cancellation waits for the
// complete TaskEligible and SuccessorsActivated journal transaction.
class WorkflowCancellationGate {
  readonly sourceSignal: AbortSignal;
  readonly controller = new AbortController();
  private activationInProgress = false;
  private cancellationPending = false;

  constructor(sourceSignal: AbortSignal) {
    this.sourceSignal = sourceSignal;
    if (sourceSignal.aborted) {
      this.controller.abort();
    } else {
      sourceSignal.addEventListener('abort', this.cancel);
    }
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  readonly cancel = (): void => {
    if (this.activationInProgress) {
      this.cancellationPending = true;
      return;
    }
    this.controller.abort();
  };

  acquireActivationLease(): ActivationLease | false {
    if (this.controller.signal.aborted || this.sourceSignal.aborted) {
      return false;
    }
    this.activationInProgress = true;
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.activationInProgress = false;
        if (this.cancellationPending || this.sourceSignal.aborted) {
          this.controller.abort();
        }
      },
    };
  }

  dispose(): void {
    this.sourceSignal.removeEventListener('abort', this.cancel);
  }
}

async function makeEligible<TTask extends string>(
  operation: EligibilityOperation<TTask>,
): Promise<void> {
  for (const task of operation.tasks) {
    if (operation.scheduled.has(task)) {
      throw new Error(`Task ${task} was scheduled more than once.`);
    }
    operation.scheduled.add(task);
    operation.dependencyTasks.set(task, operation.upstreamTasks);
    operation.eligible.push(task);
    const event: WorkflowEventWithoutMetadata<TTask> = {
      kind: WorkflowEventKind.TaskEligible,
      task,
      attempt: 1,
    };
    await operation.journal.append(event);
  }
}

type RunningTask<TTask extends string> = {
  readonly task: TTask;
  readonly completion: Promise<TaskTerminal<TTask>>;
};

type SettledTask<TTask extends string> = {
  readonly task: TTask;
  readonly terminal: TaskTerminal<TTask>;
};

async function waitForFirstCompletion<TTask extends string>(
  running: readonly RunningTask<TTask>[],
): Promise<SettledTask<TTask>> {
  const candidates = running.map(async (entry) => {
    const terminal = await entry.completion;
    const settled: SettledTask<TTask> = { task: entry.task, terminal };
    return settled;
  });
  return Promise.race(candidates);
}

async function drainRunningTasks<TTask extends string>(
  running: readonly RunningTask<TTask>[],
): Promise<void> {
  await Promise.allSettled(running.map((entry) => entry.completion));
}

type AgentResolution<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
> = {
  readonly workflow: StaticAgentWorkflowDefinition<TTask, TAgent, TJoin>;
  readonly task: StaticTaskDefinition<TTask, TAgent, TJoin>;
};

function resolveAgentProfile<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
>(
  resolution: AgentResolution<TTask, TAgent, TJoin>,
): AgentProfile<TAgent> | false {
  if (resolution.task.execution.kind === WorkflowExecutorKind.Agent) {
    return resolution.workflow.agents[resolution.task.execution.agent];
  }
  return false;
}

async function executeTask<TTask extends string, TAgent extends string>(
  context: TaskExecutionContext<TTask, TAgent>,
): Promise<TaskTerminal<TTask>> {
  const startedEvent: WorkflowEventWithoutMetadata<TTask> = {
    kind: WorkflowEventKind.TaskAttemptStarted,
    task: context.task.name,
    attempt: 1,
  };
  await context.journal.append(startedEvent);
  let acceptingActivity = true;
  const observe = async (
    observation: Parameters<
      WorkflowTaskInvocation<TTask, TAgent>['observe']
    >[0],
  ) => {
    if (!acceptingActivity) {
      return;
    }
    const event: WorkflowEventWithoutMetadata<TTask> = {
      kind: WorkflowEventKind.RuntimeActivity,
      task: context.task.name,
      attempt: 1,
      activity: observation.activity,
      detail: observation.detail,
    };
    await context.journal.append(event);
  };
  const taskController = new AbortController();
  const forwardCancellation = (): void => taskController.abort();
  if (context.signal.aborted) {
    taskController.abort();
  } else {
    context.signal.addEventListener('abort', forwardCancellation);
  }
  let invocation: WorkflowTaskInvocation<TTask, TAgent>;
  if (context.task.execution.kind === WorkflowExecutorKind.Agent) {
    if (!context.agentProfile) {
      throw new Error(
        `Agent task ${context.task.name} has no validated agent profile.`,
      );
    }
    const agentInvocation: AgentWorkflowTaskInvocation<TTask, TAgent> = {
      task: context.task.name,
      attempt: 1,
      execution: context.task.execution,
      agentProfile: context.agentProfile,
      sourceCommit: context.sourceCommit,
      runId: context.runId,
      workingDirectory: context.workingDirectory,
      upstreamOutputs: context.upstreamOutputs,
      signal: taskController.signal,
      observe,
    };
    invocation = agentInvocation;
  } else {
    const leafInvocation: LoomLeafWorkflowTaskInvocation<TTask> = {
      task: context.task.name,
      attempt: 1,
      execution: context.task.execution,
      sourceCommit: context.sourceCommit,
      runId: context.runId,
      workingDirectory: context.workingDirectory,
      upstreamOutputs: context.upstreamOutputs,
      signal: taskController.signal,
      observe,
    };
    invocation = leafInvocation;
  }
  let terminal: TaskTerminal<TTask>;
  try {
    const timedExecution: TimedExecution<TTask, TAgent> = {
      invocation,
      runtime: context.runtime,
      timeoutMs: context.task.timeoutMs,
      workflowSignal: context.signal,
      abort: () => taskController.abort(),
      cleanup: () =>
        context.signal.removeEventListener('abort', forwardCancellation),
    };
    terminal = await withTimeout(timedExecution);
  } catch (error) {
    if (error instanceof UnconfirmedTaskTeardownError) {
      throw error;
    }
    terminal = {
      kind: context.signal.aborted
        ? TaskTerminalKind.Cancelled
        : TaskTerminalKind.Failed,
      task: context.task.name,
      attempt: 1,
      summary: error instanceof Error ? error.message : 'Task runtime failed.',
    };
  } finally {
    acceptingActivity = false;
  }
  const projection = await context.journal.projectTaskTerminal(terminal);
  const terminalEvent: WorkflowEventWithoutMetadata<TTask> = {
    kind: WorkflowEventKind.TaskTerminalRecorded,
    task: terminal.task,
    attempt: terminal.attempt,
    terminalKind: terminal.kind,
    resultPath: projection.path,
    resultSha256: projection.sha256,
  };
  await context.journal.append(terminalEvent);
  return terminal;
}

type TimedExecution<TTask extends string, TAgent extends string> = {
  readonly invocation: WorkflowTaskInvocation<TTask, TAgent>;
  readonly runtime: WorkflowTaskRuntime<TTask, TAgent>;
  readonly timeoutMs: number;
  readonly workflowSignal: AbortSignal;
  readonly abort: () => void;
  readonly cleanup: () => void;
};

async function withTimeout<TTask extends string, TAgent extends string>(
  execution: TimedExecution<TTask, TAgent>,
): Promise<TaskTerminal<TTask>> {
  const timeoutControl = createTimeout(execution);
  const cancellationControl = createWorkflowCancellation(execution);
  const attempt = execution.runtime.start(execution.invocation);
  const runtimeCompletion = attempt.completion;
  void runtimeCompletion.catch(() => false);
  try {
    const terminal = await Promise.race([
      runtimeCompletion,
      timeoutControl.terminal,
      cancellationControl.terminal,
    ]);
    if (
      terminal.kind === TaskTerminalKind.TimedOut ||
      terminal.kind === TaskTerminalKind.Cancelled
    ) {
      const stopRequest = {
        reason:
          terminal.kind === TaskTerminalKind.TimedOut
            ? TaskStopReason.Timeout
            : TaskStopReason.WorkflowCancellation,
        hardDeadlineMs: TASK_TEARDOWN_HARD_DEADLINE_MS,
      } as const;
      await attempt.stop(stopRequest);
    }
    return terminal;
  } finally {
    timeoutControl.cancel();
    cancellationControl.cancel();
    execution.cleanup();
  }
}

type CancellationControl<TTask extends string> = {
  readonly terminal: Promise<TaskTerminal<TTask>>;
  readonly cancel: () => void;
};

function createWorkflowCancellation<
  TTask extends string,
  TAgent extends string,
>(execution: TimedExecution<TTask, TAgent>): CancellationControl<TTask> {
  let resolveCancellation: (terminal: TaskTerminal<TTask>) => void = () => {};
  const terminal = new Promise<TaskTerminal<TTask>>((resolve) => {
    resolveCancellation = resolve;
  });
  const cancelTask = (): void => {
    execution.abort();
    const cancelled: TaskTerminal<TTask> = {
      kind: TaskTerminalKind.Cancelled,
      task: execution.invocation.task,
      attempt: execution.invocation.attempt,
      summary: 'Workflow cancellation stopped this task.',
    };
    resolveCancellation(cancelled);
  };
  if (execution.workflowSignal.aborted) {
    cancelTask();
  } else {
    const listenerOptions: AddEventListenerOptions = { once: true };
    execution.workflowSignal.addEventListener(
      'abort',
      cancelTask,
      listenerOptions,
    );
  }
  return {
    terminal,
    cancel: () =>
      execution.workflowSignal.removeEventListener('abort', cancelTask),
  };
}

const TASK_TEARDOWN_HARD_DEADLINE_MS = 10_000;

type TimeoutControl<TTask extends string> = {
  readonly terminal: Promise<TaskTerminal<TTask>>;
  readonly cancel: () => void;
};

function createTimeout<TTask extends string, TAgent extends string>(
  execution: TimedExecution<TTask, TAgent>,
): TimeoutControl<TTask> {
  type TimerHandle = ReturnType<typeof setTimeout> | false;
  const timer: { handle: TimerHandle } = { handle: false };
  const terminal = new Promise<TaskTerminal<TTask>>((resolve) => {
    timer.handle = setTimeout(() => {
      execution.abort();
      const timedOut: TaskTerminal<TTask> = {
        kind: TaskTerminalKind.TimedOut,
        task: execution.invocation.task,
        attempt: execution.invocation.attempt,
        summary: `Task exceeded ${execution.timeoutMs}ms.`,
      };
      resolve(timedOut);
    }, execution.timeoutMs);
  });
  return {
    terminal,
    cancel: () => {
      if (timer.handle) {
        clearTimeout(timer.handle);
      }
    },
  };
}

type TargetActivation<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
> = {
  readonly sourceTask: TTask;
  readonly dependencyTasks: readonly TTask[];
  readonly target: TaskOutcomeTarget<TTask, TJoin>;
  readonly workflow: StaticAgentWorkflowDefinition<TTask, TAgent, TJoin>;
  readonly eligible: TTask[];
  readonly scheduled: Set<TTask>;
  readonly joinArrivals: Map<TJoin, Set<TTask>>;
  readonly taskDependencies: Map<TTask, readonly TTask[]>;
  readonly journal: WorkflowJournal<TTask>;
};

type ActivatedTargets<TTask extends string, TJoin extends string> = {
  readonly tasks: readonly TTask[];
  readonly joins: readonly TJoin[];
};

async function activateTarget<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
>(
  activation: TargetActivation<TTask, TAgent, TJoin>,
): Promise<ActivatedTargets<TTask, TJoin>> {
  if (activation.target.kind === TaskTargetKind.None) {
    return { tasks: [], joins: [] };
  }
  if (activation.target.kind === TaskTargetKind.Task) {
    const eligibility: EligibilityOperation<TTask> = {
      tasks: [activation.target.task],
      eligible: activation.eligible,
      scheduled: activation.scheduled,
      dependencyTasks: activation.taskDependencies,
      upstreamTasks: activation.dependencyTasks,
      journal: activation.journal,
    };
    await makeEligible(eligibility);
    return { tasks: [activation.target.task], joins: [] };
  }
  if (activation.target.kind === TaskTargetKind.Parallel) {
    const eligibility: EligibilityOperation<TTask> = {
      tasks: activation.target.tasks,
      eligible: activation.eligible,
      scheduled: activation.scheduled,
      dependencyTasks: activation.taskDependencies,
      upstreamTasks: activation.dependencyTasks,
      journal: activation.journal,
    };
    await makeEligible(eligibility);
    return { tasks: activation.target.tasks, joins: [] };
  }
  const join = activation.workflow.joins[activation.target.join];
  const arrivals = activation.joinArrivals.get(join.name) ?? new Set<TTask>();
  arrivals.add(activation.sourceTask);
  activation.joinArrivals.set(join.name, arrivals);
  if (arrivals.size !== join.arrivals.length) {
    return { tasks: [], joins: [join.name] };
  }
  const joinedActivation: TargetActivation<TTask, TAgent, TJoin> = {
    ...activation,
    dependencyTasks: join.arrivals,
    target: join.completed,
  };
  const joined = await activateTarget(joinedActivation);
  return { tasks: joined.tasks, joins: [join.name, ...joined.joins] };
}

type TerminalResolution<TTask extends string> = {
  readonly cancelled: boolean;
  readonly terminals: readonly TaskTerminal<TTask>[];
};

function resolveWorkflowTerminalKind<TTask extends string>(
  resolution: TerminalResolution<TTask>,
): WorkflowTerminalKind {
  if (resolution.cancelled) {
    return WorkflowTerminalKind.Cancelled;
  }
  if (
    resolution.terminals.some(
      (terminal) =>
        terminal.kind !== TaskTerminalKind.Completed &&
        terminal.kind !== TaskTerminalKind.Skipped,
    )
  ) {
    return WorkflowTerminalKind.CompletedWithFailures;
  }
  return WorkflowTerminalKind.Completed;
}
