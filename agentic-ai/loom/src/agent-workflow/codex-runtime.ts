import { err, ok, type Result } from 'neverthrow';
import {
  AgentExecutionFailureKind as CodexExecutionFailureKind,
  type AgentExecutionFailure,
} from './runtime.ts';
export { AgentExecutionFailureKind as CodexExecutionFailureKind } from './runtime.ts';
import { Codex } from '@openai/codex-sdk';
import type {
  McpToolCallItem,
  ModelReasoningEffort,
  ThreadEvent,
  ThreadOptions,
  TurnOptions,
} from '@openai/codex-sdk';
import { AgentReasoningEffort, AgentWorkspacePolicy } from './domain.ts';
import type { WorkflowResultKind } from './domain.ts';
import type {
  AgentExecutionCompletion,
  AgentExecutionInvocation,
  AgentTaskRuntime,
  RuntimeActivityObserver,
} from './runtime.ts';
import { WorkflowResultSchema } from './structured-result-codec.ts';
import { WorkflowRuntimeActivityKind } from './events.ts';
import type { RuntimeActivityObservation } from './events.ts';
import { HostCommand } from '../lib/run.ts';
import type { RunCommandArgs } from '../lib/run.ts';
import {
  MODULE_EXPERT_CONTEXT_MCP,
  ModuleExpertIsolation,
} from '../module-experts/runtime-contract.ts';
import type {
  ModuleExpertRuntimeIsolationRequest,
  ModuleExpertRuntimeIsolationUse,
  ReadOnlyExpertRuntimeIsolationRequest,
} from '../module-experts/runtime-contract.ts';
import { MODULE_EXPERT_READ_CONTEXT_TOOLS } from '../module-experts/read-context-mcp.ts';

export enum AgentSourceStabilityPhase {
  BeforeAttempt = 'before attempt',
  AfterAttempt = 'after attempt',
}
export type AgentSourceStabilityCheck = {
  readonly workingDirectory: string;
  readonly sourceCommit: string;
  readonly phase: AgentSourceStabilityPhase;
};
export type CodexExecutionFailureRequest = {
  readonly kind: CodexExecutionFailureKind;
  readonly message: string;
};
export class CodexExecutionFailure {
  readonly message: string;
  readonly kind: CodexExecutionFailureKind;
  constructor(request: CodexExecutionFailureRequest) {
    this.message = request.message;
    this.kind = request.kind;
  }
}
export type RunIsolatedModuleExpertCodexArgs<
  TTask extends string,
  TAgent extends string,
> = {
  readonly invocation: AgentExecutionInvocation<TTask, TAgent>;
  readonly selectedContextPaths: readonly string[];
};
export type RunIsolatedReadOnlyExpertCodexRequest<
  TTask extends string,
  TAgent extends string,
> = {
  readonly invocation: AgentExecutionInvocation<TTask, TAgent>;
  readonly isolationRequest: ReadOnlyExpertRuntimeIsolationRequest;
};
export class ModuleExpertCodexSdkAgentRuntime<
  TTask extends string,
  TAgent extends string,
> implements AgentTaskRuntime<TTask, TAgent> {
  async executeAgent(
    invocation: AgentExecutionInvocation<TTask, TAgent>,
  ): Promise<Result<AgentExecutionCompletion, AgentExecutionFailure>> {
    return ModuleExpertCodexSdkAgentRuntime.executeIsolated({
      invocation,
      selectedContextPaths: [],
    });
  }
  static async executeIsolated<TTask extends string, TAgent extends string>(
    args: RunIsolatedModuleExpertCodexArgs<TTask, TAgent>,
  ): Promise<Result<AgentExecutionCompletion, AgentExecutionFailure>> {
    const invocation = args.invocation;
    const isolationRequest: ModuleExpertRuntimeIsolationRequest = {
      expertName: invocation.agentProfile.name,
      parentEnvironment: process.env,
      selectedContextPaths: args.selectedContextPaths,
      sourceCommit: invocation.sourceCommit,
      workingDirectory: invocation.workingDirectory,
    };
    const isolationUse: ModuleExpertRuntimeIsolationUse<
      Result<AgentExecutionCompletion, AgentExecutionFailure>
    > = {
      isolationRequest,
      run: async (isolation) => {
        const execution: GuardedAgentExecution<TTask, TAgent> = {
          codex: new Codex(isolation.codexOptions),
          invocation,
          threadOptions: isolation.threadOptions,
        };
        return new GuardedCodexExecution(execution).execute();
      },
    };
    return ModuleExpertIsolation.withModuleExpertRuntimeIsolation(isolationUse);
  }
}
export class ReadOnlyExpertCodexRuntime<
  TTask extends string,
  TAgent extends string,
