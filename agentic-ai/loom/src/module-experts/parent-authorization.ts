import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AgentAttemptEventKind } from '../agent-workflow/agent-events.ts';
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
  AgentAttemptTerminalRecordedEvent,
} from '../agent-workflow/agent-events.ts';
import type {
  CompletedTaskTerminal,
  ModuleExpertAuthorization,
  ParentAgentAttempt,
} from '../agent-workflow/domain.ts';
import { replayAgentAttemptJournal } from '../agent-workflow/agent-replay.ts';
import { decodeWorkflowTaskOutput } from '../agent-workflow/structured-result-codec.ts';

const MAX_PARENT_EVENTS_BYTES = 1_048_576;
const MAX_PARENT_RESULT_BYTES = 262_144;
const MAX_PARENT_VIEW_BYTES = 65_537;

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

type ParentAttemptIdentity = {
  readonly task: string;
  readonly agent: string;
  readonly attempt: number;
  readonly depth: number;
};

type ReadParentAttemptArgs = {
  readonly runDirectory: string;
  readonly runId: string;
  readonly workflowVersion: string;
  readonly sourceCommit: string;
  readonly identity: ParentAttemptIdentity;
};

type VerifiedParentAttempt = {
  readonly firstEvent: AgentAttemptEvent;
  readonly terminal: CompletedTaskTerminal<string>;
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
  const immediate = await readParentAttempt(immediateRead);
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
  return readParentAttempt(authorityRead);
}

async function readParentAttempt(
  args: ReadParentAttemptArgs,
): Promise<VerifiedParentAttempt> {
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
    [eventsSerialized, resultSerialized, viewSerialized] = await Promise.all([
      readFile(join(attemptDirectory, 'events.jsonl'), 'utf8'),
      readFile(join(attemptDirectory, 'result.json'), 'utf8'),
      readFile(join(attemptDirectory, 'view.md'), 'utf8'),
    ]);
  } catch {
    authorizationFailed();
  }
  if (
    Buffer.byteLength(eventsSerialized, 'utf8') > MAX_PARENT_EVENTS_BYTES ||
    Buffer.byteLength(resultSerialized, 'utf8') > MAX_PARENT_RESULT_BYTES ||
    Buffer.byteLength(viewSerialized, 'utf8') > MAX_PARENT_VIEW_BYTES
  ) {
    authorizationFailed();
  }
  let events: readonly AgentAttemptEvent[];
  let terminal: CompletedTaskTerminal<string>;
  try {
    events = eventsSerialized
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as AgentAttemptEvent);
    terminal = JSON.parse(resultSerialized) as CompletedTaskTerminal<string>;
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
    replayed.terminalKind !== TaskTerminalKind.Completed ||
    terminalEvent.terminalKind !== TaskTerminalKind.Completed ||
    firstEvent.runId !== args.runId ||
    firstEvent.workflow !== DelegatedAgentWorkflowName.AgentWork ||
    firstEvent.workflowVersion !== args.workflowVersion ||
    firstEvent.sourceCommit !== args.sourceCommit ||
    firstEvent.task !== args.identity.task ||
    firstEvent.agent !== args.identity.agent ||
    firstEvent.attempt !== args.identity.attempt ||
    firstEvent.depth !== args.identity.depth ||
    !completedTerminalHasExactKeys(terminal) ||
    terminal.kind !== TaskTerminalKind.Completed ||
    terminal.task !== args.identity.task ||
    terminal.attempt !== args.identity.attempt ||
    terminal.threadId.trim() === '' ||
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
  let decodedOutput: ReturnType<typeof decodeWorkflowTaskOutput>;
  try {
    decodedOutput = decodeWorkflowTaskOutput(JSON.stringify(terminal.output));
  } catch {
    authorizationFailed();
  }
  if (viewSerialized !== `${decodedOutput.materializedViewMarkdown.trim()}\n`) {
    authorizationFailed();
  }
  if (
    decodedOutput.resultKind === WorkflowResultKind.ModuleExpertEvidence &&
    firstEvent.adapter !== AgentAttemptAdapterKind.ModuleExpertInvocation
  ) {
    authorizationFailed();
  }
  return { firstEvent, terminal: { ...terminal, output: decodedOutput } };
}

function completedTerminalHasExactKeys(
  terminal: CompletedTaskTerminal<string>,
): boolean {
  const expected = new Set(['kind', 'task', 'attempt', 'threadId', 'output']);
  const keys = Object.keys(terminal);
  return (
    keys.length === expected.size && keys.every((key) => expected.has(key))
  );
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
