import { join, resolve } from 'node:path';
import {
  AgentAttemptJournal,
  type ActiveModuleExpertJournal,
} from '../agent-workflow/agent-journal.ts';
import type { ModuleExpertAttemptJournalConfiguration } from '../agent-workflow/agent-journal.ts';
import {
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
  TaskTerminalKind,
  WorkflowResultKind,
} from '../agent-workflow/domain.ts';
import type {
  AgentAttemptParent,
  AgentAttemptProcessingReference,
  TaskTerminal,
} from '../agent-workflow/domain.ts';
import { WorkflowRuntimeActivityKind } from '../agent-workflow/events.ts';
import type { RuntimeActivityObservation } from '../agent-workflow/events.ts';
import type { AgentExecutionCompletion } from '../agent-workflow/runtime.ts';
import { WorkflowResultSchema } from '../agent-workflow/structured-result-codec.ts';
import { MODULE_EXPERT_CATALOG } from './catalog.ts';
import type { ModuleExpertProfile } from './catalog.ts';
import {
  MODULE_EXPERT_WORKFLOW_VERSION,
  ModuleExpertRuntime,
} from './trusted-runtime.ts';
import { ModuleExpertRequestDecoder } from './request-codec.ts';
import type {
  ModuleExpertInvocationRequest,
  ValidatedModuleExpertInvocationRequest,
} from './request-codec.ts';

export { ModuleExpertRequestDecoder } from './request-codec.ts';
export type { ModuleExpertInvocationRequest } from './request-codec.ts';

/** Runs one trusted, bounded module-expert task and returns its journaled result. */
export class ModuleExpertInvocation {
  private constructor() {}
  private static readonly MAX_ACTIVITY_COUNT = 256;

  static async invokeModuleExpert(
    args: InvokeModuleExpertArgs,
  ): Promise<ModuleExpertInvocationResult> {
    const request =
      ModuleExpertRequestDecoder.validatedModuleExpertInvocationRequest(
        args.request,
      );
    const repoRoot = resolve(args.repoRoot);
    const profile = MODULE_EXPERT_CATALOG.find(
      (candidate) => candidate.name === request.expert,
    );
    if (!profile) {
      throw new Error('Requested module expert is not registered.');
    }
    if (request.parent.kind !== AgentAttemptParentKind.AgentAttempt) {
      ModuleExpertInvocation.invalidRequest();
    }
    const runDirectory = join(
      repoRoot,
      'workflow',
      'processing',
      DelegatedAgentWorkflowName.AgentWork,
      request.runId,
    );
    const journalConfiguration: ModuleExpertAttemptJournalConfiguration = {
      runDirectory,
      runId: request.runId,
      workflow: DelegatedAgentWorkflowName.AgentWork,
      workflowVersion: MODULE_EXPERT_WORKFLOW_VERSION,
      sourceCommit: request.sourceCommit,
      originMainSha: request.originMainSha,
      pinnedLocalDevSha: request.pinnedLocalDevSha,
      featureHeadSha: request.featureHeadSha,
      task: request.task,
      agent: profile.name,
      attempt: request.attempt,
      depth: request.depth,
      parent: request.parent,
      now: () => new Date().toISOString(),
    };
    const runtimeSession = ModuleExpertRuntime.createModuleExpertRuntimeSession(
      {
        repoRoot,
        request,
      },
    );
    const preparedJournal = AgentAttemptJournal.createModuleExpert<string>({
      configuration: journalConfiguration,
    });
    const journal = await preparedJournal.initialize();
    await journal.observe({
      activity: WorkflowRuntimeActivityKind.SourceReadCompleted,
      detail: 'Module expert context selected.',
    });
    let activityCount = 1;
    const observe = async (
      observation: RuntimeActivityObservation,
    ): Promise<void> => {
      if (activityCount >= ModuleExpertInvocation.MAX_ACTIVITY_COUNT) {
        throw new Error('Module expert runtime activity limit exceeded.');
      }
      await journal.observe(observation);
      activityCount += 1;
    };
    let completion: AgentExecutionCompletion;
    try {
      const runtimeResult = await ModuleExpertRuntime.executeModuleExpertAgent({
        session: runtimeSession.session,
        signal: args.signal,
        observe,
      });
      if (runtimeResult.isErr()) {
        return ModuleExpertInvocation.finalizeFailedAttempt({
          journal,
          activityCount,
          runDirectory,
          profile,
          request,
        });
      }
      completion = runtimeResult.value;
    } catch {
      return ModuleExpertInvocation.finalizeFailedAttempt({
        journal,
        activityCount,
        runDirectory,
        profile,
        request,
      });
    }
    let validatedCompletion: ValidatedAgentCompletion;
    try {
      validatedCompletion = ModuleExpertInvocation.validateAgentCompletion({
        completion,
        expectedResultKind: WorkflowResultKind.ModuleExpertEvidence,
      });
    } catch {
      return ModuleExpertInvocation.finalizeFailedAttempt({
        journal,
        activityCount,
        runDirectory,
        profile,
        request,
      });
    }
    const terminal: TaskTerminal<string> = {
      kind: TaskTerminalKind.Completed,
      task: request.task,
      attempt: request.attempt,
      threadId: validatedCompletion.threadId,
      output: validatedCompletion.output,
    };
    let processing: AgentAttemptProcessingReference;
    try {
      processing = await journal.finalizeModuleExpert({ terminal });
    } catch {
      return ModuleExpertInvocation.finalizeFailedAttempt({
        journal,
        activityCount,
        runDirectory,
        profile,
        request,
      });
    }
    return ModuleExpertInvocation.invocationResult({
      runDirectory,
      profile,
      request,
      terminal,
      processing,
    });
  }

