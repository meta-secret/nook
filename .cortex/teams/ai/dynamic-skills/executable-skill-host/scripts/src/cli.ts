#!/usr/bin/env bun
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import {
  decodeSkillActionRequest,
  defaultSkillBlueprint,
  executeSkillAction,
  SKILL_TOOLS_LIST_INVOKE,
} from './skill-action-registry.ts';
import {
  SkillCommandIssue,
  SkillCommandPhase,
  SKILL_HOST_REQUEST_BYTE_LIMIT,
  SKILL_HOST_RESPONSE_BYTE_LIMIT,
  type SkillCommandErrorResponse,
} from './skill-command-domain.ts';
import {
  parseSkillCliInvocation,
  SkillCliInvocationKind,
  type ParseSkillCliInvocationRequest,
} from './skill-cli-invocation.ts';
import {
  parseSkillYamlText,
  stringifySkillYaml,
  type UntrustedSkillYamlNode,
} from './skill-yaml-codec.ts';
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
  readonly result: ReturnType<typeof executeSkillAction>;
};
export type FinalSkillCliResponseRequest = {
  readonly exitCode: number;
  readonly response: UntrustedSkillYamlNode;
};
const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER_OPTIONS = { fatal: true } as const;
const UTF8_DECODER = new TextDecoder('utf-8', UTF8_DECODER_OPTIONS);
export async function runSkillCli(
  request: RunSkillCliRequest,
): Promise<SkillCliOutcome> {
  const invocationRequest: ParseSkillCliInvocationRequest = {
    argv: request.argv,
  };
  const invocation = parseSkillCliInvocation(invocationRequest);
  if (
    invocation.kind === SkillCliInvocationKind.Help ||
    invocation.kind === SkillCliInvocationKind.DefaultToolsList
  ) {
    return dispatchSkillYamlText(defaultSkillBlueprint());
  }
  if (invocation.kind === SkillCliInvocationKind.UsageError) {
    const outcomeRequest: SkillErrorOutcomeRequest = {
      phase: SkillCommandPhase.Usage,
      issue: SkillCommandIssue.UsageError,
      message: invocation.message,
    };
    return errorOutcome(outcomeRequest);
  }
  let text: string;
  try {
    const descriptor = openSync(
      invocation.requestPath,
      constants.O_RDONLY | constants.O_NONBLOCK,
    );
    try {
      const metadata = fstatSync(descriptor);
      if (!metadata.isFile()) {
        throw new Error('Skill request path must be a regular file.');
      }
      if (metadata.size > SKILL_HOST_REQUEST_BYTE_LIMIT)
        return requestTooLargeOutcome();
      const bytes = new Uint8Array(SKILL_HOST_REQUEST_BYTE_LIMIT + 1);
      let length = 0;
      while (length < bytes.length) {
        const count = readSync(
          descriptor,
          bytes,
          length,
          bytes.length - length,
          length,
        );
        if (count === 0) break;
        length += count;
      }
      if (
        length > SKILL_HOST_REQUEST_BYTE_LIMIT ||
        fstatSync(descriptor).size > SKILL_HOST_REQUEST_BYTE_LIMIT
      )
        return requestTooLargeOutcome();
      text = UTF8_DECODER.decode(bytes.subarray(0, length));
    } finally {
      closeSync(descriptor);
    }
  } catch {
    const outcomeRequest: SkillErrorOutcomeRequest = {
      phase: SkillCommandPhase.Decode,
      issue: SkillCommandIssue.RequestFileReadFailed,
      message: 'Unable to read a regular skill request file.',
    };
    return errorOutcome(outcomeRequest);
  }
  return dispatchSkillYamlText(text);
}
export function dispatchSkillYamlText(text: string): SkillCliOutcome {
  if (UTF8_ENCODER.encode(text).byteLength > SKILL_HOST_REQUEST_BYTE_LIMIT)
    return requestTooLargeOutcome();
  const parsed = parseSkillYamlText(text);
  if (!parsed.ok) {
    const outcomeRequest: SkillErrorOutcomeRequest = {
      phase: SkillCommandPhase.Decode,
      issue: SkillCommandIssue.InvalidYaml,
      message: 'Invalid YAML syntax.',
    };
    return errorOutcome(outcomeRequest);
  }
  const decoded = decodeSkillActionRequest(parsed.value);
  if (!decoded.ok) {
    const outcomeRequest: SkillErrorOutcomeRequest = {
      phase: SkillCommandPhase.Decode,
      issue: SkillCommandIssue.InvalidRequest,
      message: decoded.message,
      path: decoded.path,
    };
    return errorOutcome(outcomeRequest);
  }
  try {
    const response: SkillSuccessResponse = {
      ok: true,
      family: decoded.request.family,
      operation: decoded.request.operation,
      result: executeSkillAction(decoded.request),
    };
    const finalRequest: FinalSkillCliResponseRequest = {
      exitCode: 0,
      response: response as UntrustedSkillYamlNode,
    };
    return finalizeSkillCliResponse(finalRequest);
  } catch {
    const outcomeRequest: SkillErrorOutcomeRequest = {
      phase: SkillCommandPhase.Execute,
      issue: SkillCommandIssue.InvalidRequest,
      message: 'Executable skill action failed validation or verification.',
    };
    return errorOutcome(outcomeRequest);
  }
}

type SkillErrorOutcomeRequest = {
  readonly phase: SkillCommandPhase;
  readonly issue: SkillCommandIssue;
  readonly message: string;
  readonly path?: string;
};
function requestTooLargeOutcome(): SkillCliOutcome {
  const request: SkillErrorOutcomeRequest = {
    phase: SkillCommandPhase.Decode,
    issue: SkillCommandIssue.RequestTooLarge,
    message: `Skill request exceeds ${SKILL_HOST_REQUEST_BYTE_LIMIT} bytes.`,
  };
  return errorOutcome(request);
}
function errorOutcome(request: SkillErrorOutcomeRequest): SkillCliOutcome {
  const path = request.path ?? '';
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
  return finalizeSkillCliResponse(finalRequest);
}
export function finalizeSkillCliResponse(
  request: FinalSkillCliResponseRequest,
): SkillCliOutcome {
  let yaml: string;
  try {
    yaml = stringifySkillYaml(request.response);
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
      yaml: stringifySkillYaml(invalidResponse as UntrustedSkillYamlNode),
    };
  }
  if (UTF8_ENCODER.encode(yaml).byteLength <= SKILL_HOST_RESPONSE_BYTE_LIMIT) {
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
  const fallbackYaml = stringifySkillYaml(response as UntrustedSkillYamlNode);
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
if (import.meta.main) {
  const request: RunSkillCliRequest = { argv: process.argv.slice(2) };
  const outcome = await runSkillCli(request);
  process.stdout.write(outcome.yaml);
  process.exitCode = outcome.exitCode;
}
