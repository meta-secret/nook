import {
  DecodeStatus,
  decodeErr,
  decodeOk,
  type DecodeOutcome,
} from '../field-error.ts';
import {
  denyUnknownKeys,
  expectBoolean,
  expectObject,
  expectPositiveInt,
  expectString,
} from '../object.ts';

export enum AgentStatsAssembleField {
  PrNumber = 'prNumber',
  ScratchPath = 'scratchPath',
  OutputPath = 'outputPath',
  IncludeTestInventory = 'includeTestInventory',
}

export enum AgentStatsFileField {
  StatsFile = 'statsFile',
}

export type AgentStatsAssembleRequest = {
  readonly prNumber: number;
  readonly scratchPath: string;
  readonly outputPath: string;
  readonly includeTestInventory: boolean;
};

export type AgentStatsFileRequest = {
  readonly statsFile: string;
};

export type DecodeAgentStatsAssemblePayloadArgs = {
  readonly value: unknown;
  readonly path: string;
};

export function decodeAgentStatsAssemblePayload(
  args: DecodeAgentStatsAssemblePayloadArgs,
): DecodeOutcome<AgentStatsAssembleRequest> {
  const { value, path } = args;

  const object = expectObject({ value, path });
  if (object.status === DecodeStatus.Failed) {
    return object;
  }
  const unknown = denyUnknownKeys({
    record: object.value,
    fields: AgentStatsAssembleField,
    path,
  });
  const prNumber = expectPositiveInt({
    record: object.value,
    key: AgentStatsAssembleField.PrNumber,
    path,
  });
  const scratchPath = expectString({
    record: object.value,
    key: AgentStatsAssembleField.ScratchPath,
    path,
  });
  const outputPath = expectString({
    record: object.value,
    key: AgentStatsAssembleField.OutputPath,
    path,
  });
  const includeTestInventory = expectBoolean({
    record: object.value,
    key: AgentStatsAssembleField.IncludeTestInventory,
    path,
  });
  const errors = [
    ...unknown,
    ...(prNumber.status === DecodeStatus.Failed ? prNumber.errors : []),
    ...(scratchPath.status === DecodeStatus.Failed ? scratchPath.errors : []),
    ...(outputPath.status === DecodeStatus.Failed ? outputPath.errors : []),
    ...(includeTestInventory.status === DecodeStatus.Failed
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

export type DecodeAgentStatsFilePayloadArgs = {
  readonly value: unknown;
  readonly path: string;
};

export function decodeAgentStatsFilePayload(
  args: DecodeAgentStatsFilePayloadArgs,
): DecodeOutcome<AgentStatsFileRequest> {
  const { value, path } = args;

  const object = expectObject({ value, path });
  if (object.status === DecodeStatus.Failed) {
    return object;
  }
  const unknown = denyUnknownKeys({
    record: object.value,
    fields: AgentStatsFileField,
    path,
  });
  const statsFile = expectString({
    record: object.value,
    key: AgentStatsFileField.StatsFile,
    path,
  });
  const errors = [
    ...unknown,
    ...(statsFile.status === DecodeStatus.Failed ? statsFile.errors : []),
  ];
  if (errors.length > 0) {
    return decodeErr(errors);
  }
  return decodeOk({
    statsFile: (statsFile as { value: string }).value,
  });
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
