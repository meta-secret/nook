import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { AgentAttemptEventKind } from '../agent-workflow/agent-events.ts';
import {
  AgentAttemptAdapterKind,
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
  MaterializedViewAuthorKind,
  MaterializedViewPresence,
  TaskTerminalKind,
  WorkflowResultKind,
} from '../agent-workflow/domain.ts';
import type {
  AgentAttemptEvent,
  AgentAttemptTerminalRecordedEvent,
} from '../agent-workflow/agent-events.ts';
import type {
  CompletedTaskTerminal,
  FailedTaskTerminal,
  MaterializedViewReference,
  ModuleExpertAuthorization,
  ParentAgentAttempt,
  ProjectionReference,
} from '../agent-workflow/domain.ts';
import { replayAgentAttemptJournal } from '../agent-workflow/agent-replay.ts';
import {
  MAX_MATERIALIZED_VIEW_MARKDOWN_LENGTH,
  decodeWorkflowTaskOutput,
} from '../agent-workflow/structured-result-codec.ts';

const MAX_PARENT_EVENTS_BYTES = 1_048_576;
const MAX_PARENT_RESULT_BYTES = 262_144;
const PERSISTED_VIEW_LINE_ENDING_LENGTH = 1;
const MAX_UTF8_BYTES_PER_UTF16_CODE_UNIT = 3;
const MAX_PARENT_VIEW_CHARACTERS =
  MAX_MATERIALIZED_VIEW_MARKDOWN_LENGTH + PERSISTED_VIEW_LINE_ENDING_LENGTH;
const MAX_PARENT_VIEW_BYTES =
  MAX_MATERIALIZED_VIEW_MARKDOWN_LENGTH * MAX_UTF8_BYTES_PER_UTF16_CODE_UNIT +
  PERSISTED_VIEW_LINE_ENDING_LENGTH;

export type ModuleExpertChildRequest = {
  readonly runId: string;
  readonly sourceCommit: string;
  readonly task: string;
  readonly expert: string;
  readonly attempt: number;
  readonly depth: number;
  readonly parent: ParentAgentAttempt;
};

export type VerifyModuleExpertParentAuthorizationArgs = {
  readonly runDirectory: string;
  readonly workflowVersion: string;
  readonly request: ModuleExpertChildRequest;
  readonly expertNames: readonly string[];
};

export enum ModuleExpertParentAuthorizationKind {
  Verified = 'verified-module-expert-parent-authorization',
}

export type VerifiedModuleExpertParentAuthorization = {
  readonly kind: ModuleExpertParentAuthorizationKind.Verified;
};

export type ConsumeModuleExpertParentAuthorizationArgs =
  VerifyModuleExpertParentAuthorizationArgs & {
    readonly authorization: VerifiedModuleExpertParentAuthorization;
  };

const VERIFIED_PARENT_AUTHORIZATIONS = new WeakMap<
  VerifiedModuleExpertParentAuthorization,
  string
>();

export type ParentAttemptIdentity = {
  readonly task: string;
  readonly agent: string;
  readonly attempt: number;
  readonly depth: number;
};

export type ReadParentAttemptArgs = {
  readonly runDirectory: string;
  readonly runId: string;
  readonly workflowVersion: string;
  readonly sourceCommit: string;
  readonly identity: ParentAttemptIdentity;
};

export type VerifiedParentAttempt = {
  readonly firstEvent: AgentAttemptEvent;
  readonly result: ProjectionReference;
  readonly terminal: CompletedTaskTerminal<string>;
  readonly view: MaterializedViewReference;
};

export type VerifiedBarrierAttempt = {
  readonly firstEvent: AgentAttemptEvent;
  readonly result: ProjectionReference;
  readonly terminal: CompletedTaskTerminal<string> | FailedTaskTerminal<string>;
  readonly view: MaterializedViewReference;
  readonly resultJson: string;
  readonly viewMarkdown: string;
};

type ReadBoundedParentProjectionArgs = {
  readonly runDirectory: string;
  readonly path: string;
  readonly maxBytes: number;
};

