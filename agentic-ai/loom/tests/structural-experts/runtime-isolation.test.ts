import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import type { RmOptions } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from 'bun:test';
import { createReadOnlyExpertRuntimeIsolation } from '../../src/module-experts/runtime-contract.ts';
import type { ReadOnlyExpertRuntimeIsolationRequest } from '../../src/module-experts/runtime-contract.ts';

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const REPO_ROOT = resolve(import.meta.dir, '../../../..');

test('materializes synthesis context without repository paths or credentials', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'structural-synthesis-'));
  const removeOptions: RmOptions = { recursive: true, force: true };
  try {
    const isolationRequest: ReadOnlyExpertRuntimeIsolationRequest = {
      expertName: 'system_coherence_synthesizer',
      parentEnvironment: {
        CODEX_API_KEY: 'must-not-persist',
        GITHUB_TOKEN: 'must-not-inherit',
        PATH: process.env.PATH ?? '',
      },
      snapshot: {
        excludedPaths: [],
        optionalScopePaths: [],
        scopePaths: [],
        contextFiles: [
          {
            path: 'children/inspect-code/attempt-1/view.md',
            content: '# Verified code view\n',
          },
        ],
      },
      sourceCommit: SOURCE_COMMIT,
      temporaryRoot,
      workingDirectory: REPO_ROOT,
    };
    const isolation =
      await createReadOnlyExpertRuntimeIsolation(isolationRequest);
    try {
      const verifiedView = join(
        isolation.repositorySnapshot,
        'children/inspect-code/attempt-1/view.md',
      );
      expect(await readFile(verifiedView, 'utf8')).toBe(
        '# Verified code view\n',
      );
      await expect(
        access(join(isolation.repositorySnapshot, '.cortex/AGENTS.md')),
      ).rejects.toThrow();
      expect(JSON.stringify(isolation.codexOptions)).not.toContain(
        'must-not-persist',
      );
      expect(Object.keys(isolation.codexOptions.env)).not.toContain(
        'GITHUB_TOKEN',
      );
    } finally {
      await isolation.dispose();
    }
    expect(await readdir(temporaryRoot)).toEqual([]);
  } finally {
    await rm(temporaryRoot, removeOptions);
  }
});

test('rejects traversal and oversized synthetic context before agent execution', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'structural-context-'));
  const removeOptions: RmOptions = { recursive: true, force: true };
  try {
    const unsafeRequest: ReadOnlyExpertRuntimeIsolationRequest = {
      expertName: 'system_coherence_synthesizer',
      parentEnvironment: {
        CODEX_API_KEY: 'test-key',
        PATH: process.env.PATH ?? '',
      },
      snapshot: {
        excludedPaths: [],
        optionalScopePaths: [],
        scopePaths: [],
        contextFiles: [{ path: '../escape.md', content: 'escape' }],
      },
      sourceCommit: SOURCE_COMMIT,
      temporaryRoot,
      workingDirectory: REPO_ROOT,
    };
    await expect(
      createReadOnlyExpertRuntimeIsolation(unsafeRequest),
    ).rejects.toThrow('context file is unsafe');
    expect(await readdir(temporaryRoot)).toEqual([]);
  } finally {
    await rm(temporaryRoot, removeOptions);
  }
});
