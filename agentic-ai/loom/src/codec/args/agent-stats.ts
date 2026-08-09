import type { UntrustedYamlNode } from '../../lib/guards.ts';
import {
  DecodeStatus,
  decodeErr,
  decodeOk,
  type DecodeOutcome,
} from '../field-error.ts';
import {
  booleanJsonSchema,
  integerJsonSchema,
  objectJsonSchema,
  stringJsonSchema,
  type IntegerJsonSchemaArgs,
  type ObjectJsonSchema,
  type ObjectJsonSchemaArgs,
} from '../json-schema.ts';
import {
  denyUnknownKeys,
  expectBoolean,
  expectObject,
  expectPositiveInt,
  expectString,
  type DenyUnknownKeysArgs,
  type ExpectFieldArgs,
  type ExpectObjectArgs,
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
  readonly value: UntrustedYamlNode;
  readonly path: string;
};

export function decodeAgentStatsAssemblePayload(
  args: DecodeAgentStatsAssemblePayloadArgs,
): DecodeOutcome<AgentStatsAssembleRequest> {
  const { value, path } = args;

  const objectArgs: ExpectObjectArgs = { value, path };
  const object = expectObject(objectArgs);
  if (object.status === DecodeStatus.Failed) {
    return object;
  }
  const unknownArgs: DenyUnknownKeysArgs<AgentStatsAssembleField> = {
    record: object.value,
    fields: AgentStatsAssembleField,
    path,
  };
  const unknown = denyUnknownKeys(unknownArgs);
  const prNumberArgs: ExpectFieldArgs<AgentStatsAssembleField> = {
    record: object.value,
    key: AgentStatsAssembleField.PrNumber,
    path,
  };
  const prNumber = expectPositiveInt(prNumberArgs);
  const scratchPathArgs: ExpectFieldArgs<AgentStatsAssembleField> = {
    record: object.value,
    key: AgentStatsAssembleField.ScratchPath,
    path,
  };
  const scratchPath = expectString(scratchPathArgs);
  const outputPathArgs: ExpectFieldArgs<AgentStatsAssembleField> = {
    record: object.value,
    key: AgentStatsAssembleField.OutputPath,
    path,
  };
  const outputPath = expectString(outputPathArgs);
  const includeTestInventoryArgs: ExpectFieldArgs<AgentStatsAssembleField> = {
    record: object.value,
    key: AgentStatsAssembleField.IncludeTestInventory,
    path,
  };
  const includeTestInventory = expectBoolean(includeTestInventoryArgs);
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
  const request: AgentStatsAssembleRequest = {
    prNumber: (prNumber as { value: number }).value,
    scratchPath: (scratchPath as { value: string }).value,
    outputPath: (outputPath as { value: string }).value,
    includeTestInventory: (includeTestInventory as { value: boolean }).value,
  };
  return decodeOk(request);
}

export type DecodeAgentStatsFilePayloadArgs = {
  readonly value: UntrustedYamlNode;
  readonly path: string;
};

export function decodeAgentStatsFilePayload(
  args: DecodeAgentStatsFilePayloadArgs,
): DecodeOutcome<AgentStatsFileRequest> {
  const { value, path } = args;

  const objectArgs: ExpectObjectArgs = { value, path };
  const object = expectObject(objectArgs);
  if (object.status === DecodeStatus.Failed) {
    return object;
  }
  const unknownArgs: DenyUnknownKeysArgs<AgentStatsFileField> = {
    record: object.value,
    fields: AgentStatsFileField,
    path,
  };
  const unknown = denyUnknownKeys(unknownArgs);
  const statsFileArgs: ExpectFieldArgs<AgentStatsFileField> = {
    record: object.value,
    key: AgentStatsFileField.StatsFile,
    path,
  };
  const statsFile = expectString(statsFileArgs);
  const errors = [
    ...unknown,
    ...(statsFile.status === DecodeStatus.Failed ? statsFile.errors : []),
  ];
  if (errors.length > 0) {
    return decodeErr(errors);
  }
  const request: AgentStatsFileRequest = {
    statsFile: (statsFile as { value: string }).value,
  };
  return decodeOk(request);
}

const positiveIntegerSchemaArgs: IntegerJsonSchemaArgs = { minimum: 1 };
const agentStatsAssembleInputSchemaArgs: ObjectJsonSchemaArgs = {
  required: [
    AgentStatsAssembleField.PrNumber,
    AgentStatsAssembleField.ScratchPath,
    AgentStatsAssembleField.OutputPath,
    AgentStatsAssembleField.IncludeTestInventory,
  ],
  properties: {
    [AgentStatsAssembleField.PrNumber]: integerJsonSchema(
      positiveIntegerSchemaArgs,
    ),
    [AgentStatsAssembleField.ScratchPath]: stringJsonSchema(),
    [AgentStatsAssembleField.OutputPath]: stringJsonSchema(),
    [AgentStatsAssembleField.IncludeTestInventory]: booleanJsonSchema(),
  },
};
export const AGENT_STATS_ASSEMBLE_INPUT_SCHEMA: ObjectJsonSchema =
  objectJsonSchema(agentStatsAssembleInputSchemaArgs);

const agentStatsFileInputSchemaArgs: ObjectJsonSchemaArgs = {
  required: [AgentStatsFileField.StatsFile],
  properties: {
    [AgentStatsFileField.StatsFile]: stringJsonSchema(),
  },
};
export const AGENT_STATS_FILE_INPUT_SCHEMA: ObjectJsonSchema = objectJsonSchema(
  agentStatsFileInputSchemaArgs,
);
