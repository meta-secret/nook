#!/usr/bin/env bun
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AgentAttemptJournal } from './agent-journal.ts';
import { AgentAttemptEventKind } from './agent-events.ts';
import { readVerifiedBarrierAttempt } from './attempt-verification.ts';
import {
  decodeDelegationAdmissionRequest,
  decodeDelegationPlan,
} from './delegation-codec.ts';
import {
  admitDelegationAttempt,
  requireDelegationAttemptAdmission,
  startDelegationRun,
} from './delegation-run-journal.ts';
import {
  AgentAttemptAdapterKind,
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
  TaskTerminalKind,
  WorkflowResultKind,
} from './domain.ts';
import { WorkflowRuntimeActivityKind } from './events.ts';
import { decodeWorkflowTaskOutput } from './structured-result-codec.ts';
import type { AgentAttemptEventWithoutMetadata } from './agent-events.ts';
import type { AgentAttemptJournalConfiguration } from './agent-journal.ts';
import type { ReadParentAttemptArgs } from './attempt-verification.ts';
import type {
  DelegationAdmissionRequest,
  DelegationAttemptDeclaration,
} from './delegation-domain.ts';
import type {
  AdmitDelegationAttemptInput,
  StartDelegationRunInput,
} from './delegation-run-journal.ts';
import type {
  AgentAttemptParent,
  TaskTerminal,
  WorkflowAttemptNumber,
} from './domain.ts';
import { CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION } from './agent-attempt-version.ts';
import {
  decodeDelegationFinalizationRequest,
  finalizeDelegationRun,
} from './delegation-aggregation.ts';
import type { FinalizeDelegationRunInput } from './delegation-aggregation.ts';
import { renderDelegationPlanTree } from './delegation-plan-tree.ts';

const HELP = `Loom delegated agent journal

Usage:
  loom-agent-delegation start --plan <plan.json> --working-directory <repo-root>
  loom-agent-delegation admit --request <request.json> --working-directory <repo-root>
  loom-agent-delegation record --request <request.json> --working-directory <repo-root>
  loom-agent-delegation finalize --request <request.json> --working-directory <repo-root>

Start persists one immutable source-bound delegation plan. Admit authorizes one
exactly declared attempt before dispatch. Record requires that admission,
creates the finalized content-addressed journal, and then rereads and verifies
its persisted event, result, and semantic view. Finalize verifies the planned
all-terminal hierarchy and materializes its root semantic view.
`;

enum DelegationCommandKind {
  Start = 'start',
  Admit = 'admit',
  Record = 'record',
  Finalize = 'finalize',
}

type DelegationStartCommandLine = {
  readonly kind: DelegationCommandKind.Start;
  readonly planPath: string;
  readonly workingDirectory: string;
};

type DelegationRecordCommandLine = {
  readonly kind: DelegationCommandKind.Record;
  readonly requestPath: string;
  readonly workingDirectory: string;
};

type DelegationAdmitCommandLine = {
  readonly kind: DelegationCommandKind.Admit;
  readonly requestPath: string;
  readonly workingDirectory: string;
};

type DelegationFinalizeCommandLine = {
  readonly kind: DelegationCommandKind.Finalize;
  readonly requestPath: string;
  readonly workingDirectory: string;
};

type DelegationCommandLine =
  | DelegationStartCommandLine
  | DelegationAdmitCommandLine
  | DelegationRecordCommandLine
  | DelegationFinalizeCommandLine;

type DelegationStartResponse = {
  readonly receipt: Awaited<ReturnType<typeof startDelegationRun>>;
  readonly rootAdmission: Awaited<ReturnType<typeof admitDelegationAttempt>>;
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
  if (commandLine.kind === DelegationCommandKind.Start) {
    return start(commandLine);
  }
  if (commandLine.kind === DelegationCommandKind.Admit) {
    return admit(commandLine);
  }
  if (commandLine.kind === DelegationCommandKind.Finalize) {
    return finalize(commandLine);
  }
  return record(commandLine);
}

async function start(commandLine: DelegationStartCommandLine): Promise<number> {
  const serialized = await readFile(commandLine.planPath, 'utf8');
  const plan = decodeDelegationPlan(serialized);
  const input: StartDelegationRunInput = {
    workingDirectory: commandLine.workingDirectory,
    plan,
  };
  const receipt = await startDelegationRun(input);
  const root = plan.attempts.find(
    (declaration) =>
      declaration.identity.task === plan.rootMaterializer.task &&
      declaration.identity.agent === plan.rootMaterializer.agent &&
      declaration.identity.attempt === plan.rootMaterializer.attempt,
  );
  if (!root) throw new Error('Delegation root materializer is missing.');
  const rootAdmissionRequestInput: AdmissionRequestForDeclarationInput = {
    runId: plan.runId,
    sourceCommit: plan.sourceCommit,
    declaration: root,
  };
  const admissionInput: AdmitDelegationAttemptInput = {
    workingDirectory: commandLine.workingDirectory,
    runId: plan.runId,
    request: admissionRequestForDeclaration(rootAdmissionRequestInput),
  };
  const rootAdmission = await admitDelegationAttempt(admissionInput);
  const response: DelegationStartResponse = { receipt, rootAdmission };
  process.stderr.write(renderDelegationPlanTree(plan));
  console.log(JSON.stringify(response));
  return 0;
}

