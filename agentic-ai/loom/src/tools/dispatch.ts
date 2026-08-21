import { readFileSync } from 'node:fs';
import { asUntrustedYamlNode, type UntrustedYamlNode } from '../lib/guards.ts';
import {
  explainAgainstBlueprint,
  explainSyntaxFailure,
} from '../codec/blueprint-diff.ts';
import { RequestFamily, ResponsePhase } from '../codec/enums.ts';
import {
  DecodeStatus,
  FieldDetailKind,
  FieldIssue,
} from '../codec/field-error.ts';
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
  commandResultToResponseValue,
  type ErrorResponse,
  type SuccessResponse,
} from '../codec/response.ts';
import { parseYamlFile } from '../codec/yaml.ts';
import { LoomFailure, LoomFailureDetailKind } from '../loom-failure.ts';
import { executeRequest, listDiscoverableRequests } from './registry.ts';
import type {
  SuccessResponseForFamilyArgs,
  SuccessResponseForAgentStatsArgs,
  SuccessResponseForPrLandArgs,
  DecodeErrorResponseArgs,
  ExecuteErrorResponseForFamilyArgs,
  ExecuteErrorResponseForAgentStatsArgs,
  ExecuteErrorResponseForPrLandArgs,
} from '../codec/response.ts';
import type { ExplainSyntaxFailureArgs } from '../codec/blueprint-diff.ts';
export type DispatchOutcome = {
  readonly exitCode: number;
  readonly body: SuccessResponse | ErrorResponse;
};

export async function dispatchRequestFile(
  requestPath: string,
): Promise<DispatchOutcome> {
  const receivedYaml = readRequestText(requestPath);
  const parsed = parseYamlFile(requestPath);
  if (parsed.status === DecodeStatus.Failed) {
    const syntax = parsed.errors.find(
      (entry) => entry.issue === FieldIssue.InvalidYaml,
    );
    const parseMessage =
      syntax && syntax.detail.kind === FieldDetailKind.Text
        ? syntax.detail.text
        : 'failed to read or parse request YAML';
    const explainSyntaxFailureArgs: ExplainSyntaxFailureArgs = {
      receivedYaml,
      parseMessage,
    };
    const decodeErrorResponseArgs2: DecodeErrorResponseArgs = {
      phase: ResponsePhase.Decode,
      errors: parsed.errors,
      explanation: explainSyntaxFailure(explainSyntaxFailureArgs),
    };
    return {
      exitCode: 2,
      body: decodeErrorResponse(decodeErrorResponseArgs2),
    };
  }
  return dispatchValue(parsed.value.value);
}

export async function dispatchValue(
  value: UntrustedYamlNode,
): Promise<DispatchOutcome> {
  const request = decodeLoomRequest(value);
  if (request.status === DecodeStatus.Failed) {
    const decodeErrorResponseArgs: DecodeErrorResponseArgs = {
      phase: ResponsePhase.Decode,
      errors: request.errors,
      explanation: explainAgainstBlueprint(value),
    };
    return {
      exitCode: 2,
      body: decodeErrorResponse(decodeErrorResponseArgs),
    };
  }
  return dispatchDecoded(request.value);
}

async function dispatchDecoded(request: LoomRequest): Promise<DispatchOutcome> {
  if (request.family === RequestFamily.ToolsCall) {
    return dispatchDecoded(request.toolsCall);
  }

  if (request.family === RequestFamily.ToolsList) {
    const asUntrustedYamlNodeArgs: UntrustedYamlNode = {
      requests: listDiscoverableRequests(),
    };
    const successResponseForFamilyArgs8: SuccessResponseForFamilyArgs = {
      family: RequestFamily.ToolsList,
      result: asUntrustedYamlNode(asUntrustedYamlNodeArgs),
    };
    return {
      exitCode: 0,
      body: successResponseForFamily(successResponseForFamilyArgs8),
    };
  }

  try {
    const result = await executeRequest(request);
    const responseValue = commandResultToResponseValue(result);
    if (request.family === RequestFamily.CortexAudit && 'auditOk' in result) {
      if (!result.auditOk) {
        const successResponseForFamilyArgs7: SuccessResponseForFamilyArgs = {
          family: RequestFamily.CortexAudit,
          result: responseValue,
        };
        return {
          exitCode: 1,
          body: successResponseForFamily(successResponseForFamilyArgs7),
        };
      }
    }
    if (
      request.family === RequestFamily.DependencyPopularity &&
      'ok' in result
    ) {
      if (!result.ok) {
        const successResponseForFamilyArgs6: SuccessResponseForFamilyArgs = {
          family: RequestFamily.DependencyPopularity,
          result: responseValue,
        };
        return {
          exitCode: 1,
          body: successResponseForFamily(successResponseForFamilyArgs6),
        };
      }
    }
    const buildSuccessResponseArgs = { request, result: responseValue };
    return {
      exitCode: 0,
      body: buildSuccessResponse(buildSuccessResponseArgs),
    };
  } catch (error) {
    const detail =
      error instanceof LoomFailure || error instanceof Error
        ? failureDetail(error)
        : typeof error === 'string'
          ? failureDetail(error)
          : failureDetail(String(error));
    const buildExecuteErrorResponseArgs = {
      request,
      detail,
    };
    return {
      exitCode: 1,
      body: buildExecuteErrorResponse(buildExecuteErrorResponseArgs),
    };
  }
}

function readRequestText(requestPath: string): string {
  try {
    return readFileSync(requestPath, 'utf8');
  } catch {
    return '';
  }
}

