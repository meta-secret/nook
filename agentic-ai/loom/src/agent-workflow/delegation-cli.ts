#!/usr/bin/env bun
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AgentAttemptJournal } from './agent-journal.ts';
import { AgentAttemptEventKind } from './agent-events.ts';
import {
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
  TaskTerminalKind,
} from './domain.ts';
import { WorkflowRuntimeActivityKind } from './events.ts';
import type { AgentAttemptEventWithoutMetadata } from './agent-events.ts';
import type { AgentAttemptJournalConfiguration } from './agent-journal.ts';
import type {
  AgentAttemptParent,
  TaskTerminal,
  WorkflowAttemptNumber,
} from './domain.ts';

const HELP = `Loom delegated agent journal

Usage:
  loom-agent-delegation record --request <request.json> --working-directory <repo-root>

The request declares runId, sourceCommit, task, agent, attempt, depth, parent,
bounded activities, and a typed terminal. The command creates one finalized,
content-addressed agent attempt under workflow/processing/delegated-agent-work.
`;

type DelegationCommandLine = {
  readonly requestPath: string;
  readonly workingDirectory: string;
};

type DelegationActivity = {
  readonly activity: WorkflowRuntimeActivityKind;
  readonly detail: string;
};

type DelegationRecordRequest = {
  readonly runId: string;
  readonly sourceCommit: string;
  readonly task: string;
  readonly agent: string;
  readonly attempt: WorkflowAttemptNumber;
  readonly depth: number;
  readonly parent: AgentAttemptParent;
  readonly activities: readonly DelegationActivity[];
  readonly terminal: TaskTerminal<string>;
};

const ACTIVITY_KINDS = new Set<string>(
  Object.values(WorkflowRuntimeActivityKind),
);
const TERMINAL_KINDS = new Set<string>(Object.values(TaskTerminalKind));

async function main(): Promise<number> {
  const commandLine = parseCommandLine(process.argv.slice(2));
  if (!commandLine) {
    console.error(HELP);
    return 2;
  }
  const serialized = await readFile(commandLine.requestPath, 'utf8');
  const request = JSON.parse(serialized) as DelegationRecordRequest;
  assertRequest(request);
  const runDirectory = resolve(
    commandLine.workingDirectory,
    'workflow',
    'processing',
    DelegatedAgentWorkflowName.AgentWork,
    request.runId,
  );
  const journalConfiguration: AgentAttemptJournalConfiguration = {
    runDirectory,
    runId: request.runId,
    workflow: DelegatedAgentWorkflowName.AgentWork,
    workflowVersion: '1.0.0',
    sourceCommit: request.sourceCommit,
    task: request.task,
    agent: request.agent,
    attempt: request.attempt,
    depth: request.depth,
    parent: request.parent,
    now: () => new Date().toISOString(),
  };
  const journal = new AgentAttemptJournal<string>(journalConfiguration);
  await journal.initialize();
  for (const activity of request.activities) {
    const event: AgentAttemptEventWithoutMetadata = {
      kind: AgentAttemptEventKind.RuntimeActivity,
      activity: activity.activity,
      detail: activity.detail,
    };
    await journal.append(event);
  }
  const processing = await journal.finalize(request.terminal);
  const response = { runDirectory, processing };
  console.log(JSON.stringify(response));
  return 0;
}

function parseCommandLine(
  argv: readonly string[],
): DelegationCommandLine | false {
  if (argv.length !== 5 || argv[0] !== 'record') return false;
  const requestFlag = argv.indexOf('--request');
  const workingDirectoryFlag = argv.indexOf('--working-directory');
  const requestPath = argv[requestFlag + 1];
  const workingDirectory = argv[workingDirectoryFlag + 1];
  if (
    requestFlag !== 1 ||
    workingDirectoryFlag !== 3 ||
    !requestPath ||
    !workingDirectory ||
    requestPath.startsWith('--') ||
    workingDirectory.startsWith('--')
  ) {
    return false;
  }
  return {
    requestPath: resolve(requestPath),
    workingDirectory: resolve(workingDirectory),
  };
}

function assertRequest(request: DelegationRecordRequest): void {
  if (
    !request ||
    typeof request.runId !== 'string' ||
    request.runId.trim() === '' ||
    !/^[0-9a-f]{40}$/.test(request.sourceCommit) ||
    !Array.isArray(request.activities) ||
    !request.terminal ||
    !TERMINAL_KINDS.has(request.terminal.kind) ||
    request.terminal.task !== request.task ||
    request.terminal.attempt !== request.attempt
  ) {
    throw new Error(
      'Delegation journal request identity or terminal is invalid.',
    );
  }
  for (const activity of request.activities) {
    if (
      !activity ||
      !ACTIVITY_KINDS.has(activity.activity) ||
      typeof activity.detail !== 'string'
    ) {
      throw new Error('Delegation journal request activity is invalid.');
    }
  }
  if (request.terminal.kind === TaskTerminalKind.Completed) {
    const view = request.terminal.output.materializedViewMarkdown;
    if (view.trim() === '' || view.length > 65_536) {
      throw new Error('Delegated agent materialized view must be bounded.');
    }
  }
  if (
    request.parent.kind !== AgentAttemptParentKind.WorkflowRoot &&
    request.parent.kind !== AgentAttemptParentKind.AgentAttempt
  ) {
    throw new Error('Delegation journal request parent is invalid.');
  }
}

if (import.meta.main) {
  process.exit(await main());
}
