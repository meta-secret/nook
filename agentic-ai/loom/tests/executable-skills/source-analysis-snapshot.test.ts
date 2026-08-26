import { describe, expect, test } from 'bun:test';
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import type { RmOptions } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  readSourceAnalysisSnapshot,
  type ReadSourceAnalysisSnapshotRequest,
} from '../../src/executable-skills/source-analysis-snapshot.ts';
import { readBoundedSourceAnalysisSnapshot } from '../../src/executable-skills/source-analysis-snapshot-process.ts';

async function withSnapshotDirectory(
  assertion: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), 'source-snapshot-'));
  try {
    await assertion(directory);
  } finally {
    const options: RmOptions = { force: true, recursive: true };
    await rm(directory, options);
  }
}

type SnapshotFixtureRequest = {
  readonly relativePath: string;
  readonly repoRoot: string;
};

function snapshotRequest(
  request: SnapshotFixtureRequest,
): ReadSourceAnalysisSnapshotRequest {
  return {
    deadlineExpiresAt: Date.now() + 5_000,
    relativePaths: [request.relativePath],
    repoRoot: request.repoRoot,
    signal: false,
  };
}

describe('sealed source analysis image snapshot', () => {
  test('reads only exact bounded regular files', async () => {
    await withSnapshotDirectory(async (directory) => {
      const relativePath = 'input.ts';
      await writeFile(path.join(directory, relativePath), 'export {};');
      const fixtureRequest: SnapshotFixtureRequest = {
        relativePath,
        repoRoot: directory,
      };
      const request = snapshotRequest(fixtureRequest);
      const snapshot = await readSourceAnalysisSnapshot(request);
      expect(snapshot).toHaveLength(1);
      expect(new TextDecoder().decode(snapshot[0]?.contents)).toBe(
        'export {};',
      );

      const oversized = new Uint8Array(1024 * 1024 + 1);
      await writeFile(path.join(directory, relativePath), oversized);
      await expect(readSourceAnalysisSnapshot(request)).rejects.toThrow(
        'not bounded',
      );
    });
  });

  test('rejects symlinked and nonregular inputs', async () => {
    await withSnapshotDirectory(async (directory) => {
      const target = path.join(directory, 'target.ts');
      const symlinkPath = path.join(directory, 'link.ts');
      await writeFile(target, 'export {};');
      await symlink(target, symlinkPath);
      const linkFixture: SnapshotFixtureRequest = {
        relativePath: 'link.ts',
        repoRoot: directory,
      };
      const linkRequest = snapshotRequest(linkFixture);
      await expect(readSourceAnalysisSnapshot(linkRequest)).rejects.toThrow(
        'cannot be a symlink',
      );

      const hardLink = path.join(directory, 'hard-link.ts');
      await link(target, hardLink);
      const hardLinkFixture: SnapshotFixtureRequest = {
        relativePath: 'hard-link.ts',
        repoRoot: directory,
      };
      const hardLinkRequest = snapshotRequest(hardLinkFixture);
      await expect(readSourceAnalysisSnapshot(hardLinkRequest)).rejects.toThrow(
        'not bounded',
      );

      await mkdir(path.join(directory, 'folder'));
      const directoryFixture: SnapshotFixtureRequest = {
        relativePath: 'folder',
        repoRoot: directory,
      };
      const directoryRequest = snapshotRequest(directoryFixture);
      await expect(
        readSourceAnalysisSnapshot(directoryRequest),
      ).rejects.toThrow('not bounded');
    });
  });

  test('fails before reads after cancellation or deadline expiry', async () => {
    await withSnapshotDirectory(async (directory) => {
      const relativePath = 'input.ts';
      await writeFile(path.join(directory, relativePath), 'export {};');
      const controller = new AbortController();
      controller.abort();
      const fixtureRequest: SnapshotFixtureRequest = {
        relativePath,
        repoRoot: directory,
      };
      const cancelledRequest: ReadSourceAnalysisSnapshotRequest = {
        ...snapshotRequest(fixtureRequest),
        signal: controller.signal,
      };
      await expect(
        readSourceAnalysisSnapshot(cancelledRequest),
      ).rejects.toThrow('aborted');

      const expiredRequest: ReadSourceAnalysisSnapshotRequest = {
        ...snapshotRequest(fixtureRequest),
        deadlineExpiresAt: Date.now() - 1,
      };
      await expect(readSourceAnalysisSnapshot(expiredRequest)).rejects.toThrow(
        'deadline expired',
      );
    });
  });

  test('runs production snapshot reads inside a bounded child process', async () => {
    const request: ReadSourceAnalysisSnapshotRequest = {
      deadlineExpiresAt: Date.now() + 5_000,
      relativePaths: ['agentic-ai/loom/package.json'],
      repoRoot: path.resolve(import.meta.dir, '../../../..'),
      signal: false,
    };
    const snapshot = await readBoundedSourceAnalysisSnapshot(request);
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]?.relativePath).toBe('agentic-ai/loom/package.json');
    expect(snapshot[0]?.contents.byteLength).toBeGreaterThan(0);
  });
});
