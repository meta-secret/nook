import { err, ok, type Result } from 'neverthrow';
import {
  AgentExecutionFailureKind as CodexExecutionFailureKind,
  type AgentExecutionFailure,
} from './runtime.ts';
export { AgentExecutionFailureKind as CodexExecutionFailureKind } from './runtime.ts';
import { Codex } from '@openai/codex-sdk';
import type {
  CodexOptions,
  McpToolCallItem,
  ModelReasoningEffort,
  ThreadEvent,
  ThreadOptions,
  TurnOptions,
} from '@openai/codex-sdk';
import {
  AgentReasoningEffort,
  AgentServiceTier,
  AgentWorkspacePolicy,
} from './domain.ts';
import type {
  AgentProfile,
  ResolvedAgentProfile,
  WorkflowResultKind,
} from './domain.ts';
import { TeamAuthorityCatalog } from '../team-agents/catalog.ts';
import type {
  TeamAgentKey,
  TeamRuntimeProfile,
} from '../team-agents/catalog.ts';
import type {
  AgentExecutionCompletion,
  AgentExecutionInvocation,
  AgentTaskRuntime,
  RuntimeActivityObserver,
} from './runtime.ts';
import { WorkflowResultSchema } from './structured-result-codec.ts';
import { WorkflowRuntimeActivityKind } from './events.ts';
import type { RuntimeActivityObservation } from './events.ts';
import { RepositoryCommand, RepositoryCommandExecutable } from '../lib/run.ts';
import type { RepositoryCommandRequest } from '../lib/run.ts';
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
import { PinnedDevBaseEvidenceContract } from '../lib/base-evidence.ts';

