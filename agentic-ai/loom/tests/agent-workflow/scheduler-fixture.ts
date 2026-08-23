import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW,
  CortexAuditAgent,
  CortexAuditJoin,
  CortexAuditTask,
} from '../../src/agent-workflow/cortex-workflow.ts';
import {
  TaskTerminalKind,
  WorkflowExecutorKind,
  WorkflowResultKind,
} from '../../src/agent-workflow/domain.ts';
import type {
  TaskTerminal,
  WorkflowTaskOutput,
} from '../../src/agent-workflow/domain.ts';
import { WorkflowJournal } from '../../src/agent-workflow/journal.ts';
import type { WorkflowJournalConfiguration } from '../../src/agent-workflow/journal.ts';
import type {
  WorkflowDependencyOutput,
  WorkflowTaskAttempt,
  WorkflowTaskInvocation,
  WorkflowTaskRuntime,
} from '../../src/agent-workflow/runtime.ts';
import { TaskTeardownKind } from '../../src/agent-workflow/runtime.ts';
import { WorkflowRuntimeActivityKind } from '../../src/agent-workflow/events.ts';
import type { RuntimeActivityObservation } from '../../src/agent-workflow/events.ts';
import type { StaticWorkflowRunConfiguration } from '../../src/agent-workflow/scheduler.ts';

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const FIXED_TIME = '2026-08-14T05:00:00.000Z';

export type ScriptedRuntimeConfiguration = {
  readonly failedTask: CortexAuditTask | false;
  readonly tamperResultArtifactDuringSynthesis: boolean;
};

class ScriptedWorkflowRuntime implements WorkflowTaskRuntime<
  CortexAuditTask,
  CortexAuditAgent
> {
  readonly failedTask: CortexAuditTask | false;
  readonly tamperResultArtifactDuringSynthesis: boolean;
  readonly started: CortexAuditTask[] = [];
  readonly upstreamByTask = new Map<
    CortexAuditTask,
    readonly WorkflowDependencyOutput<CortexAuditTask>[]
  >();
  running = 0;
  maximumRunning = 0;

  constructor(configuration: ScriptedRuntimeConfiguration) {
    this.failedTask = configuration.failedTask;
    this.tamperResultArtifactDuringSynthesis =
      configuration.tamperResultArtifactDuringSynthesis;
  }

  start(
    invocation: WorkflowTaskInvocation<CortexAuditTask, CortexAuditAgent>,
  ): WorkflowTaskAttempt<CortexAuditTask> {
    const completion = this.execute(invocation);
    return {
      completion,
      stop: async () => {
        await completion.catch(() => false);
        return { kind: TaskTeardownKind.Confirmed };
      },
    };
  }

  private async execute(
    invocation: WorkflowTaskInvocation<CortexAuditTask, CortexAuditAgent>,
  ): Promise<TaskTerminal<CortexAuditTask>> {
    this.started.push(invocation.task);
    this.upstreamByTask.set(invocation.task, invocation.upstreamOutputs);
    const observation: RuntimeActivityObservation = {
      activity: WorkflowRuntimeActivityKind.TurnStarted,
      detail: 'Scripted task turn started.',
    };
    await invocation.observe(observation);
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
    if (
      this.tamperResultArtifactDuringSynthesis &&
      invocation.task === CortexAuditTask.SynthesizeFindings
    ) {
      const dependency = invocation.upstreamOutputs[0];
      if (dependency) {
        await writeFile(
          dependency.resultArtifact.location,
          '{"tampered":true}\n',
          'utf8',
        );
      }
    }
    const resultKind =
      invocation.execution.kind === WorkflowExecutorKind.Agent
        ? invocation.execution.resultKind
        : WorkflowResultKind.LoomLeafEvidence;
    if (
      resultKind === WorkflowResultKind.ModuleDevelopmentPlan ||
      resultKind === WorkflowResultKind.ModuleExpertEvidence ||
      resultKind === WorkflowResultKind.StructuralExpertPlan ||
      resultKind === WorkflowResultKind.CodeRefactoringEvidence ||
      resultKind === WorkflowResultKind.CortexRefactoringEvidence ||
      resultKind === WorkflowResultKind.SystemCoherenceSynthesis
    ) {
      throw new Error(
        'The generic scheduler fixture cannot synthesize specialized expert evidence.',
      );
    }
    const output: WorkflowTaskOutput = {
      resultKind,
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
      threadId: `thread-${invocation.task}`,
      output,
    };
  }
}

export type SchedulerFixture = {
  readonly runRoot: string;
  readonly runtime: ScriptedWorkflowRuntime;
  readonly abortController: AbortController;
  readonly configuration: StaticWorkflowRunConfiguration<
    CortexAuditTask,
    CortexAuditAgent,
    CortexAuditJoin
  >;
};

export async function createSchedulerFixture(
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
