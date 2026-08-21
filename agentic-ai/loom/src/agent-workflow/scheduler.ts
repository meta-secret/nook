import { join } from 'node:path';
import {
  TaskTargetKind,
  TaskTerminalKind,
  TaskProcessingKind,
  WorkflowExecutorKind,
  WorkflowTerminalKind,
  AgentAttemptParentKind,
  MaterializedViewPresence,
  MaterializedViewAuthorKind,
} from './domain.ts';
import { AgentAttemptJournal } from './agent-journal.ts';
import type { AgentAttemptJournalConfiguration } from './agent-journal.ts';
import { runtimeActivityEvent } from './agent-events.ts';
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
  MaterializedViewReference,
  TaskProcessingReference,
  AgentAttemptParent,
} from './domain.ts';
import type { WorkflowEventWithoutMetadata } from './events.ts';
import { WorkflowJournal } from './journal.ts';
import { TaskStopReason, UnconfirmedTaskTeardownError } from './runtime.ts';
import {
  projectWorkflowTaskProcessing,
  terminalFailureOutput,
} from './processing.ts';
import type { WorkflowTaskProcessingInput } from './processing.ts';
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
import { drainRunningTasks } from './task-drain.ts';
import type { RunningTask } from './task-drain.ts';

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
  readonly processingReferences: Map<TTask, TaskProcessingReference>;
  readonly agentJournalConfiguration: AgentAttemptJournalConfiguration | false;
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
  const dependencyOutputs = new Map<TTask, WorkflowTaskOutput>();
  const terminals = new Map<TTask, TaskTerminal<TTask>>();
  const processingReferences = new Map<TTask, TaskProcessingReference>();
  let fatalError: Error | false = false;
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
        const agentProfile = resolveAgentProfile(agentResolution);
        const agentJournalResolution: AgentJournalResolution<
          TTask,
          TAgent,
          TJoin
        > = {
          configuration,
          task,
          agentProfile,
        };
        const upstreamOutputs: WorkflowDependencyOutput<TTask>[] = [];
        let dependencyIntegrityFailure = false;
        for (const upstreamTask of dependencyTasks.get(taskName) ?? []) {
          const output = dependencyOutputs.get(upstreamTask);
          const upstreamTerminal = terminals.get(upstreamTask);
          const upstreamProcessing = processingReferences.get(upstreamTask);
          if (output && upstreamTerminal && upstreamProcessing) {
            let materializedViewMarkdown: string;
            try {
              materializedViewMarkdown =
                await configuration.journal.readVerifiedProcessingView(
                  upstreamProcessing,
                );
            } catch {
              dependencyIntegrityFailure = true;
              break;
            }
            const dependencyOutput: WorkflowDependencyOutput<TTask> = {
              task: upstreamTask,
              terminalKind: upstreamTerminal.kind,
              view: upstreamProcessing.view,
              materializedViewMarkdown: materializedViewMarkdown.trimEnd(),
              resultArtifact: {
                location: join(
                  configuration.journal.runDirectory,
                  upstreamProcessing.result.path,
                ),
                sha256: upstreamProcessing.result.sha256,
              },
            };
            upstreamOutputs.push(dependencyOutput);
          }
        }
        const executionContext: TaskExecutionContext<TTask, TAgent> = {
          task: task as StaticTaskDefinition<TTask, TAgent, string>,
          agentProfile,
          runtime: configuration.runtime,
          runId: configuration.runId,
          sourceCommit: configuration.sourceCommit,
          workingDirectory: configuration.workingDirectory,
          upstreamOutputs,
          signal: cancellationGate.signal,
          journal: configuration.journal,
          processingReferences,
          agentJournalConfiguration: resolveAgentJournalConfiguration(
            agentJournalResolution,
          ),
        };
        const runningTask: RunningTask<TTask> = {
          task: taskName,
          completion: dependencyIntegrityFailure
            ? recordDependencyIntegrityFailure(executionContext)
            : executeTask(executionContext),
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
        dependencyOutputs.set(terminal.task, terminal.output);
      } else {
        dependencyOutputs.set(terminal.task, terminalFailureOutput(terminal));
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
    const drainedTerminals = await drainRunningTasks(running);
    for (const terminal of drainedTerminals) {
      terminals.set(terminal.task, terminal);
      if (terminal.kind === TaskTerminalKind.Completed) {
        completedOutputs.set(terminal.task, terminal.output);
        dependencyOutputs.set(terminal.task, terminal.output);
      } else {
        dependencyOutputs.set(terminal.task, terminalFailureOutput(terminal));
      }
    }
    fatalError =
      error instanceof Error
        ? error
        : new Error('Workflow execution failed with an invalid error value.');
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
      processing: {
        kind: TaskProcessingKind.WorkflowTask,
        result: projection,
        view: {
          presence: MaterializedViewPresence.Unavailable,
          reason: 'Skipped workflow tasks do not have an executed view.',
        },
      },
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
  const terminalKind = fatalError
    ? WorkflowTerminalKind.Failed
    : resolveWorkflowTerminalKind(terminalResolution);
  const materializedOutput = completedOutputs.get(
    configuration.workflow.materializedViewTask,
  );
  const materializerExecution =
    configuration.workflow.tasks[configuration.workflow.materializedViewTask]
      .execution;
  const viewProjectionInput = materializedOutput
    ? {
        markdown: materializedOutput.materializedViewMarkdown,
        authorKind:
          materializerExecution.kind === WorkflowExecutorKind.Agent
            ? MaterializedViewAuthorKind.Agent
            : MaterializedViewAuthorKind.LoomLeaf,
      }
    : {
        markdown: [
          '# Workflow terminal view',
          '',
          `Status: ${terminalKind}`,
          '',
          `Materializer task ${configuration.workflow.materializedViewTask} did not complete.`,
          '',
          'This root read model was produced by Loom. Inspect the terminal task projections and sanitized attempt streams before continuing.',
        ].join('\n'),
        authorKind: MaterializedViewAuthorKind.LoomRuntime,
      };
  const materializedView: MaterializedViewReference =
    await configuration.journal.projectWorkflowView(viewProjectionInput);
  const runTerminal: WorkflowRunTerminal<TTask> = {
    kind: terminalKind,
    runId: configuration.runId,
    workflow: configuration.workflow.name,
    version: configuration.workflow.version,
    sourceCommit: configuration.sourceCommit,
    taskTerminals: orderedTerminals,
    materializedView,
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
    materializedView,
  };
  await configuration.journal.append(terminalEvent);
  if (fatalError) throw fatalError;
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
  const agentJournal = context.agentJournalConfiguration
    ? new AgentAttemptJournal<TTask>(context.agentJournalConfiguration)
    : false;
  if (agentJournal) {
    await agentJournal.initialize();
  }
  let acceptingActivity = true;
  const observe = async (
    observation: Parameters<
      WorkflowTaskInvocation<TTask, TAgent>['observe']
    >[0],
  ) => {
    if (!acceptingActivity) {
      return;
    }
    if (agentJournal) {
      await agentJournal.append(runtimeActivityEvent(observation));
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
    if (
      terminal.kind === TaskTerminalKind.Completed &&
      !(await dependenciesRemainVerified(context))
    ) {
      terminal = {
        kind: TaskTerminalKind.Failed,
        task: context.task.name,
        attempt: 1,
        summary:
          'Dependency processing changed during parent execution. The parent result was rejected.',
      };
    }
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
      summary: context.signal.aborted
        ? 'Workflow cancellation stopped this task.'
        : 'Task runtime failed. Inspect sanitized attempt events and local diagnostics.',
    };
  } finally {
    acceptingActivity = false;
  }
  const terminalRecording: TerminalRecording<TTask, TAgent> = {
    context,
    terminal,
    agentJournal,
  };
  await recordTaskTerminal(terminalRecording);
  return terminal;
}