export async function verifyModuleExpertParentAuthorization(
  args: VerifyModuleExpertParentAuthorizationArgs,
): Promise<VerifiedModuleExpertParentAuthorization> {
  const immediateIdentity: ParentAttemptIdentity = {
    task: args.request.parent.task,
    agent: args.request.parent.agent,
    attempt: args.request.parent.attempt,
    depth: args.request.depth - 1,
  };
  const immediateRead: ReadParentAttemptArgs = {
    runDirectory: args.runDirectory,
    runId: args.request.runId,
    workflowVersion: args.workflowVersion,
    sourceCommit: args.request.sourceCommit,
    identity: immediateIdentity,
  };
  const immediate = await readVerifiedParentAttempt(immediateRead);
  const depthThreeArgs: ReadDepthThreeAuthorityArgs = { args, immediate };
  const authority =
    args.request.depth === 2
      ? immediate
      : await readDepthThreeAuthority(depthThreeArgs);
  if (
    authority.firstEvent.depth !== 1 ||
    authority.firstEvent.parent.kind !== AgentAttemptParentKind.WorkflowRoot ||
    authority.firstEvent.adapter ===
      AgentAttemptAdapterKind.ModuleExpertInvocation ||
    args.expertNames.includes(authority.firstEvent.agent) ||
    authority.terminal.output.resultKind !==
      WorkflowResultKind.ModuleDevelopmentPlan
  ) {
    authorizationFailed();
  }
  const expectedAuthorization: ModuleExpertAuthorization = {
    task: args.request.task,
    expert: args.request.expert,
    attempt: args.request.attempt,
    depth: args.request.depth,
    parent: args.request.parent,
  };
  if (
    !authority.terminal.output.moduleExpertAuthorizations.some(
      (authorization) =>
        JSON.stringify(authorization) === JSON.stringify(expectedAuthorization),
    )
  ) {
    authorizationFailed();
  }
  const authorizationValue = {
    kind: ModuleExpertParentAuthorizationKind.Verified,
  } as const;
  const authorization: VerifiedModuleExpertParentAuthorization =
    Object.freeze(authorizationValue);
  VERIFIED_PARENT_AUTHORIZATIONS.set(
    authorization,
    parentAuthorizationDigest(args),
  );
  return authorization;
}

export function consumeModuleExpertParentAuthorization(
  args: ConsumeModuleExpertParentAuthorizationArgs,
): void {
  const expected = parentAuthorizationDigest(args);
  if (VERIFIED_PARENT_AUTHORIZATIONS.get(args.authorization) !== expected) {
    authorizationFailed();
  }
  VERIFIED_PARENT_AUTHORIZATIONS.delete(args.authorization);
}

type ReadDepthThreeAuthorityArgs = {
  readonly args: VerifyModuleExpertParentAuthorizationArgs;
  readonly immediate: VerifiedParentAttempt;
};

async function readDepthThreeAuthority(
  input: ReadDepthThreeAuthorityArgs,
): Promise<VerifiedParentAttempt> {
  if (
    input.immediate.firstEvent.parent.kind !==
      AgentAttemptParentKind.AgentAttempt ||
    !input.args.expertNames.includes(input.immediate.firstEvent.agent) ||
    input.immediate.terminal.output.resultKind !==
      WorkflowResultKind.ModuleExpertEvidence
  ) {
    authorizationFailed();
  }
  const authorityIdentity: ParentAttemptIdentity = {
    task: input.immediate.firstEvent.parent.task,
    agent: input.immediate.firstEvent.parent.agent,
    attempt: input.immediate.firstEvent.parent.attempt,
    depth: 1,
  };
  const authorityRead: ReadParentAttemptArgs = {
    runDirectory: input.args.runDirectory,
    runId: input.args.request.runId,
    workflowVersion: input.args.workflowVersion,
    sourceCommit: input.args.request.sourceCommit,
    identity: authorityIdentity,
  };
  return readVerifiedParentAttempt(authorityRead);
}

export async function readVerifiedParentAttempt(
  args: ReadParentAttemptArgs,
): Promise<VerifiedParentAttempt> {
  const attempt = await readVerifiedBarrierAttempt(args);
  if (attempt.terminal.kind !== TaskTerminalKind.Completed) {
    authorizationFailed();
  }
  return {
    firstEvent: attempt.firstEvent,
    result: attempt.result,
    terminal: attempt.terminal,
    view: attempt.view,
  };
}

