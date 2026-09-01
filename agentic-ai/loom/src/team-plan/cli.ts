#!/usr/bin/env bun
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';

import {
  LoomFailure,
  LoomFailureCode,
  loomFailureFromCause,
} from '../loom-failure.ts';
import {
  discardFinalizedTeamPlan,
  finalizeTeamPlan,
  leaseTeamPlan,
  recordTeamPlan,
  restartTeamPlan,
  selectTeamPlan,
  startTeamPlan,
} from './index.ts';
import { MAX_MODULE_DELIVERY_NODES } from '../module-delivery/domain.ts';
import { assertTeamPlanRecord } from './domain.ts';
import { teamPlanMessages } from './messages.ts';
import { MAX_TEAM_PLAN_RECORD_REQUEST_BYTES } from './record-limits.ts';

import type {
  TeamPlanRecord,
  TeamPlanRecordRequest,
  TeamPlanStartRequest,
} from './domain.ts';
import type { TeamPlanMessages } from './messages.ts';

export { MAX_TEAM_PLAN_RECORD_REQUEST_BYTES } from './record-limits.ts';
const TEAM_PLAN_RECORD_READ_CHUNK_BYTES = 65_536;
const MAX_TEAM_PLAN_TASK_ID_LIST_BYTES = 262_144;
const TEAM_PLAN_RUN_ID = /^[0-9a-f]{64}$/u;

enum TeamPlanCommandKind {
  Start = 'start',
  Select = 'select',
  Lease = 'lease',
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
  kind: TeamPlanCommandKind.Select;
  journalPath: string;
}>;

type TeamPlanRunCommand = Readonly<{
  kind: TeamPlanCommandKind.Finalize | TeamPlanCommandKind.Discard;
  journalPath: string;
  runId: string;
}>;

type TeamPlanLeaseCommand = Readonly<{
  kind: TeamPlanCommandKind.Lease;
  journalPath: string;
  runId: string;
  generation: number;
  planDigest: string;
  taskIds: readonly string[];
}>;

type TeamPlanRecordCommand = Readonly<{
  kind: TeamPlanCommandKind.Record;
  journalPath: string;
  runId: string;
  requestPath: string;
}>;

type TeamPlanRestartCommand = Readonly<{
  kind: TeamPlanCommandKind.Restart;
  journalPath: string;
  runId: string;
  requestPath: string;
}>;

type TeamPlanCommand =
  | TeamPlanStartCommand
  | TeamPlanJournalCommand
  | TeamPlanLeaseCommand
  | TeamPlanRunCommand
  | TeamPlanRecordCommand
  | TeamPlanRestartCommand;

export type TeamPlanCliArguments = Readonly<{
  argv: readonly string[];
  locale: string;
}>;

type CommandPathRequest = Readonly<{
  argv: readonly string[];
  index: number;
}>;

type ReadTeamPlanRecordRequest = Readonly<{
  requestPath: string;
  messages: TeamPlanMessages;
}>;

