import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  AgentAttemptJournal,
  createModuleExpertAttemptJournal,
} from '../agent-workflow/agent-journal.ts';
import {
  AgentAttemptEventKind,
  runtimeActivityEvent,
} from '../agent-workflow/agent-events.ts';
import {
  AgentAttemptAdapterKind,
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
  MaterializedViewPresence,
  TaskTerminalKind,
  WorkflowResultKind,
} from '../agent-workflow/domain.ts';
import type {
  AgentAttemptEvent,
  AgentAttemptEventWithoutMetadata,
  AgentRuntimeActivityEvent,
  AgentAttemptTerminalRecordedEvent,
} from '../agent-workflow/agent-events.ts';
import type {
  AgentAttemptParent,
  AgentAttemptProcessingReference,
  TaskTerminal,
} from '../agent-workflow/domain.ts';
import type { ModuleExpertAttemptJournalConfiguration } from '../agent-workflow/agent-journal.ts';
import {
  MODULE_EXPERT_WORKFLOW_VERSION,
  createModuleExpertRuntimeSession,
  executeModuleExpertAgent,
} from './trusted-runtime.ts';
import type { TrustedModuleExpertExecution } from './trusted-runtime.ts';
import { replayAgentAttemptJournal } from '../agent-workflow/agent-replay.ts';
import { WorkflowRuntimeActivityKind } from '../agent-workflow/events.ts';
import type { RuntimeActivityObservation } from '../agent-workflow/events.ts';
import type { AgentExecutionCompletion } from '../agent-workflow/runtime.ts';
import { decodeWorkflowTaskOutput } from '../agent-workflow/structured-result-codec.ts';
import { auditModuleExperts } from './audit.ts';
import type { AuditModuleExpertsArgs } from './audit.ts';
import { MODULE_EXPERT_CATALOG } from './catalog.ts';
import type { ModuleExpertProfile } from './catalog.ts';
import { verifyModuleExpertParentAuthorization } from './parent-authorization.ts';
import { publishedCortexIdentifiersAtCommit } from '../lib/cortex-identifiers.ts';
import type {
  ModuleExpertChildRequest,
  VerifyModuleExpertParentAuthorizationArgs,
} from './parent-authorization.ts';
import {
  decodeModuleExpertInvocationRequest,
  validatedModuleExpertInvocationRequest,
} from './request-codec.ts';
import type {
  ModuleExpertInvocationRequest,
  ValidatedModuleExpertInvocationRequest,
} from './request-codec.ts';

export { decodeModuleExpertInvocationRequest } from './request-codec.ts';
export type { ModuleExpertInvocationRequest } from './request-codec.ts';

const MAX_ACTIVITY_COUNT = 256;

export type ModuleExpertInvocationResult = {
  readonly runDirectory: string;
  readonly runId: string;
  readonly expert: string;
  readonly selectedContextPaths: readonly string[];
  readonly sourceCommit: string;
  readonly task: string;
  readonly attempt: number;
  readonly depth: number;
  readonly parent: AgentAttemptParent;
  readonly terminal: TaskTerminal<string>;
  readonly processing: AgentAttemptProcessingReference;
};

export type InvokeModuleExpertArgs = {
  readonly repoRoot: string;
  readonly request: ModuleExpertInvocationRequest;
  readonly signal: AbortSignal;
};

export type VerifyModuleExpertInvocationResultArgs = {
  readonly result: ModuleExpertInvocationResult;
};

type ModuleExpertResultContext = {
  readonly runDirectory: string;
  readonly profile: ModuleExpertProfile;
  readonly request: ValidatedModuleExpertInvocationRequest;
  readonly terminal: TaskTerminal<string>;
  readonly processing: AgentAttemptProcessingReference;
};

type ValidateAgentCompletionContext = {
  readonly completion: AgentExecutionCompletion;
  readonly expectedResultKind: WorkflowResultKind;
};

type ValidatedAgentCompletion = {
  readonly threadId: string;
  readonly output: ReturnType<typeof decodeWorkflowTaskOutput>;
};

type ReadVerifiedProjectionArgs = {
  readonly runDirectory: string;
  readonly path: string;
  readonly sha256: string;
};

type FinalizeFailedAttemptContext = {
  readonly journal: AgentAttemptJournal<string>;
  readonly activityCount: number;
  readonly runDirectory: string;
  readonly profile: ModuleExpertProfile;
  readonly request: ValidatedModuleExpertInvocationRequest;
};

