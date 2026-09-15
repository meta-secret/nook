import { join, resolve } from 'node:path';
import {
  AgentAttemptJournal,
  type ActiveStructuralExpertJournal,
} from '../agent-workflow/agent-journal.ts';
import type { StructuralExpertAttemptJournalConfiguration } from '../agent-workflow/agent-journal.ts';
import {
  DelegatedAgentWorkflowName,
  TaskTerminalKind,
} from '../agent-workflow/domain.ts';
import type {
  AgentAttemptParent,
  AgentAttemptProcessingReference,
  TaskTerminal,
} from '../agent-workflow/domain.ts';
import { WorkflowResultSchema } from '../agent-workflow/structured-result-codec.ts';
import { WorkflowRuntimeActivityKind } from '../agent-workflow/events.ts';
import type { RuntimeActivityObservation } from '../agent-workflow/events.ts';
import type { AgentExecutionCompletion } from '../agent-workflow/runtime.ts';
import { StructuralExpertKind, StructuralExpertCatalog } from './catalog.ts';
import { StructuralExpertOutputScope } from './output-scope.ts';
import {
  STRUCTURAL_EXPERT_WORKFLOW_VERSION,
  StructuralExpertParentContext,
} from './parent-context.ts';
import { StructuralExpertRuntime } from './trusted-runtime.ts';
import { StructuralExpertRequestDecoder } from './request-codec.ts';
import type { StructuralExpertInvocationRequest } from './request-codec.ts';

/** Runs one trusted, bounded structural-expert task and returns its journaled result. */
export class StructuralExpertInvocation {
  private constructor() {}
  private static readonly MAX_ACTIVITY_COUNT = 256;

  static async invokeStructuralExpert(
    input: InvokeStructuralExpertRequest,
  ): Promise<StructuralExpertInvocationResult> {
    const request =
      StructuralExpertRequestDecoder.validatedStructuralExpertInvocationRequest(
        input.request,
      );
    const repoRoot = resolve(input.repoRoot);
    const profile = StructuralExpertCatalog.structuralExpertProfile(
      request.expert,
    );
    if (!profile) {
      throw new Error('Requested structural expert is not registered.');
    }
    const runDirectory = join(
      repoRoot,
      'workflow',
      'processing',
      DelegatedAgentWorkflowName.AgentWork,
      request.runId,
    );
    const childContexts = await StructuralExpertParentContext.read({
      runDirectory,
      request,
    });
    const runtime = StructuralExpertRuntime.createStructuralRuntimeSession({
      childContexts,
      repoRoot,
      request,
    });
    const configuration: StructuralExpertAttemptJournalConfiguration = {
      runDirectory,
      runId: request.runId,
      workflow: DelegatedAgentWorkflowName.AgentWork,
      workflowVersion: STRUCTURAL_EXPERT_WORKFLOW_VERSION,
      sourceCommit: request.sourceCommit,
      originMainSha: request.originMainSha,
      pinnedLocalDevSha: request.pinnedLocalDevSha,
      featureHeadSha: request.featureHeadSha,
      task: request.task,
      agent: request.expert,
      attempt: request.attempt,
      depth: 2,
      parent: request.parent,
      now: () => new Date().toISOString(),
    };
    const preparedJournal = AgentAttemptJournal.createStructuralExpert({
      configuration,
    });
    const journal = await preparedJournal.initialize();
    let activityCount = 0;
    const observe = async (
      observation: RuntimeActivityObservation,
    ): Promise<void> => {
      if (activityCount >= StructuralExpertInvocation.MAX_ACTIVITY_COUNT) {
        throw new Error('Structural expert runtime activity limit exceeded.');
      }
      await journal.observe(observation);
      activityCount += 1;
    };
    let completion: AgentExecutionCompletion;
    try {
      const runtimeResult =
        await StructuralExpertRuntime.executeStructuralExpert({
          observe,
          session: runtime.session,
          signal: input.signal,
        });
      if (runtimeResult.isErr()) {
        return StructuralExpertInvocation.finalizeStructuralFailure({
          activityCount,
          journal,
          request,
          runDirectory,
        });
      }
      completion = runtimeResult.value;
    } catch {
      return StructuralExpertInvocation.finalizeStructuralFailure({
        activityCount,
        journal,
        request,
        runDirectory,
      });
    }
    let output: ReturnType<
      typeof WorkflowResultSchema.decodeWorkflowTaskOutput
    >;
    try {
      output = WorkflowResultSchema.decodeWorkflowTaskOutputNode(
        completion.output,
      );
      if (
        completion.threadId.trim() === '' ||
        completion.threadId.length > 1024 ||
        StructuralExpertInvocation.containsForbiddenControl(
          completion.threadId,
        ) ||
        output.resultKind !== profile.resultKind
      ) {
        throw new Error('Structural expert runtime completion is invalid.');
      }
      if (request.kind === StructuralExpertKind.RepositoryEvidence) {
        StructuralExpertOutputScope.validate({
          output,
          profile,
          repoRoot,
          request,
        });
      }
    } catch {
      return StructuralExpertInvocation.finalizeStructuralFailure({
        activityCount,
        journal,
        request,
        runDirectory,
      });
    }
    const terminal: TaskTerminal<string> = {
      kind: TaskTerminalKind.Completed,
      task: request.task,
      attempt: request.attempt,
      threadId: completion.threadId,
      output,
    };
    const beforeFinalization = journal.eventHighWaterMark;
    let processing: AgentAttemptProcessingReference;
    try {
      processing = await journal.finalizeStructuralExpert({
        terminal,
      });
    } catch {
      if (journal.eventHighWaterMark !== beforeFinalization) {
        throw new Error('Structural expert processing finalization failed.');
      }
      return StructuralExpertInvocation.finalizeStructuralFailure({
        activityCount,
        journal,
        request,
        runDirectory,
      });
    }
    return StructuralExpertInvocation.invocationResult({
      processing,
      request,
      runDirectory,
      terminal,
    });
  }

