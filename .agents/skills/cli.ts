#!/usr/bin/env bun
import { readFileSync } from 'node:fs';
import {
  blueprintForSkillRequest,
  decodeSkillActionRequest,
  defaultSkillBlueprint,
  executeSkillAction,
  SKILL_TOOLS_LIST_INVOKE,
} from './skill-action-registry.ts';
import {
  SkillCommandIssue,
  SkillCommandPhase,
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
  readonly result: ReturnType<typeof executeSkillAction>;
};

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
      receivedYaml: '',
      blueprintYaml: defaultSkillBlueprint(),
    };
    return errorOutcome(outcomeRequest);
  }
  let text: string;
  try {
    text = readFileSync(invocation.requestPath, 'utf8');
  } catch (error) {
    const outcomeRequest: SkillErrorOutcomeRequest = {
      phase: SkillCommandPhase.Decode,
      issue: SkillCommandIssue.RequestFileReadFailed,
      message: error instanceof Error ? error.message : String(error),
      receivedYaml: '',
      blueprintYaml: defaultSkillBlueprint(),
    };
    return errorOutcome(outcomeRequest);
  }
  return dispatchSkillYamlText(text);
}

export function dispatchSkillYamlText(text: string): SkillCliOutcome {
  const parsed = parseSkillYamlText(text);
  if (!parsed.ok) {
    const outcomeRequest: SkillErrorOutcomeRequest = {
      phase: SkillCommandPhase.Decode,
      issue: SkillCommandIssue.InvalidYaml,
      message: parsed.message,
      receivedYaml: text,
      blueprintYaml: defaultSkillBlueprint(),
      parseMessage: parsed.message,
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
      receivedYaml: stringifySkillYaml(parsed.value),
      blueprintYaml: blueprintForSkillRequest(parsed.value),
    };
    return errorOutcome(outcomeRequest);
  }
  try {
    const response: SkillSuccessResponse = {
      ok: true,
      result: executeSkillAction(decoded.request),
    };
    return {
      exitCode: 0,
      yaml: stringifySkillYaml(response as UntrustedSkillYamlNode),
    };
  } catch (error) {
    const outcomeRequest: SkillErrorOutcomeRequest = {
      phase: SkillCommandPhase.Execute,
      issue: SkillCommandIssue.InvalidRequest,
      message: error instanceof Error ? error.message : String(error),
      receivedYaml: stringifySkillYaml(parsed.value),
      blueprintYaml: blueprintForSkillRequest(parsed.value),
    };
    return errorOutcome(outcomeRequest);
  }
}

type SkillErrorOutcomeRequest = {
  readonly phase: SkillCommandPhase;
  readonly issue: SkillCommandIssue;
  readonly message: string;
  readonly path?: string;
  readonly receivedYaml: string;
  readonly blueprintYaml: string;
  readonly parseMessage?: string;
};

function errorOutcome(request: SkillErrorOutcomeRequest): SkillCliOutcome {
  const path = request.path ?? '';
  const explanation =
    typeof request.parseMessage === 'string'
      ? {
          blueprintYaml: request.blueprintYaml,
          receivedYaml: request.receivedYaml,
          parseMessage: request.parseMessage,
        }
      : {
          blueprintYaml: request.blueprintYaml,
          receivedYaml: request.receivedYaml,
        };
  const response: SkillCommandErrorResponse = {
    ok: false,
    isError: true,
    phase: request.phase,
    errors: [{ path, issue: request.issue, message: request.message }],
    explanation,
    recover: {
      toolsListRequest: SKILL_TOOLS_LIST_INVOKE,
      hint: 'List skill actions, copy the matching YAML example, and retry.',
    },
  };
  return {
    exitCode: 2,
    yaml: stringifySkillYaml(response as UntrustedSkillYamlNode),
  };
}

if (import.meta.main) {
  const request: RunSkillCliRequest = { argv: process.argv.slice(2) };
  const outcome = await runSkillCli(request);
  process.stdout.write(outcome.yaml);
  process.exitCode = outcome.exitCode;
}
