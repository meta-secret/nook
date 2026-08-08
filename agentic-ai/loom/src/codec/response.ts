import {
  AgentStatsOperation,
  PrLandOperation,
  RequestFamily,
  ResponsePhase,
} from './enums.ts';
import {
  FieldIssue,
  fieldDetailText,
  fieldError,
  fieldIssueMessage,
  type FieldError,
} from './field-error.ts';

export type RecoverHint = {
  readonly toolsListRequest: string;
  readonly hint: string;
};

type SuccessResponseBase = {
  readonly ok: true;
  readonly result: unknown;
};

export type SuccessResponse =
  | (SuccessResponseBase & {
      readonly family:
        | RequestFamily.PrePush
        | RequestFamily.CortexAudit
        | RequestFamily.SkillScaffold
        | RequestFamily.ToolsList;
    })
  | (SuccessResponseBase & {
      readonly family: RequestFamily.AgentStats;
      readonly operation: AgentStatsOperation;
    })
  | (SuccessResponseBase & {
      readonly family: RequestFamily.PrLand;
      readonly operation: PrLandOperation;
    });

export type DecodeErrorResponse = {
  readonly ok: false;
  readonly isError: true;
  readonly phase: ResponsePhase.Decode | ResponsePhase.UnknownRequest;
  readonly errors: readonly FieldError[];
  readonly recover: RecoverHint;
};

export type ExecuteErrorResponse =
  | {
      readonly ok: false;
      readonly isError: true;
      readonly phase: ResponsePhase.Execute;
      readonly family:
        | RequestFamily.PrePush
        | RequestFamily.CortexAudit
        | RequestFamily.SkillScaffold
        | RequestFamily.ToolsList
        | RequestFamily.ToolsCall;
      readonly errors: readonly FieldError[];
      readonly recover: RecoverHint;
    }
  | {
      readonly ok: false;
      readonly isError: true;
      readonly phase: ResponsePhase.Execute;
      readonly family: RequestFamily.AgentStats;
      readonly operation: AgentStatsOperation;
      readonly errors: readonly FieldError[];
      readonly recover: RecoverHint;
    }
  | {
      readonly ok: false;
      readonly isError: true;
      readonly phase: ResponsePhase.Execute;
      readonly family: RequestFamily.PrLand;
      readonly operation: PrLandOperation;
      readonly errors: readonly FieldError[];
      readonly recover: RecoverHint;
    };

export type ErrorResponse = DecodeErrorResponse | ExecuteErrorResponse;

export const TOOLS_LIST_REQUEST_PATH =
  'agentic-ai/loom/params/tools-list/default.yaml';

const DEFAULT_HINT =
  'run loom with a toolsList request, then retry with a valid domain request object';

const EXECUTE_HINT =
  'fix the underlying gate, then retry the same domain request object';

export function successResponseForFamily(
  family:
    | RequestFamily.PrePush
    | RequestFamily.CortexAudit
    | RequestFamily.SkillScaffold
    | RequestFamily.ToolsList,
  result: unknown,
): SuccessResponse {
  return { ok: true, family, result };
}

export function successResponseForAgentStats(
  operation: AgentStatsOperation,
  result: unknown,
): SuccessResponse {
  return { ok: true, family: RequestFamily.AgentStats, operation, result };
}

export function successResponseForPrLand(
  operation: PrLandOperation,
  result: unknown,
): SuccessResponse {
  return { ok: true, family: RequestFamily.PrLand, operation, result };
}

export function decodeErrorResponse(
  phase: ResponsePhase.Decode | ResponsePhase.UnknownRequest,
  errors: readonly FieldError[],
): DecodeErrorResponse {
  return {
    ok: false,
    isError: true,
    phase,
    errors,
    recover: {
      toolsListRequest: TOOLS_LIST_REQUEST_PATH,
      hint: DEFAULT_HINT,
    },
  };
}

export function executeErrorResponseForFamily(
  family:
    | RequestFamily.PrePush
    | RequestFamily.CortexAudit
    | RequestFamily.SkillScaffold
    | RequestFamily.ToolsList
    | RequestFamily.ToolsCall,
  errors: readonly FieldError[],
): ExecuteErrorResponse {
  return {
    ok: false,
    isError: true,
    phase: ResponsePhase.Execute,
    family,
    errors,
    recover: {
      toolsListRequest: TOOLS_LIST_REQUEST_PATH,
      hint: EXECUTE_HINT,
    },
  };
}

export function executeErrorResponseForAgentStats(
  operation: AgentStatsOperation,
  errors: readonly FieldError[],
): ExecuteErrorResponse {
  return {
    ok: false,
    isError: true,
    phase: ResponsePhase.Execute,
    family: RequestFamily.AgentStats,
    operation,
    errors,
    recover: {
      toolsListRequest: TOOLS_LIST_REQUEST_PATH,
      hint: EXECUTE_HINT,
    },
  };
}

export function executeErrorResponseForPrLand(
  operation: PrLandOperation,
  errors: readonly FieldError[],
): ExecuteErrorResponse {
  return {
    ok: false,
    isError: true,
    phase: ResponsePhase.Execute,
    family: RequestFamily.PrLand,
    operation,
    errors,
    recover: {
      toolsListRequest: TOOLS_LIST_REQUEST_PATH,
      hint: EXECUTE_HINT,
    },
  };
}

export function encodeResponse(
  response: SuccessResponse | ErrorResponse,
): unknown {
  if (response.ok) {
    const encoded: Record<string, unknown> = {
      ok: true,
      family: response.family,
      result: response.result,
    };
    if (
      response.family === RequestFamily.AgentStats ||
      response.family === RequestFamily.PrLand
    ) {
      encoded.operation = response.operation;
    }
    return encoded;
  }

  const encoded: Record<string, unknown> = {
    ok: false,
    isError: true,
    phase: response.phase,
    errors: response.errors.map((entry) => ({
      path: entry.path,
      message: fieldIssueMessage(entry),
    })),
    recover: {
      toolsListRequest: response.recover.toolsListRequest,
      hint: response.recover.hint,
    },
  };
  if (response.phase === ResponsePhase.Execute) {
    encoded.family = response.family;
    if (
      response.family === RequestFamily.AgentStats ||
      response.family === RequestFamily.PrLand
    ) {
      encoded.operation = response.operation;
    }
  }
  return encoded;
}

export function executionFieldError(detail: string): FieldError {
  return fieldError(
    'result',
    FieldIssue.ExecuteFailed,
    fieldDetailText(detail),
  );
}
