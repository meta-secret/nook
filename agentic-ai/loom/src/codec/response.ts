import { MaybeKind, absent, type Maybe } from '../result.ts';
import { RequestKind, ResponsePhase } from './enums.ts';
import type { FieldError } from './field-error.ts';

export type RecoverHint = {
  readonly toolsListRequest: string;
  readonly hint: string;
};

export type SuccessResponse = {
  readonly ok: true;
  readonly requestKind: RequestKind;
  readonly result: unknown;
};

export type ErrorResponse = {
  readonly ok: false;
  readonly isError: true;
  readonly phase: ResponsePhase;
  readonly requestKind: Maybe<RequestKind>;
  readonly errors: readonly FieldError[];
  readonly recover: RecoverHint;
};

export const TOOLS_LIST_REQUEST_PATH =
  'agentic-ai/loom/params/tools-list/default.yaml';

export function successResponse(
  requestKind: RequestKind,
  result: unknown,
): SuccessResponse {
  return { ok: true, requestKind, result };
}

export function errorResponse(
  phase: ResponsePhase,
  errors: readonly FieldError[],
  requestKind: Maybe<RequestKind> = absent(),
  hint: Maybe<string> = absent(),
): ErrorResponse {
  const defaultHint =
    'run loom with a toolsList request, then retry with a valid domain request object';
  return {
    ok: false,
    isError: true,
    phase,
    requestKind,
    errors,
    recover: {
      toolsListRequest: TOOLS_LIST_REQUEST_PATH,
      hint: hint.kind === MaybeKind.Present ? hint.value : defaultHint,
    },
  };
}

export function encodeResponse(
  response: SuccessResponse | ErrorResponse,
): unknown {
  if (response.ok) {
    return {
      ok: true,
      requestKind: response.requestKind,
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
  if (response.requestKind.kind === MaybeKind.Present) {
    encoded.requestKind = response.requestKind.value;
  }
  return encoded;
}
