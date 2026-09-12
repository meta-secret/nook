import type {
  UntrustedYamlMapBuilder,
  UntrustedYamlNode,
} from '../lib/guards.ts';
import { UntrustedYamlBoundary } from '../lib/guards.ts';

import type { LoomCommandResult } from '../tools/registry.ts';
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
  type FieldError,
  FieldDiagnosticText,
  FieldDiagnostic,
  FieldDiagnosticMessage,
} from './field-error.ts';

import type { FieldErrorArgs } from './field-error.ts';
import { TOOLS_LIST_INVOKE } from './example-documents.ts';
export type RecoverHint = {
  readonly toolsListRequest: string;
  readonly hint: string;
};

type SuccessResponseBase = {
  readonly ok: true;
  readonly result: UntrustedYamlNode;
};

/** Serialize a concrete command report only at the outbound YAML boundary. */

/** Owns the loom response encoder registry and its capability transitions. */
export class LoomResponseEncoder {
  private constructor() {}
  private static readonly DEFAULT_HINT =
    'run task loom:tools-list, then retry with a valid domain request object';

  private static readonly EXECUTE_HINT =
    'fix the underlying gate, then retry the same domain request object';

  static commandResultToResponseValue(
    result: LoomCommandResult,
  ): UntrustedYamlNode {
    return UntrustedYamlBoundary.fromHost(result as UntrustedYamlNode);
  }

  static successResponseForFamily(
    args: SuccessResponseForFamilyArgs,
  ): SuccessResponse {
    const { family, result } = args;

    return { ok: true, family, result };
  }

  static successResponseForAgentStats(
    args: SuccessResponseForAgentStatsArgs,
  ): SuccessResponse {
    const { operation, result } = args;

    return { ok: true, family: RequestFamily.AgentStats, operation, result };
  }

  static successResponseForPrLand(
    args: SuccessResponseForPrLandArgs,
  ): SuccessResponse {
    const { operation, result } = args;

    return { ok: true, family: RequestFamily.PrLand, operation, result };
  }

  static decodeErrorResponse(
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
        toolsListRequest: TOOLS_LIST_INVOKE,
        hint: LoomResponseEncoder.DEFAULT_HINT,
      },
    };
  }

  static executeErrorResponseForFamily(
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
        toolsListRequest: TOOLS_LIST_INVOKE,
        hint: LoomResponseEncoder.EXECUTE_HINT,
      },
    };
  }

  static executeErrorResponseForAgentStats(
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
        toolsListRequest: TOOLS_LIST_INVOKE,
        hint: LoomResponseEncoder.EXECUTE_HINT,
      },
    };
  }

  static executeErrorResponseForPrLand(
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
        toolsListRequest: TOOLS_LIST_INVOKE,
        hint: LoomResponseEncoder.EXECUTE_HINT,
      },
    };
  }

  static encodeResponse(
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
      return UntrustedYamlBoundary.seal(encoded);
    }

    const encoded: UntrustedYamlMapBuilder = {
      ok: false,
      isError: true,
      phase: response.phase,
      errors: response.errors.map((entry) => ({
        path: entry.path,
        issue: entry.issue,
        message: FieldDiagnosticMessage.render(entry),
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
      encoded.explanation = UntrustedYamlBoundary.seal(explanation);
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
    return UntrustedYamlBoundary.seal(encoded);
  }

  static executionFieldError(detail: string): FieldError {
    const fieldErrorArgs: FieldErrorArgs = {
      path: 'result',
      issue: FieldIssue.ExecuteFailed,
      detail: FieldDiagnosticText.create(detail),
    };
    return FieldDiagnostic.create(fieldErrorArgs);
  }
}

export type SuccessResponse =
  | (SuccessResponseBase & {
      readonly family:
        | RequestFamily.PrePush
        | RequestFamily.CortexAudit
        | RequestFamily.CortexSessionClean
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
        | RequestFamily.CortexSessionClean
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

export type SuccessResponseForFamilyArgs = {
  readonly family:
    | RequestFamily.PrePush
    | RequestFamily.CortexAudit
    | RequestFamily.CortexSessionClean
    | RequestFamily.SkillScaffold
    | RequestFamily.DependencyPopularity
    | RequestFamily.ToolsList;
  readonly result: UntrustedYamlNode;
};

export type SuccessResponseForAgentStatsArgs = {
  readonly operation: AgentStatsOperation;
  readonly result: UntrustedYamlNode;
};

export type SuccessResponseForPrLandArgs = {
  readonly operation: PrLandOperation;
  readonly result: UntrustedYamlNode;
};

export type DecodeErrorResponseArgs = {
  readonly phase: ResponsePhase.Decode | ResponsePhase.UnknownRequest;
  readonly errors: readonly FieldError[];
  readonly explanation: BlueprintExplanation;
};

export type ExecuteErrorResponseForFamilyArgs = {
  readonly family:
    | RequestFamily.PrePush
    | RequestFamily.CortexAudit
    | RequestFamily.CortexSessionClean
    | RequestFamily.SkillScaffold
    | RequestFamily.DependencyPopularity
    | RequestFamily.ToolsList
    | RequestFamily.ToolsCall;
  readonly errors: readonly FieldError[];
};

export type ExecuteErrorResponseForAgentStatsArgs = {
  readonly operation: AgentStatsOperation;
  readonly errors: readonly FieldError[];
};

export type ExecuteErrorResponseForPrLandArgs = {
  readonly operation: PrLandOperation;
  readonly errors: readonly FieldError[];
};