async function dependenciesRemainVerified<
  TTask extends string,
  TAgent extends string,
>(context: TaskExecutionContext<TTask, TAgent>): Promise<boolean> {
  try {
    for (const dependency of context.upstreamOutputs) {
      const processing = context.processingReferences.get(dependency.task);
      if (!processing) return false;
      await context.journal.readVerifiedProcessingView(processing);
    }
    return true;
  } catch {
    return false;
  }
}

type TerminalRecording<TTask extends string, TAgent extends string> = {
  readonly context: TaskExecutionContext<TTask, TAgent>;
  readonly terminal: TaskTerminal<TTask>;
  readonly agentJournal: AgentAttemptJournal<TTask> | false;
};

async function recordTaskTerminal<TTask extends string, TAgent extends string>(
  recording: TerminalRecording<TTask, TAgent>,
): Promise<void> {
  const { context, terminal, agentJournal } = recording;
  let processing: TaskProcessingReference;
  if (agentJournal) {
    processing = await agentJournal.finalize(terminal);
  } else {
    const projection = await context.journal.projectTaskTerminal(terminal);
    const workflowTaskProcessingInput: WorkflowTaskProcessingInput<TTask> = {
      journal: context.journal,
      terminal,
      result: projection,
    };
    processing = await projectWorkflowTaskProcessing(
      workflowTaskProcessingInput,
    );
  }
  context.processingReferences.set(terminal.task, processing);
  const terminalEvent: WorkflowEventWithoutMetadata<TTask> = {
    kind: WorkflowEventKind.TaskTerminalRecorded,
    task: terminal.task,
    attempt: terminal.attempt,
    terminalKind: terminal.kind,
    resultPath: processing.result.path,
    resultSha256: processing.result.sha256,
    processing,
  };
  await context.journal.append(terminalEvent);
}

