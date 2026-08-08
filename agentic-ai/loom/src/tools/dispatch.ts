import { RequestKind, ResponsePhase } from '../codec/enums.ts';
import { fieldError } from '../codec/field-error.ts';
import { decodeLoomRequest, type LoomRequest } from '../codec/request.ts';
import {
  encodeResponse,
  errorResponse,
  successResponse,
  type ErrorResponse,
  type SuccessResponse,
} from '../codec/response.ts';
import { parseYamlFile } from '../codec/yaml.ts';
import { ResultKind, absent, present } from '../result.ts';
import { executeRequest, listDiscoverableRequests } from './registry.ts';

export type DispatchOutcome = {
  readonly exitCode: number;
  readonly body: SuccessResponse | ErrorResponse;
};

export async function dispatchRequestFile(
  requestPath: string,
): Promise<DispatchOutcome> {
  const parsed = parseYamlFile(requestPath);
  if (parsed.kind === ResultKind.Err) {
    return {
      exitCode: 2,
      body: errorResponse(ResponsePhase.Decode, parsed.errors, absent()),
    };
  }
  return dispatchValue(parsed.value);
}

export async function dispatchValue(value: unknown): Promise<DispatchOutcome> {
  const request = decodeLoomRequest(value);
  if (request.kind === ResultKind.Err) {
    return {
      exitCode: 2,
      body: errorResponse(ResponsePhase.Decode, request.errors, absent()),
    };
  }
  return dispatchDecoded(request.value);
}

async function dispatchDecoded(request: LoomRequest): Promise<DispatchOutcome> {
  if (request.kind === RequestKind.ToolsCall) {
    return dispatchDecoded(request.toolsCall);
  }

  if (request.kind === RequestKind.ToolsList) {
    return {
      exitCode: 0,
      body: successResponse(request.kind, {
        requests: listDiscoverableRequests(),
      }),
    };
  }

  const result = await executeRequest(request);
  if (result.kind === ResultKind.Err) {
    return {
      exitCode: 1,
      body: errorResponse(
        ResponsePhase.Execute,
        [fieldError('result', result.message)],
        present(request.kind),
        present(
          'fix the underlying gate, then retry the same domain request object',
        ),
      ),
    };
  }

  if (
    request.kind === RequestKind.CortexAudit &&
    typeof result.value === 'object' &&
    result.value instanceof Object &&
    'auditOk' in result.value &&
    result.value.auditOk === false
  ) {
    return {
      exitCode: 1,
      body: successResponse(request.kind, result.value),
    };
  }

  return {
    exitCode: 0,
    body: successResponse(request.kind, result.value),
  };
}

export function encodedOutcome(outcome: DispatchOutcome): unknown {
  return encodeResponse(outcome.body);
}
