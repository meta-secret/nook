import { runCortexAudit } from '../commands/cortex-audit.ts';
import type { CortexAuditRequest } from '../codec/args/cortex-audit.ts';
import { runCommand } from '../lib/run.ts';
import type { RunCommandArgs } from '../lib/run.ts';
import {
  LoomLeafKind,
  TaskTerminalKind,
  WorkflowArtifactKind,
  WorkflowExecutorKind,
  WorkflowResultKind,
} from './domain.ts';
import type {
  CompletedTaskTerminal,
  StaticTaskExecution,
  TaskTerminal,
  WorkflowTaskOutput,
} from './domain.ts';
import type {
  AgentTaskRuntime,
  WorkflowTaskInvocation,
  WorkflowTaskRuntime,
} from './runtime.ts';

export class LocalWorkflowTaskRuntime<
  TTask extends string,
  TAgent extends string,
> implements WorkflowTaskRuntime<TTask, TAgent> {
  readonly agentRuntime: AgentTaskRuntime<TTask, TAgent>;

  constructor(agentRuntime: AgentTaskRuntime<TTask, TAgent>) {
    this.agentRuntime = agentRuntime;
  }

  async execute(
    invocation: WorkflowTaskInvocation<TTask, TAgent>,
  ): Promise<TaskTerminal<TTask>> {
    if (invocation.execution.kind === WorkflowExecutorKind.Agent) {
      const agentInvocation = {
        ...invocation,
        execution: invocation.execution,
      };
      const completion = await this.agentRuntime.executeAgent(agentInvocation);
      const terminal: CompletedTaskTerminal<TTask> = {
        kind: TaskTerminalKind.Completed,
        task: invocation.task,
        attempt: invocation.attempt,
        threadId: completion.threadId,
        output: completion.output,
      };
      return terminal;
    }
    return executeLeaf(invocation);
  }
}

async function executeLeaf<TTask extends string, TAgent extends string>(
  invocation: WorkflowTaskInvocation<TTask, TAgent>,
): Promise<TaskTerminal<TTask>> {
  const execution: StaticTaskExecution<TAgent> = invocation.execution;
  if (execution.kind !== WorkflowExecutorKind.LoomLeaf) {
    throw new Error('Agent execution reached the Loom leaf adapter.');
  }
  if (execution.leaf === LoomLeafKind.VerifyGitBaseline) {
    const commandInput: RunCommandArgs = {
      command: 'git',
      args: ['rev-parse', 'HEAD'],
      cwd: invocation.workingDirectory,
    };
    const commandOutput = runCommand(commandInput);
    const actualCommit = commandOutput.stdout.trim();
    if (
      commandOutput.exitCode !== 0 ||
      actualCommit !== invocation.sourceCommit
    ) {
      throw new Error(
        `Workflow baseline mismatch: expected ${invocation.sourceCommit}, received ${actualCommit}.`,
      );
    }
    const statusInput: RunCommandArgs = {
      command: 'git',
      args: ['status', '--porcelain', '--untracked-files=normal'],
      cwd: invocation.workingDirectory,
    };
    const statusOutput = runCommand(statusInput);
    if (statusOutput.exitCode !== 0 || statusOutput.stdout.trim().length > 0) {
      throw new Error('Workflow baseline must have a clean working tree.');
    }
    return completedLeafTerminal([
      invocation,
      `Verified source commit ${actualCommit}.`,
    ]);
  }
  const cortexAuditInput: CortexAuditRequest = {
    includeDensityLint: execution.includeDensityLint,
  };
  const report = await runCortexAudit(cortexAuditInput);
  if (!report.auditOk) {
    throw new Error('Mechanical Cortex audit reported inconsistencies.');
  }
  return completedLeafTerminal([invocation, 'Mechanical Cortex audit passed.']);
}

type LeafCompletionValues<
  TTask extends string,
  TAgent extends string,
> = readonly [WorkflowTaskInvocation<TTask, TAgent>, string];

function completedLeafTerminal<TTask extends string, TAgent extends string>(
  values: LeafCompletionValues<TTask, TAgent>,
): CompletedTaskTerminal<TTask> {
  const invocation = values[0];
  const output: WorkflowTaskOutput = {
    resultKind: WorkflowResultKind.LoomLeafEvidence,
    summary: values[1],
    findings: [],
    notesForParent: [],
    artifacts: [
      {
        kind: WorkflowArtifactKind.Report,
        location: 'events.jsonl',
        description: 'Parent-owned workflow journal evidence.',
      },
    ],
  };
  return {
    kind: TaskTerminalKind.Completed,
    task: invocation.task,
    attempt: invocation.attempt,
    threadId: 'loom-leaf',
    output,
  };
}
