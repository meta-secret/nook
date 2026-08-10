import type { UntrustedYamlNode } from '../lib/guards.ts';
import {
  AgentStatsOperation,
  PrLandOperation,
  RequestFamily,
} from './enums.ts';
import {
  decodeAgentStatsAssemblePayload,
  decodeAgentStatsFilePayload,
  type AgentStatsAssembleRequest,
  type AgentStatsFileRequest,
} from './args/agent-stats.ts';
import { joinPath, type DecodeOutcome, DecodeStatus } from './field-error.ts';
import {
  AGENT_STATS_OPERATIONS,
  decodeExactlyOneOperation,
  expectObject,
  mapDecode,
  type ExpectObjectArgs,
  type MapDecodeArgs,
} from './object.ts';
import type { JoinPathArgs } from './field-error.ts';
import type {
  DecodeAgentStatsAssemblePayloadArgs,
  DecodeAgentStatsFilePayloadArgs,
} from './args/agent-stats.ts';
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

export function decodeAgentStatsFamily(
  args: DecodeAgentStatsFamilyArgs,
): DecodeOutcome<AgentStatsLoomRequest> {
  const { value, path } = args;

  const basePathArgs: JoinPathArgs = {
    base: path,
    key: RequestFamily.AgentStats,
  };
  const basePath = joinPath(basePathArgs);
  const objectArgs: ExpectObjectArgs = { value, path: basePath };
  const object = expectObject(objectArgs);
  if (object.status === DecodeStatus.Failed) {
    return object;
  }
  const selectedArgs = {
    record: object.value,
    path: basePath,
    operations: AGENT_STATS_OPERATIONS,
  };
  const selected = decodeExactlyOneOperation(selectedArgs);
  if (selected.status === DecodeStatus.Failed) {
    return selected;
  }
  const operationPathArgs: JoinPathArgs = {
    base: basePath,
    key: selected.value.operation,
  };
  const operationPath = joinPath(operationPathArgs);
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
        outcome: decodeAgentStatsAssemblePayload(
          decodeAgentStatsAssemblePayloadArgs,
        ),
        build: (assemble) => ({
          family: RequestFamily.AgentStats,
          operation: AgentStatsOperation.Assemble,
          assemble,
        }),
      };
      return mapDecode(mapDecodeArgs3);
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
        outcome: decodeAgentStatsFilePayload(decodeAgentStatsFilePayloadArgs2),
        build: (validate) => ({
          family: RequestFamily.AgentStats,
          operation: AgentStatsOperation.Validate,
          validate,
        }),
      };
      return mapDecode(mapDecodeArgs2);
    }
    case AgentStatsOperation.Publish: {
      const decodeAgentStatsFilePayloadArgs: DecodeAgentStatsFilePayloadArgs = {
        value: selected.value.payload,
        path: operationPath,
      };
      const mapDecodeArgs: MapDecodeArgs<
        AgentStatsFileRequest,
        AgentStatsLoomRequest
      > = {
        outcome: decodeAgentStatsFilePayload(decodeAgentStatsFilePayloadArgs),
        build: (publish) => ({
          family: RequestFamily.AgentStats,
          operation: AgentStatsOperation.Publish,
          publish,
        }),
      };
      return mapDecode(mapDecodeArgs);
    }
  }
}

export function listAgentStatsOperations(): readonly AgentStatsOperation[] {
  return AGENT_STATS_OPERATIONS;
}