export async function readVerifiedBarrierAttempt(
  args: ReadParentAttemptArgs,
): Promise<VerifiedBarrierAttempt> {
  const attemptDirectory = join(
    args.runDirectory,
    'agents',
    args.identity.task,
    `attempt-${args.identity.attempt}`,
  );
  let eventsSerialized: string;
  let resultSerialized: string;
  let viewSerialized: string;
  try {
    const eventsRead: ReadBoundedParentProjectionArgs = {
      runDirectory: args.runDirectory,
      path: join(attemptDirectory, 'events.jsonl'),
      maxBytes: MAX_PARENT_EVENTS_BYTES,
    };
    const resultRead: ReadBoundedParentProjectionArgs = {
      runDirectory: args.runDirectory,
      path: join(attemptDirectory, 'result.json'),
      maxBytes: MAX_PARENT_RESULT_BYTES,
    };
    const viewRead: ReadBoundedParentProjectionArgs = {
      runDirectory: args.runDirectory,
      path: join(attemptDirectory, 'view.md'),
      maxBytes: MAX_PARENT_VIEW_BYTES,
    };
    [eventsSerialized, resultSerialized, viewSerialized] = await Promise.all([
      readBoundedParentProjection(eventsRead),
      readBoundedParentProjection(resultRead),
      readBoundedParentProjection(viewRead),
    ]);
  } catch {
    authorizationFailed();
  }
  if (viewSerialized.length > MAX_PARENT_VIEW_CHARACTERS) {
    authorizationFailed();
  }
  let events: readonly AgentAttemptEvent[];
  let terminal: CompletedTaskTerminal<string> | FailedTaskTerminal<string>;
  try {
    events = eventsSerialized
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as AgentAttemptEvent);
    terminal = JSON.parse(resultSerialized) as
      CompletedTaskTerminal<string> | FailedTaskTerminal<string>;
  } catch {
    authorizationFailed();
  }
  const replayRequest = { events };
  let replayed: ReturnType<typeof replayAgentAttemptJournal>;
  try {
    replayed = replayAgentAttemptJournal(replayRequest);
  } catch {
    authorizationFailed();
  }
  const firstEvent = events[0];
  const terminalEvents = events.filter(
    (event) => event.kind === AgentAttemptEventKind.AttemptTerminalRecorded,
  ) as readonly AgentAttemptTerminalRecordedEvent[];
  const terminalEvent = terminalEvents[0];
  if (
    !firstEvent ||
    !terminalEvent ||
    terminalEvents.length !== 1 ||
    (terminal.kind !== TaskTerminalKind.Completed &&
      terminal.kind !== TaskTerminalKind.Failed) ||
    replayed.terminalKind !== terminal.kind ||
    terminalEvent.terminalKind !== terminal.kind ||
    firstEvent.runId !== args.runId ||
    firstEvent.workflow !== DelegatedAgentWorkflowName.AgentWork ||
    firstEvent.workflowVersion !== args.workflowVersion ||
    firstEvent.sourceCommit !== args.sourceCommit ||
    firstEvent.task !== args.identity.task ||
    firstEvent.agent !== args.identity.agent ||
    firstEvent.attempt !== args.identity.attempt ||
    firstEvent.depth !== args.identity.depth ||
    !barrierTerminalHasExactKeys(terminal) ||
    terminal.task !== args.identity.task ||
    terminal.attempt !== args.identity.attempt ||
    terminalEvent.result.path !==
      join(
        'agents',
        args.identity.task,
        `attempt-${args.identity.attempt}`,
        'result.json',
      ) ||
    sha256(resultSerialized) !== terminalEvent.result.sha256 ||
    terminalEvent.view.presence !== MaterializedViewPresence.Recorded ||
    terminalEvent.view.projection.path !==
      join(
        'agents',
        args.identity.task,
        `attempt-${args.identity.attempt}`,
        'view.md',
      ) ||
    sha256(viewSerialized) !== terminalEvent.view.projection.sha256 ||
    JSON.stringify(replayed.view) !== JSON.stringify(terminalEvent.view)
  ) {
    authorizationFailed();
  }
  if (terminal.kind === TaskTerminalKind.Failed) {
    const expectedView = failedAttemptView(terminal);
    if (
      terminal.summary.trim() === '' ||
      terminal.summary.length > 4096 ||
      viewSerialized !== expectedView ||
      terminalEvent.view.authorKind !== MaterializedViewAuthorKind.LoomRuntime
    ) {
      authorizationFailed();
    }
    return {
      firstEvent,
      result: terminalEvent.result,
      terminal,
      view: terminalEvent.view,
      resultJson: JSON.stringify(terminal),
      viewMarkdown: viewSerialized,
    };
  }
  if (terminal.threadId.trim() === '') authorizationFailed();
  let decodedOutput: ReturnType<typeof decodeWorkflowTaskOutput>;
  try {
    decodedOutput = decodeWorkflowTaskOutput(JSON.stringify(terminal.output));
  } catch {
    authorizationFailed();
  }
  if (
    viewSerialized !== `${decodedOutput.materializedViewMarkdown.trim()}\n` ||
    terminalEvent.view.authorKind !== MaterializedViewAuthorKind.Agent ||
    (decodedOutput.resultKind === WorkflowResultKind.ModuleExpertEvidence &&
      firstEvent.adapter !== AgentAttemptAdapterKind.ModuleExpertInvocation)
  ) {
    authorizationFailed();
  }
  const normalizedTerminal: CompletedTaskTerminal<string> = {
    ...terminal,
    output: decodedOutput,
  };
  return {
    firstEvent,
    result: terminalEvent.result,
    terminal: normalizedTerminal,
    view: terminalEvent.view,
    resultJson: JSON.stringify(normalizedTerminal),
    viewMarkdown: viewSerialized,
  };
}