  private static async finalizeStructuralFailure(
    input: FinalizeStructuralFailureInput,
  ): Promise<StructuralExpertInvocationResult> {
    if (input.activityCount < StructuralExpertInvocation.MAX_ACTIVITY_COUNT) {
      await input.journal.observe({
        activity: WorkflowRuntimeActivityKind.RuntimeError,
        detail: 'Structural expert runtime failed.',
      });
    }
    const terminal: TaskTerminal<string> = {
      kind: TaskTerminalKind.Failed,
      task: input.request.task,
      attempt: input.request.attempt,
      summary: 'Structural expert runtime failed.',
    };
    const processing = await input.journal.finalize(terminal);
    return StructuralExpertInvocation.invocationResult({
      processing,
      request: input.request,
      runDirectory: input.runDirectory,
      terminal,
    });
  }

  private static invocationResult(
    input: StructuralInvocationResultInput,
  ): StructuralExpertInvocationResult {
    return {
      runDirectory: input.runDirectory,
      runId: input.request.runId,
      expert: input.request.expert,
      sourceCommit: input.request.sourceCommit,
      originMainSha: input.request.originMainSha,
      pinnedLocalDevSha: input.request.pinnedLocalDevSha,
      featureHeadSha: input.request.featureHeadSha,
      task: input.request.task,
      attempt: input.request.attempt,
      depth: 2,
      parent: input.request.parent,
      terminal: input.terminal,
      processing: input.processing,
    };
  }

  private static containsForbiddenControl(value: string): boolean {
    return Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return (
        code === 127 || (code < 32 && code !== 9 && code !== 10 && code !== 13)
      );
    });
  }
}

export type StructuralExpertInvocationResult = Readonly<{
  readonly runDirectory: string;
  readonly runId: string;
  readonly expert: string;
  readonly sourceCommit: string;
  readonly originMainSha: string;
  readonly pinnedLocalDevSha: string;
  readonly featureHeadSha: string;
  readonly task: string;
  readonly attempt: number;
  readonly depth: 2;
  readonly parent: AgentAttemptParent;
  readonly terminal: TaskTerminal<string>;
  readonly processing: AgentAttemptProcessingReference;
}>;

export type InvokeStructuralExpertRequest = Readonly<{
  readonly repoRoot: string;
  readonly request: StructuralExpertInvocationRequest;
  readonly signal: AbortSignal;
}>;

type FinalizeStructuralFailureInput = Readonly<{
  readonly activityCount: number;
  readonly journal: ActiveStructuralExpertJournal<string>;
  readonly request: StructuralExpertInvocationRequest;
  readonly runDirectory: string;
}>;

type StructuralInvocationResultInput = Readonly<{
  readonly processing: AgentAttemptProcessingReference;
  readonly request: StructuralExpertInvocationRequest;
  readonly runDirectory: string;
  readonly terminal: TaskTerminal<string>;
}>;