type LocalizedTeamPlanRuntimeRequest<T> = Readonly<{
  messages: TeamPlanMessages;
  action: () => Promise<T>;
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
  let messages: TeamPlanMessages;
  try {
    messages = teamPlanMessages(cliArguments.locale);
  } catch (cause) {
    throw loomFailureFromCause({
      code: LoomFailureCode.TeamPlanValidationFailed,
      cause: cause instanceof Error ? cause : new Error('Invalid locale.'),
    });
  }
  const parsed = parseTeamPlanCommand(cliArguments);
  if (parsed.kind === TeamPlanCommandParseKind.Invalid) {
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
    console.log(
      JSON.stringify(
        await localizedTeamPlanRuntime({
          messages,
          action: () => startTeamPlan(request),
        }),
      ),
    );
    return 0;
  }
  if (command.kind === TeamPlanCommandKind.Select) {
    console.log(
      JSON.stringify(
        await localizedTeamPlanRuntime({
          messages,
          action: () => selectTeamPlan({ journalPath: command.journalPath }),
        }),
      ),
    );
    return 0;
  }
  if (command.kind === TeamPlanCommandKind.Lease) {
    console.log(
      JSON.stringify(
        await localizedTeamPlanRuntime({
          messages,
          action: () =>
            leaseTeamPlan({
              journalPath: command.journalPath,
              runId: command.runId,
              generation: command.generation,
              planDigest: command.planDigest,
              taskIds: command.taskIds,
            }),
        }),
      ),
    );
    return 0;
  }
  if (command.kind === TeamPlanCommandKind.Finalize) {
    console.log(
      JSON.stringify(
        await localizedTeamPlanRuntime({
          messages,
          action: () =>
            finalizeTeamPlan({
              journalPath: command.journalPath,
              runId: command.runId,
            }),
        }),
      ),
    );
    return 0;
  }
  if (command.kind === TeamPlanCommandKind.Discard) {
    await localizedTeamPlanRuntime({
      messages,
      action: () =>
        discardFinalizedTeamPlan({
          journalPath: command.journalPath,
          runId: command.runId,
        }),
    });
    console.log(JSON.stringify({ discarded: true }));
    return 0;
  }
  if (command.kind === TeamPlanCommandKind.Restart) {
    console.log(
      JSON.stringify(
        await localizedTeamPlanRuntime({
          messages,
          action: () =>
            restartTeamPlan({
              journalPath: command.journalPath,
              runId: command.runId,
              planPath: command.requestPath,
            }),
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
  const serialized = await readTeamPlanRecordRequest({
    requestPath: command.requestPath,
    messages,
  });
  let record: TeamPlanRecord;
  try {
    record = JSON.parse(serialized) as TeamPlanRecord;
  } catch {
    throw loomFailureFromCause({
      code: LoomFailureCode.TeamPlanValidationFailed,
      cause: new Error(messages.invalidRecordJson),
    });
  }
  try {
    assertTeamPlanRecord(record);
  } catch {
    throw loomFailureFromCause({
      code: LoomFailureCode.TeamPlanValidationFailed,
      cause: new Error(messages.invalidRecordContents),
    });
  }
  const request: TeamPlanRecordRequest = {
    journalPath: command.journalPath,
    runId: command.runId,
    record,
  };
  console.log(
    JSON.stringify(
      await localizedTeamPlanRuntime({
        messages,
        action: () => recordTeamPlan(request),
      }),
    ),
  );
  return 0;
}

async function localizedTeamPlanRuntime<T>(
  request: LocalizedTeamPlanRuntimeRequest<T>,
): Promise<T> {
  try {
    return await request.action();
  } catch (cause) {
    const failure =
      cause instanceof LoomFailure
        ? cause
        : loomFailureFromCause({
            code: LoomFailureCode.TeamPlanCommandFailed,
            cause:
              cause instanceof Error
                ? cause
                : new Error('Team Plan runtime command failed.'),
          });
    throw loomFailureFromCause({
      code: failure.code,
      cause: new Error(
        localizedRuntimeFailure({
          messages: request.messages,
          code: failure.code,
        }),
      ),
    });
  }
}

function localizedRuntimeFailure(request: {
  readonly messages: TeamPlanMessages;
  readonly code: LoomFailureCode;
}): string {
  switch (request.code) {
    case LoomFailureCode.TeamPlanValidationFailed:
      return request.messages.runtimeValidationFailure;
    case LoomFailureCode.TeamPlanStorageFailed:
      return request.messages.runtimeStorageFailure;
    case LoomFailureCode.TeamPlanRecoveryFailed:
      return request.messages.runtimeRecoveryFailure;
    default:
      return request.messages.runtimeCommandFailure;
  }
}

async function readTeamPlanRecordRequest(
  request: ReadTeamPlanRecordRequest,
): Promise<string> {
  try {
    const requestFile = await open(
      request.requestPath,
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
          cause: new Error(request.messages.invalidRecordFile),
        });
      const chunks: Buffer[] = [];
      let bytesRead = 0;
      while (bytesRead <= MAX_TEAM_PLAN_RECORD_REQUEST_BYTES) {
        const chunk = Buffer.alloc(
          Math.min(
            TEAM_PLAN_RECORD_READ_CHUNK_BYTES,
            MAX_TEAM_PLAN_RECORD_REQUEST_BYTES + 1 - bytesRead,
          ),
        );
        const read = await requestFile.read(
          chunk,
          0,
          chunk.byteLength,
          bytesRead,
        );
        if (read.bytesRead === 0) break;
        chunks.push(chunk.subarray(0, read.bytesRead));
        bytesRead += read.bytesRead;
      }
      if (bytesRead > MAX_TEAM_PLAN_RECORD_REQUEST_BYTES)
        throw loomFailureFromCause({
          code: LoomFailureCode.TeamPlanValidationFailed,
          cause: new Error(request.messages.oversizedRecord),
        });
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(
          Buffer.concat(chunks, bytesRead),
        );
      } catch {
        throw loomFailureFromCause({
          code: LoomFailureCode.TeamPlanValidationFailed,
          cause: new Error(request.messages.invalidRecordEncoding),
        });
      }
    } finally {
      await requestFile.close();
    }
  } catch (cause) {
    if (cause instanceof LoomFailure) throw cause;
    const storageCause =
      cause instanceof Error
        ? cause
        : new Error('Team Plan record request read failed.');
    throw loomFailureFromCause({
      code: LoomFailureCode.TeamPlanStorageFailed,
      cause: new Error(request.messages.runtimeStorageFailure, {
        cause: storageCause,
      }),
    });
  }
}

function parseTeamPlanCommand(
  cliArguments: TeamPlanCliArguments,
): TeamPlanCommandParse {
  const { argv } = cliArguments;
  const kind = argv[0];
  if (
    kind === TeamPlanCommandKind.Lease &&
    argv.length === 11 &&
    argv[1] === '--journal' &&
    argv[3] === '--run-id' &&
    argv[5] === '--generation' &&
    argv[7] === '--plan-digest' &&
    argv[9] === '--task-ids'
  ) {
    const journalPath = commandPathAt({ argv, index: 2 });
    const runId = argv[4];
    const generation = Number(argv[6]);
    const planDigest = argv[8];
    const taskIdsValue = argv[10];
    const taskIds =
      typeof taskIdsValue === 'string' &&
      Buffer.byteLength(taskIdsValue) <= MAX_TEAM_PLAN_TASK_ID_LIST_BYTES
        ? taskIdsValue.split(',', MAX_MODULE_DELIVERY_NODES + 1)
        : [];
    if (
      journalPath.kind === CommandPathKind.Invalid ||
      typeof runId !== 'string' ||
      !TEAM_PLAN_RUN_ID.test(runId) ||
      !Number.isSafeInteger(generation) ||
      generation < 1 ||
      typeof planDigest !== 'string' ||
      !TEAM_PLAN_RUN_ID.test(planDigest) ||
      taskIds.length === 0 ||
      taskIds.length > MAX_MODULE_DELIVERY_NODES ||
      taskIds.some((taskId) => taskId.length === 0)
    )
      return { kind: TeamPlanCommandParseKind.Invalid };
    return {
      kind: TeamPlanCommandParseKind.Valid,
      command: {
        kind,
        journalPath: journalPath.path,
        runId,
        generation,
        planDigest,
        taskIds,
      },
    };
  }
  if (
    kind === TeamPlanCommandKind.Select &&
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
    (kind === TeamPlanCommandKind.Discard ||
      kind === TeamPlanCommandKind.Finalize) &&
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
    kind === TeamPlanCommandKind.Record &&
    argv.length === 7 &&
    argv[1] === '--journal' &&
    argv[3] === '--run-id' &&
    argv[5] === '--request'
  ) {
    const journalPath = commandPathAt({ argv, index: 2 });
    const runId = argv[4];
    const requestPath = commandPathAt({ argv, index: 6 });
    if (
      journalPath.kind === CommandPathKind.Invalid ||
      typeof runId !== 'string' ||
      !TEAM_PLAN_RUN_ID.test(runId) ||
      requestPath.kind === CommandPathKind.Invalid
    )
      return { kind: TeamPlanCommandParseKind.Invalid };
    return {
      kind: TeamPlanCommandParseKind.Valid,
      command: {
        kind,
        journalPath: journalPath.path,
        runId,
        requestPath: requestPath.path,
      },
    };
  }
  if (
    kind === TeamPlanCommandKind.Restart &&
    argv.length === 7 &&
    argv[1] === '--journal' &&
    argv[3] === '--run-id' &&
    argv[5] === '--plan'
  ) {
    const journalPath = commandPathAt({ argv, index: 2 });
    const runId = argv[4];
    const requestPath = commandPathAt({ argv, index: 6 });
    if (
      journalPath.kind === CommandPathKind.Invalid ||
      typeof runId !== 'string' ||
      !TEAM_PLAN_RUN_ID.test(runId) ||
      requestPath.kind === CommandPathKind.Invalid
    )
      return { kind: TeamPlanCommandParseKind.Invalid };
    return {
      kind: TeamPlanCommandParseKind.Valid,
      command: {
        kind,
        journalPath: journalPath.path,
        runId,
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
