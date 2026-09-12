import assert from 'node:assert/strict';
import { ok } from 'neverthrow';
import { expect, test } from 'bun:test';

import { join } from 'node:path';

import { type RunSkillCliRequest, ExecutableSkillCli } from '../src/cli.ts';

import { SkillCommandIssue } from '../src/skill-command-domain.ts';

import {
  type UntrustedSkillYamlMap,
  type UntrustedSkillYamlNode,
  ExecutableSkillYamlAdmission,
  ExecutableSkillYamlProperty,
  SkillYamlValue,
} from '../src/skill-yaml-codec.ts';

export class ExecutableSkillHostCliFileScenario {
  private constructor(private readonly request: string) {}

  static parseResponse(yaml: string): CliResponse {
    return new ExecutableSkillHostCliFileScenario(yaml).execute();
  }

  private execute(): CliResponse {
    const yaml = this.request;
    const parsed = ExecutableSkillYamlAdmission.from(
      Bun.YAML.parse(yaml),
    ).execute();
    assert(parsed.isOk());
    assert(ExecutableSkillHostCliFileScenario.isResponse(parsed.value));
    return parsed.value;
  }

  private static isResponse(
    value: UntrustedSkillYamlNode,
  ): value is CliResponse {
    const candidate = new SkillYamlValue(value);
    if (!candidate.isMap() || !Object.hasOwn(candidate.value, 'errors')) {
      return false;
    }
    const property = new ExecutableSkillYamlProperty({
      key: 'errors',
      map: candidate.value,
    }).execute();
    if (!property.found) return false;
    const errors = new SkillYamlValue(property.value);
    return (
      errors.isList() &&
      errors.value.every((value) => {
        const error = new SkillYamlValue(value);
        return error.isMap() && typeof error.value.issue === 'string';
      })
    );
  }
}

type CliResponse = UntrustedSkillYamlMap & {
  readonly errors: readonly (UntrustedSkillYamlMap & {
    readonly issue: string;
  })[];
};

test('preserves multiline YAML in exactly one command-line token', () => {
  const yaml = 'skillToolsList:\n  list: {}\n';
  const request: RunSkillCliRequest = {
    argv: [`--request-yaml=${yaml}`],
  };
  expect(
    ExecutableSkillCli.from(request)
      .execute()
      .map((response) => response.exitCode),
  ).toEqual(ok(0));
  const outcome = Bun.spawnSync(
    [
      'bun',
      join(import.meta.dir, '..', 'src', 'cli.ts'),
      `--request-yaml=${yaml}`,
    ],
    { stderr: 'pipe', stdout: 'pipe' },
  );
  expect(outcome.exitCode).toBe(0);
  expect(outcome.stderr.toString()).toBe('');
});

test('does not accept paths, file flags, stdin, or split YAML arguments', () => {
  for (const argv of [
    ['request.yml'],
    ['--request-file=request.yml'],
    ['-'],
    ['--request-yaml=skillToolsList:', 'list: {}'],
  ] as const) {
    const request: RunSkillCliRequest = { argv };
    const outcomeResult = ExecutableSkillCli.from(request).execute();
    assert(outcomeResult.isOk());
    const outcome = outcomeResult.value;
    expect(outcome.exitCode).toBe(2);
    expect(
      ExecutableSkillHostCliFileScenario.parseResponse(outcome.yaml).errors?.at(
        0,
      )?.issue,
    ).toBe(SkillCommandIssue.UsageError);
  }
});

test('returns bounded redacted YAML for invalid inline input', () => {
  const secret = 'SECRET_MARKER';
  const request: RunSkillCliRequest = {
    argv: [`--request-yaml=skillToolsList: [${secret}`],
  };
  const outcomeResult = ExecutableSkillCli.from(request).execute();
  assert(outcomeResult.isOk());
  const outcome = outcomeResult.value;
  expect(outcome.exitCode).toBe(2);
  expect(
    ExecutableSkillHostCliFileScenario.parseResponse(outcome.yaml).errors?.at(0)
      ?.issue,
  ).toBe(SkillCommandIssue.InvalidYaml);
  expect(outcome.yaml).not.toContain(secret);
});
