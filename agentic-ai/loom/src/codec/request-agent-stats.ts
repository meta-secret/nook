import type { UntrustedYamlNode } from '../lib/guards.ts';

import { AgentStatsOperation, RequestFamily } from './enums.ts';

import {
  type AgentStatsAssembleRequest,
  type AgentStatsFileRequest,
  AgentStatsAssemblePayload,
  AgentStatsFilePayload,
} from './args/agent-stats.ts';

import { type DecodeOutcome, DecodeStatus, FieldPath } from './field-error.ts';

import {
  AGENT_STATS_OPERATIONS,
  type ExpectObjectArgs,
  type MapDecodeArgs,
  YamlOperationSelection,
  YamlObjectField,
  FieldDecodeProjection,
} from './object.ts';

import type { JoinPathArgs } from './field-error.ts';

import type {
  DecodeAgentStatsAssemblePayloadArgs,
  DecodeAgentStatsFilePayloadArgs,
} from './args/agent-stats.ts';

export class AgentStatsFamilyDecoder {
  private constructor(private readonly request: DecodeAgentStatsFamilyArgs) {}

  static decodeAgentStatsFamily(
    args: DecodeAgentStatsFamilyArgs,
  ): DecodeOutcome<AgentStatsLoomRequest> {
    return new AgentStatsFamilyDecoder(args).execute();
  }

  private execute(): DecodeOutcome<AgentStatsLoomRequest> {
    const args = this.request;
    const { value, path } = args;

    const basePathArgs: JoinPathArgs = {
      base: path,
      key: RequestFamily.AgentStats,
    };
    const basePath = FieldPath.join(basePathArgs);
    const objectArgs: ExpectObjectArgs = { value, path: basePath };
    const object = YamlObjectField.decode(objectArgs);
    if (object.status === DecodeStatus.Failed) {
      return object;
    }
    const selectedArgs = {
      record: object.value,
      path: basePath,
      operations: AGENT_STATS_OPERATIONS,
    };
    const selected = YamlOperationSelection.decode(selectedArgs);
    if (selected.status === DecodeStatus.Failed) {
      return selected;
    }
    const operationPathArgs: JoinPathArgs = {
      base: basePath,
      key: selected.value.operation,
    };
    const operationPath = FieldPath.join(operationPathArgs);
    switch (selected.value.operation) {
      case AgentStatsOperation.Assemble: {
        const decodeAgentStatsAssemblePayloadArgs: DecodeAgentStatsAssemblePayloadArgs =
          {
            value: selected.value.payload,
            path: operationPath,
          };
        const mapDecodeArgs3: MapDecodeArgs<
          AgentStatsAssembleRequest,
          AgentStatsLoomRequest
        > = {
          outcome: AgentStatsAssemblePayload.decode(
            decodeAgentStatsAssemblePayloadArgs,
          ),
          build: (assemble) => ({
            family: RequestFamily.AgentStats,
            operation: AgentStatsOperation.Assemble,
            assemble,
          }),
        };
        return FieldDecodeProjection.map(mapDecodeArgs3);
      }
      case AgentStatsOperation.Validate: {
        const decodeAgentStatsFilePayloadArgs2: DecodeAgentStatsFilePayloadArgs =
          {
            value: selected.value.payload,
            path: operationPath,
          };
        const mapDecodeArgs2: MapDecodeArgs<
          AgentStatsFileRequest,
          AgentStatsLoomRequest
        > = {
          outcome: AgentStatsFilePayload.decode(
            decodeAgentStatsFilePayloadArgs2,
          ),
          build: (validate) => ({
            family: RequestFamily.AgentStats,
            operation: AgentStatsOperation.Validate,
            validate,
          }),
        };
        return FieldDecodeProjection.map(mapDecodeArgs2);
      }
      case AgentStatsOperation.Publish: {
        const decodeAgentStatsFilePayloadArgs: DecodeAgentStatsFilePayloadArgs =
          {
            value: selected.value.payload,
            path: operationPath,
          };
        const mapDecodeArgs: MapDecodeArgs<
          AgentStatsFileRequest,
          AgentStatsLoomRequest
        > = {
          outcome: AgentStatsFilePayload.decode(
            decodeAgentStatsFilePayloadArgs,
          ),
          build: (publish) => ({
            family: RequestFamily.AgentStats,
            operation: AgentStatsOperation.Publish,
            publish,
          }),
        };
        return FieldDecodeProjection.map(mapDecodeArgs);
      }
    }
  }

  static listAgentStatsOperations(): readonly AgentStatsOperation[] {
    return AGENT_STATS_OPERATIONS;
  }
}

export type AgentStatsLoomRequest =
  | {
      readonly family: RequestFamily.AgentStats;
      readonly operation: AgentStatsOperation.Assemble;
      readonly assemble: AgentStatsAssembleRequest;
    }
  | {
      readonly family: RequestFamily.AgentStats;
      readonly operation: AgentStatsOperation.Validate;
      readonly validate: AgentStatsFileRequest;
    }
  | {
      readonly family: RequestFamily.AgentStats;
      readonly operation: AgentStatsOperation.Publish;
      readonly publish: AgentStatsFileRequest;
    };

export type DecodeAgentStatsFamilyArgs = {
  readonly value: UntrustedYamlNode;
  readonly path: string;
};