  private static invocationResult(
    context: ModuleExpertResultContext,
  ): ModuleExpertInvocationResult {
    return {
      runDirectory: context.runDirectory,
      runId: context.request.runId,
      expert: context.profile.name,
      selectedContextPaths: context.request.selectedContextPaths,
      sourceCommit: context.request.sourceCommit,
      originMainSha: context.request.originMainSha,
      pinnedLocalDevSha: context.request.pinnedLocalDevSha,
      featureHeadSha: context.request.featureHeadSha,
      task: context.request.task,
      attempt: context.request.attempt,
      depth: context.request.depth,
      parent: context.request.parent,
      terminal: context.terminal,
      processing: context.processing,
    };
  }

  private static async finalizeFailedAttempt(
    context: FinalizeFailedAttemptContext,
  ): Promise<ModuleExpertInvocationResult> {
    if (context.activityCount < ModuleExpertInvocation.MAX_ACTIVITY_COUNT) {
      await context.journal.observe({
        activity: WorkflowRuntimeActivityKind.RuntimeError,
        detail: 'Module expert runtime failed.',
      });
    }
    const terminal: TaskTerminal<string> = {
      kind: TaskTerminalKind.Failed,
      task: context.request.task,
      attempt: context.request.attempt,
      summary: 'Module expert runtime failed.',
    };
    const processing = await context.journal.finalize(terminal);
    return ModuleExpertInvocation.invocationResult({
      runDirectory: context.runDirectory,
      profile: context.profile,
      request: context.request,
      terminal,
      processing,
    });
  }

  private static validateAgentCompletion(
    context: ValidateAgentCompletionContext,
  ): ValidatedAgentCompletion {
    const output = WorkflowResultSchema.decodeWorkflowTaskOutputNode(
      context.completion.output,
    );
    if (
      context.completion.threadId.trim() === '' ||
      context.completion.threadId.length > 1024 ||
      ModuleExpertInvocation.containsForbiddenControl(
        context.completion.threadId,
      ) ||
      output.resultKind !== context.expectedResultKind
    ) {
      throw new Error('Module expert runtime completion is invalid.');
    }
    return { threadId: context.completion.threadId, output };
  }

  private static containsForbiddenControl(value: string): boolean {
    return Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return (
        code === 127 || (code < 32 && code !== 9 && code !== 10 && code !== 13)
      );
    });
  }

  private static invalidRequest(): never {
    throw new Error('Module expert invocation request is invalid.');
  }
}

export type ModuleExpertInvocationResult = Readonly<{
  readonly runDirectory: string;
  readonly runId: string;
  readonly expert: string;
  readonly selectedContextPaths: readonly string[];
  readonly sourceCommit: string;
  readonly originMainSha: string;
  readonly pinnedLocalDevSha: string;
  readonly featureHeadSha: string;
  readonly task: string;
  readonly attempt: number;
  readonly depth: number;
  readonly parent: AgentAttemptParent;
  readonly terminal: TaskTerminal<string>;
  readonly processing: AgentAttemptProcessingReference;
}>;

export type InvokeModuleExpertArgs = Readonly<{
  readonly repoRoot: string;
  readonly request: ModuleExpertInvocationRequest;
  readonly signal: AbortSignal;
}>;

type ModuleExpertResultContext = Readonly<{
  readonly runDirectory: string;
  readonly profile: ModuleExpertProfile;
  readonly request: ValidatedModuleExpertInvocationRequest;
  readonly terminal: TaskTerminal<string>;
  readonly processing: AgentAttemptProcessingReference;
}>;

type ValidateAgentCompletionContext = Readonly<{
  readonly completion: AgentExecutionCompletion;
  readonly expectedResultKind: WorkflowResultKind;
}>;

type ValidatedAgentCompletion = Readonly<{
  readonly threadId: string;
  readonly output: ReturnType<
    typeof WorkflowResultSchema.decodeWorkflowTaskOutput
  >;
}>;

type FinalizeFailedAttemptContext = Readonly<{
  readonly journal: ActiveModuleExpertJournal<string>;
  readonly activityCount: number;
  readonly runDirectory: string;
  readonly profile: ModuleExpertProfile;
  readonly request: ValidatedModuleExpertInvocationRequest;
}>;
