import type { FieldError } from './field-error.ts';

export type ResponsePhase = 'decode' | 'unknown-tool' | 'arguments' | 'execute';

export type RecoverHint = {
  readonly toolsListRequest: string;
  readonly hint: string;
};

export type SuccessResponse = {
  readonly ok: true;
  readonly name: string;
  readonly result: unknown;
};

export type ErrorResponse = {
  readonly ok: false;
  readonly isError: true;
  readonly phase: ResponsePhase;
  readonly name?: string;
  readonly errors: readonly FieldError[];
  readonly recover: RecoverHint;
};

export const TOOLS_LIST_REQUEST_PATH =
  'agentic-ai/loom/params/tools-list/default.yaml';

export function successResponse(
  name: string,
  result: unknown,
): SuccessResponse {
  return { ok: true, name, result };
}

export function errorResponse(
  phase: ResponsePhase,
  errors: readonly FieldError[],
  name?: string,
  hint?: string,
): ErrorResponse {
  const response: ErrorResponse = {
    ok: false,
    isError: true,
    phase,
    errors,
    recover: {
      toolsListRequest: TOOLS_LIST_REQUEST_PATH,
      hint:
        hint ??
        'run loom with a tools-list request, then retry with a valid arguments object',
    },
  };
  if (typeof name === 'string') {
    return { ...response, name };
  }
  return response;
}

export function encodeResponse(
  response: SuccessResponse | ErrorResponse,
): unknown {
  if (response.ok) {
    return {
      ok: true,
      name: response.name,
      result: response.result,
    };
  }
  const encoded: Record<string, unknown> = {
    ok: false,
    isError: true,
    phase: response.phase,
    errors: response.errors.map((entry) => ({
      path: entry.path,
      message: entry.message,
    })),
    recover: {
      toolsListRequest: response.recover.toolsListRequest,
      hint: response.recover.hint,
    },
  };
  if (typeof response.name === 'string') {
    encoded.name = response.name;
  }
  return encoded;
}
