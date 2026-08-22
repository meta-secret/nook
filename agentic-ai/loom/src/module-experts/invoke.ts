import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { AgentAttemptJournal } from '../agent-workflow/agent-journal.ts';
import {
  AgentAttemptEventKind,
  runtimeActivityEvent,
} from '../agent-workflow/agent-events.ts';
import {
  AgentAttemptParentKind,
  AgentReasoningEffort,
  AgentWorkspacePolicy,
  DelegatedAgentWorkflowName,
  MaterializedViewPresence,
  TaskTerminalKind,
  WorkflowExecutorKind,
  WorkflowResultKind,
} from '../agent-workflow/domain.ts';
import type {
  AgentAttemptEvent,
  AgentAttemptTerminalRecordedEvent,
} from '../agent-workflow/agent-events.ts';
import type {
  AgentAttemptParent,
  AgentAttemptProcessingReference,
  AgentProfile,
  AgentTaskExecution,
  TaskTerminal,
} from '../agent-workflow/domain.ts';
import type { AgentAttemptJournalConfiguration } from '../agent-workflow/agent-journal.ts';
import { replayAgentAttemptJournal } from '../agent-workflow/agent-replay.ts';
import { WorkflowRuntimeActivityKind } from '../agent-workflow/events.ts';
import { MAX_AGENT_HIERARCHY_DEPTH } from '../agent-workflow/hierarchy.ts';
import type {
  AgentExecutionCompletion,
  AgentExecutionInvocation,
  AgentTaskRuntime,
} from '../agent-workflow/runtime.ts';
import { decodeWorkflowTaskOutput } from '../agent-workflow/structured-result-codec.ts';
import {
  UntrustedYamlPropertyPresence,
  isRecord,
  untrustedYamlProperty,
} from '../lib/guards.ts';
import type {
  UntrustedYamlMap,
  UntrustedYamlNode,
  UntrustedYamlPropertyArgs,
} from '../lib/guards.ts';
import { auditModuleExperts } from './audit.ts';
import type { AuditModuleExpertsArgs } from './audit.ts';
import {
  MODULE_EXPERT_AGENT_INSTRUCTIONS,
  MODULE_EXPERT_CATALOG,
} from './catalog.ts';
import type { ModuleExpertProfile } from './catalog.ts';
import { verifyModuleExpertParentAuthorization } from './parent-authorization.ts';
import type {
  ModuleExpertChildRequest,
  VerifyModuleExpertParentAuthorizationArgs,
} from './parent-authorization.ts';

const MAX_REQUEST_BYTES = 65_536;
const MAX_INSTRUCTION_LENGTH = 16_384;
const MAX_ACTIVITY_COUNT = 256;
const MAX_AGENT_DEFINITION_BYTES = 65_536;
const MODULE_EXPERT_WORKFLOW_VERSION = '1.0.0';

export type ModuleExpertInvocationRequest = {
  readonly runId: string;
  readonly expert: string;
  readonly sourceCommit: string;
  readonly task: string;
  readonly attempt: number;
  readonly depth: number;
  readonly parent: AgentAttemptParent;
  readonly instruction: string;
};

export type ModuleExpertInvocationResult = {
  readonly runDirectory: string;
  readonly runId: string;
  readonly expert: string;
  readonly agentDefinitionPath: string;
  readonly agentDefinitionSha256: string;
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
  readonly runtime: AgentTaskRuntime<string, string>;
  readonly signal: AbortSignal;
};

export type VerifyModuleExpertInvocationResultArgs = {
  readonly result: ModuleExpertInvocationResult;
};

type ModuleExpertRequestProperty = {
  readonly record: UntrustedYamlMap;
  readonly key: string;
};

type ModuleExpertPromptContext = {
  readonly profile: ModuleExpertProfile;
  readonly instruction: string;
};

type ModuleExpertResultContext = {
  readonly runDirectory: string;
  readonly profile: ModuleExpertProfile;
  readonly definitionSha256: string;
  readonly request: ModuleExpertInvocationRequest;
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
  readonly definitionSha256: string;
  readonly request: ModuleExpertInvocationRequest;
};

