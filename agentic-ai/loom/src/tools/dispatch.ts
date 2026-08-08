import { readFileSync } from 'node:fs';
import {
  ExternalPropertyPresence,
  asExternalValue,
  externalProperty,
  isRecord,
  type ExternalValue,
} from '../lib/guards.ts';
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
    return {
      exitCode: 2,
      body: decodeErrorResponse({
        phase: ResponsePhase.Decode,
        errors: parsed.errors,
        explanation: explainSyntaxFailure({ receivedYaml, parseMessage }),
      }),
    };
  }
  return dispatchValue(parsed.value.value);
}

export async function dispatchValue(
  value: ExternalValue,
): Promise<DispatchOutcome> {
  const request = decodeLoomRequest(value);
  if (request.status === DecodeStatus.Failed) {
    return {
      exitCode: 2,
      body: decodeErrorResponse({
        phase: ResponsePhase.Decode,
        errors: request.errors,
        explanation: explainAgainstBlueprint(value),
      }),
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
      body: successResponseForFamily({
        family: RequestFamily.ToolsList,
        result: asExternalValue({
          requests: listDiscoverableRequests(),
        } as ExternalValue),
      }),
    };
  }

  try {
    const result = await executeRequest(request);
    if (request.family === RequestFamily.CortexAudit && isRecord(result)) {
      const auditOk = externalProperty({ record: result, key: 'auditOk' });
      if (
        auditOk.presence === ExternalPropertyPresence.Present &&
        auditOk.value === false
      ) {
        return {
          exitCode: 1,
          body: successResponseForFamily({
            family: RequestFamily.CortexAudit,
            result,
          }),
        };
      }
    }
    if (
      request.family === RequestFamily.DependencyPopularity &&
      isRecord(result)
    ) {
      const ok = externalProperty({ record: result, key: 'ok' });
      if (
        ok.presence === ExternalPropertyPresence.Present &&
        ok.value === false
      ) {
        return {
          exitCode: 1,
          body: successResponseForFamily({
            family: RequestFamily.DependencyPopularity,
            result,
          }),
        };
      }
    }
    return {
      exitCode: 0,
      body: buildSuccessResponse({ request, result }),
    };
  } catch (error) {
    const detail =
      error instanceof LoomFailure || error instanceof Error
        ? failureDetail(error)
        : typeof error === 'string'
          ? failureDetail(error)
          : failureDetail(String(error));
    return {
      exitCode: 1,
      body: buildExecuteErrorResponse({
        request,
        detail,
      }),
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
  readonly result: ExternalValue;
};

function buildSuccessResponse(args: BuildSuccessResponseArgs): SuccessResponse {
  const { request, result } = args;

  switch (request.family) {
    case RequestFamily.PrePush:
      return successResponseForFamily({
        family: RequestFamily.PrePush,
        result,
      });
    case RequestFamily.CortexAudit:
      return successResponseForFamily({
        family: RequestFamily.CortexAudit,
        result,
      });
    case RequestFamily.SkillScaffold:
      return successResponseForFamily({
        family: RequestFamily.SkillScaffold,
        result,
      });
    case RequestFamily.AgentStats:
      return successResponseForAgentStats({
        operation: request.operation,
        result,
      });
    case RequestFamily.PrLand:
      return successResponseForPrLand({ operation: request.operation, result });
    case RequestFamily.DependencyPopularity:
      return successResponseForFamily({
        family: RequestFamily.DependencyPopularity,
        result,
      });
    case RequestFamily.ToolsList:
    case RequestFamily.ToolsCall:
      return successResponseForFamily({
        family: RequestFamily.ToolsList,
        result,
      });
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
    case RequestFamily.PrePush:
      return executeErrorResponseForFamily({
        family: RequestFamily.PrePush,
        errors,
      });
    case RequestFamily.CortexAudit:
      return executeErrorResponseForFamily({
        family: RequestFamily.CortexAudit,
        errors,
      });
    case RequestFamily.SkillScaffold:
      return executeErrorResponseForFamily({
        family: RequestFamily.SkillScaffold,
        errors,
      });
    case RequestFamily.AgentStats:
      return executeErrorResponseForAgentStats({
        operation: request.operation,
        errors,
      });
    case RequestFamily.PrLand:
      return executeErrorResponseForPrLand({
        operation: request.operation,
        errors,
      });
    case RequestFamily.DependencyPopularity:
      return executeErrorResponseForFamily({
        family: RequestFamily.DependencyPopularity,
        errors,
      });
    case RequestFamily.ToolsList:
    case RequestFamily.ToolsCall:
      return executeErrorResponseForFamily({
        family: RequestFamily.ToolsList,
        errors,
      });
  }
}

export function encodedOutcome(outcome: DispatchOutcome): ExternalValue {
  return encodeResponse(outcome.body);
}
