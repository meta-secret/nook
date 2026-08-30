import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { runSkillCli, type RunSkillCliRequest } from '../src/cli.ts';
import { SkillCommandIssue } from '../src/skill-command-domain.ts';

type CliResponse = {
  readonly errors?: readonly { readonly issue: string }[];
};

function parseResponse(yaml: string): CliResponse {
  return Bun.YAML.parse(yaml) as CliResponse;
}

test('preserves multiline YAML in exactly one command-line token', () => {
  const yaml = 'skillToolsList:\n  list: {}\n';
  const request: RunSkillCliRequest = {
    argv: [`--request-yaml=${yaml}`],
  };
  expect(runSkillCli(request).exitCode).toBe(0);
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
    const outcome = runSkillCli(request);
    expect(outcome.exitCode).toBe(2);
    expect(parseResponse(outcome.yaml).errors?.at(0)?.issue).toBe(
      SkillCommandIssue.UsageError,
    );
  }
});

test('returns bounded redacted YAML for invalid inline input', () => {
  const secret = 'SECRET_MARKER';
  const request: RunSkillCliRequest = {
    argv: [`--request-yaml=skillToolsList: [${secret}`],
  };
  const outcome = runSkillCli(request);
  expect(outcome.exitCode).toBe(2);
  expect(parseResponse(outcome.yaml).errors?.at(0)?.issue).toBe(
    SkillCommandIssue.InvalidYaml,
  );
  expect(outcome.yaml).not.toContain(secret);
});
