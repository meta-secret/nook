import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';

export type SourceAnalysisSnapshotInput = {
  readonly contents: Uint8Array;
  readonly relativePath: string;
};

export type ReadSourceAnalysisSnapshotRequest = {
  readonly deadlineExpiresAt: number;
  readonly relativePaths: readonly string[];
  readonly repoRoot: string;
  readonly signal: AbortSignal | false;
};

export const MAXIMUM_SNAPSHOT_FILE_BYTES = 1024 * 1024;
export const MAXIMUM_SNAPSHOT_TOTAL_BYTES = 4 * 1024 * 1024;

export async function readSourceAnalysisSnapshot(
  request: ReadSourceAnalysisSnapshotRequest,
): Promise<readonly SourceAnalysisSnapshotInput[]> {
  assertSnapshotActive(request);
  const repositoryRoot = await realpath(request.repoRoot);
  const inputs: SourceAnalysisSnapshotInput[] = [];
  let totalBytes = 0;
  for (const relativePath of request.relativePaths) {
    assertSnapshotActive(request);
    const canonicalPathRequest: CanonicalSnapshotPathRequest = {
      relativePath,
      repositoryRoot,
    };
    const canonicalPath = await canonicalSnapshotPath(canonicalPathRequest);
    const handle = await open(
      canonicalPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const descriptorPath =
        process.platform === 'linux'
          ? `/proc/self/fd/${handle.fd}`
          : `/dev/fd/${handle.fd}`;
      if ((await realpath(descriptorPath)) !== canonicalPath) {
        throw new Error(
          'Sealed source analysis image input descriptor escaped its path.',
        );
      }
      const metadata = await handle.stat();
      if (
        !metadata.isFile() ||
        metadata.nlink !== 1 ||
        metadata.size < 0 ||
        metadata.size > MAXIMUM_SNAPSHOT_FILE_BYTES ||
        totalBytes + metadata.size > MAXIMUM_SNAPSHOT_TOTAL_BYTES
      ) {
        throw new Error('Sealed source analysis image input is not bounded.');
      }
      const readRequest: ReadExactSnapshotFileRequest = {
        expectedBytes: metadata.size,
        handle,
        lifecycle: request,
      };
      const contents = await readExactSnapshotFile(readRequest);
      const finalMetadata = await handle.stat();
      if (
        finalMetadata.dev !== metadata.dev ||
        finalMetadata.ino !== metadata.ino ||
        finalMetadata.nlink !== metadata.nlink ||
        finalMetadata.size !== metadata.size ||
        finalMetadata.ctimeMs !== metadata.ctimeMs ||
        finalMetadata.mtimeMs !== metadata.mtimeMs
      ) {
        throw new Error('Sealed source analysis image input drifted.');
      }
      totalBytes += contents.byteLength;
      const input: SourceAnalysisSnapshotInput = { contents, relativePath };
      inputs.push(input);
    } finally {
      await handle.close();
    }
  }
  assertSnapshotActive(request);
  return inputs;
}

type CanonicalSnapshotPathRequest = {
  readonly relativePath: string;
  readonly repositoryRoot: string;
};

async function canonicalSnapshotPath(
  request: CanonicalSnapshotPathRequest,
): Promise<string> {
  if (
    path.isAbsolute(request.relativePath) ||
    path.normalize(request.relativePath) !== request.relativePath
  ) {
    throw new Error('Sealed source analysis image input path is invalid.');
  }
  const target = await realpath(
    path.join(request.repositoryRoot, request.relativePath),
  );
  await assertSnapshotPathHasNoSymlinks(request);
  const relative = path.relative(request.repositoryRoot, target);
  if (
    relative.length === 0 ||
    relative.startsWith('..') ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      'Sealed source analysis image input escaped the repository.',
    );
  }
  return target;
}

async function assertSnapshotPathHasNoSymlinks(
  request: CanonicalSnapshotPathRequest,
): Promise<void> {
  let current = request.repositoryRoot;
  for (const segment of request.relativePath.split(path.sep)) {
    current = path.join(current, segment);
    if ((await lstat(current)).isSymbolicLink()) {
      throw new Error(
        'Sealed source analysis image input cannot be a symlink.',
      );
    }
  }
}

type ReadExactSnapshotFileRequest = {
  readonly expectedBytes: number;
  readonly handle: FileHandle;
  readonly lifecycle: ReadSourceAnalysisSnapshotRequest;
};

async function readExactSnapshotFile(
  request: ReadExactSnapshotFileRequest,
): Promise<Uint8Array> {
  const contents = new Uint8Array(request.expectedBytes);
  let offset = 0;
  while (offset < contents.byteLength) {
    assertSnapshotActive(request.lifecycle);
    const readRequest = {
      buffer: contents,
      length: contents.byteLength - offset,
      offset,
      position: offset,
    };
    const result = await request.handle.read(readRequest);
    if (result.bytesRead === 0) {
      throw new Error('Sealed source analysis image input ended early.');
    }
    offset += result.bytesRead;
  }
  assertSnapshotActive(request.lifecycle);
  return contents;
}

function assertSnapshotActive(
  request: ReadSourceAnalysisSnapshotRequest,
): void {
  if (request.signal !== false && request.signal.aborted) {
    throw new Error('Sealed source analysis image snapshot was aborted.');
  }
  if (Date.now() >= request.deadlineExpiresAt) {
    throw new Error('Sealed source analysis image snapshot deadline expired.');
  }
}
