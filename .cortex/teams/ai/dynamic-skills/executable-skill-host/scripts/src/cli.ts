#!/usr/bin/env bun
import {
  SKILL_TOOLS_LIST_INVOKE,
  ExecutableSkillActions,
  type SkillActionResult,
} from './skill-action-registry.ts';

import {
  SkillCommandIssue,
  SkillCommandPhase,
  SKILL_HOST_REQUEST_BYTE_LIMIT,
  SKILL_HOST_RESPONSE_BYTE_LIMIT,
  type SkillCommandErrorResponse,
} from './skill-command-domain.ts';

import {
  SkillCliInvocationKind,
  type ParseSkillCliInvocationRequest,
  ExecutableSkillInvocation,
} from './skill-cli-invocation.ts';

import {
  type UntrustedSkillYamlNode,
  ExecutableSkillYaml,
} from './skill-yaml-codec.ts';

export class ExecutableSkillCli {
  private constructor(private readonly request: RunSkillCliRequest) {}

  static runSkillCli(request: RunSkillCliRequest): SkillCliOutcome {
    return new ExecutableSkillCli(request).execute();
  }

  private execute(): SkillCliOutcome {
    const request = this.request;
    const invocationRequest: ParseSkillCliInvocationRequest = {
      argv: request.argv,
    };
    const invocation =
      ExecutableSkillInvocation.parseSkillCliInvocation(invocationRequest);
    if (invocation.kind === SkillCliInvocationKind.ToolsList) {
      return ExecutableSkillCli.dispatchSkillYamlText(
        ExecutableSkillActions.defaultSkillBlueprint(),
      );
    }
    if (invocation.kind === SkillCliInvocationKind.UsageError) {
      const outcomeRequest: SkillErrorOutcomeRequest = {
        phase: SkillCommandPhase.Usage,
        issue: SkillCommandIssue.UsageError,
        message: invocation.message,
      };
      return ExecutableSkillCli.errorOutcome(outcomeRequest);
    }
    return ExecutableSkillCli.dispatchSkillYamlText(invocation.requestYaml);
  }

  static dispatchSkillYamlText(text: string): SkillCliOutcome {
    if (UTF8_ENCODER.encode(text).byteLength > SKILL_HOST_REQUEST_BYTE_LIMIT)
      return ExecutableSkillCli.requestTooLargeOutcome();
    const parsed = ExecutableSkillYaml.parseSkillYamlText(text);
    if (!parsed.ok) {
      const outcomeRequest: SkillErrorOutcomeRequest = {
        phase: SkillCommandPhase.Decode,
        issue: SkillCommandIssue.InvalidYaml,
        message: 'Invalid YAML syntax.',
      };
      return ExecutableSkillCli.errorOutcome(outcomeRequest);
    }
    const decoded = ExecutableSkillActions.decodeSkillActionRequest(
      parsed.value,
    );
    if (!decoded.ok) {
      const outcomeRequest: SkillErrorOutcomeRequest = {
        phase: SkillCommandPhase.Decode,
        issue: SkillCommandIssue.InvalidRequest,
        message: decoded.message,
        path: decoded.path,
      };
      return ExecutableSkillCli.errorOutcome(outcomeRequest);
    }
    try {
      const response: SkillSuccessResponse = {
        ok: true,
        family: decoded.request.family,
        operation: decoded.request.operation,
        result: decoded.request.execute(),
      };
      const finalRequest: FinalSkillCliResponseRequest = {
        exitCode: 0,
        response: response as UntrustedSkillYamlNode,
      };
      return ExecutableSkillCli.finalizeSkillCliResponse(finalRequest);
    } catch {
      const outcomeRequest: SkillErrorOutcomeRequest = {
        phase: SkillCommandPhase.Execute,
        issue: SkillCommandIssue.InvalidRequest,
        message: 'Executable skill action failed validation or verification.',
      };
      return ExecutableSkillCli.errorOutcome(outcomeRequest);
    }
  }