export function decodeModuleExpertInvocationRequest(
  serialized: string,
): ModuleExpertInvocationRequest {
  if (Buffer.byteLength(serialized, 'utf8') > MAX_REQUEST_BYTES) {
    invalidRequest();
  }
  let node: UntrustedYamlNode;
  try {
    node = JSON.parse(serialized) as UntrustedYamlNode;
  } catch {
    invalidRequest();
  }
  if (!isRecord(node)) {
    invalidRequest();
  }
  const expectedKeys = [
    'attempt',
    'depth',
    'expert',
    'instruction',
    'parent',
    'runId',
    'sourceCommit',
    'task',
  ];
  const actualKeys = Object.keys(node).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    invalidRequest();
  }
  const expertProperty: ModuleExpertRequestProperty = {
    record: node,
    key: 'expert',
  };
  const runIdProperty: ModuleExpertRequestProperty = {
    record: node,
    key: 'runId',
  };
  const sourceCommitProperty: ModuleExpertRequestProperty = {
    record: node,
    key: 'sourceCommit',
  };
  const taskProperty: ModuleExpertRequestProperty = {
    record: node,
    key: 'task',
  };
  const instructionProperty: ModuleExpertRequestProperty = {
    record: node,
    key: 'instruction',
  };
  const attemptProperty: ModuleExpertRequestProperty = {
    record: node,
    key: 'attempt',
  };
  const depthProperty: ModuleExpertRequestProperty = {
    record: node,
    key: 'depth',
  };
  const parentProperty: ModuleExpertRequestProperty = {
    record: node,
    key: 'parent',
  };
  const runId = requiredString(runIdProperty);
  const expert = requiredString(expertProperty);
  const sourceCommit = requiredString(sourceCommitProperty);
  const task = requiredString(taskProperty);
  const instruction = requiredString(instructionProperty);
  const attempt = requiredNumber(attemptProperty);
  const depth = requiredNumber(depthProperty);
  const parent = requiredParent(parentProperty);
  const lineageValidation: ParentLineageValidation = {
    task,
    expert,
    attempt,
    depth,
    parent,
  };
  if (
    !safeIdentifier(runId) ||
    !safeIdentifier(expert) ||
    !/^[0-9a-f]{40}$/u.test(sourceCommit) ||
    !safeIdentifier(task) ||
    !validParentLineage(lineageValidation) ||
    instruction.trim() === '' ||
    instruction.length > MAX_INSTRUCTION_LENGTH ||
    containsForbiddenControl(instruction)
  ) {
    invalidRequest();
  }
  return {
    runId,
    expert,
    sourceCommit,
    task,
    attempt,
    depth,
    parent,
    instruction,
  };
}

function validatedInvocationRequest(
  request: ModuleExpertInvocationRequest,
): ModuleExpertInvocationRequest {
  let serialized: string;
  try {
    const encoded = JSON.stringify(request);
    if (typeof encoded !== 'string') invalidRequest();
    serialized = encoded;
  } catch {
    invalidRequest();
  }
  return decodeModuleExpertInvocationRequest(serialized);
}