async function recordDependencyIntegrityFailure<
  TTask extends string,
  TAgent extends string,
>(context: TaskExecutionContext<TTask, TAgent>): Promise<TaskTerminal<TTask>> {
  const startedEvent: WorkflowEventWithoutMetadata<TTask> = {
    kind: WorkflowEventKind.TaskAttemptStarted,
    task: context.task.name,
    attempt: 1,
  };
  await context.journal.append(startedEvent);
  const agentJournal = context.agentJournalConfiguration
    ? new AgentAttemptJournal<TTask>(context.agentJournalConfiguration)
    : false;
  if (agentJournal) await agentJournal.initialize();
  const terminal: TaskTerminal<TTask> = {
    kind: TaskTerminalKind.Failed,
    task: context.task.name,
    attempt: 1,
    summary:
      'Dependency processing integrity verification failed. Inspect the immutable child projections and sanitized attempt streams.',
  };
  const terminalRecording: TerminalRecording<TTask, TAgent> = {
    context,
    terminal,
    agentJournal,
  };
  await recordTaskTerminal(terminalRecording);
  return terminal;
}

type AgentJournalResolution<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
> = {
  readonly configuration: StaticWorkflowRunConfiguration<TTask, TAgent, TJoin>;
  readonly task: StaticTaskDefinition<TTask, TAgent, TJoin>;
  readonly agentProfile: AgentProfile<TAgent> | false;
};

function resolveAgentJournalConfiguration<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
>(
  resolution: AgentJournalResolution<TTask, TAgent, TJoin>,
): AgentAttemptJournalConfiguration | false {
  if (
    resolution.task.execution.kind !== WorkflowExecutorKind.Agent ||
    !resolution.agentProfile
  ) {
    return false;
  }
  const workflow = resolution.configuration.workflow;
  const materializer = workflow.tasks[workflow.materializedViewTask];
  const isMaterializer = resolution.task.name === workflow.materializedViewTask;
  const parent: AgentAttemptParent =
    !isMaterializer &&
    materializer.execution.kind === WorkflowExecutorKind.Agent
      ? {
          kind: AgentAttemptParentKind.AgentAttempt,
          task: materializer.name,
          agent: materializer.execution.agent,
          attempt: 1,
        }
      : { kind: AgentAttemptParentKind.WorkflowRoot };
  return {
    runDirectory: resolution.configuration.journal.runDirectory,
    runId: resolution.configuration.runId,
    workflow: resolution.configuration.journal.identity.workflow,
    workflowVersion: resolution.configuration.journal.identity.workflowVersion,
    sourceCommit: resolution.configuration.sourceCommit,
    task: resolution.task.name,
    agent: resolution.agentProfile.name,
    attempt: 1,
    depth: isMaterializer ? 1 : 2,
    parent,
    now: resolution.configuration.journal.now,
  };
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