async function readBoundedParentProjection(
  args: ReadBoundedParentProjectionArgs,
): Promise<string> {
  const projectionPath = await verifiedParentProjectionPath(args);
  const handle = await open(
    projectionPath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const status = await handle.stat();
    if (!status.isFile()) authorizationFailed();
    const buffer = Buffer.alloc(args.maxBytes + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const read = await handle.read(
        buffer,
        bytesRead,
        buffer.length - bytesRead,
        bytesRead,
      );
      if (read.bytesRead === 0) break;
      bytesRead += read.bytesRead;
    }
    if (bytesRead > args.maxBytes) authorizationFailed();
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

async function verifiedParentProjectionPath(
  args: ReadBoundedParentProjectionArgs,
): Promise<string> {
  const runDirectory = resolve(args.runDirectory);
  const projectionPath = resolve(args.path);
  const projectionRelativePath = relative(runDirectory, projectionPath);
  if (
    projectionRelativePath === '' ||
    pathEscapesRunDirectory(projectionRelativePath)
  ) {
    authorizationFailed();
  }
  const runDirectoryStatus = await lstat(runDirectory);
  if (
    runDirectoryStatus.isSymbolicLink() ||
    !runDirectoryStatus.isDirectory()
  ) {
    authorizationFailed();
  }
  const pathSegments = projectionRelativePath.split(sep);
  let currentPath = runDirectory;
  for (const [index, segment] of pathSegments.entries()) {
    currentPath = join(currentPath, segment);
    const status = await lstat(currentPath);
    const isProjectionFile = index === pathSegments.length - 1;
    if (
      status.isSymbolicLink() ||
      (isProjectionFile ? !status.isFile() : !status.isDirectory())
    ) {
      authorizationFailed();
    }
  }
  const resolvedRunDirectory = await realpath(runDirectory);
  const resolvedProjectionPath = await realpath(projectionPath);
  const resolvedRelativePath = relative(
    resolvedRunDirectory,
    resolvedProjectionPath,
  );
  if (
    resolvedRelativePath === '' ||
    pathEscapesRunDirectory(resolvedRelativePath)
  ) {
    authorizationFailed();
  }
  return projectionPath;
}

function pathEscapesRunDirectory(relativePath: string): boolean {
  return (
    isAbsolute(relativePath) ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`)
  );
}

function barrierTerminalHasExactKeys(
  terminal: CompletedTaskTerminal<string> | FailedTaskTerminal<string>,
): boolean {
  const expected = new Set(
    terminal.kind === TaskTerminalKind.Completed
      ? ['kind', 'task', 'attempt', 'threadId', 'output']
      : ['kind', 'task', 'attempt', 'summary'],
  );
  const keys = Object.keys(terminal);
  return (
    keys.length === expected.size && keys.every((key) => expected.has(key))
  );
}

function failedAttemptView(terminal: FailedTaskTerminal<string>): string {
  return [
    '# Agent attempt failure view',
    '',
    `Status: ${terminal.kind}`,
    '',
    'This view was produced by Loom because the agent did not complete an authored semantic view.',
    '',
    `Normalized outcome: ${terminal.summary}`,
    '',
  ].join('\n');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function parentAuthorizationDigest(
  args: VerifyModuleExpertParentAuthorizationArgs,
): string {
  const identity = {
    runDirectory: args.runDirectory,
    workflowVersion: args.workflowVersion,
    request: args.request,
    expertNames: args.expertNames,
  };
  return sha256(JSON.stringify(identity));
}

function authorizationFailed(): never {
  throw new Error('Module expert parent authorization failed.');
}
