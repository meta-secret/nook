import type { UntrustedYamlMapBuilder, UntrustedYamlNode } from '../lib/guards.ts';
import { sealUntrustedYamlMap } from '../lib/guards.ts';
import {
  BlueprintExplanationKind,
  type BlueprintExplanation,
} from './blueprint-diff.ts';
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

import type { FieldErrorArgs } from './field-error.ts';
export type RecoverHint = {
  readonly toolsListRequest: string;
  readonly hint: string;
};

type SuccessResponseBase = {
  readonly ok: true;
  readonly result: UntrustedYamlNode;
};

export type SuccessResponse =
  | (SuccessResponseBase & {
      readonly family:
        | RequestFamily.PrePush
        | RequestFamily.CortexAudit
        | RequestFamily.SkillScaffold
        | RequestFamily.DependencyPopularity
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
  readonly explanation: BlueprintExplanation;
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
        | RequestFamily.DependencyPopularity
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

export type SuccessResponseForFamilyArgs = {
  readonly family:
    | RequestFamily.PrePush
    | RequestFamily.CortexAudit
    | RequestFamily.SkillScaffold
    | RequestFamily.DependencyPopularity
    | RequestFamily.ToolsList;
  readonly result: UntrustedYamlNode;
};

export function successResponseForFamily(
  args: SuccessResponseForFamilyArgs,
): SuccessResponse {
  const { family, result } = args;

  return { ok: true, family, result };
}

export type SuccessResponseForAgentStatsArgs = {
  readonly operation: AgentStatsOperation;
  readonly result: UntrustedYamlNode;
};

export function successResponseForAgentStats(
  args: SuccessResponseForAgentStatsArgs,
): SuccessResponse {
  const { operation, result } = args;

  return { ok: true, family: RequestFamily.AgentStats, operation, result };
}

export type SuccessResponseForPrLandArgs = {
  readonly operation: PrLandOperation;
  readonly result: UntrustedYamlNode;
};

export function successResponseForPrLand(
  args: SuccessResponseForPrLandArgs,
): SuccessResponse {
  const { operation, result } = args;

  return { ok: true, family: RequestFamily.PrLand, operation, result };
}

export type DecodeErrorResponseArgs = {
  readonly phase: ResponsePhase.Decode | ResponsePhase.UnknownRequest;
  readonly errors: readonly FieldError[];
  readonly explanation: BlueprintExplanation;
};

export function decodeErrorResponse(
  args: DecodeErrorResponseArgs,
): DecodeErrorResponse {
  const { phase, errors, explanation } = args;

  return {
    ok: false,
    isError: true,
    phase,
    errors,
    explanation,
    recover: {
      toolsListRequest: TOOLS_LIST_REQUEST_PATH,
      hint: DEFAULT_HINT,
    },
  };
}

export type ExecuteErrorResponseForFamilyArgs = {
  readonly family:
    | RequestFamily.PrePush
    | RequestFamily.CortexAudit
    | RequestFamily.SkillScaffold
    | RequestFamily.DependencyPopularity
    | RequestFamily.ToolsList
    | RequestFamily.ToolsCall;
  readonly errors: readonly FieldError[];
};

export function executeErrorResponseForFamily(
  args: ExecuteErrorResponseForFamilyArgs,
): ExecuteErrorResponse {
  const { family, errors } = args;

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

export type ExecuteErrorResponseForAgentStatsArgs = {
  readonly operation: AgentStatsOperation;
  readonly errors: readonly FieldError[];
};

export function executeErrorResponseForAgentStats(
  args: ExecuteErrorResponseForAgentStatsArgs,
): ExecuteErrorResponse {
  const { operation, errors } = args;

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

export type ExecuteErrorResponseForPrLandArgs = {
  readonly operation: PrLandOperation;
  readonly errors: readonly FieldError[];
};

export function executeErrorResponseForPrLand(
  args: ExecuteErrorResponseForPrLandArgs,
): ExecuteErrorResponse {
  const { operation, errors } = args;

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
): UntrustedYamlNode {
  if (response.ok) {
    const encoded: UntrustedYamlMapBuilder = {
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
    return sealUntrustedYamlMap(encoded);
  }

  const encoded: UntrustedYamlMapBuilder = {
    ok: false,
    isError: true,
    phase: response.phase,
    errors: response.errors.map((entry) => ({
      path: entry.path,
      issue: entry.issue,
      message: fieldIssueMessage(entry),
    })),
    recover: {
      toolsListRequest: response.recover.toolsListRequest,
      hint: response.recover.hint,
    },
  };
  if ('explanation' in response) {
    const explanation: UntrustedYamlMapBuilder = {
      kind: response.explanation.kind,
      blueprintPath: response.explanation.blueprintPath,
      blueprintYaml: response.explanation.blueprintYaml,
      receivedYaml: response.explanation.receivedYaml,
      unifiedDiff: response.explanation.unifiedDiff,
    };
    if (response.explanation.kind === BlueprintExplanationKind.Syntax) {
      explanation.parseMessage = response.explanation.parseMessage;
    }
    encoded.explanation = sealUntrustedYamlMap(explanation);
  }
  if (response.phase === ResponsePhase.Execute) {
    encoded.family = response.family;
    if (
      response.family === RequestFamily.AgentStats ||
      response.family === RequestFamily.PrLand
    ) {
      encoded.operation = response.operation;
    }
  }
  return sealUntrustedYamlMap(encoded);
}

export function executionFieldError(detail: string): FieldError {
  const fieldErrorArgs: FieldErrorArgs = {
    path: 'result',
    issue: FieldIssue.ExecuteFailed,
    detail: fieldDetailText(detail),
  };
  return fieldError(fieldErrorArgs);
}
