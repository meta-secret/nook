import { RequestFamily, ResponsePhase } from '../codec/enums.ts';
import { DecodeStatus } from '../codec/field-error.ts';
import { decodeLoomRequest, type LoomRequest } from '../codec/request.ts';
import {
  decodeErrorResponse,
  encodeResponse,
  executeErrorResponseForAgentStats,
  executeErrorResponseForFamily,
  executeErrorResponseForPrLand,
  executionFieldError,
  successResponseForAgentStats,
  successResponseForFamily,
  successResponseForPrLand,
  type ErrorResponse,
  type SuccessResponse,
} from '../codec/response.ts';
import { parseYamlFile } from '../codec/yaml.ts';
import { LoomFailure, LoomFailureDetailKind } from '../loom-failure.ts';
import { executeRequest, listDiscoverableRequests } from './registry.ts';

export type DispatchOutcome = {
  readonly exitCode: number;
  readonly body: SuccessResponse | ErrorResponse;
};

export async function dispatchRequestFile(
  requestPath: string,
): Promise<DispatchOutcome> {
  const parsed = parseYamlFile(requestPath);
  if (parsed.status === DecodeStatus.Failed) {
    return {
      exitCode: 2,
      body: decodeErrorResponse(ResponsePhase.Decode, parsed.errors),
    };
  }
  return dispatchValue(parsed.value);
}

export async function dispatchValue(value: unknown): Promise<DispatchOutcome> {
  const request = decodeLoomRequest(value);
  if (request.status === DecodeStatus.Failed) {
    return {
      exitCode: 2,
      body: decodeErrorResponse(ResponsePhase.Decode, request.errors),
    };
  }
  return dispatchDecoded(request.value);
}

async function dispatchDecoded(request: LoomRequest): Promise<DispatchOutcome> {
  if (request.family === RequestFamily.ToolsCall) {
    return dispatchDecoded(request.toolsCall);
  }

  if (request.family === RequestFamily.ToolsList) {
    return {
      exitCode: 0,
      body: successResponseForFamily(RequestFamily.ToolsList, {
        requests: listDiscoverableRequests(),
      }),
    };
  }

  try {
    const result = await executeRequest(request);
    if (
      request.family === RequestFamily.CortexAudit &&
      typeof result === 'object' &&
      result instanceof Object &&
      'auditOk' in result &&
      result.auditOk === false
    ) {
      return {
        exitCode: 1,
        body: successResponseForFamily(RequestFamily.CortexAudit, result),
      };
    }
    return {
      exitCode: 0,
      body: buildSuccessResponse(request, result),
    };
  } catch (error) {
    return {
      exitCode: 1,
      body: buildExecuteErrorResponse(request, failureDetail(error)),
    };
  }
}

function failureDetail(error: unknown): string {
  if (error instanceof LoomFailure) {
    if (error.detail.kind === LoomFailureDetailKind.Text) {
      return error.detail.text;
    }
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function buildSuccessResponse(
  request: LoomRequest,
  result: unknown,
): SuccessResponse {
  switch (request.family) {
    case RequestFamily.PrePush:
      return successResponseForFamily(RequestFamily.PrePush, result);
    case RequestFamily.CortexAudit:
      return successResponseForFamily(RequestFamily.CortexAudit, result);
    case RequestFamily.SkillScaffold:
      return successResponseForFamily(RequestFamily.SkillScaffold, result);
    case RequestFamily.AgentStats:
      return successResponseForAgentStats(request.operation, result);
    case RequestFamily.PrLand:
      return successResponseForPrLand(request.operation, result);
    case RequestFamily.ToolsList:
    case RequestFamily.ToolsCall:
      return successResponseForFamily(RequestFamily.ToolsList, result);
  }
}

function buildExecuteErrorResponse(
  request: LoomRequest,
  detail: string,
): ErrorResponse {
  const errors = [executionFieldError(detail)];
  switch (request.family) {
    case RequestFamily.PrePush:
      return executeErrorResponseForFamily(RequestFamily.PrePush, errors);
    case RequestFamily.CortexAudit:
      return executeErrorResponseForFamily(RequestFamily.CortexAudit, errors);
    case RequestFamily.SkillScaffold:
      return executeErrorResponseForFamily(RequestFamily.SkillScaffold, errors);
    case RequestFamily.AgentStats:
      return executeErrorResponseForAgentStats(request.operation, errors);
    case RequestFamily.PrLand:
      return executeErrorResponseForPrLand(request.operation, errors);
    case RequestFamily.ToolsList:
    case RequestFamily.ToolsCall:
      return executeErrorResponseForFamily(RequestFamily.ToolsList, errors);
  }
}

export function encodedOutcome(outcome: DispatchOutcome): unknown {
  return encodeResponse(outcome.body);
}
