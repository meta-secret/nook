#!/usr/bin/env bun
import { EXECUTABLE_SKILL_CATALOG } from './skill-action-registry.ts';
import { err, ok, type Result } from 'neverthrow';
import {
  ExecutableSkillYamlEncoding,
  SkillYamlEncodingIssue,
  type SkillYamlEncodingFailure,
} from './skill-yaml-codec.ts';
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

  static from(request: RunSkillCliRequest): ExecutableSkillCli {
    return new ExecutableSkillCli(request);
  }

  public execute(): Result<SkillCliOutcome, SkillYamlEncodingFailure> {
    const request = this.request;
    const invocationRequest: ParseSkillCliInvocationRequest = {
      argv: request.argv,
    };
    const invocation =
      ExecutableSkillInvocation.from(invocationRequest).execute();
    if (invocation.kind === SkillCliInvocationKind.ToolsList) {
      return new ExecutableSkillRequest(
        EXECUTABLE_SKILL_CATALOG.example(),
      ).execute();
    }
    if (invocation.kind === SkillCliInvocationKind.UsageError) {
      const outcomeRequest: SkillErrorOutcomeRequest = {
        phase: SkillCommandPhase.Usage,
        issue: SkillCommandIssue.UsageError,
        message: invocation.message,
      };
      return new ExecutableSkillFailureResponse(outcomeRequest).execute();
    }
    return new ExecutableSkillRequest(invocation.requestYaml).execute();
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

export class ExecutableSkillRequest {
  constructor(private readonly text: string) {}
  execute(): Result<SkillCliOutcome, SkillYamlEncodingFailure> {
    const text = this.text;
    if (UTF8_ENCODER.encode(text).byteLength > SKILL_HOST_REQUEST_BYTE_LIMIT)
      return this.requestTooLargeOutcome();
    const parsed = ExecutableSkillYaml.from(text).execute();
    if (parsed.isErr()) {
      const outcomeRequest: SkillErrorOutcomeRequest = {
        phase: SkillCommandPhase.Decode,
        issue: SkillCommandIssue.InvalidYaml,
        message: 'Invalid YAML syntax.',
      };
      return new ExecutableSkillFailureResponse(outcomeRequest).execute();
    }
    const decoded = ExecutableSkillActions.from(parsed.value).execute();
    if (decoded.isErr()) {
      const outcomeRequest: SkillErrorOutcomeRequest = {
        phase: SkillCommandPhase.Decode,
        issue: SkillCommandIssue.InvalidRequest,
        message: decoded.error.message,
        path: decoded.error.path,
      };
      return new ExecutableSkillFailureResponse(outcomeRequest).execute();
    }
    const execution = decoded.value.execute();
    if (execution.isErr()) {
      return new ExecutableSkillFailureResponse({
        phase: SkillCommandPhase.Execute,
        issue: SkillCommandIssue.InvalidRequest,
        message: 'Executable skill action failed validation or verification.',
      }).execute();
    }
    const response: SkillSuccessResponse = {
      ok: true,
      family: decoded.value.family,
      operation: decoded.value.operation,
      result: execution.value,
    };
    const finalRequest: FinalSkillCliResponseRequest = {
      exitCode: 0,
      response: response as UntrustedSkillYamlNode,
    };
    return new ExecutableSkillResponse(finalRequest).execute();
  }

  private requestTooLargeOutcome(): Result<
    SkillCliOutcome,
    SkillYamlEncodingFailure
  > {
    const request: SkillErrorOutcomeRequest = {
      phase: SkillCommandPhase.Decode,
      issue: SkillCommandIssue.RequestTooLarge,
      message: `Skill request exceeds ${SKILL_HOST_REQUEST_BYTE_LIMIT} bytes.`,
    };
    return new ExecutableSkillFailureResponse(request).execute();
  }
}

export class ExecutableSkillFailureResponse {
  constructor(private readonly request: SkillErrorOutcomeRequest) {}
  execute(): Result<SkillCliOutcome, SkillYamlEncodingFailure> {
    const request = this.request;
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
    return new ExecutableSkillResponse(finalRequest).execute();
  }
}

export class ExecutableSkillResponse {
  constructor(private readonly request: FinalSkillCliResponseRequest) {}
  execute(): Result<SkillCliOutcome, SkillYamlEncodingFailure> {
    const request = this.request;
    const serialized = new ExecutableSkillYamlEncoding(
      request.response,
    ).execute();
    if (serialized.isErr()) {
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
      return new ExecutableSkillYamlEncoding(
        invalidResponse as UntrustedSkillYamlNode,
      )
        .execute()
        .map((yaml) => ({ exitCode: 1, yaml }));
    }
    const yaml = serialized.value;
    if (
      UTF8_ENCODER.encode(yaml).byteLength <= SKILL_HOST_RESPONSE_BYTE_LIMIT
    ) {
      return ok({ exitCode: request.exitCode, yaml });
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
    const fallback = new ExecutableSkillYamlEncoding(
      response as UntrustedSkillYamlNode,
    ).execute();
    if (fallback.isErr()) return err(fallback.error);
    const fallbackYaml = fallback.value;
    if (
      UTF8_ENCODER.encode(fallbackYaml).byteLength >
      SKILL_HOST_RESPONSE_BYTE_LIMIT
    ) {
      return err({
        kind: SkillYamlEncodingIssue.ResponseCapacity,
        message: 'Failure response exceeds its byte limit.',
      });
    }
    return ok({ exitCode: 1, yaml: fallbackYaml });
  }
}

if (import.meta.main) {
  const request: RunSkillCliRequest = { argv: process.argv.slice(2) };
  const outcome = ExecutableSkillCli.from(request).execute();
  outcome.match(
    (response) => {
      process.stdout.write(response.yaml);
      process.exitCode = response.exitCode;
    },
    (failure) => {
      process.stderr.write(`${failure.message}\n`);
      process.exitCode = 1;
    },
  );
}
