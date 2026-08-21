import { Codex } from '@openai/codex-sdk';
import type {
  ModelReasoningEffort,
  ThreadEvent,
  ThreadOptions,
  TurnOptions,
} from '@openai/codex-sdk';
import { AgentReasoningEffort, AgentWorkspacePolicy } from './domain.ts';
import type {
  AgentExecutionCompletion,
  AgentExecutionInvocation,
  AgentTaskRuntime,
} from './runtime.ts';
import {
  decodeWorkflowTaskOutput,
  workflowTaskOutputSchema,
} from './structured-result-codec.ts';
import { WorkflowRuntimeActivityKind } from './events.ts';
import type { RuntimeActivityObservation } from './events.ts';
import { runCommand } from '../lib/run.ts';
import type { RunCommandArgs } from '../lib/run.ts';

export enum AgentSourceStabilityPhase {
  BeforeAttempt = 'before attempt',
  AfterAttempt = 'after attempt',
}

export type AgentSourceStabilityCheck = {
  readonly workingDirectory: string;
  readonly sourceCommit: string;
  readonly phase: AgentSourceStabilityPhase;
};

export class CodexSdkAgentRuntime<
  TTask extends string,
  TAgent extends string,
> implements AgentTaskRuntime<TTask, TAgent> {
  readonly codex: Codex;

  constructor() {
    this.codex = new Codex();
  }

  async executeAgent(
    invocation: AgentExecutionInvocation<TTask, TAgent>,
  ): Promise<AgentExecutionCompletion> {
    if (
      invocation.agentProfile.workspacePolicy !== AgentWorkspacePolicy.ReadOnly
    ) {
      throw new Error('Write-capable Codex workflow workers are not enabled.');
    }
    const beforeAttempt: AgentSourceStabilityCheck = {
      workingDirectory: invocation.workingDirectory,
      sourceCommit: invocation.sourceCommit,
      phase: AgentSourceStabilityPhase.BeforeAttempt,
    };
    assertAgentSourceStable(beforeAttempt);
    try {
      const threadOptions: ThreadOptions = {
        workingDirectory: invocation.workingDirectory,
        sandboxMode: 'read-only',
        approvalPolicy: 'never',
        modelReasoningEffort: reasoningEffort(
          invocation.agentProfile.reasoningEffort,
        ),
        networkAccessEnabled: false,
      };
      const thread = this.codex.startThread(threadOptions);
      const prompt = buildPrompt(invocation);
      const outputSchema = workflowTaskOutputSchema(
        invocation.execution.resultKind,
      );
      const turnOptions: TurnOptions = {
        outputSchema,
        signal: invocation.signal,
      };
      const streamedTurn = await thread.runStreamed(prompt, turnOptions);
      let threadId = '';
      let serializedOutput = '';
      for await (const event of streamedTurn.events) {
        if (event.type === 'thread.started') {
          threadId = event.thread_id;
        }
        if (
          event.type === 'item.completed' &&
          event.item.type === 'agent_message'
        ) {
          serializedOutput = event.item.text;
        }
        const observation = normalizeEvent(event);
        if (observation) {
          await invocation.observe(observation);
        }
      }
      if (threadId.length === 0 || serializedOutput.length === 0) {
        throw new Error(
          'Codex completed without a thread identity or structured result.',
        );
      }
      const output = decodeWorkflowTaskOutput(serializedOutput);
      if (output.resultKind !== invocation.execution.resultKind) {
        throw new Error(
          `Codex result kind ${output.resultKind} does not match ${invocation.execution.resultKind}.`,
        );
      }
      return { threadId, output };
    } finally {
      const afterAttempt: AgentSourceStabilityCheck = {
        workingDirectory: invocation.workingDirectory,
        sourceCommit: invocation.sourceCommit,
        phase: AgentSourceStabilityPhase.AfterAttempt,
      };
      assertAgentSourceStable(afterAttempt);
    }
  }
}