export async function invokeModuleExpert(
  args: InvokeModuleExpertArgs,
): Promise<ModuleExpertInvocationResult> {
  const request = validatedModuleExpertInvocationRequest(args.request);
  const repoRoot = resolve(args.repoRoot);
  const profile = MODULE_EXPERT_CATALOG.find(
    (candidate) => candidate.name === request.expert,
  );
  if (!profile) {
    throw new Error('Requested module expert is not registered.');
  }
  const auditArgs: AuditModuleExpertsArgs = { repoRoot };
  const audit = auditModuleExperts(auditArgs);
  if (!audit.auditOk) {
    throw new Error('Module expert catalog validation failed.');
  }
  const runDirectory = join(
    repoRoot,
    'workflow',
    'processing',
    DelegatedAgentWorkflowName.AgentWork,
    request.runId,
  );
  if (request.parent.kind !== AgentAttemptParentKind.AgentAttempt) {
    invalidRequest();
  }
  const childRequest: ModuleExpertChildRequest = {
    runId: request.runId,
    sourceCommit: request.sourceCommit,
    task: request.task,
    expert: request.expert,
    attempt: request.attempt,
    depth: request.depth,
    parent: request.parent,
  };
  const authorizationArgs: VerifyModuleExpertParentAuthorizationArgs = {
    runDirectory,
    workflowVersion: MODULE_EXPERT_WORKFLOW_VERSION,
    request: childRequest,
    expertNames: MODULE_EXPERT_CATALOG.map((expert) => expert.name),
  };
  const parentAuthorization =
    await verifyModuleExpertParentAuthorization(authorizationArgs);
  const journalConfiguration: ModuleExpertAttemptJournalConfiguration = {
    runDirectory,
    runId: request.runId,
    workflow: DelegatedAgentWorkflowName.AgentWork,
    workflowVersion: MODULE_EXPERT_WORKFLOW_VERSION,
    sourceCommit: request.sourceCommit,
    task: request.task,
    agent: profile.name,
    attempt: request.attempt,
    depth: request.depth,
    parent: request.parent,
    now: () => new Date().toISOString(),
  };
  const sessionArgs = {
    repoRoot,
    request,
    parentAuthorization,
  };
  const runtimeSession = createModuleExpertRuntimeSession(sessionArgs);
  const journalArgs = {
    configuration: journalConfiguration,
    authority: runtimeSession.journalAuthority,
    identity: runtimeSession.identity,
  };
  const journal = createModuleExpertAttemptJournal<string>(journalArgs);
  await journal.initialize();
  const selectedContextObservation: RuntimeActivityObservation = {
    activity: WorkflowRuntimeActivityKind.SourceReadCompleted,
    detail: 'Module expert context selected.',
  };
  const selectedContextEvent: AgentAttemptEventWithoutMetadata = {
    ...runtimeActivityEvent(selectedContextObservation),
    evidenceSha256: sha256(JSON.stringify(request.selectedContextPaths)),
  };
  await journal.append(selectedContextEvent);
  let activityCount = 1;
  const observe = async (
    observation: RuntimeActivityObservation,
  ): Promise<void> => {
    if (activityCount >= MAX_ACTIVITY_COUNT) {
      throw new Error('Module expert runtime activity limit exceeded.');
    }
    const event = runtimeActivityEvent(observation);
    await journal.append(event);
    activityCount += 1;
  };
  let trustedExecution: TrustedModuleExpertExecution;
  try {
    const executionArgs = {
      session: runtimeSession.session,
      signal: args.signal,
      observe,
    };
    trustedExecution = await executeModuleExpertAgent(executionArgs);
  } catch {
    const failureContext: FinalizeFailedAttemptContext = {
      journal,
      activityCount,
      runDirectory,
      profile,
      request,
    };
    return finalizeFailedAttempt(failureContext);
  }
  const completionContext: ValidateAgentCompletionContext = {
    completion: trustedExecution.completion,
    expectedResultKind: WorkflowResultKind.ModuleExpertEvidence,
  };
  let validatedCompletion: ValidatedAgentCompletion;
  try {
    validatedCompletion = validateAgentCompletion(completionContext);
  } catch {
    const failureContext: FinalizeFailedAttemptContext = {
      journal,
      activityCount,
      runDirectory,
      profile,
      request,
    };
    return finalizeFailedAttempt(failureContext);
  }
  const terminal: TaskTerminal<string> = {
    kind: TaskTerminalKind.Completed,
    task: request.task,
    attempt: request.attempt,
    threadId: validatedCompletion.threadId,
    output: validatedCompletion.output,
  };
  const beforeFinalization = journal.eventHighWaterMark;
  let processing: AgentAttemptProcessingReference;
  try {
    const finalizeArgs = { terminal, execution: trustedExecution };
    processing = await journal.finalizeModuleExpert(finalizeArgs);
  } catch {
    if (journal.eventHighWaterMark === beforeFinalization) {
      const failureContext: FinalizeFailedAttemptContext = {
        journal,
        activityCount,
        runDirectory,
        profile,
        request,
      };
      return finalizeFailedAttempt(failureContext);
    }
    processingVerificationFailed();
  }
  const resultContext: ModuleExpertResultContext = {
    runDirectory,
    profile,
    request,
    terminal,
    processing,
  };
  const result = invocationResult(resultContext);
  const verificationArgs: VerifyModuleExpertInvocationResultArgs = { result };
  await verifyModuleExpertInvocationResult(verificationArgs);
  return result;
}

