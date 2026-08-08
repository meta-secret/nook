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
} from './object.ts';

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
  readonly value: unknown;
  readonly path: string;
};

export function decodeAgentStatsFamily(
  args: DecodeAgentStatsFamilyArgs,
): DecodeOutcome<AgentStatsLoomRequest> {
  const { value, path } = args;

  const basePath = joinPath({ base: path, key: RequestFamily.AgentStats });
  const object = expectObject({ value, path: basePath });
  if (object.status === DecodeStatus.Failed) {
    return object;
  }
  const selected = decodeExactlyOneOperation({
    record: object.value,
    path: basePath,
    operations: AGENT_STATS_OPERATIONS,
  });
  if (selected.status === DecodeStatus.Failed) {
    return selected;
  }
  const operationPath = joinPath({
    base: basePath,
    key: selected.value.operation,
  });
  switch (selected.value.operation) {
    case AgentStatsOperation.Assemble:
      return mapDecode({
        outcome: decodeAgentStatsAssemblePayload({
          value: selected.value.payload,
          path: operationPath,
        }),
        build: (assemble) => ({
          family: RequestFamily.AgentStats,
          operation: AgentStatsOperation.Assemble,
          assemble,
        }),
      });
    case AgentStatsOperation.Validate:
      return mapDecode({
        outcome: decodeAgentStatsFilePayload({
          value: selected.value.payload,
          path: operationPath,
        }),
        build: (validate) => ({
          family: RequestFamily.AgentStats,
          operation: AgentStatsOperation.Validate,
          validate,
        }),
      });
    case AgentStatsOperation.Publish:
      return mapDecode({
        outcome: decodeAgentStatsFilePayload({
          value: selected.value.payload,
          path: operationPath,
        }),
        build: (publish) => ({
          family: RequestFamily.AgentStats,
          operation: AgentStatsOperation.Publish,
          publish,
        }),
      });
  }
}

export function listAgentStatsOperations(): readonly AgentStatsOperation[] {
  return AGENT_STATS_OPERATIONS;
}
