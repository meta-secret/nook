#!/usr/bin/env bun
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';

import { LoomFailureCode, loomFailureFromCause } from '../loom-failure.ts';
import {
  MAX_MODULE_DELIVERY_EVIDENCE_ENTRIES,
  MAX_MODULE_DELIVERY_EVIDENCE_ENTRY_CODE_UNITS,
} from '../module-delivery/evidence-limits.ts';
import {
  discardFinalizedTeamPlan,
  finalizeTeamPlan,
  recordTeamPlan,
  restartTeamPlan,
  selectTeamPlan,
  startTeamPlan,
} from './index.ts';
import { teamPlanMessages } from './messages.ts';

import type {
  TeamPlanRecord,
  TeamPlanRecordRequest,
  TeamPlanStartRequest,
} from './domain.ts';

const MAX_NON_EVIDENCE_RECORD_REQUEST_BYTES = 1_048_576;
const MAX_SERIALIZED_JSON_BYTES_PER_CODE_UNIT = 6;
export const MAX_TEAM_PLAN_RECORD_REQUEST_BYTES =
  MAX_NON_EVIDENCE_RECORD_REQUEST_BYTES +
  MAX_MODULE_DELIVERY_EVIDENCE_ENTRIES *
    MAX_MODULE_DELIVERY_EVIDENCE_ENTRY_CODE_UNITS *
    MAX_SERIALIZED_JSON_BYTES_PER_CODE_UNIT;
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
  locale: string;
}>;

type CommandPathRequest = Readonly<{
  argv: readonly string[];
  index: number;
}>;

enum TeamPlanCommandParseKind {
  Valid = 'valid',
  Invalid = 'invalid',
}

type TeamPlanCommandParse =
  | Readonly<{
      kind: TeamPlanCommandParseKind.Valid;
      command: TeamPlanCommand;
    }>
  | Readonly<{ kind: TeamPlanCommandParseKind.Invalid }>;

enum CommandPathKind {
  Valid = 'valid',
  Invalid = 'invalid',
}

type CommandPath =
  | Readonly<{ kind: CommandPathKind.Valid; path: string }>
  | Readonly<{ kind: CommandPathKind.Invalid }>;

export async function runTeamPlanCli(
  cliArguments: TeamPlanCliArguments,
): Promise<number> {
  const parsed = parseTeamPlanCommand(cliArguments);
  if (parsed.kind === TeamPlanCommandParseKind.Invalid) {
    const messages = teamPlanMessages(cliArguments.locale);
    console.error(messages.help);
    throw loomFailureFromCause({
      code: LoomFailureCode.TeamPlanValidationFailed,
      cause: new Error(messages.invalidArguments),
    });
  }
  const { command } = parsed;
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
    throw loomFailureFromCause({
      code: LoomFailureCode.TeamPlanCommandFailed,
      cause: new Error('Team Plan command dispatch is invalid.'),
    });
  const serialized = await readTeamPlanRecordRequest(command.requestPath);
  let record: TeamPlanRecord;
  try {
    record = JSON.parse(serialized) as TeamPlanRecord;
  } catch (cause) {
    throw loomFailureFromCause({
      code: LoomFailureCode.TeamPlanValidationFailed,
      cause:
        cause instanceof Error
          ? cause
          : new Error('Team Plan record JSON is invalid.'),
    });
  }
  const request: TeamPlanRecordRequest = {
    journalPath: command.journalPath,
    record,
  };
  console.log(JSON.stringify(await recordTeamPlan(request)));
  return 0;
}

async function readTeamPlanRecordRequest(requestPath: string): Promise<string> {
  try {
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
        throw loomFailureFromCause({
          code: LoomFailureCode.TeamPlanValidationFailed,
          cause: new Error(
            'Team Plan record request file is invalid or oversized.',
          ),
        });
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
        throw loomFailureFromCause({
          code: LoomFailureCode.TeamPlanValidationFailed,
          cause: new Error('Team Plan record request is oversized.'),
        });
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(
          content.subarray(0, bytesRead),
        );
      } catch (cause) {
        throw loomFailureFromCause({
          code: LoomFailureCode.TeamPlanValidationFailed,
          cause:
            cause instanceof Error
              ? cause
              : new Error('Team Plan record request UTF-8 is invalid.'),
        });
      }
    } finally {
      await requestFile.close();
    }
  } catch (cause) {
    throw loomFailureFromCause({
      code: LoomFailureCode.TeamPlanStorageFailed,
      cause:
        cause instanceof Error
          ? cause
          : new Error('Team Plan record request read failed.'),
    });
  }
}

function parseTeamPlanCommand(
  cliArguments: TeamPlanCliArguments,
): TeamPlanCommandParse {
  const { argv } = cliArguments;
  const kind = argv[0];
  if (
    (kind === TeamPlanCommandKind.Select ||
      kind === TeamPlanCommandKind.Finalize) &&
    argv.length === 3 &&
    argv[1] === '--journal'
  ) {
    const journalPath = commandPathAt({ argv, index: 2 });
    if (journalPath.kind === CommandPathKind.Invalid)
      return { kind: TeamPlanCommandParseKind.Invalid };
    return {
      kind: TeamPlanCommandParseKind.Valid,
      command: { kind, journalPath: journalPath.path },
    };
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
      journalPath.kind === CommandPathKind.Invalid ||
      typeof runId !== 'string' ||
      !TEAM_PLAN_RUN_ID.test(runId)
    )
      return { kind: TeamPlanCommandParseKind.Invalid };
    return {
      kind: TeamPlanCommandParseKind.Valid,
      command: { kind, journalPath: journalPath.path, runId },
    };
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
    if (
      journalPath.kind === CommandPathKind.Invalid ||
      requestPath.kind === CommandPathKind.Invalid
    )
      return { kind: TeamPlanCommandParseKind.Invalid };
    return {
      kind: TeamPlanCommandParseKind.Valid,
      command: {
        kind,
        journalPath: journalPath.path,
        requestPath: requestPath.path,
      },
    };
  }
  if (
    kind !== TeamPlanCommandKind.Start ||
    argv.length !== 7 ||
    argv[1] !== '--plan' ||
    argv[3] !== '--journal' ||
    argv[5] !== '--repository-root'
  )
    return { kind: TeamPlanCommandParseKind.Invalid };
  const planPath = commandPathAt({ argv, index: 2 });
  const journalPath = commandPathAt({ argv, index: 4 });
  const repositoryRoot = commandPathAt({ argv, index: 6 });
  if (
    planPath.kind === CommandPathKind.Invalid ||
    journalPath.kind === CommandPathKind.Invalid ||
    repositoryRoot.kind === CommandPathKind.Invalid
  )
    return { kind: TeamPlanCommandParseKind.Invalid };
  return {
    kind: TeamPlanCommandParseKind.Valid,
    command: {
      kind,
      planPath: planPath.path,
      journalPath: journalPath.path,
      repositoryRoot: repositoryRoot.path,
    },
  };
}

function commandPathAt(request: CommandPathRequest): CommandPath {
  const value = request.argv[request.index];
  if (typeof value !== 'string' || value.startsWith('--'))
    return { kind: CommandPathKind.Invalid };
  return { kind: CommandPathKind.Valid, path: resolve(value) };
}

if (import.meta.main)
  process.exit(
    await runTeamPlanCli({
      argv: process.argv.slice(2),
      locale: process.env.LC_ALL || process.env.LANG || 'en',
    }),
  );