function invocationResult(
  context: ModuleExpertResultContext,
): ModuleExpertInvocationResult {
  return {
    runDirectory: context.runDirectory,
    runId: context.request.runId,
    expert: context.profile.name,
    selectedContextPaths: context.request.selectedContextPaths,
    sourceCommit: context.request.sourceCommit,
    task: context.request.task,
    attempt: context.request.attempt,
    depth: context.request.depth,
    parent: context.request.parent,
    terminal: context.terminal,
    processing: context.processing,
  };
}

async function finalizeFailedAttempt(
  context: FinalizeFailedAttemptContext,
): Promise<ModuleExpertInvocationResult> {
  if (context.activityCount < MAX_ACTIVITY_COUNT) {
    const failureObservation = {
      activity: WorkflowRuntimeActivityKind.RuntimeError,
      detail: 'Module expert runtime failed.',
    };
    const failureEvent = runtimeActivityEvent(failureObservation);
    await context.journal.append(failureEvent);
  }
  const terminal: TaskTerminal<string> = {
    kind: TaskTerminalKind.Failed,
    task: context.request.task,
    attempt: context.request.attempt,
    summary: 'Module expert runtime failed.',
  };
  const processing = await context.journal.finalize(terminal);
  const resultContext: ModuleExpertResultContext = {
    runDirectory: context.runDirectory,
    profile: context.profile,
    request: context.request,
    terminal,
    processing,
  };
  const result = invocationResult(resultContext);
  const verificationArgs: VerifyModuleExpertInvocationResultArgs = { result };
  await verifyModuleExpertInvocationResult(verificationArgs);
  return result;
}

function validateAgentCompletion(
  context: ValidateAgentCompletionContext,
): ValidatedAgentCompletion {
  const output = decodeWorkflowTaskOutput(
    JSON.stringify(context.completion.output),
  );
  if (
    context.completion.threadId.trim() === '' ||
    context.completion.threadId.length > 1024 ||
    containsForbiddenControl(context.completion.threadId) ||
    output.resultKind !== context.expectedResultKind
  ) {
    throw new Error('Module expert runtime completion is invalid.');
  }
  return { threadId: context.completion.threadId, output };
}