  private static requestTooLargeOutcome(): SkillCliOutcome {
    const request: SkillErrorOutcomeRequest = {
      phase: SkillCommandPhase.Decode,
      issue: SkillCommandIssue.RequestTooLarge,
      message: `Skill request exceeds ${SKILL_HOST_REQUEST_BYTE_LIMIT} bytes.`,
    };
    return ExecutableSkillCli.errorOutcome(request);
  }

  private static errorOutcome(
    request: SkillErrorOutcomeRequest,
  ): SkillCliOutcome {
    const { path = '' } = request;
    const response: SkillCommandErrorResponse = {
      ok: false,
      isError: true,
      phase: request.phase,
      errors: [{ path, issue: request.issue, message: request.message }],
      recover: {
        toolsListRequest: SKILL_TOOLS_LIST_INVOKE,
        hint: 'List skill actions, copy the matching YAML example, and retry.',
      },
    };
    const finalRequest: FinalSkillCliResponseRequest = {
      exitCode: request.phase === SkillCommandPhase.Execute ? 1 : 2,
      response: response as UntrustedSkillYamlNode,
    };
    return ExecutableSkillCli.finalizeSkillCliResponse(finalRequest);
  }

  static finalizeSkillCliResponse(
    request: FinalSkillCliResponseRequest,
  ): SkillCliOutcome {
    let yaml: string;
    try {
      yaml = ExecutableSkillYaml.stringifySkillYaml(request.response);
    } catch {
      const invalidResponse: SkillCommandErrorResponse = {
        ok: false,
        isError: true,
        phase: SkillCommandPhase.Execute,
        errors: [
          {
            path: 'result',
            issue: SkillCommandIssue.InvalidResponse,
            message: 'Skill action returned an invalid YAML response value.',
          },
        ],
        recover: {
          toolsListRequest: SKILL_TOOLS_LIST_INVOKE,
          hint: 'Use only finite values permitted by the action result schema.',
        },
      };
      return {
        exitCode: 1,
        yaml: ExecutableSkillYaml.stringifySkillYaml(
          invalidResponse as UntrustedSkillYamlNode,
        ),
      };
    }
    if (
      UTF8_ENCODER.encode(yaml).byteLength <= SKILL_HOST_RESPONSE_BYTE_LIMIT
    ) {
      return { exitCode: request.exitCode, yaml };
    }
    const response: SkillCommandErrorResponse = {
      ok: false,
      isError: true,
      phase: SkillCommandPhase.Execute,
      errors: [
        {
          path: 'result',
          issue: SkillCommandIssue.ResponseTooLarge,
          message: `Encoded YAML response exceeds ${SKILL_HOST_RESPONSE_BYTE_LIMIT} bytes.`,
        },
      ],
      recover: {
        toolsListRequest: SKILL_TOOLS_LIST_INVOKE,
        hint: 'Reduce the request cardinality and retry the skill action.',
      },
    };
    const fallbackYaml = ExecutableSkillYaml.stringifySkillYaml(
      response as UntrustedSkillYamlNode,
    );
    if (
      UTF8_ENCODER.encode(fallbackYaml).byteLength >
      SKILL_HOST_RESPONSE_BYTE_LIMIT
    ) {
      throw new Error(
        'Static response-too-large failure exceeds its byte limit.',
      );
    }
    return { exitCode: 1, yaml: fallbackYaml };
  }
}

export type SkillCliOutcome = {
  readonly exitCode: number;
  readonly yaml: string;
};

export type RunSkillCliRequest = {
  readonly argv: readonly string[];
};

type SkillSuccessResponse = {
  readonly ok: true;
  readonly family: string;
  readonly operation: string;
  readonly result: SkillActionResult;
};

export type FinalSkillCliResponseRequest = {
  readonly exitCode: number;
  readonly response: UntrustedSkillYamlNode;
};

const UTF8_ENCODER = new TextEncoder();

type SkillErrorOutcomeRequest = {
  readonly phase: SkillCommandPhase;
  readonly issue: SkillCommandIssue;
  readonly message: string;
  readonly path?: string;
};

if (import.meta.main) {
  const request: RunSkillCliRequest = { argv: process.argv.slice(2) };
  const outcome = ExecutableSkillCli.runSkillCli(request);
  process.stdout.write(outcome.yaml);
  process.exitCode = outcome.exitCode;
}