export function assertAgentSourceStable(
  check: AgentSourceStabilityCheck,
): void {
  const headCommand: RunCommandArgs = {
    command: 'git',
    args: ['rev-parse', 'HEAD'],
    cwd: check.workingDirectory,
  };
  const head = runCommand(headCommand);
  const actualHead = head.stdout.trim();
  if (head.exitCode !== 0 || actualHead !== check.sourceCommit) {
    throw new Error(
      `Codex agent source is not at immutable commit ${check.sourceCommit} ${check.phase}.`,
    );
  }
  const statusCommand: RunCommandArgs = {
    command: 'git',
    args: ['status', '--porcelain', '--untracked-files=normal'],
    cwd: check.workingDirectory,
  };
  const status = runCommand(statusCommand);
  if (status.exitCode !== 0 || status.stdout.trim().length > 0) {
    throw new Error(`Codex agent worktree is not clean ${check.phase}.`);
  }
}

function buildPrompt<TTask extends string, TAgent extends string>(
  invocation: AgentExecutionInvocation<TTask, TAgent>,
): string {
  const upstream = JSON.stringify(invocation.upstreamOutputs);
  return [
    invocation.agentProfile.instructionPrefix,
    invocation.execution.instruction,
    `Immutable source commit: ${invocation.sourceCommit}`,
    `Required resultKind: ${invocation.execution.resultKind}`,
    'Author materializedViewMarkdown as a concise Markdown read model of outcomes, evidence, risks, and parent actions. It must not contain hidden reasoning, prompts, credentials, or raw command output.',
    'Return only the requested structured result. Do not create unscheduled subagents.',
    invocation.upstreamOutputs.length > 0
      ? `Completed upstream materialized views and typed results:\n${upstream}`
      : 'No upstream results.',
  ].join('\n\n');
}

function reasoningEffort(effort: AgentReasoningEffort): ModelReasoningEffort {
  if (effort === AgentReasoningEffort.Low) {
    return 'low';
  }
  if (effort === AgentReasoningEffort.Medium) {
    return 'medium';
  }
  return 'high';
}

function normalizeEvent(
  event: ThreadEvent,
): RuntimeActivityObservation | false {
  if (event.type === 'thread.started') {
    return observation([
      WorkflowRuntimeActivityKind.ThreadStarted,
      event.thread_id,
    ]);
  }
  if (event.type === 'turn.started') {
    return observation([
      WorkflowRuntimeActivityKind.TurnStarted,
      'Codex turn started.',
    ]);
  }
  if (event.type === 'turn.completed') {
    return observation([
      WorkflowRuntimeActivityKind.TurnCompleted,
      'Codex turn completed.',
    ]);
  }
  if (event.type === 'turn.failed') {
    return observation([
      WorkflowRuntimeActivityKind.TurnFailed,
      'Codex turn failed. Inspect the typed task terminal projection.',
    ]);
  }
  if (event.type === 'error') {
    return observation([
      WorkflowRuntimeActivityKind.RuntimeError,
      'Codex runtime reported an error. Inspect local diagnostics.',
    ]);
  }
  if (event.type !== 'item.completed') {
    return false;
  }
  if (event.item.type === 'command_execution') {
    return observation([
      WorkflowRuntimeActivityKind.CommandCompleted,
      `Command ${event.item.status}.`,
    ]);
  }
  if (event.item.type === 'file_change') {
    return observation([
      WorkflowRuntimeActivityKind.FileChangeCompleted,
      `File change ${event.item.status}.`,
    ]);
  }
  if (event.item.type === 'agent_message') {
    return observation([
      WorkflowRuntimeActivityKind.AgentMessageCompleted,
      'Structured agent message completed.',
    ]);
  }
  return false;
}

type ObservationValues = readonly [WorkflowRuntimeActivityKind, string];

function observation(values: ObservationValues): RuntimeActivityObservation {
  return { activity: values[0], detail: values[1] };
}
