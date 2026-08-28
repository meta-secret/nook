import { expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAllDocuments } from 'yaml';
import {
  runSkillCli,
  type RunSkillCliRequest,
  type SkillCliOutcome,
} from '../src/cli.ts';
import {
  listDiscoverableSkillActions,
  SKILL_PROVIDER_RESULT_BYTE_LIMIT,
} from '../src/skill-action-registry.ts';
import {
  SkillCommandIssue,
  SKILL_HOST_REQUEST_BYTE_LIMIT,
  SkillRequestFamily,
} from '../src/skill-command-domain.ts';
type SkillFileErrorTransport = {
  readonly errors?: readonly { readonly issue: string }[];
};
const REMOVE_DIRECTORY_OPTIONS = { recursive: true } as const;
function parseError(outcome: SkillCliOutcome): SkillFileErrorTransport {
  return Bun.YAML.parse(outcome.yaml) as SkillFileErrorTransport;
}
function createTemporaryDirectory(): string {
  return mkdtempSync(join(tmpdir(), 'nook-skill-cli-'));
}
test('reads and executes a valid request file', async () => {
  const directory = createTemporaryDirectory();
  try {
    const action = listDiscoverableSkillActions().actions.find(
      (candidate) =>
        candidate.family === SkillRequestFamily.CortexArticleStructure,
    );
    if (!action) throw new Error('Missing article-structure action.');
    const requestPath = join(directory, 'request.yml');
    writeFileSync(requestPath, action.exampleYaml);
    const request: RunSkillCliRequest = { argv: [requestPath] };
    const outcome = await runSkillCli(request);
    expect(outcome.exitCode).toBe(0);
  } finally {
    rmSync(directory, REMOVE_DIRECTORY_OPTIONS);
  }
});
test('rejects every invalid request-file transport', async () => {
  const directory = createTemporaryDirectory();
  const unreadable = join(directory, 'unreadable.yml');
  const oversized = join(directory, 'bom-oversized.yml');
  const invalidUtf8 = join(directory, 'invalid-utf8.yml');
  try {
    writeFileSync(unreadable, 'skillToolsList:\n  list: {}\n');
    chmodSync(unreadable, 0o000);
    const oversizedBytes = new Uint8Array(SKILL_HOST_REQUEST_BYTE_LIMIT + 1);
    oversizedBytes.set([0xef, 0xbb, 0xbf]);
    writeFileSync(oversized, oversizedBytes);
    writeFileSync(invalidUtf8, new Uint8Array([0xc3, 0x28]));
    const cases = [
      [join(directory, 'missing.yml'), SkillCommandIssue.RequestFileReadFailed],
      [unreadable, SkillCommandIssue.RequestFileReadFailed],
      [directory, SkillCommandIssue.RequestFileReadFailed],
      [oversized, SkillCommandIssue.RequestTooLarge],
      [invalidUtf8, SkillCommandIssue.RequestFileReadFailed],
    ] as const;
    for (const [requestPath, issue] of cases) {
      const request: RunSkillCliRequest = { argv: [requestPath] };
      const outcome = await runSkillCli(request);
      expect(outcome.exitCode).toBe(2);
      expect(parseError(outcome).errors?.at(0)?.issue).toBe(issue);
    }
  } finally {
    chmodSync(unreadable, 0o600);
    rmSync(directory, REMOVE_DIRECTORY_OPTIONS);
  }
});
test('rejects tagged-key collisions with bounded redaction and silent stderr', () => {
  const directory = createTemporaryDirectory();
  const secretMarker = 'SECRET_MARKER';
  try {
    const action = listDiscoverableSkillActions().actions.find(
      (candidate) =>
        candidate.family === SkillRequestFamily.CortexArticleStructure,
    );
    if (!action) throw new Error('Missing article-structure action.');
    const requestPath = join(directory, 'tagged-key.yml');
    const request = action.exampleYaml.replace(
      '  audit:',
      `  !!binary YXVkaXQ=: ${secretMarker}\n  audit:`,
    );
    writeFileSync(requestPath, request);
    const cliPath = join(import.meta.dir, '..', 'src', 'cli.ts');
    const skillsDirectory = join(import.meta.dir, '..');
    const spawnOptions = {
      cwd: skillsDirectory,
      stderr: 'pipe',
      stdout: 'pipe',
    } as const;
    const processOutcome = Bun.spawnSync(
      ['bun', cliPath, requestPath],
      spawnOptions,
    );
    const stdout = processOutcome.stdout.toString();
    const stderr = processOutcome.stderr.toString();
    const response = Bun.YAML.parse(stdout) as SkillFileErrorTransport;
    expect(processOutcome.exitCode).toBe(2);
    expect(response.errors?.at(0)?.issue).toBe(SkillCommandIssue.InvalidYaml);
    expect(stdout).not.toContain(secretMarker);
    expect(new TextEncoder().encode(stdout).byteLength).toBeLessThanOrEqual(
      SKILL_PROVIDER_RESULT_BYTE_LIMIT,
    );
    expect(stderr).toBe('');
  } finally {
    rmSync(directory, REMOVE_DIRECTORY_OPTIONS);
  }
});
test('Task transport keeps stdout YAML-only and CONFIG literal', () => {
  const directory = createTemporaryDirectory();
  const repositoryRoot = join(import.meta.dir, '../../../..');
  const canary = join(directory, 'injected');
  const spawnOptions = {
    cwd: repositoryRoot,
    stderr: 'pipe',
    stdout: 'pipe',
  } as const;
  try {
    const discovery = Bun.spawnSync(
      ['task', 'skills:tools-list'],
      spawnOptions,
    );
    const discoveryStdout = discovery.stdout.toString();
    expect(discovery.exitCode).toBe(0);
    expect(parseAllDocuments(discoveryStdout)).toHaveLength(1);
    expect(discoveryStdout).not.toContain('bun install');
    expect(discovery.stderr.toString()).toContain('bun install');
    const payload = `$(touch ${canary});"'\n\`touch ${canary}-backtick\``;
    const invocation = Bun.spawnSync(
      ['task', 'skills:run', `CONFIG=${payload}`],
      spawnOptions,
    );
    const invocationStdout = invocation.stdout.toString();
    expect(invocation.exitCode).not.toBe(0);
    expect(parseAllDocuments(invocationStdout)).toHaveLength(1);
    expect(invocationStdout).not.toContain('bun install');
    expect(existsSync(canary)).toBe(false);
    expect(existsSync(`${canary}-backtick`)).toBe(false);
  } finally {
    rmSync(directory, REMOVE_DIRECTORY_OPTIONS);
  }
});
