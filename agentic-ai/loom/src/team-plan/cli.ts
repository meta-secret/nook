#!/usr/bin/env bun
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';

import {
  discardFinalizedTeamPlan,
  finalizeTeamPlan,
  recordTeamPlan,
  restartTeamPlan,
  selectTeamPlan,
  startTeamPlan,
} from './runtime.ts';

import type {
  TeamPlanRecord,
  TeamPlanRecordRequest,
  TeamPlanStartRequest,
} from './domain.ts';

const HELP = `Usage:
  loom-team-plan start --plan <plan.json> --journal <events.jsonl> --repository-root <repo>
  loom-team-plan select --journal <events.jsonl>
  loom-team-plan record --journal <events.jsonl> --request <result.json>
  loom-team-plan restart --journal <events.jsonl> --plan <plan.json>
  loom-team-plan finalize --journal <events.jsonl>
  loom-team-plan discard --journal <events.jsonl> --run-id <id>
`;
const MAX_TEAM_PLAN_RECORD_REQUEST_BYTES = 1_048_576;
const TEAM_PLAN_RUN_ID = /^[0-9a-f]{64}$/u;

enum TeamPlanCommandKind {
  Start = 'start',
  Select = 'select',
  Record = 'record',
  Restart = 'restart',
  Finalize = 'finalize',
  Discard = 'discard',
}

type TeamPlanStartCommand = Readonly<{
  kind: TeamPlanCommandKind.Start;
  planPath: string;
  journalPath: string;
  repositoryRoot: string;
}>;

type TeamPlanJournalCommand = Readonly<{
  kind: TeamPlanCommandKind.Select | TeamPlanCommandKind.Finalize;
  journalPath: string;
}>;

type TeamPlanDiscardCommand = Readonly<{
  kind: TeamPlanCommandKind.Discard;
  journalPath: string;
  runId: string;
}>;

type TeamPlanRecordCommand = Readonly<{
  kind: TeamPlanCommandKind.Record | TeamPlanCommandKind.Restart;
  journalPath: string;
  requestPath: string;
}>;

type TeamPlanCommand =
  | TeamPlanStartCommand
  | TeamPlanJournalCommand
  | TeamPlanDiscardCommand
  | TeamPlanRecordCommand;

export type TeamPlanCliArguments = Readonly<{
  argv: readonly string[];
}>;

type CommandPathRequest = Readonly<{
  argv: readonly string[];
  index: number;
}>;

export async function runTeamPlanCli(
  cliArguments: TeamPlanCliArguments,
): Promise<number> {
  const command = parseTeamPlanCommand(cliArguments);
  if (!command) {
    console.error(HELP);
    return 2;
  }
  if (command.kind === TeamPlanCommandKind.Start) {
    const request: TeamPlanStartRequest = {
      planPath: command.planPath,
      journalPath: command.journalPath,
      repositoryRoot: command.repositoryRoot,
    };
    console.log(JSON.stringify(await startTeamPlan(request)));
    return 0;
  }
  if (command.kind === TeamPlanCommandKind.Select) {
    console.log(
      JSON.stringify(
        await selectTeamPlan({ journalPath: command.journalPath }),
      ),
    );
    return 0;
  }
  if (command.kind === TeamPlanCommandKind.Finalize) {
    console.log(
      JSON.stringify(
        await finalizeTeamPlan({ journalPath: command.journalPath }),
      ),
    );
    return 0;
  }
  if (command.kind === TeamPlanCommandKind.Discard) {
    await discardFinalizedTeamPlan({
      journalPath: command.journalPath,
      runId: command.runId,
    });
    console.log(JSON.stringify({ discarded: true }));
    return 0;
  }
  if (command.kind === TeamPlanCommandKind.Restart) {
    console.log(
      JSON.stringify(
        await restartTeamPlan({
          journalPath: command.journalPath,
          planPath: command.requestPath,
        }),
      ),
    );
    return 0;
  }
  if (!('requestPath' in command))
    throw new Error('Invalid Team Plan command.');
  const serialized = await readTeamPlanRecordRequest(command.requestPath);
  const record = JSON.parse(serialized) as TeamPlanRecord;
  const request: TeamPlanRecordRequest = {
    journalPath: command.journalPath,
    record,
  };
  console.log(JSON.stringify(await recordTeamPlan(request)));
  return 0;
}