export async function verifyModuleExpertInvocationResult(
  args: VerifyModuleExpertInvocationResultArgs,
): Promise<void> {
  const result = args.result;
  if (result.processing.view.presence !== MaterializedViewPresence.Recorded) {
    processingVerificationFailed();
  }
  const expectedAttemptDirectory = join(
    'agents',
    result.task,
    `attempt-${result.attempt}`,
  );
  if (
    result.processing.events.path !==
      join(expectedAttemptDirectory, 'events.jsonl') ||
    result.processing.result.path !==
      join(expectedAttemptDirectory, 'result.json') ||
    result.processing.view.projection.path !==
      join(expectedAttemptDirectory, 'view.md')
  ) {
    processingVerificationFailed();
  }
  const eventsProjection: ReadVerifiedProjectionArgs = {
    runDirectory: result.runDirectory,
    path: result.processing.events.path,
    sha256: result.processing.events.sha256,
  };
  const resultProjection: ReadVerifiedProjectionArgs = {
    runDirectory: result.runDirectory,
    path: result.processing.result.path,
    sha256: result.processing.result.sha256,
  };
  const viewProjection: ReadVerifiedProjectionArgs = {
    runDirectory: result.runDirectory,
    path: result.processing.view.projection.path,
    sha256: result.processing.view.projection.sha256,
  };
  const eventsSerialized = await readVerifiedProjection(eventsProjection);
  const resultSerialized = await readVerifiedProjection(resultProjection);
  const viewSerialized = await readVerifiedProjection(viewProjection);
  let projectedTerminal: TaskTerminal<string>;
  let events: readonly AgentAttemptEvent[];
  try {
    projectedTerminal = JSON.parse(resultSerialized) as TaskTerminal<string>;
    events = eventsSerialized
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as AgentAttemptEvent);
  } catch {
    processingVerificationFailed();
  }
  if (
    JSON.stringify(projectedTerminal) !== JSON.stringify(result.terminal) ||
    viewSerialized.trim() === ''
  ) {
    processingVerificationFailed();
  }
  if (projectedTerminal.kind === TaskTerminalKind.Completed) {
    let projectedOutput: ReturnType<typeof decodeWorkflowTaskOutput>;
    try {
      projectedOutput = decodeWorkflowTaskOutput(
        JSON.stringify(projectedTerminal.output),
      );
    } catch {
      processingVerificationFailed();
    }
    if (
      projectedOutput.resultKind !== WorkflowResultKind.ModuleExpertEvidence ||
      JSON.stringify(projectedOutput) !==
        JSON.stringify(projectedTerminal.output) ||
      viewSerialized !==
        `${projectedTerminal.output.materializedViewMarkdown.trim()}\n`
    ) {
      processingVerificationFailed();
    }
  }
  let replayed: ReturnType<typeof replayAgentAttemptJournal>;
  try {
    const knownCortexIdentifiers = publishedCortexIdentifiersAtCommit({
      repoRoot: resolve(result.runDirectory, '../../../..'),
      sourceCommit: result.sourceCommit,
    });
    const replayRequest = { events, knownCortexIdentifiers };
    replayed = replayAgentAttemptJournal(replayRequest);
  } catch {
    processingVerificationFailed();
  }
  const firstEvent = events[0];
  const selectedContextEvent = events[1] as AgentRuntimeActivityEvent;
  const terminalEvents = events.filter(
    (event) => event.kind === AgentAttemptEventKind.AttemptTerminalRecorded,
  ) as readonly AgentAttemptTerminalRecordedEvent[];
  const terminalEvent = terminalEvents[0];
  if (
    !firstEvent ||
    !selectedContextEvent ||
    terminalEvents.length !== 1 ||
    !terminalEvent ||
    firstEvent.adapter !== AgentAttemptAdapterKind.ModuleExpertInvocation ||
    firstEvent.runId !== result.runId ||
    firstEvent.workflow !== DelegatedAgentWorkflowName.AgentWork ||
    firstEvent.workflowVersion !== MODULE_EXPERT_WORKFLOW_VERSION ||
    firstEvent.sourceCommit !== result.sourceCommit ||
    firstEvent.task !== result.task ||
    firstEvent.agent !== result.expert ||
    firstEvent.attempt !== result.attempt ||
    firstEvent.depth !== result.depth ||
    JSON.stringify(firstEvent.parent) !== JSON.stringify(result.parent) ||
    selectedContextEvent.kind !== AgentAttemptEventKind.RuntimeActivity ||
    selectedContextEvent.activity !==
      WorkflowRuntimeActivityKind.SourceReadCompleted ||
    selectedContextEvent.evidenceSha256 !==
      sha256(JSON.stringify(result.selectedContextPaths)) ||
    projectedTerminal.task !== result.task ||
    projectedTerminal.attempt !== result.attempt ||
    projectedTerminal.kind !== result.terminal.kind ||
    JSON.stringify(terminalEvent.result) !==
      JSON.stringify(result.processing.result) ||
    JSON.stringify(terminalEvent.view) !==
      JSON.stringify(result.processing.view) ||
    replayed.eventCount !== events.length ||
    replayed.terminalKind !== result.terminal.kind ||
    JSON.stringify(replayed.view) !== JSON.stringify(result.processing.view)
  ) {
    processingVerificationFailed();
  }
}

async function readVerifiedProjection(
  args: ReadVerifiedProjectionArgs,
): Promise<string> {
  const runRoot = resolve(args.runDirectory);
  const absolutePath = resolve(runRoot, args.path);
  const relativePath = relative(runRoot, absolutePath);
  const segments = args.path.split(/[\\/]/u);
  if (
    isAbsolute(args.path) ||
    segments.some(
      (segment) => segment === '' || segment === '.' || segment === '..',
    ) ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`)
  ) {
    processingVerificationFailed();
  }
  let serialized: string;
  try {
    serialized = await readFile(absolutePath, 'utf8');
  } catch {
    processingVerificationFailed();
  }
  if (sha256(serialized) !== args.sha256) {
    processingVerificationFailed();
  }
  return serialized;
}

function processingVerificationFailed(): never {
  throw new Error('Module expert processing verification failed.');
}

function containsForbiddenControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return (
      code === 127 || (code < 32 && code !== 9 && code !== 10 && code !== 13)
    );
  });
}

function invalidRequest(): never {
  throw new Error('Module expert invocation request is invalid.');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
