import type { UntrustedYamlNode } from '../../lib/guards.ts';

import {
  DecodeStatus,
  type DecodeOutcome,
  FailedFieldDecode,
  SuccessfulFieldDecode,
} from '../field-error.ts';

import {
  type IntegerJsonSchemaArgs,
  type ObjectJsonSchema,
  type ObjectJsonSchemaArgs,
  JsonSchemaDefinition,
} from '../json-schema.ts';

import {
  type DenyUnknownKeysArgs,
  type ExpectFieldArgs,
  type ExpectObjectArgs,
  YamlObjectVocabulary,
  YamlBooleanField,
  YamlObjectField,
  YamlPositiveIntegerField,
  YamlStringField,
} from '../object.ts';

export class AgentStatsAssemblePayload {
  private constructor(
    private readonly request: DecodeAgentStatsAssemblePayloadArgs,
  ) {}
  static decode(
    args: DecodeAgentStatsAssemblePayloadArgs,
  ): DecodeOutcome<AgentStatsAssembleRequest> {
    return new AgentStatsAssemblePayload(args).execute();
  }
  private execute(): DecodeOutcome<AgentStatsAssembleRequest> {
    const args = this.request;
    const { value, path } = args;

    const objectArgs: ExpectObjectArgs = { value, path };
    const object = YamlObjectField.decode(objectArgs);
    if (object.status === DecodeStatus.Failed) {
      return object;
    }
    const unknownArgs: DenyUnknownKeysArgs<AgentStatsAssembleField> = {
      record: object.value,
      fields: AgentStatsAssembleField,
      path,
    };
    const unknown = YamlObjectVocabulary.unknownFields(unknownArgs);
    const prNumberArgs: ExpectFieldArgs<AgentStatsAssembleField> = {
      record: object.value,
      key: AgentStatsAssembleField.PrNumber,
      path,
    };
    const prNumber = YamlPositiveIntegerField.decode(prNumberArgs);
    const scratchPathArgs: ExpectFieldArgs<AgentStatsAssembleField> = {
      record: object.value,
      key: AgentStatsAssembleField.ScratchPath,
      path,
    };
    const scratchPath = YamlStringField.decode(scratchPathArgs);
    const outputPathArgs: ExpectFieldArgs<AgentStatsAssembleField> = {
      record: object.value,
      key: AgentStatsAssembleField.OutputPath,
      path,
    };
    const outputPath = YamlStringField.decode(outputPathArgs);
    const includeTestInventoryArgs: ExpectFieldArgs<AgentStatsAssembleField> = {
      record: object.value,
      key: AgentStatsAssembleField.IncludeTestInventory,
      path,
    };
    const includeTestInventory = YamlBooleanField.decode(
      includeTestInventoryArgs,
    );
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
      return FailedFieldDecode.create(errors);
    }
    const request: AgentStatsAssembleRequest = {
      prNumber: (prNumber as { value: number }).value,
      scratchPath: (scratchPath as { value: string }).value,
      outputPath: (outputPath as { value: string }).value,
      includeTestInventory: (includeTestInventory as { value: boolean }).value,
    };
    return SuccessfulFieldDecode.create(request);
  }
}

export class AgentStatsFilePayload {
  private constructor(
    private readonly request: DecodeAgentStatsFilePayloadArgs,
  ) {}
  static decode(
    args: DecodeAgentStatsFilePayloadArgs,
  ): DecodeOutcome<AgentStatsFileRequest> {
    return new AgentStatsFilePayload(args).execute();
  }
  private execute(): DecodeOutcome<AgentStatsFileRequest> {
    const args = this.request;
    const { value, path } = args;

    const objectArgs: ExpectObjectArgs = { value, path };
    const object = YamlObjectField.decode(objectArgs);
    if (object.status === DecodeStatus.Failed) {
      return object;
    }
    const unknownArgs: DenyUnknownKeysArgs<AgentStatsFileField> = {
      record: object.value,
      fields: AgentStatsFileField,
      path,
    };
    const unknown = YamlObjectVocabulary.unknownFields(unknownArgs);
    const statsFileArgs: ExpectFieldArgs<AgentStatsFileField> = {
      record: object.value,
      key: AgentStatsFileField.StatsFile,
      path,
    };
    const statsFile = YamlStringField.decode(statsFileArgs);
    const errors = [
      ...unknown,
      ...(statsFile.status === DecodeStatus.Failed ? statsFile.errors : []),
    ];
    if (errors.length > 0) {
      return FailedFieldDecode.create(errors);
    }
    const request: AgentStatsFileRequest = {
      statsFile: (statsFile as { value: string }).value,
    };
    return SuccessfulFieldDecode.create(request);
  }
}

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

export type DecodeAgentStatsFilePayloadArgs = {
  readonly value: UntrustedYamlNode;
  readonly path: string;
};

const positiveIntegerSchemaArgs: IntegerJsonSchemaArgs = { minimum: 1 };

const agentStatsAssembleInputSchemaArgs: ObjectJsonSchemaArgs = {
  required: [
    AgentStatsAssembleField.PrNumber,
    AgentStatsAssembleField.ScratchPath,
    AgentStatsAssembleField.OutputPath,
    AgentStatsAssembleField.IncludeTestInventory,
  ],
  properties: {
    [AgentStatsAssembleField.PrNumber]: JsonSchemaDefinition.integer(
      positiveIntegerSchemaArgs,
    ),
    [AgentStatsAssembleField.ScratchPath]: JsonSchemaDefinition.string(),
    [AgentStatsAssembleField.OutputPath]: JsonSchemaDefinition.string(),
    [AgentStatsAssembleField.IncludeTestInventory]:
      JsonSchemaDefinition.boolean(),
  },
};

export const AGENT_STATS_ASSEMBLE_INPUT_SCHEMA: ObjectJsonSchema =
  JsonSchemaDefinition.object(agentStatsAssembleInputSchemaArgs);

const agentStatsFileInputSchemaArgs: ObjectJsonSchemaArgs = {
  required: [AgentStatsFileField.StatsFile],
  properties: {
    [AgentStatsFileField.StatsFile]: JsonSchemaDefinition.string(),
  },
};

export const AGENT_STATS_FILE_INPUT_SCHEMA: ObjectJsonSchema =
  JsonSchemaDefinition.object(agentStatsFileInputSchemaArgs);
