import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSkillCli, type RunSkillCliRequest } from '../src/cli.ts';
import {
  SkillCommandIssue,
  SKILL_HOST_REQUEST_BYTE_LIMIT,
  SKILL_HOST_RESPONSE_BYTE_LIMIT,
} from '../src/skill-command-domain.ts';
type ErrorResponse = {
  readonly errors?: readonly { readonly issue: string }[];
};
const REMOVE_DIRECTORY_OPTIONS = { recursive: true } as const;
function temporaryDirectory(): string {
  return mkdtempSync(join(tmpdir(), 'nook-skill-cli-'));
}
function parseError(yaml: string): ErrorResponse {
  return Bun.YAML.parse(yaml) as ErrorResponse;
}
test('reads and executes a valid tools-list request file', async () => {
  const directory = temporaryDirectory();
  try {
    const requestPath = join(directory, 'request.yml');
    writeFileSync(requestPath, 'skillToolsList:\n  list: {}\n');
    const request: RunSkillCliRequest = { argv: [requestPath] };
    expect((await runSkillCli(request)).exitCode).toBe(0);
  } finally {
    rmSync(directory, REMOVE_DIRECTORY_OPTIONS);
  }
});
test('rejects invalid request-file transports before dispatch', async () => {
  const directory = temporaryDirectory();
  const fifo = join(directory, 'request.fifo');
  const oversized = join(directory, 'bom-oversized.yml');
  const invalidUtf8 = join(directory, 'invalid-utf8.yml');
  try {
    expect(Bun.spawnSync(['mkfifo', fifo]).exitCode).toBe(0);
    const oversizedBytes = new Uint8Array(SKILL_HOST_REQUEST_BYTE_LIMIT + 1);
    oversizedBytes.set([0xef, 0xbb, 0xbf]);
    writeFileSync(oversized, oversizedBytes);
    writeFileSync(invalidUtf8, new Uint8Array([0xc3, 0x28]));
    for (const [path, issue] of [
      [join(directory, 'missing.yml'), SkillCommandIssue.RequestFileReadFailed],
      [fifo, SkillCommandIssue.RequestFileReadFailed],
      [directory, SkillCommandIssue.RequestFileReadFailed],
      [oversized, SkillCommandIssue.RequestTooLarge],
      [invalidUtf8, SkillCommandIssue.RequestFileReadFailed],
    ] as const) {
      const request: RunSkillCliRequest = { argv: [path] };
      const outcome = await runSkillCli(request);
      expect(outcome.exitCode).toBe(2);
      expect(parseError(outcome.yaml).errors?.at(0)?.issue).toBe(issue);
    }
  } finally {
    rmSync(directory, REMOVE_DIRECTORY_OPTIONS);
  }
});
test('rejects tagged keys with bounded redacted stdout and silent stderr', () => {
  const directory = temporaryDirectory();
  const secret = 'SECRET_MARKER';
  try {
    const path = join(directory, 'tagged-key.yml');
    writeFileSync(
      path,
      `skillToolsList:\n  !!binary bGlzdA==: ${secret}\n  list: {}\n`,
    );
    const spawnOptions = {
      cwd: join(import.meta.dir, '..'),
      stderr: 'pipe',
      stdout: 'pipe',
    } as const;
    const processOutcome = Bun.spawnSync(
      ['bun', join(import.meta.dir, '..', 'src', 'cli.ts'), path],
      spawnOptions,
    );
    const stdout = processOutcome.stdout.toString();
    expect(processOutcome.exitCode).toBe(2);
    expect(parseError(stdout).errors?.at(0)?.issue).toBe(
      SkillCommandIssue.InvalidYaml,
    );
    expect(stdout).not.toContain(secret);
    expect(new TextEncoder().encode(stdout).byteLength).toBeLessThanOrEqual(
      SKILL_HOST_RESPONSE_BYTE_LIMIT,
    );
    expect(processOutcome.stderr.toString()).toBe('');
  } finally {
    rmSync(directory, REMOVE_DIRECTORY_OPTIONS);
  }
});