function failureDetail(error: LoomFailure | Error | string): string {
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

type BuildSuccessResponseArgs = {
  readonly request: LoomRequest;
  readonly result: UntrustedYamlNode;
};

function buildSuccessResponse(args: BuildSuccessResponseArgs): SuccessResponse {
  const { request, result } = args;

  switch (request.family) {
    case RequestFamily.PrePush: {
      const successResponseForFamilyArgs5: SuccessResponseForFamilyArgs = {
        family: RequestFamily.PrePush,
        result,
      };
      return successResponseForFamily(successResponseForFamilyArgs5);
    }
    case RequestFamily.CortexAudit: {
      const successResponseForFamilyArgs4: SuccessResponseForFamilyArgs = {
        family: RequestFamily.CortexAudit,
        result,
      };
      return successResponseForFamily(successResponseForFamilyArgs4);
    }
    case RequestFamily.CortexSessionClean: {
      const successResponseForFamilyArgs: SuccessResponseForFamilyArgs = {
        family: RequestFamily.CortexSessionClean,
        result,
      };
      return successResponseForFamily(successResponseForFamilyArgs);
    }
    case RequestFamily.SkillScaffold: {
      const successResponseForFamilyArgs3: SuccessResponseForFamilyArgs = {
        family: RequestFamily.SkillScaffold,
        result,
      };
      return successResponseForFamily(successResponseForFamilyArgs3);
    }
    case RequestFamily.AgentStats: {
      const successResponseForAgentStatsArgs: SuccessResponseForAgentStatsArgs =
        {
          operation: request.operation,
          result,
        };
      return successResponseForAgentStats(successResponseForAgentStatsArgs);
    }
    case RequestFamily.PrLand: {
      const successResponseForPrLandArgs: SuccessResponseForPrLandArgs = {
        operation: request.operation,
        result,
      };
      return successResponseForPrLand(successResponseForPrLandArgs);
    }
    case RequestFamily.DependencyPopularity: {
      const successResponseForFamilyArgs2: SuccessResponseForFamilyArgs = {
        family: RequestFamily.DependencyPopularity,
        result,
      };
      return successResponseForFamily(successResponseForFamilyArgs2);
    }
    case RequestFamily.ToolsList:
    case RequestFamily.ToolsCall: {
      const successResponseForFamilyArgs: SuccessResponseForFamilyArgs = {
        family: RequestFamily.ToolsList,
        result,
      };
      return successResponseForFamily(successResponseForFamilyArgs);
    }
  }
}

type BuildExecuteErrorResponseArgs = {
  readonly request: LoomRequest;
  readonly detail: string;
};

function buildExecuteErrorResponse(
  args: BuildExecuteErrorResponseArgs,
): ErrorResponse {
  const { request, detail } = args;

  const errors = [executionFieldError(detail)];
  switch (request.family) {
    case RequestFamily.PrePush: {
      const executeErrorResponseForFamilyArgs5: ExecuteErrorResponseForFamilyArgs =
        {
          family: RequestFamily.PrePush,
          errors,
        };
      return executeErrorResponseForFamily(executeErrorResponseForFamilyArgs5);
    }
    case RequestFamily.CortexAudit: {
      const executeErrorResponseForFamilyArgs4: ExecuteErrorResponseForFamilyArgs =
        {
          family: RequestFamily.CortexAudit,
          errors,
        };
      return executeErrorResponseForFamily(executeErrorResponseForFamilyArgs4);
    }
    case RequestFamily.CortexSessionClean: {
      const executeErrorResponseForFamilyArgs: ExecuteErrorResponseForFamilyArgs =
        {
          family: RequestFamily.CortexSessionClean,
          errors,
        };
      return executeErrorResponseForFamily(executeErrorResponseForFamilyArgs);
    }
    case RequestFamily.SkillScaffold: {
      const executeErrorResponseForFamilyArgs3: ExecuteErrorResponseForFamilyArgs =
        {
          family: RequestFamily.SkillScaffold,
          errors,
        };
      return executeErrorResponseForFamily(executeErrorResponseForFamilyArgs3);
    }
    case RequestFamily.AgentStats: {
      const executeErrorResponseForAgentStatsArgs: ExecuteErrorResponseForAgentStatsArgs =
        {
          operation: request.operation,
          errors,
        };
      return executeErrorResponseForAgentStats(
        executeErrorResponseForAgentStatsArgs,
      );
    }
    case RequestFamily.PrLand: {
      const executeErrorResponseForPrLandArgs: ExecuteErrorResponseForPrLandArgs =
        {
          operation: request.operation,
          errors,
        };
      return executeErrorResponseForPrLand(executeErrorResponseForPrLandArgs);
    }
    case RequestFamily.DependencyPopularity: {
      const executeErrorResponseForFamilyArgs2: ExecuteErrorResponseForFamilyArgs =
        {
          family: RequestFamily.DependencyPopularity,
          errors,
        };
      return executeErrorResponseForFamily(executeErrorResponseForFamilyArgs2);
    }
    case RequestFamily.ToolsList:
    case RequestFamily.ToolsCall: {
      const executeErrorResponseForFamilyArgs: ExecuteErrorResponseForFamilyArgs =
        {
          family: RequestFamily.ToolsList,
          errors,
        };
      return executeErrorResponseForFamily(executeErrorResponseForFamilyArgs);
    }
  }
}

export function encodedOutcome(outcome: DispatchOutcome): UntrustedYamlNode {
  return encodeResponse(outcome.body);
}
