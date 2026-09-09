import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { AgentAttemptJournal } from '../agent-workflow/agent-journal.ts';
import type { StructuralExpertAttemptJournalConfiguration } from '../agent-workflow/agent-journal.ts';
import {
  AgentAttemptAdapterKind,
  DelegatedAgentWorkflowName,
  MaterializedViewPresence,
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
import { AgentAttemptReplay } from '../agent-workflow/agent-replay.ts';
import { StructuralExpertContract } from './audit.ts';
import { StructuralExpertKind, StructuralExpertCatalog } from './catalog.ts';
import { StructuralExpertOutputScope } from './output-scope.ts';
import {
  STRUCTURAL_EXPERT_WORKFLOW_VERSION,
  StructuralExpertParentAuthorization,
} from './parent-authorization.ts';
import { StructuralExpertRuntimeAuthority } from './trusted-runtime.ts';
import type { TrustedStructuralExecution } from './trusted-runtime.ts';
import { StructuralExpertRequestDecoder } from './request-codec.ts';
import type { StructuralExpertInvocationRequest } from './request-codec.ts';
import { AgentAttemptEventKind } from '../agent-workflow/agent-events.ts';
import type {
  AgentAttemptEvent,
  AgentAttemptTerminalRecordedEvent,
} from '../agent-workflow/agent-events.ts';

/** Owns the structural expert invocation registry and its capability transitions. */
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
    const auditRequest = { repoRoot };
    const audit = StructuralExpertContract.auditStructuralExperts(auditRequest);
    const profile = StructuralExpertCatalog.structuralExpertProfile(
      request.expert,
    );
    if (!audit.auditOk || !profile) {
      throw new Error('Structural expert catalog validation failed.');
    }
    const runDirectory = join(
      repoRoot,
      'workflow',
      'processing',
      DelegatedAgentWorkflowName.AgentWork,
      request.runId,
    );
    const authorizationRequest = {
      request,
      runDirectory,
    };
    const parentAuthorization =
      await StructuralExpertParentAuthorization.verifyStructuralParentAuthorization(
        authorizationRequest,
      );
    const sessionRequest = {
      parentAuthorization,
      repoRoot,
      request,
    };
    const runtime =
      StructuralExpertRuntimeAuthority.createStructuralRuntimeSession(
        sessionRequest,
      );
    const configuration: StructuralExpertAttemptJournalConfiguration = {
      runDirectory,
      runId: request.runId,
      workflow: DelegatedAgentWorkflowName.AgentWork,
      workflowVersion: STRUCTURAL_EXPERT_WORKFLOW_VERSION,
      sourceCommit: request.sourceCommit,
      task: request.task,
      agent: request.expert,
      attempt: request.attempt,
      depth: 2,
      parent: request.parent,
      now: () => new Date().toISOString(),
    };
    const journalRequest = {
      authority: runtime.journalAuthority,
      configuration,
      identity: runtime.identity,
    };
    const journal = AgentAttemptJournal.createStructuralExpert(journalRequest);
    await journal.initialize();
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
    let execution: TrustedStructuralExecution;
    try {
      const executionRequest = {
        observe,
        session: runtime.session,
        signal: input.signal,
      };
      execution =
        await StructuralExpertRuntimeAuthority.executeStructuralExpert(
          executionRequest,
        );
    } catch {
      const failureInput: FinalizeStructuralFailureInput = {
        activityCount,
        journal,
        request,
        runDirectory,
      };
      return StructuralExpertInvocation.finalizeStructuralFailure(failureInput);
    }
    const completion = execution.completion;
    let output: ReturnType<
      typeof WorkflowResultSchema.decodeWorkflowTaskOutput
    >;
    try {
      output = WorkflowResultSchema.decodeWorkflowTaskOutput(
        JSON.stringify(completion.output),
      );
      if (
        completion.threadId.trim() === '' ||
        completion.threadId.length > 1024 ||
        output.resultKind !== profile.resultKind
      ) {
        throw new Error('Structural expert runtime completion is invalid.');
      }
      if (request.kind === StructuralExpertKind.RepositoryEvidence) {
        const scopeRequest = { output, profile, repoRoot, request };
        StructuralExpertOutputScope.validate(scopeRequest);
      }
    } catch {
      const failureInput: FinalizeStructuralFailureInput = {
        activityCount,
        journal,
        request,
        runDirectory,
      };
      return StructuralExpertInvocation.finalizeStructuralFailure(failureInput);
    }
    const terminal: TaskTerminal<string> = {
      kind: TaskTerminalKind.Completed,
      task: request.task,
      attempt: request.attempt,
      threadId: completion.threadId,
      output,
    };
    const finalizationRequest = {
      execution,
      terminal,
    };
    const beforeFinalization = journal.eventHighWaterMark;
    let processing: AgentAttemptProcessingReference;
    try {
      processing = await journal.finalizeStructuralExpert(finalizationRequest);
    } catch {
      if (journal.eventHighWaterMark === beforeFinalization) {
        const failureInput: FinalizeStructuralFailureInput = {
          activityCount,
          journal,
          request,
          runDirectory,
        };
        return StructuralExpertInvocation.finalizeStructuralFailure(
          failureInput,
        );
      }
      throw new Error('Structural expert processing finalization failed.');
    }
    const resultInput: StructuralInvocationResultInput = {
      processing,
      request,
      runDirectory,
      terminal,
    };
    const result = StructuralExpertInvocation.invocationResult(resultInput);
    await StructuralExpertInvocation.verifyStructuralExpertInvocationResult(
      result,
    );
    return result;
  }

  private static async finalizeStructuralFailure(
    input: FinalizeStructuralFailureInput,
  ): Promise<StructuralExpertInvocationResult> {
    if (input.activityCount < StructuralExpertInvocation.MAX_ACTIVITY_COUNT) {
      const observation: RuntimeActivityObservation = {
        activity: WorkflowRuntimeActivityKind.RuntimeError,
        detail: 'Structural expert runtime failed.',
      };
      await input.journal.observe(observation);
    }
    const terminal: TaskTerminal<string> = {
      kind: TaskTerminalKind.Failed,
      task: input.request.task,
      attempt: input.request.attempt,
      summary: 'Structural expert runtime failed.',
    };
    const processing = await input.journal.finalize(terminal);
    const resultInput: StructuralInvocationResultInput = {
      processing,
      request: input.request,
      runDirectory: input.runDirectory,
      terminal,
    };
    const result = StructuralExpertInvocation.invocationResult(resultInput);
    await StructuralExpertInvocation.verifyStructuralExpertInvocationResult(
      result,
    );
    return result;
  }

  private static invocationResult(
    input: StructuralInvocationResultInput,
  ): StructuralExpertInvocationResult {
    return {
      runDirectory: input.runDirectory,
      runId: input.request.runId,
      expert: input.request.expert,
      sourceCommit: input.request.sourceCommit,
      task: input.request.task,
      attempt: input.request.attempt,
      depth: 2,
      parent: input.request.parent,
      terminal: input.terminal,
      processing: input.processing,
    };
  }

  static async verifyStructuralExpertInvocationResult(
    result: StructuralExpertInvocationResult,
  ): Promise<void> {
    if (result.processing.view.presence !== MaterializedViewPresence.Recorded) {
      StructuralExpertInvocation.verificationFailed();
    }
    const attemptDirectory = join(
      'agents',
      result.task,
      `attempt-${result.attempt}`,
    );
    const expectedPaths = {
      events: join(attemptDirectory, 'events.jsonl'),
      result: join(attemptDirectory, 'result.json'),
      view: join(attemptDirectory, 'view.md'),
    };
    if (
      result.processing.events.path !== expectedPaths.events ||
      result.processing.result.path !== expectedPaths.result ||
      result.processing.view.projection.path !== expectedPaths.view
    ) {
      StructuralExpertInvocation.verificationFailed();
    }
    const eventsRead: ReadVerifiedProjectionRequest = {
      path: result.processing.events.path,
      runDirectory: result.runDirectory,
      sha256: result.processing.events.sha256,
    };
    const resultRead: ReadVerifiedProjectionRequest = {
      path: result.processing.result.path,
      runDirectory: result.runDirectory,
      sha256: result.processing.result.sha256,
    };
    const viewRead: ReadVerifiedProjectionRequest = {
      path: result.processing.view.projection.path,
      runDirectory: result.runDirectory,
      sha256: result.processing.view.projection.sha256,
    };
    const [eventsSerialized, resultSerialized, viewSerialized] =
      await Promise.all([
        StructuralExpertInvocation.readVerifiedProjection(eventsRead),
        StructuralExpertInvocation.readVerifiedProjection(resultRead),
        StructuralExpertInvocation.readVerifiedProjection(viewRead),
      ]);
    let projected: TaskTerminal<string>;
    let events: readonly AgentAttemptEvent[];
    try {
      projected = JSON.parse(resultSerialized) as TaskTerminal<string>;
      events = eventsSerialized
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as AgentAttemptEvent);
    } catch {
      StructuralExpertInvocation.verificationFailed();
    }
    if (
      JSON.stringify(projected) !== JSON.stringify(result.terminal) ||
      viewSerialized.trim() === ''
    ) {
      StructuralExpertInvocation.verificationFailed();
    }
    if (
      projected.kind === TaskTerminalKind.Completed &&
      viewSerialized !== `${projected.output.materializedViewMarkdown.trim()}\n`
    ) {
      StructuralExpertInvocation.verificationFailed();
    }
    let replayed: ReturnType<typeof AgentAttemptReplay.replay>;
    try {
      const replayRequest = { events };
      replayed = AgentAttemptReplay.replay(replayRequest);
    } catch {
      StructuralExpertInvocation.verificationFailed();
    }
    const first = events[0];
    const terminals = events.filter(
      (event) => event.kind === AgentAttemptEventKind.AttemptTerminalRecorded,
    ) as readonly AgentAttemptTerminalRecordedEvent[];
    const terminalEvent = terminals[0];
    if (
      !first ||
      !terminalEvent ||
      terminals.length !== 1 ||
      first.adapter !== AgentAttemptAdapterKind.StructuralExpertInvocation ||
      first.runId !== result.runId ||
      first.sourceCommit !== result.sourceCommit ||
      first.task !== result.task ||
      first.agent !== result.expert ||
      first.attempt !== result.attempt ||
      first.depth !== 2 ||
      JSON.stringify(first.parent) !== JSON.stringify(result.parent) ||
      replayed.eventCount !== events.length ||
      replayed.terminalKind !== result.terminal.kind ||
      JSON.stringify(replayed.view) !== JSON.stringify(result.processing.view)
    ) {
      StructuralExpertInvocation.verificationFailed();
    }
  }

  private static async readVerifiedProjection(
    input: ReadVerifiedProjectionRequest,
  ): Promise<string> {
    const runRoot = resolve(input.runDirectory);
    const absolutePath = resolve(runRoot, input.path);
    const relativePath = relative(runRoot, absolutePath);
    if (
      isAbsolute(input.path) ||
      input.path
        .split(/[\\/]/u)
        .some(
          (segment) => segment === '' || segment === '.' || segment === '..',
        ) ||
      relativePath === '..' ||
      relativePath.startsWith(`..${sep}`)
    ) {
      StructuralExpertInvocation.verificationFailed();
    }
    let serialized: string;
    try {
      serialized = await readFile(absolutePath, 'utf8');
    } catch {
      StructuralExpertInvocation.verificationFailed();
    }
    if (StructuralExpertInvocation.sha256(serialized) !== input.sha256)
      StructuralExpertInvocation.verificationFailed();
    return serialized;
  }

  private static sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private static verificationFailed(): never {
    throw new Error('Structural expert processing verification failed.');
  }
}

export type StructuralExpertInvocationResult = {
  readonly runDirectory: string;
  readonly runId: string;
  readonly expert: string;
  readonly sourceCommit: string;
  readonly task: string;
  readonly attempt: number;
  readonly depth: 2;
  readonly parent: AgentAttemptParent;
  readonly terminal: TaskTerminal<string>;
  readonly processing: AgentAttemptProcessingReference;
};

export type InvokeStructuralExpertRequest = {
  readonly repoRoot: string;
  readonly request: StructuralExpertInvocationRequest;
  readonly signal: AbortSignal;
};

type FinalizeStructuralFailureInput = {
  readonly activityCount: number;
  readonly journal: AgentAttemptJournal<string>;
  readonly request: StructuralExpertInvocationRequest;
  readonly runDirectory: string;
};

type StructuralInvocationResultInput = {
  readonly processing: AgentAttemptProcessingReference;
  readonly request: StructuralExpertInvocationRequest;
  readonly runDirectory: string;
  readonly terminal: TaskTerminal<string>;
};

type ReadVerifiedProjectionRequest = {
  readonly runDirectory: string;
  readonly path: string;
  readonly sha256: string;
};