export enum AgentSourceStabilityPhase {
  BeforeAttempt = 'before attempt',
  AfterAttempt = 'after attempt',
}
export type AgentSourceStabilityCheck = {
  readonly workingDirectory: string;
  readonly sourceCommit: string;
  readonly originMainSha: string;
  readonly pinnedLocalDevSha: string;
  readonly featureHeadSha: string;
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

export type AgentCodexOptionsRequest = {
  readonly codexOptions: CodexOptions;
  readonly agentProfile: ResolvedAgentProfile<string>;
};

export type ExpertCodexOptionsRequest = {
  readonly codexOptions: CodexOptions;
};

export type AgentCodexInvocationRequest = {
  readonly codexOptions: CodexOptions;
  readonly agentProfile: AgentProfile<string>;
};

export type AgentCodexExecutionConfiguration = {
  readonly codexOptions: CodexOptions;
  readonly agentProfile: AgentProfile<string>;
};

export type ResolveTeamAgentProfileRequest = {
  readonly agent: TeamAgentKey;
  readonly instructionPrefix: string;
};

export type ResolveTeamAgentInvocationProfileRequest = {
  readonly profile: AgentProfile<string>;
};

type TeamAgentRuntimeProfileCatalogRequest = {
  readonly profile: TeamRuntimeProfile;
  readonly instructionPrefix: string;
};

/** Owns canonical Team Agent profile resolution at the Codex runtime boundary. */
export class TeamAgentRuntimeProfile {
  private constructor() {}

  static resolve(
    request: ResolveTeamAgentProfileRequest,
  ): ResolvedAgentProfile<string> {
    const profile = TeamAuthorityCatalog.teamRuntimeProfile(request.agent);
    if (!profile) {
      throw new Error(`Unknown Team Agent runtime profile: ${request.agent}`);
    }
    TeamAgentRuntimeProfile.assertCanonicalProfile(profile);
    return TeamAgentRuntimeProfile.fromCatalog({
      profile,
      instructionPrefix: request.instructionPrefix,
    });
  }

  static fromInvocation(
    request: ResolveTeamAgentInvocationProfileRequest,
  ): ResolvedAgentProfile<string> | false {
    const profile = TeamAuthorityCatalog.teamRuntimeProfileByName(
      request.profile.name,
    );
    if (!profile) return false;
    TeamAgentRuntimeProfile.assertCanonicalProfile(profile);
    const canonicalReasoningEffort =
      TeamAgentRuntimeProfile.reasoningEffort(profile);
    if (
      request.profile.reasoningEffort !== canonicalReasoningEffort ||
      (request.profile.model !== undefined &&
        request.profile.model !== profile.model) ||
      (request.profile.serviceTier !== undefined &&
        request.profile.serviceTier !== AgentServiceTier.Fast)
    ) {
      throw new Error(
        `Team Agent runtime profile drifted: ${request.profile.name}`,
      );
    }
    return TeamAgentRuntimeProfile.fromCatalog({
      profile,
      instructionPrefix: request.profile.instructionPrefix,
    });
  }

  private static fromCatalog(
    request: TeamAgentRuntimeProfileCatalogRequest,
  ): ResolvedAgentProfile<string> {
    return Object.freeze({
      name: request.profile.key,
      instructionPrefix: request.instructionPrefix,
      workspacePolicy: AgentWorkspacePolicy.ReadOnly,
      reasoningEffort: TeamAgentRuntimeProfile.reasoningEffort(
        request.profile,
      ),
      model: request.profile.model,
      serviceTier: AgentServiceTier.Fast,
    });
  }

  private static reasoningEffort(
    profile: TeamRuntimeProfile,
  ): AgentReasoningEffort {
    return profile.reasoningEffort === 'low'
      ? AgentReasoningEffort.Low
      : AgentReasoningEffort.XHigh;
  }

  private static assertCanonicalProfile(profile: TeamRuntimeProfile): void {
    const isGizmo = profile.parent === 'Gizmo Prime';
    const expectedModel = isGizmo ? 'gpt-5.6-sol' : 'gpt-5.6-luna';
    const expectedReasoningEffort = isGizmo ? 'low' : 'xhigh';
    const teamGizmo = TeamAuthorityCatalog.teamGizmoProfile(profile.team);
    const hierarchyMatches = isGizmo
      ? teamGizmo?.key === profile.key
      : teamGizmo?.key === profile.parent;
    if (
      !hierarchyMatches ||
      profile.model !== expectedModel ||
      profile.reasoningEffort !== expectedReasoningEffort ||
      profile.serviceTier !== 'fast'
    ) {
      throw new Error(
        `Team Agent catalog profile is not canonical: ${profile.key}`,
      );
    }
  }
}

/** Owns the typed mapping from a resolved profile to Codex CLI configuration. */
export class AgentCodexOptions {
  private constructor() {}

  static forProfile(request: AgentCodexOptionsRequest): CodexOptions {
    const profile = TeamAgentRuntimeProfile.fromInvocation({
      profile: request.agentProfile,
    });
    if (!profile) {
      throw new Error('A resolved Team Agent profile is required.');
    }
    const model = profile.model.trim();
    if (model.length === 0) {
      throw new Error('A resolved Team Agent profile requires a model.');
    }
    if (profile.serviceTier !== AgentServiceTier.Fast) {
      throw new Error('A resolved Team Agent profile requires Fast mode.');
    }
    return {
      ...request.codexOptions,
      config: {
        ...request.codexOptions.config,
        service_tier: profile.serviceTier,
      },
    };
  }

  static forExpertProfile(
    request: ExpertCodexOptionsRequest,
  ): CodexOptions {
    return request.codexOptions;
  }

  static forInvocation(
    request: AgentCodexInvocationRequest,
  ): AgentCodexExecutionConfiguration {
    const teamProfile = TeamAgentRuntimeProfile.fromInvocation({
      profile: request.agentProfile,
    });
    if (!teamProfile) {
      return {
        codexOptions: AgentCodexOptions.forExpertProfile({
          codexOptions: request.codexOptions,
        }),
        agentProfile: request.agentProfile,
      };
    }
    return {
      codexOptions: AgentCodexOptions.forProfile({
        codexOptions: request.codexOptions,
        agentProfile: teamProfile,
      }),
      agentProfile: teamProfile,
    };
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
      originMainSha: invocation.originMainSha,
      pinnedLocalDevSha: invocation.pinnedLocalDevSha,
      featureHeadSha: invocation.featureHeadSha,
      workingDirectory: invocation.workingDirectory,
    };
    const isolationUse: ModuleExpertRuntimeIsolationUse<
      AgentExecutionCompletion,
      AgentExecutionFailure
    > = {
      isolationRequest,
      run: async (isolation) => {
        const configured = AgentCodexOptions.forInvocation({
          codexOptions: isolation.codexOptions,
          agentProfile: invocation.agentProfile,
        });
        const execution: GuardedAgentExecution<TTask, TAgent> = {
          codex: new Codex(configured.codexOptions),
          invocation,
          agentProfile: configured.agentProfile,
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
    if (isolation.isErr()) return err(isolation.error);
    try {
      const configured = AgentCodexOptions.forInvocation({
        codexOptions: isolation.value.codexOptions,
        agentProfile: request.invocation.agentProfile,
      });
      const execution: GuardedAgentExecution<TTask, TAgent> = {
        codex: new Codex(configured.codexOptions),
        invocation: request.invocation,
        agentProfile: configured.agentProfile,
        threadOptions: isolation.value.threadOptions,
      };
      return await new GuardedCodexExecution(execution).execute();
    } finally {
      await isolation.value.dispose();
    }
  }
}
type GuardedAgentExecution<TTask extends string, TAgent extends string> = {
  readonly codex: Codex;
  readonly invocation: AgentExecutionInvocation<TTask, TAgent>;
  readonly agentProfile: AgentProfile<string>;
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
      execution.agentProfile.workspacePolicy !== AgentWorkspacePolicy.ReadOnly
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
      originMainSha: execution.invocation.originMainSha,
      pinnedLocalDevSha: execution.invocation.pinnedLocalDevSha,
      featureHeadSha: execution.invocation.featureHeadSha,
      phase: AgentSourceStabilityPhase.BeforeAttempt,
    };
    const before = new AgentSourceSnapshot(beforeAttempt).assertStable();
    if (before.isErr()) return err(before.error);
    let outcome: Result<AgentExecutionCompletion, AgentExecutionFailure>;
    let after: ReturnType<AgentSourceSnapshot['assertStable']>;
    try {
      outcome = await this.executeStable();
    } finally {
      const afterAttempt: AgentSourceStabilityCheck = {
        workingDirectory: execution.invocation.workingDirectory,
        sourceCommit: execution.invocation.sourceCommit,
        originMainSha: execution.invocation.originMainSha,
        pinnedLocalDevSha: execution.invocation.pinnedLocalDevSha,
        featureHeadSha: execution.invocation.featureHeadSha,
        phase: AgentSourceStabilityPhase.AfterAttempt,
      };
      after = new AgentSourceSnapshot(afterAttempt).assertStable();
    }
    if (after.isErr()) return err(after.error);
    return outcome;
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
      ...(execution.agentProfile.model
        ? { model: execution.agentProfile.model }
        : {}),
      modelReasoningEffort: this.reasoningEffort(
        execution.agentProfile.reasoningEffort,
      ),
    };
    let thread;
    try {
      thread = execution.codex.startThread(threadOptions);
    } catch {
      return err({
        kind: CodexExecutionFailureKind.RuntimeBoundary,
        message: 'Codex could not create the requested thread.',
      });
    }
    const prompt = this.buildPrompt();
    const outputSchema = WorkflowResultSchema.workflowTaskOutputSchema(
      execution.invocation.execution.resultKind,
    );
    const turnOptions: TurnOptions = {
      outputSchema,
      signal: execution.invocation.signal,
    };
    let streamedTurn;
    try {
      streamedTurn = await thread.runStreamed(prompt, turnOptions);
    } catch {
      return err({
        kind: CodexExecutionFailureKind.RuntimeBoundary,
        message: 'Codex could not start the requested turn.',
      });
    }
    const collectionArgs: CollectCodexTurnArgs = {
      events: streamedTurn.events,
      expectedResultKind: execution.invocation.execution.resultKind,
      observe: execution.invocation.observe,
    };
    return new CodexTurn(collectionArgs).collect();
  }
  private buildPrompt(): string {
    const invocation = this.execution.invocation;
    const upstream = JSON.stringify(invocation.upstreamOutputs);
    return [
      invocation.agentProfile.instructionPrefix,
      invocation.execution.instruction,
      `Immutable source commit: ${invocation.sourceCommit}`,
      `Fetched origin/main evidence: ${invocation.originMainSha}`,
      `Pinned local-dev feature base: ${invocation.pinnedLocalDevSha}`,
      `Canonical feature frontier: ${invocation.featureHeadSha}`,
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
    if (effort === AgentReasoningEffort.XHigh) {
      return 'xhigh';
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
type CodexTurnStateRequest = {
  readonly termination: TurnTermination;
  readonly thread: TurnText;
  readonly output: TurnText;
};
class CodexTurnState {
  readonly termination: TurnTermination;
  readonly thread: TurnText;
  readonly output: TurnText;
  constructor(request: CodexTurnStateRequest) {
    this.termination = request.termination;
    this.thread = request.thread;
    this.output = request.output;
  }

  static pending(): CodexTurnState {
    const missing: TurnText = { presence: TurnValuePresence.Missing };
    return new CodexTurnState({
      termination: TurnTermination.Pending,
      thread: missing,
      output: missing,
    });
  }

  advance(event: ThreadEvent): CodexTurnState {
    const thread =
      event.type === 'thread.started'
        ? new CodexTurnText(event.thread_id).value()
        : this.thread;
    const termination =
      event.type === 'turn.failed' || event.type === 'error'
        ? TurnTermination.Failed
        : event.type === 'turn.completed' &&
            this.termination !== TurnTermination.Failed
          ? TurnTermination.Completed
          : this.termination;
    const output =
      termination !== TurnTermination.Failed &&
      event.type === 'item.completed' &&
      event.item.type === 'agent_message'
        ? new CodexTurnText(event.item.text).value()
        : this.output;
    return new CodexTurnState({ termination, thread, output });
  }
}

class CodexTurnText {
  constructor(private readonly text: string) {}
  value(): TurnText {
    return this.text.length === 0
      ? { presence: TurnValuePresence.Missing }
      : { presence: TurnValuePresence.Present, text: this.text };
  }
}

enum CodexStreamLifecycle {
  Open = 'open',
  Exhausted = 'exhausted',
}

class CodexEventStream {
  constructor(private readonly events: AsyncIterable<ThreadEvent>) {}
  async collect(
    observe: RuntimeActivityObserver,
  ): Promise<Result<CodexTurnState, AgentExecutionFailure>> {
    let iterator;
    try {
      const open = this.events[Symbol.asyncIterator];
      iterator = open.call(this.events);
    } catch {
      return err({
        kind: CodexExecutionFailureKind.RuntimeBoundary,
        message: 'Codex event stream could not be opened.',
      });
    }
    let state = CodexTurnState.pending();
    let lifecycle = CodexStreamLifecycle.Open;
    let outcome: Result<CodexTurnState, AgentExecutionFailure> | false = false;
    let closeFailure: AgentExecutionFailure | false = false;
    try {
      while (outcome === false) {
        let next;
        try {
          next = await iterator.next();
        } catch {
          outcome = err({
            kind: CodexExecutionFailureKind.RuntimeBoundary,
            message: 'Codex event stream failed.',
          });
          break;
        }
        if (next.done) {
          lifecycle = CodexStreamLifecycle.Exhausted;
          outcome = ok(state);
          break;
        }
        state = state.advance(next.value);
        const observation = new CodexActivity(next.value).normalize();
        if (observation) await observe(observation);
      }
    } finally {
      if (lifecycle === CodexStreamLifecycle.Open && iterator.return) {
        try {
          await iterator.return();
        } catch {
          closeFailure = {
            kind: CodexExecutionFailureKind.RuntimeBoundary,
            message: 'Codex event stream could not be closed.',
          };
        }
      }
    }
    return closeFailure === false ? outcome : err(closeFailure);
  }
}

export class CodexTurn {
  constructor(private readonly request: CollectCodexTurnArgs) {}
  async collect(): Promise<
    Result<AgentExecutionCompletion, AgentExecutionFailure>
  > {
    const collected = await new CodexEventStream(this.request.events).collect(
      this.request.observe,
    );
    if (collected.isErr()) return err(collected.error);
    const state = collected.value;
    if (state.termination === TurnTermination.Failed)
      return err(
        new CodexExecutionFailure({
          kind: CodexExecutionFailureKind.FailedTurn,
          message: 'Codex turn failed before a valid structured result.',
        }),
      );
    if (
      state.termination !== TurnTermination.Completed ||
      state.thread.presence === TurnValuePresence.Missing ||
      state.output.presence === TurnValuePresence.Missing
    )
      return err(
        new CodexExecutionFailure({
          kind: CodexExecutionFailureKind.IncompleteTurn,
          message:
            'Codex completed without a thread identity or structured result.',
        }),
      );
    let output: AgentExecutionCompletion['output'];
    try {
      output = WorkflowResultSchema.decodeWorkflowTaskOutput(state.output.text);
    } catch {
      return err(
        new CodexExecutionFailure({
          kind: CodexExecutionFailureKind.RuntimeBoundary,
          message: 'Codex structured result could not be decoded.',
        }),
      );
    }
    if (output.resultKind !== this.request.expectedResultKind)
      return err(
        new CodexExecutionFailure({
          kind: CodexExecutionFailureKind.ResultKind,
          message: `Codex result kind ${output.resultKind} does not match ${this.request.expectedResultKind}.`,
        }),
      );
    return ok({ threadId: state.thread.text, output });
  }
}
export class AgentSourceSnapshot {
  constructor(private readonly check: AgentSourceStabilityCheck) {}
  assertStable(): Result<void, AgentExecutionFailure> {
    const check = this.check;
    const headCommand: RepositoryCommandRequest = {
      command: RepositoryCommandExecutable.Git,
      args: ['rev-parse', 'HEAD'],
      rootDirectory: check.workingDirectory,
      workingDirectory: check.workingDirectory,
    };
    const headLaunch = new RepositoryCommand(headCommand).execute();
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
    const statusCommand: RepositoryCommandRequest = {
      command: RepositoryCommandExecutable.Git,
      args: ['status', '--porcelain', '--untracked-files=normal'],
      rootDirectory: check.workingDirectory,
      workingDirectory: check.workingDirectory,
    };
    const statusLaunch = new RepositoryCommand(statusCommand).execute();
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
    try {
      PinnedDevBaseEvidenceContract.assertAncestry({
        originMainSha: check.originMainSha,
        pinnedLocalDevSha: check.pinnedLocalDevSha,
        featureHeadSha: check.featureHeadSha,
        sourceCommit: check.sourceCommit,
        workingDirectory: check.workingDirectory,
      });
    } catch {
      return err(
        new CodexExecutionFailure({
          kind: CodexExecutionFailureKind.SourceCommit,
          message: `Codex agent source does not descend from the pinned local-dev base ${check.phase}.`,
        }),
      );
    }
    return ok();
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
