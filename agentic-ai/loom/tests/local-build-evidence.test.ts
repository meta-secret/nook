import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { ok, type Result } from 'neverthrow';

import {
  LOCAL_BUILD_EVIDENCE_AUTHORIZATION,
  LocalBuildEvidenceAdmission,
  LocalBuildEvidenceGenerator,
  LocalBuildEvidenceStore,
  type LocalBuildCommandOutput,
  type LocalBuildCommandRequest,
  type LocalBuildCommandRunner,
} from '../src/dev-delivery/local-build-evidence.ts';
import {
  BranchName,
  CommitSha,
  DevFailureKind,
  type DevFailure,
} from '../src/dev-delivery/dev-types.ts';

const BRANCH = 'codex/agent-branching';
const SHA = '2222222222222222222222222222222222222222';
const OTHER_SHA = '3333333333333333333333333333333333333333';

class LocalBuildRunner implements LocalBuildCommandRunner {
  readonly requests: LocalBuildCommandRequest[] = [];

  constructor(
    private readonly output: LocalBuildCommandOutput = {
      exitCode: 0,
      stdout: 'build output TOKEN=must-not-be-persisted',
      stderr: '',
    },
  ) {}

  run(
    request: LocalBuildCommandRequest,
  ): Result<LocalBuildCommandOutput, DevFailure> {
    this.requests.push(request);
    return ok(this.output);
  }

  toolVersion(): Result<string, DevFailure> {
    return ok('Task version: 3.44.1');
  }
}

class FailedLocalBuildRunner extends LocalBuildRunner {
  constructor() {
    super({ exitCode: 1, stdout: 'compiler failure', stderr: 'failed' });
  }
}

class LocalBuildEvidenceScenario {
  static inputs(root: string) {
    const branch = BranchName.parseFeature(BRANCH);
    const commit = CommitSha.parse(SHA);
    if (branch.isErr() || commit.isErr()) throw new Error('fixture is invalid');
    return {
      repositoryRoot: root,
      source: { branch: branch.value, commit: commit.value },
      task: { id: 'local-build-test', attempt: 1, name: 'app:build' as const },
      outputPath: LocalBuildEvidenceStore.defaultPath({
        repositoryRoot: root,
        sourceSha: commit.value,
      }),
    };
  }
}