> {
  private constructor(
    private readonly request: RunIsolatedReadOnlyExpertCodexRequest<
      TTask,
      TAgent
    >,
  ) {}
  static executeIsolated<TTask extends string, TAgent extends string>(
    request: RunIsolatedReadOnlyExpertCodexRequest<TTask, TAgent>,
  ): Promise<Result<AgentExecutionCompletion, AgentExecutionFailure>> {
    return new ReadOnlyExpertCodexRuntime(request).execute();
  }
  async execute(): Promise<
    Result<AgentExecutionCompletion, AgentExecutionFailure>
  > {
    const request = this.request;
    const isolation =
      await ModuleExpertIsolation.createReadOnlyExpertRuntimeIsolation(
        request.isolationRequest,
      );
    try {
      const execution: GuardedAgentExecution<TTask, TAgent> = {
        codex: new Codex(isolation.codexOptions),
        invocation: request.invocation,
        threadOptions: isolation.threadOptions,
      };
      return await new GuardedCodexExecution(execution).execute();
    } finally {
      await isolation.dispose();
    }
  }
}
type GuardedAgentExecution<TTask extends string, TAgent extends string> = {
  readonly codex: Codex;
  readonly invocation: AgentExecutionInvocation<TTask, TAgent>;
  readonly threadOptions?: ThreadOptions;
};
class GuardedCodexExecution<TTask extends string, TAgent extends string> {
  constructor(
    private readonly execution: GuardedAgentExecution<TTask, TAgent>,
  ) {}
  async execute(): Promise<
    Result<AgentExecutionCompletion, AgentExecutionFailure>
  > {
    const execution = this.execution;
    if (
      execution.invocation.agentProfile.workspacePolicy !==
      AgentWorkspacePolicy.ReadOnly
    ) {
      return err(
        new CodexExecutionFailure({
          kind: CodexExecutionFailureKind.WorkspacePolicy,
          message: 'Write-capable Codex workflow workers are not enabled.',
        }),
      );
    }
    const beforeAttempt: AgentSourceStabilityCheck = {
      workingDirectory: execution.invocation.workingDirectory,
      sourceCommit: execution.invocation.sourceCommit,
      phase: AgentSourceStabilityPhase.BeforeAttempt,
    };
    const before = AgentSourceSnapshot.assertStable(beforeAttempt);
    if (before.isErr()) return err(before.error);
    try {
      return await this.executeStable();
    } finally {
      const afterAttempt: AgentSourceStabilityCheck = {
        workingDirectory: execution.invocation.workingDirectory,
        sourceCommit: execution.invocation.sourceCommit,
        phase: AgentSourceStabilityPhase.AfterAttempt,
      };
      const after = AgentSourceSnapshot.assertStable(afterAttempt);
      if (after.isErr()) return err(after.error);
    }
  }
  private async executeStable(): Promise<
    Result<AgentExecutionCompletion, AgentExecutionFailure>
  > {
    const execution = this.execution;
    const moduleExpertThreadOptionsArgs = {
      workingDirectory: execution.invocation.workingDirectory,
    };
    const [
      baseThreadOptions = ModuleExpertIsolation.moduleExpertThreadOptions(
        moduleExpertThreadOptionsArgs,
      ),
    ] = [execution.threadOptions];
    const threadOptions: ThreadOptions = {
      ...baseThreadOptions,
      modelReasoningEffort: this.reasoningEffort(
        execution.invocation.agentProfile.reasoningEffort,
      ),
    };
    const thread = execution.codex.startThread(threadOptions);
    const prompt = this.buildPrompt();
    const outputSchema = WorkflowResultSchema.workflowTaskOutputSchema(
      execution.invocation.execution.resultKind,
    );
    const turnOptions: TurnOptions = {
      outputSchema,
      signal: execution.invocation.signal,
    };
    const streamedTurn = await thread.runStreamed(prompt, turnOptions);
    const collectionArgs: CollectCodexTurnArgs = {
      events: streamedTurn.events,
      expectedResultKind: execution.invocation.execution.resultKind,
      observe: execution.invocation.observe,
    };
    return CodexTurn.collect(collectionArgs);
  }
  private buildPrompt(): string {
    const invocation = this.execution.invocation;
    const upstream = JSON.stringify(invocation.upstreamOutputs);
    return [
      invocation.agentProfile.instructionPrefix,
      invocation.execution.instruction,
      `Immutable source commit: ${invocation.sourceCommit}`,
      `Required resultKind: ${invocation.execution.resultKind}`,
      'Author materializedViewMarkdown as a concise Markdown read model of outcomes, evidence, risks, and parent actions. It must not contain hidden reasoning, prompts, credentials, or raw command output.',
      'Return only the requested structured result. Do not create unscheduled subagents.',
      invocation.upstreamOutputs.length > 0
        ? `Verified upstream materialized views:\n${upstream}`
        : 'No upstream results.',
    ].join('\n\n');
  }
  private reasoningEffort(effort: AgentReasoningEffort): ModelReasoningEffort {
    if (effort === AgentReasoningEffort.Low) {
      return 'low';
    }
    if (effort === AgentReasoningEffort.Medium) {
      return 'medium';
    }
    return 'high';
  }
}
export type CollectCodexTurnArgs = {
  readonly events: AsyncIterable<ThreadEvent>;
  readonly expectedResultKind: WorkflowResultKind;
  readonly observe: RuntimeActivityObserver;
};
enum TurnTermination {
  Pending = 'pending',
  Completed = 'completed',
  Failed = 'failed',
}
enum TurnValuePresence {
  Missing = 'missing',
  Present = 'present',
}
type TurnText =
  | { readonly presence: TurnValuePresence.Missing }
  | { readonly presence: TurnValuePresence.Present; readonly text: string };
