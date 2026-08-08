import { fieldError, type FieldError } from '../codec/field-error.ts';
import { decodeLoomRequest } from '../codec/request.ts';
import {
  encodeResponse,
  errorResponse,
  successResponse,
  type ErrorResponse,
  type SuccessResponse,
} from '../codec/response.ts';
import { parseYamlFile } from '../codec/yaml.ts';
import { ResultKind } from '../result.ts';
import { getTool, listAllToolNames } from './registry.ts';

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
      body: errorResponse('decode', parsed.errors),
    };
  }
  return dispatchValue(parsed.value);
}

export async function dispatchValue(value: unknown): Promise<DispatchOutcome> {
  const request = decodeLoomRequest(value);
  if (request.kind === ResultKind.Err) {
    return {
      exitCode: 2,
      body: errorResponse('decode', request.errors),
    };
  }

  const tool = getTool(request.value.name);
  if (!tool) {
    return {
      exitCode: 2,
      body: errorResponse(
        'unknown-tool',
        [
          fieldError(
            'name',
            `unknown tool; known: ${listAllToolNames().join(', ')}`,
          ),
        ],
        request.value.name,
      ),
    };
  }

  if (tool.name === 'tools-call') {
    return dispatchToolsCall(request.value.arguments, request.value.name);
  }

  const args = tool.decodeArgs(request.value.arguments);
  if (args.kind === ResultKind.Err) {
    return {
      exitCode: 2,
      body: errorResponse('arguments', args.errors, tool.name),
    };
  }

  const result = await tool.run(args.value);
  if (result.kind === ResultKind.Err) {
    return {
      exitCode: 1,
      body: errorResponse(
        'execute',
        [fieldError('result', result.message)],
        tool.name,
        'fix the underlying gate, then retry the same request envelope',
      ),
    };
  }

  if (
    tool.name === 'cortex-audit' &&
    typeof result.value === 'object' &&
    result.value instanceof Object &&
    'auditOk' in result.value &&
    result.value.auditOk === false
  ) {
    return {
      exitCode: 1,
      body: successResponse(tool.name, result.value),
    };
  }

  return {
    exitCode: 0,
    body: successResponse(tool.name, result.value),
  };
}

async function dispatchToolsCall(
  nestedValue: unknown,
  outerName: string,
): Promise<DispatchOutcome> {
  const tool = getTool('tools-call');
  if (!tool) {
    return {
      exitCode: 2,
      body: errorResponse(
        'unknown-tool',
        [fieldError('name', 'tools-call missing from registry')],
        outerName,
      ),
    };
  }
  const nested = tool.decodeArgs(nestedValue);
  if (nested.kind === ResultKind.Err) {
    return {
      exitCode: 2,
      body: errorResponse('arguments', nested.errors, outerName),
    };
  }
  const callArgs = nested.value as { name: string; arguments: unknown };
  return dispatchValue({
    name: callArgs.name,
    arguments: callArgs.arguments,
  });
}

export function outcomeYamlValue(
  outcome: DispatchOutcome,
): SuccessResponse | ErrorResponse {
  return outcome.body;
}

export function encodedOutcome(outcome: DispatchOutcome): unknown {
  return encodeResponse(outcome.body);
}

export function decodeErrorsOf(errors: readonly FieldError[]): ErrorResponse {
  return errorResponse('decode', errors);
}