test('generator writes an exact-head proof from command success without secrets', () => {
  const root = mkdtempSync(join(tmpdir(), 'nook-local-build-evidence-'));
  const startedAt = new Date('2026-09-14T10:00:00.000Z');
  let calls = 0;
  const runner = new LocalBuildRunner();
  try {
    const result = new LocalBuildEvidenceGenerator({
      runner,
      clock: () => {
        calls += 1;
        return new Date(startedAt.getTime() + (calls === 1 ? 0 : 1_000));
      },
      environment: {
        platform: 'test',
        architecture: 'test-arch',
        runtime: 'test-runtime',
      },
    }).execute(LocalBuildEvidenceScenario.inputs(root));

    expect(result.isOk()).toBe(true);
    expect(runner.requests).toEqual([
      {
        executable: 'task',
        args: ['app:build'],
        workingDirectory: root,
      },
    ]);
    const outputPath = LocalBuildEvidenceScenario.inputs(root).outputPath;
    expect(existsSync(outputPath)).toBe(true);
    const serialized = readFileSync(outputPath, 'utf8');
    expect(serialized).not.toContain('TOKEN=must-not-be-persisted');
    expect(serialized).toContain(LOCAL_BUILD_EVIDENCE_AUTHORIZATION);
    expect(serialized).toContain('2222222222222222222222222222222222222222');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('generator refuses nonzero command results and never writes success proof', () => {
  const root = mkdtempSync(join(tmpdir(), 'nook-local-build-evidence-failed-'));
  try {
    const result = new LocalBuildEvidenceGenerator({
      runner: new FailedLocalBuildRunner(),
      clock: () => new Date('2026-09-14T10:00:00.000Z'),
    }).execute(LocalBuildEvidenceScenario.inputs(root));
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe(DevFailureKind.Evidence);
    expect(existsSync(LocalBuildEvidenceScenario.inputs(root).outputPath)).toBe(
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('admission accepts only a fresh proof for the exact branch and commit', () => {
  const root = mkdtempSync(join(tmpdir(), 'nook-local-build-evidence-admit-'));
  const branch = BranchName.parseFeature(BRANCH);
  const commit = CommitSha.parse(SHA);
  const otherCommit = CommitSha.parse(OTHER_SHA);
  if (branch.isErr() || commit.isErr() || otherCommit.isErr())
    throw new Error('fixture is invalid');
  try {
    const generated = new LocalBuildEvidenceGenerator({
      runner: new LocalBuildRunner(),
      clock: () => new Date('2026-09-14T10:00:00.000Z'),
    }).execute(LocalBuildEvidenceScenario.inputs(root));
    expect(generated.isOk()).toBe(true);
    const path = LocalBuildEvidenceScenario.inputs(root).outputPath;
    const admitted = new LocalBuildEvidenceAdmission({
      repositoryRoot: root,
      clock: () => new Date('2026-09-14T10:01:00.000Z'),
    }).verify({ path, branch: branch.value, commit: commit.value });
    expect(admitted.isOk()).toBe(true);

    const wrongCommit = new LocalBuildEvidenceAdmission({
      repositoryRoot: root,
      clock: () => new Date('2026-09-14T10:01:00.000Z'),
    }).verify({ path, branch: branch.value, commit: otherCommit.value });
    expect(wrongCommit.isErr()).toBe(true);
    if (wrongCommit.isErr())
      expect(wrongCommit.error.kind).toBe(DevFailureKind.Evidence);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('admission rejects stale, tampered, malformed, and out-of-scope artifacts', () => {
  const root = mkdtempSync(join(tmpdir(), 'nook-local-build-evidence-reject-'));
  const branch = BranchName.parseFeature(BRANCH);
  const commit = CommitSha.parse(SHA);
  if (branch.isErr() || commit.isErr()) throw new Error('fixture is invalid');
  try {
    const generated = new LocalBuildEvidenceGenerator({
      runner: new LocalBuildRunner(),
      clock: () => new Date('2026-09-14T10:00:00.000Z'),
    }).execute(LocalBuildEvidenceScenario.inputs(root));
    expect(generated.isOk()).toBe(true);
    const path = LocalBuildEvidenceScenario.inputs(root).outputPath;
    const stale = new LocalBuildEvidenceAdmission({
      repositoryRoot: root,
      clock: () => new Date('2026-09-14T10:16:00.000Z'),
    }).verify({ path, branch: branch.value, commit: commit.value });
    expect(stale.isErr()).toBe(true);

    const serialized = readFileSync(path, 'utf8');
    const digestNibble = serialized.match(
      /"digest"\s*:\s*"sha256:([0-9a-f])/u,
    )?.[1];
    const replacement = digestNibble === '0' ? '1' : '0';
    writeFileSync(
      path,
      serialized.replace(
        /("digest"\s*:\s*"sha256:)[0-9a-f]/u,
        '$1' + replacement,
      ),
    );
    const tampered = new LocalBuildEvidenceAdmission({
      repositoryRoot: root,
      clock: () => new Date('2026-09-14T10:01:00.000Z'),
    }).verify({ path, branch: branch.value, commit: commit.value });
    expect(tampered.isErr()).toBe(true);

    writeFileSync(path, '{}');
    const malformed = new LocalBuildEvidenceAdmission({
      repositoryRoot: root,
      clock: () => new Date('2026-09-14T10:01:00.000Z'),
    }).verify({ path, branch: branch.value, commit: commit.value });
    expect(malformed.isErr()).toBe(true);

    mkdirSync(join(root, 'outside'));
    const outside = new LocalBuildEvidenceStore().read({
      repositoryRoot: root,
      path: join(root, 'outside', 'proof.json'),
    });
    expect(outside.isErr()).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
