import { ResponsePhase, ToolName } from '../codec/enums.ts';
import { fieldError } from '../codec/field-error.ts';
import { decodeLoomRequest } from '../codec/request.ts';
import {
  encodeResponse,
  errorResponse,
  successResponse,
  type ErrorResponse,
  type SuccessResponse,
} from '../codec/response.ts';
import { parseYamlFile } from '../codec/yaml.ts';
import { MaybeKind, ResultKind, absent, present } from '../result.ts';
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
  return dispatchNamed(request.value.name, request.value.arguments);
}

async function dispatchNamed(
  name: string,
  argsValue: unknown,
): Promise<DispatchOutcome> {
  const toolLookup = getTool(name);
  if (toolLookup.kind === MaybeKind.Absent) {
    return {
      exitCode: 2,
      body: errorResponse(
        ResponsePhase.UnknownTool,
        [
          fieldError(
            'name',
            `unknown tool; known: ${listAllToolNames().join(', ')}`,
          ),
        ],
        present(name),
      ),
    };
  }
  const tool = toolLookup.value;

  if (tool.name === ToolName.ToolsCall) {
    return dispatchToolsCall(argsValue, name);
  }

  const args = tool.decodeArgs(argsValue);
  if (args.kind === ResultKind.Err) {
    return {
      exitCode: 2,
      body: errorResponse(
        ResponsePhase.Arguments,
        args.errors,
        present(tool.name),
      ),
    };
  }

  const result = await tool.run(args.value);
  if (result.kind === ResultKind.Err) {
    return {
      exitCode: 1,
      body: errorResponse(
        ResponsePhase.Execute,
        [fieldError('result', result.message)],
        present(tool.name),
        present(
          'fix the underlying gate, then retry the same request envelope',
        ),
      ),
    };
  }

  if (
    tool.name === ToolName.CortexAudit &&
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
  const toolLookup = getTool(ToolName.ToolsCall);
  if (toolLookup.kind === MaybeKind.Absent) {
    return {
      exitCode: 2,
      body: errorResponse(
        ResponsePhase.UnknownTool,
        [fieldError('name', 'tools-call missing from registry')],
        present(outerName),
      ),
    };
  }
  const nested = toolLookup.value.decodeArgs(nestedValue);
  if (nested.kind === ResultKind.Err) {
    return {
      exitCode: 2,
      body: errorResponse(
        ResponsePhase.Arguments,
        nested.errors,
        present(outerName),
      ),
    };
  }
  const callArgs = nested.value as { name: string; arguments: unknown };
  return dispatchNamed(callArgs.name, callArgs.arguments);
}

export function encodedOutcome(outcome: DispatchOutcome): unknown {
  return encodeResponse(outcome.body);
}
