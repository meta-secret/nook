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

export function decodeAgentStatsFamily(
  value: unknown,
  path: string,
): DecodeOutcome<AgentStatsLoomRequest> {
  const basePath = joinPath(path, RequestFamily.AgentStats);
  const object = expectObject(value, basePath);
  if (object.status === DecodeStatus.Failed) {
    return object;
  }
  const selected = decodeExactlyOneOperation(
    object.value,
    basePath,
    AGENT_STATS_OPERATIONS,
  );
  if (selected.status === DecodeStatus.Failed) {
    return selected;
  }
  const operationPath = joinPath(basePath, selected.value.operation);
  switch (selected.value.operation) {
    case AgentStatsOperation.Assemble:
      return mapDecode(
        decodeAgentStatsAssemblePayload(selected.value.payload, operationPath),
        (assemble) => ({
          family: RequestFamily.AgentStats,
          operation: AgentStatsOperation.Assemble,
          assemble,
        }),
      );
    case AgentStatsOperation.Validate:
      return mapDecode(
        decodeAgentStatsFilePayload(selected.value.payload, operationPath),
        (validate) => ({
          family: RequestFamily.AgentStats,
          operation: AgentStatsOperation.Validate,
          validate,
        }),
      );
    case AgentStatsOperation.Publish:
      return mapDecode(
        decodeAgentStatsFilePayload(selected.value.payload, operationPath),
        (publish) => ({
          family: RequestFamily.AgentStats,
          operation: AgentStatsOperation.Publish,
          publish,
        }),
      );
  }
}

export function listAgentStatsOperations(): readonly AgentStatsOperation[] {
  return AGENT_STATS_OPERATIONS;
}