export class CodexTurn {
  private termination = TurnTermination.Pending;
  private thread: TurnText = { presence: TurnValuePresence.Missing };
  private output: TurnText = { presence: TurnValuePresence.Missing };
  private constructor(private readonly request: CollectCodexTurnArgs) {}
  static collect(
    request: CollectCodexTurnArgs,
  ): Promise<Result<AgentExecutionCompletion, AgentExecutionFailure>> {
    return new CodexTurn(request).complete();
  }
  private async complete(): Promise<
    Result<AgentExecutionCompletion, AgentExecutionFailure>
  > {
    for await (const event of this.request.events) {
      if (event.type === 'thread.started')
        this.thread = this.text(event.thread_id);
      if (
        event.type === 'turn.completed' &&
        this.termination !== TurnTermination.Failed
      )
        this.termination = TurnTermination.Completed;
      if (event.type === 'turn.failed' || event.type === 'error')
        this.termination = TurnTermination.Failed;
      if (
        this.termination !== TurnTermination.Failed &&
        event.type === 'item.completed' &&
        event.item.type === 'agent_message'
      )
        this.output = this.text(event.item.text);
      const observation = new CodexActivity(event).normalize();
      if (observation) await this.request.observe(observation);
    }
    if (this.termination === TurnTermination.Failed)
      return err(
        new CodexExecutionFailure({
          kind: CodexExecutionFailureKind.FailedTurn,
          message: 'Codex turn failed before a valid structured result.',
        }),
      );
    if (
      this.termination !== TurnTermination.Completed ||
      this.thread.presence === TurnValuePresence.Missing ||
      this.output.presence === TurnValuePresence.Missing
    )
      return err(
        new CodexExecutionFailure({
          kind: CodexExecutionFailureKind.IncompleteTurn,
          message:
            'Codex completed without a thread identity or structured result.',
        }),
      );
    const output = WorkflowResultSchema.decodeWorkflowTaskOutput(
      this.output.text,
    );
    if (output.resultKind !== this.request.expectedResultKind)
      return err(
        new CodexExecutionFailure({
          kind: CodexExecutionFailureKind.ResultKind,
          message: `Codex result kind ${output.resultKind} does not match ${this.request.expectedResultKind}.`,
        }),
      );
    return ok({ threadId: this.thread.text, output });
  }
  private text(text: string): TurnText {
    return text.length === 0
      ? { presence: TurnValuePresence.Missing }
      : { presence: TurnValuePresence.Present, text };
  }
}
export class AgentSourceSnapshot {
  private constructor(private readonly check: AgentSourceStabilityCheck) {}
  static assertStable(
    check: AgentSourceStabilityCheck,
  ): Result<void, AgentExecutionFailure> {
    return new AgentSourceSnapshot(check).assertCurrent();
  }
  private assertCurrent(): Result<void, AgentExecutionFailure> {
    const check = this.check;
    const headCommand: RunCommandArgs = {
      command: 'git',
      args: ['rev-parse', 'HEAD'],
      cwd: check.workingDirectory,
    };
    const headLaunch = new HostCommand(headCommand).execute();
    if (headLaunch.isErr()) return err(headLaunch.error);
    const head = headLaunch.value;
    const actualHead = head.stdout.trim();
    if (head.exitCode !== 0 || actualHead !== check.sourceCommit) {
      return err(
        new CodexExecutionFailure({
          kind: CodexExecutionFailureKind.SourceCommit,
          message: `Codex agent source is not at immutable commit ${check.sourceCommit} ${check.phase}.`,
        }),
      );
    }
    const statusCommand: RunCommandArgs = {
      command: 'git',
      args: ['status', '--porcelain', '--untracked-files=normal'],
      cwd: check.workingDirectory,
    };
    const statusLaunch = new HostCommand(statusCommand).execute();
    if (statusLaunch.isErr()) return err(statusLaunch.error);
    const status = statusLaunch.value;
    if (status.exitCode !== 0 || status.stdout.trim().length > 0) {
      return err(
        new CodexExecutionFailure({
          kind: CodexExecutionFailureKind.DirtyWorktree,
          message: `Codex agent worktree is not clean ${check.phase}.`,
        }),
      );
    }
    return ok(undefined);
  }
}
class CodexActivity {
  constructor(private readonly event: ThreadEvent) {}
  normalize(): RuntimeActivityObservation | false {
    const event = this.event;
    if (event.type === 'thread.started') {
      return this.observation([
        WorkflowRuntimeActivityKind.ThreadStarted,
        event.thread_id,
      ]);
    }
    if (event.type === 'turn.started') {
      return this.observation([
        WorkflowRuntimeActivityKind.TurnStarted,
        'Codex turn started.',
      ]);
    }
    if (event.type === 'turn.completed') {
      return this.observation([
        WorkflowRuntimeActivityKind.TurnCompleted,
        'Codex turn completed.',
      ]);
    }
    if (event.type === 'turn.failed') {
      return this.observation([
        WorkflowRuntimeActivityKind.TurnFailed,
        'Codex turn failed. Inspect the typed task terminal projection.',
      ]);
    }
    if (event.type === 'error') {
      return this.observation([
        WorkflowRuntimeActivityKind.RuntimeError,
        'Codex runtime reported an error. Inspect local diagnostics.',
      ]);
    }
    if (event.type !== 'item.completed') {
      return false;
    }
    if (event.item.type === 'command_execution') {
      return this.observation([
        WorkflowRuntimeActivityKind.CommandCompleted,
        `Command ${event.item.status}.`,
      ]);
    }
    if (event.item.type === 'file_change') {
      return this.observation([
        WorkflowRuntimeActivityKind.FileChangeCompleted,
        `File change ${event.item.status}.`,
      ]);
    }
    if (event.item.type === 'mcp_tool_call') {
      return this.sourceReadObservation(event.item);
    }
    if (event.item.type === 'agent_message') {
      return this.observation([
        WorkflowRuntimeActivityKind.AgentMessageCompleted,
        'Structured agent message completed.',
      ]);
    }
    return false;
  }
  private sourceReadObservation(
    item: McpToolCallItem,
  ): RuntimeActivityObservation | false {
    if (item.server !== MODULE_EXPERT_CONTEXT_MCP) {
      return false;
    }
    const action = this.sourceReadAction(item.tool);
    if (!action) {
      return false;
    }
    return this.observation([
      WorkflowRuntimeActivityKind.SourceReadCompleted,
      `Repository ${action} ${this.sourceReadStatus(item.status)}.`,
    ]);
  }
  private sourceReadAction(tool: string): string | false {
    if (tool === MODULE_EXPERT_READ_CONTEXT_TOOLS[0]) {
      return 'file listing';
    }
    if (tool === MODULE_EXPERT_READ_CONTEXT_TOOLS[1]) {
      return 'file read';
    }
    if (tool === MODULE_EXPERT_READ_CONTEXT_TOOLS[2]) {
      return 'text search';
    }
    return false;
  }
  private sourceReadStatus(status: McpToolCallItem['status']): string {
    if (status === 'completed') {
      return 'completed';
    }
    if (status === 'failed') {
      return 'failed';
    }
    return 'ended without a terminal status';
  }
  private observation(values: ObservationValues): RuntimeActivityObservation {
    return { activity: values[0], detail: values[1] };
  }
}
type ObservationValues = readonly [WorkflowRuntimeActivityKind, string];
