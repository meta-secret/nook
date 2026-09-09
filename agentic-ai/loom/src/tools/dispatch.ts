import { readFileSync } from 'node:fs';

import {
  type UntrustedYamlNode,
  UntrustedYamlBoundary,
} from '../lib/guards.ts';

import { RequestBlueprintComparison } from '../codec/blueprint-diff.ts';

import { RequestFamily, ResponsePhase } from '../codec/enums.ts';

import {
  DecodeStatus,
  FieldDetailKind,
  FieldIssue,
} from '../codec/field-error.ts';

import { type LoomRequest, LoomRequestSchema } from '../codec/request.ts';

import {
  type ErrorResponse,
  type SuccessResponse,
  LoomResponseEncoder,
} from '../codec/response.ts';

import { YamlDocument } from '../codec/yaml.ts';

import { LoomFailure, LoomFailureDetailKind } from '../loom-failure.ts';

import { LoomRequestCatalog } from './registry.ts';

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

export class LoomRequestDispatch {
  private constructor(private readonly request: string) {}

  static dispatchRequestFile(requestPath: string): Promise<DispatchOutcome> {
    return new LoomRequestDispatch(requestPath).execute();
  }

  private async execute(): Promise<DispatchOutcome> {
    const requestPath = this.request;
    const receivedYaml = LoomRequestDispatch.readRequestText(requestPath);
    const parsed = YamlDocument.read(requestPath);
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
        explanation: RequestBlueprintComparison.explainSyntaxFailure(
          explainSyntaxFailureArgs,
        ),
      };
      return {
        exitCode: 2,
        body: LoomResponseEncoder.decodeErrorResponse(decodeErrorResponseArgs2),
      };
    }
    return LoomRequestDispatch.dispatchValue(parsed.value.value);
  }

  static async dispatchValue(
    value: UntrustedYamlNode,
  ): Promise<DispatchOutcome> {
    const request = LoomRequestSchema.decodeLoomRequest(value);
    if (request.status === DecodeStatus.Failed) {
      const decodeErrorResponseArgs: DecodeErrorResponseArgs = {
        phase: ResponsePhase.Decode,
        errors: request.errors,
        explanation: RequestBlueprintComparison.explainAgainstBlueprint(value),
      };
      return {
        exitCode: 2,
        body: LoomResponseEncoder.decodeErrorResponse(decodeErrorResponseArgs),
      };
    }
    return LoomRequestDispatch.dispatchDecoded(request.value);
  }

  private static async dispatchDecoded(
    request: LoomRequest,
  ): Promise<DispatchOutcome> {
    if (request.family === RequestFamily.ToolsCall) {
      return LoomRequestDispatch.dispatchDecoded(request.toolsCall);
    }

    if (request.family === RequestFamily.ToolsList) {
      const asUntrustedYamlNodeArgs: UntrustedYamlNode = {
        requests: LoomRequestCatalog.listDiscoverableRequests(),
      };
      const successResponseForFamilyArgs8: SuccessResponseForFamilyArgs = {
        family: RequestFamily.ToolsList,
        result: UntrustedYamlBoundary.fromHost(asUntrustedYamlNodeArgs),
      };
      return {
        exitCode: 0,
        body: LoomResponseEncoder.successResponseForFamily(
          successResponseForFamilyArgs8,
        ),
      };
    }

    try {
      const result = await LoomRequestCatalog.executeRequest(request);
      const responseValue =
        LoomResponseEncoder.commandResultToResponseValue(result);
      if (request.family === RequestFamily.CortexAudit && 'auditOk' in result) {
        if (!result.auditOk) {
          const successResponseForFamilyArgs7: SuccessResponseForFamilyArgs = {
            family: RequestFamily.CortexAudit,
            result: responseValue,
          };
          return {
            exitCode: 1,
            body: LoomResponseEncoder.successResponseForFamily(
              successResponseForFamilyArgs7,
            ),
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
            body: LoomResponseEncoder.successResponseForFamily(
              successResponseForFamilyArgs6,
            ),
          };
        }
      }
      const buildSuccessResponseArgs = { request, result: responseValue };
      return {
        exitCode: 0,
        body: LoomRequestDispatch.buildSuccessResponse(
          buildSuccessResponseArgs,
        ),
      };
    } catch (error) {
      const detail =
        error instanceof LoomFailure || error instanceof Error
          ? LoomRequestDispatch.failureDetail(error)
          : typeof error === 'string'
            ? LoomRequestDispatch.failureDetail(error)
            : LoomRequestDispatch.failureDetail(String(error));
      const buildExecuteErrorResponseArgs = {
        request,
        detail,
      };
      return {
        exitCode: 1,
        body: LoomRequestDispatch.buildExecuteErrorResponse(
          buildExecuteErrorResponseArgs,
        ),
      };
    }
  }

  private static readRequestText(requestPath: string): string {
    try {
      return readFileSync(requestPath, 'utf8');
    } catch {
      return '';
    }
  }

  private static failureDetail(error: LoomFailure | Error | string): string {
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

  private static buildSuccessResponse(
    args: BuildSuccessResponseArgs,
  ): SuccessResponse {
    const { request, result } = args;

    switch (request.family) {
      case RequestFamily.PrePush: {
        const successResponseForFamilyArgs5: SuccessResponseForFamilyArgs = {
          family: RequestFamily.PrePush,
          result,
        };
        return LoomResponseEncoder.successResponseForFamily(
          successResponseForFamilyArgs5,
        );
      }
      case RequestFamily.CortexAudit: {
        const successResponseForFamilyArgs4: SuccessResponseForFamilyArgs = {
          family: RequestFamily.CortexAudit,
          result,
        };
        return LoomResponseEncoder.successResponseForFamily(
          successResponseForFamilyArgs4,
        );
      }
      case RequestFamily.CortexSessionClean: {
        const successResponseForFamilyArgs: SuccessResponseForFamilyArgs = {
          family: RequestFamily.CortexSessionClean,
          result,
        };
        return LoomResponseEncoder.successResponseForFamily(
          successResponseForFamilyArgs,
        );
      }
      case RequestFamily.SkillScaffold: {
        const successResponseForFamilyArgs3: SuccessResponseForFamilyArgs = {
          family: RequestFamily.SkillScaffold,
          result,
        };
        return LoomResponseEncoder.successResponseForFamily(
          successResponseForFamilyArgs3,
        );
      }
      case RequestFamily.AgentStats: {
        const successResponseForAgentStatsArgs: SuccessResponseForAgentStatsArgs =
          {
            operation: request.operation,
            result,
          };
        return LoomResponseEncoder.successResponseForAgentStats(
          successResponseForAgentStatsArgs,
        );
      }
      case RequestFamily.PrLand: {
        const successResponseForPrLandArgs: SuccessResponseForPrLandArgs = {
          operation: request.operation,
          result,
        };
        return LoomResponseEncoder.successResponseForPrLand(
          successResponseForPrLandArgs,
        );
      }
      case RequestFamily.DependencyPopularity: {
        const successResponseForFamilyArgs2: SuccessResponseForFamilyArgs = {
          family: RequestFamily.DependencyPopularity,
          result,
        };
        return LoomResponseEncoder.successResponseForFamily(
          successResponseForFamilyArgs2,
        );
      }
      case RequestFamily.ToolsList:
      case RequestFamily.ToolsCall: {
        const successResponseForFamilyArgs: SuccessResponseForFamilyArgs = {
          family: RequestFamily.ToolsList,
          result,
        };
        return LoomResponseEncoder.successResponseForFamily(
          successResponseForFamilyArgs,
        );
      }
    }
  }

  private static buildExecuteErrorResponse(
    args: BuildExecuteErrorResponseArgs,
  ): ErrorResponse {
    const { request, detail } = args;

    const errors = [LoomResponseEncoder.executionFieldError(detail)];
    switch (request.family) {
      case RequestFamily.PrePush: {
        const executeErrorResponseForFamilyArgs5: ExecuteErrorResponseForFamilyArgs =
          {
            family: RequestFamily.PrePush,
            errors,
          };
        return LoomResponseEncoder.executeErrorResponseForFamily(
          executeErrorResponseForFamilyArgs5,
        );
      }
      case RequestFamily.CortexAudit: {
        const executeErrorResponseForFamilyArgs4: ExecuteErrorResponseForFamilyArgs =
          {
            family: RequestFamily.CortexAudit,
            errors,
          };
        return LoomResponseEncoder.executeErrorResponseForFamily(
          executeErrorResponseForFamilyArgs4,
        );
      }
      case RequestFamily.CortexSessionClean: {
        const executeErrorResponseForFamilyArgs: ExecuteErrorResponseForFamilyArgs =
          {
            family: RequestFamily.CortexSessionClean,
            errors,
          };
        return LoomResponseEncoder.executeErrorResponseForFamily(
          executeErrorResponseForFamilyArgs,
        );
      }
      case RequestFamily.SkillScaffold: {
        const executeErrorResponseForFamilyArgs3: ExecuteErrorResponseForFamilyArgs =
          {
            family: RequestFamily.SkillScaffold,
            errors,
          };
        return LoomResponseEncoder.executeErrorResponseForFamily(
          executeErrorResponseForFamilyArgs3,
        );
      }
      case RequestFamily.AgentStats: {
        const executeErrorResponseForAgentStatsArgs: ExecuteErrorResponseForAgentStatsArgs =
          {
            operation: request.operation,
            errors,
          };
        return LoomResponseEncoder.executeErrorResponseForAgentStats(
          executeErrorResponseForAgentStatsArgs,
        );
      }
      case RequestFamily.PrLand: {
        const executeErrorResponseForPrLandArgs: ExecuteErrorResponseForPrLandArgs =
          {
            operation: request.operation,
            errors,
          };
        return LoomResponseEncoder.executeErrorResponseForPrLand(
          executeErrorResponseForPrLandArgs,
        );
      }
      case RequestFamily.DependencyPopularity: {
        const executeErrorResponseForFamilyArgs2: ExecuteErrorResponseForFamilyArgs =
          {
            family: RequestFamily.DependencyPopularity,
            errors,
          };
        return LoomResponseEncoder.executeErrorResponseForFamily(
          executeErrorResponseForFamilyArgs2,
        );
      }
      case RequestFamily.ToolsList:
      case RequestFamily.ToolsCall: {
        const executeErrorResponseForFamilyArgs: ExecuteErrorResponseForFamilyArgs =
          {
            family: RequestFamily.ToolsList,
            errors,
          };
        return LoomResponseEncoder.executeErrorResponseForFamily(
          executeErrorResponseForFamilyArgs,
        );
      }
    }
  }

  static encodedOutcome(outcome: DispatchOutcome): UntrustedYamlNode {
    return LoomResponseEncoder.encodeResponse(outcome.body);
  }
}

export type DispatchOutcome = {
  readonly exitCode: number;
  readonly body: SuccessResponse | ErrorResponse;
};

type BuildSuccessResponseArgs = {
  readonly request: LoomRequest;
  readonly result: UntrustedYamlNode;
};

type BuildExecuteErrorResponseArgs = {
  readonly request: LoomRequest;
  readonly detail: string;
};