async function readTeamPlanRecordRequest(requestPath: string): Promise<string> {
  const requestFile = await open(
    requestPath,
    constants.O_RDONLY | constants.O_NONBLOCK,
  );
  try {
    const requestStatus = await requestFile.stat();
    if (
      !requestStatus.isFile() ||
      requestStatus.size > MAX_TEAM_PLAN_RECORD_REQUEST_BYTES
    )
      throw new Error('Team Plan record request file is invalid or oversized.');
    const content = Buffer.alloc(MAX_TEAM_PLAN_RECORD_REQUEST_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < content.byteLength) {
      const read = await requestFile.read(
        content,
        bytesRead,
        content.byteLength - bytesRead,
        bytesRead,
      );
      if (read.bytesRead === 0) break;
      bytesRead += read.bytesRead;
    }
    if (bytesRead > MAX_TEAM_PLAN_RECORD_REQUEST_BYTES)
      throw new Error('Team Plan record request is oversized.');
    return content.subarray(0, bytesRead).toString('utf8');
  } finally {
    await requestFile.close();
  }
}

function parseTeamPlanCommand(
  cliArguments: TeamPlanCliArguments,
): TeamPlanCommand | false {
  const { argv } = cliArguments;
  const kind = argv[0];
  if (
    (kind === TeamPlanCommandKind.Select ||
      kind === TeamPlanCommandKind.Finalize) &&
    argv.length === 3 &&
    argv[1] === '--journal'
  ) {
    const journalPath = commandPathAt({ argv, index: 2 });
    if (!journalPath) return false;
    return { kind, journalPath };
  }
  if (
    kind === TeamPlanCommandKind.Discard &&
    argv.length === 5 &&
    argv[1] === '--journal' &&
    argv[3] === '--run-id'
  ) {
    const journalPath = commandPathAt({ argv, index: 2 });
    const runId = argv[4];
    if (
      !journalPath ||
      typeof runId !== 'string' ||
      !TEAM_PLAN_RUN_ID.test(runId)
    )
      return false;
    return { kind, journalPath, runId };
  }
  if (
    (kind === TeamPlanCommandKind.Record ||
      kind === TeamPlanCommandKind.Restart) &&
    argv.length === 5 &&
    argv[1] === '--journal' &&
    argv[3] === (kind === TeamPlanCommandKind.Record ? '--request' : '--plan')
  ) {
    const journalPath = commandPathAt({ argv, index: 2 });
    const requestPath = commandPathAt({ argv, index: 4 });
    if (!journalPath || !requestPath) return false;
    return { kind, journalPath, requestPath };
  }
  if (
    kind !== TeamPlanCommandKind.Start ||
    argv.length !== 7 ||
    argv[1] !== '--plan' ||
    argv[3] !== '--journal' ||
    argv[5] !== '--repository-root'
  )
    return false;
  const planPath = commandPathAt({ argv, index: 2 });
  const journalPath = commandPathAt({ argv, index: 4 });
  const repositoryRoot = commandPathAt({ argv, index: 6 });
  if (!planPath || !journalPath || !repositoryRoot) return false;
  return {
    kind,
    planPath,
    journalPath,
    repositoryRoot,
  };
}

function commandPathAt(request: CommandPathRequest): string | false {
  const value = request.argv[request.index];
  if (typeof value !== 'string' || value.startsWith('--')) return false;
  return resolve(value);
}

if (import.meta.main)
  process.exit(await runTeamPlanCli({ argv: process.argv.slice(2) }));