export async function invokeModuleExpert(
  args: InvokeModuleExpertArgs,
): Promise<ModuleExpertInvocationResult> {
  const request = validatedInvocationRequest(args.request);
  const profile = MODULE_EXPERT_CATALOG.find(
    (candidate) => candidate.name === request.expert,
  );
  if (!profile) {
    throw new Error('Requested module expert is not registered.');
  }
  const auditArgs: AuditModuleExpertsArgs = { repoRoot: args.repoRoot };
  const audit = auditModuleExperts(auditArgs);
  if (!audit.auditOk) {
    throw new Error('Module expert catalog validation failed.');
  }
  const definitionPath = join(args.repoRoot, profile.agentDefinitionPath);
  const definition = readFileSync(definitionPath, 'utf8');
  if (Buffer.byteLength(definition, 'utf8') > MAX_AGENT_DEFINITION_BYTES) {
    throw new Error('Module expert agent definition exceeds its size bound.');
  }
  const runDirectory = join(
    args.repoRoot,
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
  await verifyModuleExpertParentAuthorization(authorizationArgs);
  const journalConfiguration: AgentAttemptJournalConfiguration = {
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
  const journal = new AgentAttemptJournal<string>(journalConfiguration);
  await journal.initialize();
  let activityCount = 0;
  const agentProfile: AgentProfile<string> = {
    name: profile.name,
    instructionPrefix: MODULE_EXPERT_AGENT_INSTRUCTIONS,
    workspacePolicy: AgentWorkspacePolicy.ReadOnly,
    reasoningEffort: AgentReasoningEffort.High,
  };
  const promptContext: ModuleExpertPromptContext = {
    profile,
    instruction: request.instruction,
  };
  const execution: AgentTaskExecution<string> = {
    kind: WorkflowExecutorKind.Agent,
    agent: profile.name,
    instruction: moduleExpertInstruction(promptContext),
    resultKind: WorkflowResultKind.ModuleExpertEvidence,
  };
  const invocation: AgentExecutionInvocation<string, string> = {
    task: request.task,
    attempt: request.attempt,
    sourceCommit: request.sourceCommit,
    runId: request.runId,
    workingDirectory: args.repoRoot,
    upstreamOutputs: [],
    signal: args.signal,
    observe: async (observation) => {
      if (activityCount >= MAX_ACTIVITY_COUNT) {
        throw new Error('Module expert runtime activity limit exceeded.');
      }
      const event = runtimeActivityEvent(observation);
      await journal.append(event);
      activityCount += 1;
    },
    execution,
    agentProfile,
  };
  let completion: AgentExecutionCompletion;
  try {
    completion = await args.runtime.executeAgent(invocation);
  } catch {
    const failureContext: FinalizeFailedAttemptContext = {
      journal,
      activityCount,
      runDirectory,
      profile,
      definitionSha256: sha256(definition),
      request,
    };
    return finalizeFailedAttempt(failureContext);
  }
  const completionContext: ValidateAgentCompletionContext = {
    completion,
    expectedResultKind: execution.resultKind,
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
      definitionSha256: sha256(definition),
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
    processing = await journal.finalize(terminal);
  } catch {
    if (journal.eventHighWaterMark === beforeFinalization) {
      const failureContext: FinalizeFailedAttemptContext = {
        journal,
        activityCount,
        runDirectory,
        profile,
        definitionSha256: sha256(definition),
        request,
      };
      return finalizeFailedAttempt(failureContext);
    }
    processingVerificationFailed();
  }
  const resultContext: ModuleExpertResultContext = {
    runDirectory,
    profile,
    definitionSha256: sha256(definition),
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
    agentDefinitionPath: context.profile.agentDefinitionPath,
    agentDefinitionSha256: context.definitionSha256,
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
    definitionSha256: context.definitionSha256,
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
    const projectedOutput = decodeWorkflowTaskOutput(
      JSON.stringify(projectedTerminal.output),
    );
    if (
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
    const replayRequest = { events };
    replayed = replayAgentAttemptJournal(replayRequest);
  } catch {
    processingVerificationFailed();
  }
  const firstEvent = events[0];
  const terminalEvents = events.filter(
    (event) => event.kind === AgentAttemptEventKind.AttemptTerminalRecorded,
  ) as readonly AgentAttemptTerminalRecordedEvent[];
  const terminalEvent = terminalEvents[0];
  if (
    !firstEvent ||
    terminalEvents.length !== 1 ||
    !terminalEvent ||
    firstEvent.runId !== result.runId ||
    firstEvent.workflow !== DelegatedAgentWorkflowName.AgentWork ||
    firstEvent.workflowVersion !== MODULE_EXPERT_WORKFLOW_VERSION ||
    firstEvent.sourceCommit !== result.sourceCommit ||
    firstEvent.task !== result.task ||
    firstEvent.agent !== result.expert ||
    firstEvent.attempt !== result.attempt ||
    firstEvent.depth !== result.depth ||
    JSON.stringify(firstEvent.parent) !== JSON.stringify(result.parent) ||
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

function moduleExpertInstruction(context: ModuleExpertPromptContext): string {
  const profile = context.profile;
  return [
    `Assigned module expert: ${profile.name}`,
    `Description: ${profile.description}`,
    `Module roots: ${JSON.stringify(profile.moduleRoots)}`,
    `Additional scope: ${JSON.stringify(profile.scopePaths)}`,
    `Generated scope: ${JSON.stringify(profile.generatedScopePaths.map((scope) => scope.path))}`,
    `Excluded paths: ${JSON.stringify(profile.excludedPaths)}`,
    `Public entry points: ${JSON.stringify(profile.publicEntryPoints)}`,
    `Authority paths: ${JSON.stringify(profile.authorityPaths)}`,
    `Skill paths: ${JSON.stringify(profile.skillPaths)}`,
    `Focused validation selectors: ${JSON.stringify(profile.validationSelectors)}`,
    'Structured continuation: populate externalApi, dependencies, consumers, behaviorInvariants, securityInvariants, compatibilityInvariants, owningTests, focusedValidation, risks, unresolvedDecisions, and parentActions with at least one concrete entry each. Use an explicit none-with-reason entry when a category has no items.',
    'Parent actions are evidence for the delivery owner. They do not authorize scheduling, writes, or further delegation.',
    `Requested analysis:\n${context.instruction}`,
  ].join('\n\n');
}

function requiredString(property: ModuleExpertRequestProperty): string {
  const propertyArgs: UntrustedYamlPropertyArgs = {
    record: property.record,
    key: property.key,
  };
  const value = untrustedYamlProperty(propertyArgs);
  if (
    value.presence === UntrustedYamlPropertyPresence.Absent ||
    typeof value.value !== 'string'
  ) {
    invalidRequest();
  }
  return value.value;
}

function requiredNumber(property: ModuleExpertRequestProperty): number {
  const propertyArgs: UntrustedYamlPropertyArgs = {
    record: property.record,
    key: property.key,
  };
  const value = untrustedYamlProperty(propertyArgs);
  if (
    value.presence === UntrustedYamlPropertyPresence.Absent ||
    typeof value.value !== 'number'
  ) {
    invalidRequest();
  }
  return value.value;
}

function requiredParent(
  property: ModuleExpertRequestProperty,
): AgentAttemptParent {
  const propertyArgs: UntrustedYamlPropertyArgs = {
    record: property.record,
    key: property.key,
  };
  const value = untrustedYamlProperty(propertyArgs);
  if (
    value.presence === UntrustedYamlPropertyPresence.Absent ||
    !isRecord(value.value)
  ) {
    invalidRequest();
  }
  const kindProperty: ModuleExpertRequestProperty = {
    record: value.value,
    key: 'kind',
  };
  const kind = requiredString(kindProperty);
  if (kind === AgentAttemptParentKind.WorkflowRoot) {
    if (Object.keys(value.value).length !== 1) invalidRequest();
    return { kind: AgentAttemptParentKind.WorkflowRoot };
  }
  if (
    kind !== AgentAttemptParentKind.AgentAttempt ||
    JSON.stringify(Object.keys(value.value).sort()) !==
      JSON.stringify(['agent', 'attempt', 'kind', 'task'])
  ) {
    invalidRequest();
  }
  const taskProperty: ModuleExpertRequestProperty = {
    record: value.value,
    key: 'task',
  };
  const agentProperty: ModuleExpertRequestProperty = {
    record: value.value,
    key: 'agent',
  };
  const attemptProperty: ModuleExpertRequestProperty = {
    record: value.value,
    key: 'attempt',
  };
  const task = requiredString(taskProperty);
  const agent = requiredString(agentProperty);
  const attempt = requiredNumber(attemptProperty);
  if (
    !safeIdentifier(task) ||
    !safeIdentifier(agent) ||
    !Number.isSafeInteger(attempt) ||
    attempt < 1
  ) {
    invalidRequest();
  }
  return { kind: AgentAttemptParentKind.AgentAttempt, task, agent, attempt };
}

type ParentLineageValidation = {
  readonly task: string;
  readonly expert: string;
  readonly attempt: number;
  readonly depth: number;
  readonly parent: AgentAttemptParent;
};

function validParentLineage(validation: ParentLineageValidation): boolean {
  if (validation.parent.kind !== AgentAttemptParentKind.AgentAttempt) {
    return false;
  }
  return (
    Number.isSafeInteger(validation.attempt) &&
    validation.attempt >= 1 &&
    Number.isSafeInteger(validation.depth) &&
    validation.depth >= 2 &&
    validation.depth <= MAX_AGENT_HIERARCHY_DEPTH &&
    safeIdentifier(validation.parent.task) &&
    safeIdentifier(validation.parent.agent) &&
    Number.isSafeInteger(validation.parent.attempt) &&
    validation.parent.attempt >= 1 &&
    (validation.parent.task !== validation.task ||
      validation.parent.agent !== validation.expert ||
      validation.parent.attempt !== validation.attempt)
  );
}

function safeIdentifier(value: string): boolean {
  return value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value);
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
