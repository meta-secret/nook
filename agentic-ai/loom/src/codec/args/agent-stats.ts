import { ResultKind } from '../../result.ts';
import { RequestKind } from '../enums.ts';
import { decodeErr, decodeOk, type DecodeResult } from '../field-error.ts';
import {
  denyUnknownKeys,
  expectBoolean,
  expectObject,
  expectPositiveInt,
  expectString,
} from '../object.ts';

export type AgentStatsAssembleRequest = {
  readonly prNumber: number;
  readonly scratchPath: string;
  readonly outputPath: string;
  readonly includeTestInventory: boolean;
};

export type AgentStatsFileRequest = {
  readonly statsFile: string;
};

function decodeAssemble(
  value: unknown,
  root: string,
): DecodeResult<AgentStatsAssembleRequest> {
  const object = expectObject(value, root);
  if (object.kind === ResultKind.Err) {
    return object;
  }
  const allowed = new Set([
    'prNumber',
    'scratchPath',
    'outputPath',
    'includeTestInventory',
  ]);
  const unknown = denyUnknownKeys(object.value, allowed, root);
  const prNumber = expectPositiveInt(object.value, 'prNumber', root);
  const scratchPath = expectString(object.value, 'scratchPath', root);
  const outputPath = expectString(object.value, 'outputPath', root);
  const includeTestInventory = expectBoolean(
    object.value,
    'includeTestInventory',
    root,
  );
  const errors = [
    ...unknown,
    ...(prNumber.kind === ResultKind.Err ? prNumber.errors : []),
    ...(scratchPath.kind === ResultKind.Err ? scratchPath.errors : []),
    ...(outputPath.kind === ResultKind.Err ? outputPath.errors : []),
    ...(includeTestInventory.kind === ResultKind.Err
      ? includeTestInventory.errors
      : []),
  ];
  if (errors.length > 0) {
    return decodeErr(errors);
  }
  return decodeOk({
    prNumber: (prNumber as { value: number }).value,
    scratchPath: (scratchPath as { value: string }).value,
    outputPath: (outputPath as { value: string }).value,
    includeTestInventory: (includeTestInventory as { value: boolean }).value,
  });
}

function decodeStatsFile(
  value: unknown,
  root: string,
): DecodeResult<AgentStatsFileRequest> {
  const object = expectObject(value, root);
  if (object.kind === ResultKind.Err) {
    return object;
  }
  const unknown = denyUnknownKeys(object.value, new Set(['statsFile']), root);
  const statsFile = expectString(object.value, 'statsFile', root);
  const errors = [
    ...unknown,
    ...(statsFile.kind === ResultKind.Err ? statsFile.errors : []),
  ];
  if (errors.length > 0) {
    return decodeErr(errors);
  }
  return decodeOk({
    statsFile: (statsFile as { value: string }).value,
  });
}

export function decodeAgentStatsAssembleRequest(
  value: unknown,
): DecodeResult<AgentStatsAssembleRequest> {
  return decodeAssemble(value, RequestKind.AgentStatsAssemble);
}

export function decodeAgentStatsValidateRequest(
  value: unknown,
): DecodeResult<AgentStatsFileRequest> {
  return decodeStatsFile(value, RequestKind.AgentStatsValidate);
}

export function decodeAgentStatsPublishRequest(
  value: unknown,
): DecodeResult<AgentStatsFileRequest> {
  return decodeStatsFile(value, RequestKind.AgentStatsPublish);
}

export const AGENT_STATS_ASSEMBLE_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['prNumber', 'scratchPath', 'outputPath', 'includeTestInventory'],
  properties: {
    prNumber: { type: 'integer', minimum: 1 },
    scratchPath: { type: 'string' },
    outputPath: { type: 'string' },
    includeTestInventory: { type: 'boolean' },
  },
} as const;

export const AGENT_STATS_FILE_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['statsFile'],
  properties: {
    statsFile: { type: 'string' },
  },
} as const;