async function admit(commandLine: DelegationAdmitCommandLine): Promise<number> {
  const serialized = await readFile(commandLine.requestPath, 'utf8');
  const request = decodeDelegationAdmissionRequest(serialized);
  const input: AdmitDelegationAttemptInput = {
    workingDirectory: commandLine.workingDirectory,
    runId: request.runId,
    request,
  };
  const receipt = await admitDelegationAttempt(input);
  console.log(JSON.stringify(receipt));
  return 0;
}

async function finalize(
  commandLine: DelegationFinalizeCommandLine,
): Promise<number> {
  const serialized = await readFile(commandLine.requestPath, 'utf8');
  const request = decodeDelegationFinalizationRequest(serialized);
  const input: FinalizeDelegationRunInput = {
    workingDirectory: commandLine.workingDirectory,
    request,
  };
  const receipt = await finalizeDelegationRun(input);
  console.log(JSON.stringify(receipt));
  return 0;
}

async function record(
  commandLine: DelegationRecordCommandLine,
): Promise<number> {
  const serialized = await readFile(commandLine.requestPath, 'utf8');
  const request = JSON.parse(serialized) as DelegationRecordRequest;
  assertRequest(request);
  const terminal = normalizedTerminal(request.terminal);
  const runDirectory = resolve(
    commandLine.workingDirectory,
    'workflow',
    'processing',
    DelegatedAgentWorkflowName.AgentWork,
    request.runId,
  );
  const admissionRequest: DelegationAdmissionRequest = {
    runId: request.runId,
    sourceCommit: request.sourceCommit,
    identity: {
      task: request.task,
      agent: request.agent,
      attempt: request.attempt,
    },
    depth: request.depth,
    parent: request.parent,
  };
  const admissionInput: AdmitDelegationAttemptInput = {
    workingDirectory: commandLine.workingDirectory,
    runId: request.runId,
    request: admissionRequest,
  };
  const admission = await requireDelegationAttemptAdmission(admissionInput);
  const journalConfiguration: AgentAttemptJournalConfiguration = {
    adapter: AgentAttemptAdapterKind.GenericDelegationRecorder,
    runDirectory,
    runId: request.runId,
    workflow: DelegatedAgentWorkflowName.AgentWork,
    workflowVersion: CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION,
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
  const processing = await journal.finalize(terminal);
  const verificationRequest: ReadParentAttemptArgs = {
    runDirectory,
    runId: request.runId,
    workflowVersion: CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION,
    sourceCommit: request.sourceCommit,
    identity: {
      task: request.task,
      agent: request.agent,
      attempt: request.attempt,
      depth: request.depth,
    },
  };
  await readVerifiedBarrierAttempt(verificationRequest);
  const response = { runDirectory, admission, processing };
  console.log(JSON.stringify(response));
  return 0;
}

type AdmissionRequestForDeclarationInput = {
  readonly runId: string;
  readonly sourceCommit: string;
  readonly declaration: DelegationAttemptDeclaration;
};

function admissionRequestForDeclaration(
  input: AdmissionRequestForDeclarationInput,
): DelegationAdmissionRequest {
  return {
    runId: input.runId,
    sourceCommit: input.sourceCommit,
    identity: input.declaration.identity,
    depth: input.declaration.depth,
    parent: input.declaration.parent,
  };
}

function parseCommandLine(
  argv: readonly string[],
): DelegationCommandLine | false {
  if (argv.length !== 5) return false;
  const command = argv[0];
  const workingDirectoryFlag = argv.indexOf('--working-directory');
  const workingDirectory = argv[workingDirectoryFlag + 1];
  if (
    workingDirectoryFlag !== 3 ||
    !workingDirectory ||
    workingDirectory.startsWith('--')
  ) {
    return false;
  }
  if (command === DelegationCommandKind.Start && argv[1] === '--plan') {
    const planPath = argv[2];
    if (!planPath || planPath.startsWith('--')) return false;
    return {
      kind: DelegationCommandKind.Start,
      planPath: resolve(planPath),
      workingDirectory: resolve(workingDirectory),
    };
  }
  if (
    (command !== DelegationCommandKind.Admit &&
      command !== DelegationCommandKind.Record &&
      command !== DelegationCommandKind.Finalize) ||
    argv[1] !== '--request'
  ) {
    return false;
  }
  const requestPath = argv[2];
  if (!requestPath || requestPath.startsWith('--')) return false;
  return {
    kind: command,
    requestPath: resolve(requestPath),
    workingDirectory: resolve(workingDirectory),
  };
}

function assertRequest(request: DelegationRecordRequest): void {
  if (
    !request ||
    typeof request.runId !== 'string' ||
    !safeFilesystemIdentifier(request.runId) ||
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

function normalizedTerminal(
  terminal: TaskTerminal<string>,
): TaskTerminal<string> {
  if (terminal.kind !== TaskTerminalKind.Completed) return terminal;
  if (
    terminal.output.resultKind === WorkflowResultKind.ModuleExpertEvidence ||
    terminal.output.resultKind === WorkflowResultKind.CodeRefactoringEvidence ||
    terminal.output.resultKind ===
      WorkflowResultKind.CortexRefactoringEvidence ||
    terminal.output.resultKind === WorkflowResultKind.SystemCoherenceSynthesis
  ) {
    throw new Error(
      'Generic delegation cannot record isolated expert evidence.',
    );
  }
  return {
    ...terminal,
    output: decodeWorkflowTaskOutput(JSON.stringify(terminal.output)),
  };
}

function safeFilesystemIdentifier(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

if (import.meta.main) {
  process.exit(await main());
}
