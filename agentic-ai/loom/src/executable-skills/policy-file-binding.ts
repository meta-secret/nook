import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';

type BoundPolicyLifecycle = {
  readonly deadlineExpiresAt: number;
  readonly repositoryRoot: string;
  readonly signal: AbortSignal | false;
};

export type BoundPolicyGitRequest = BoundPolicyLifecycle & {
  readonly arguments: readonly string[];
};

export type BoundPolicyGitRunner = (
  request: BoundPolicyGitRequest,
) => Promise<string>;

export type AuditBoundPolicyFileRequest = BoundPolicyLifecycle & {
  readonly relativePath: string;
  readonly runGit: BoundPolicyGitRunner;
  readonly skillId: string;
  readonly sourceTree: string;
};

type DecodeFrozenPolicyFileRequest = {
  readonly output: string;
  readonly relativePath: string;
};

type FrozenPolicyFile = {
  readonly blobHash: string;
  readonly bytes: number;
  readonly mode: string;
};

type ReadPolicyDescriptorRequest = {
  readonly handle: FileHandle;
  readonly lifecycle: BoundPolicyLifecycle;
  readonly maximumBytes: number;
};

const MAXIMUM_EXECUTABLE_SKILL_POLICY_BYTES = 256 * 1024;

export async function isBoundPolicyFileSafe(
  request: AuditBoundPolicyFileRequest,
): Promise<boolean> {
  let handle: FileHandle | false = false;
  try {
    assertPolicyAuditActive(request);
    const treeRequest: BoundPolicyGitRequest = {
      arguments: [
        'ls-tree',
        '-l',
        '-z',
        request.sourceTree,
        '--',
        request.relativePath,
      ],
      deadlineExpiresAt: request.deadlineExpiresAt,
      repositoryRoot: request.repositoryRoot,
      signal: request.signal,
    };
    const frozenRequest: DecodeFrozenPolicyFileRequest = {
      output: await request.runGit(treeRequest),
      relativePath: request.relativePath,
    };
    const frozen = decodeFrozenPolicyFile(frozenRequest);
    if (
      frozen.mode !== '100644' ||
      frozen.bytes > MAXIMUM_EXECUTABLE_SKILL_POLICY_BYTES
    ) {
      return false;
    }
    const absolutePath = path.join(
      request.repositoryRoot,
      request.relativePath,
    );
    const canonicalRoot = await realpath(request.repositoryRoot);
    const expectedPath = path.join(canonicalRoot, request.relativePath);
    if ((await realpath(absolutePath)) !== expectedPath) return false;
    const flags =
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
    handle = await open(absolutePath, flags);
    const stat = await handle.stat();
    if ((await realpath(absolutePath)) !== expectedPath) return false;
    assertPolicyAuditActive(request);
    if (
      !stat.isFile() ||
      (stat.mode & 0o111) !== 0 ||
      stat.size > MAXIMUM_EXECUTABLE_SKILL_POLICY_BYTES
    ) {
      return false;
    }
    const descriptorRequest: ReadPolicyDescriptorRequest = {
      handle,
      lifecycle: request,
      maximumBytes: frozen.bytes + 1,
    };
    const worktreeBytes = await readPolicyDescriptor(descriptorRequest);
    return (
      worktreeBytes.byteLength === frozen.bytes &&
      gitBlobHash(worktreeBytes) === frozen.blobHash
    );
  } catch {
    assertPolicyAuditActive(request);
    return false;
  } finally {
    if (handle !== false) await handle.close();
  }
}

function decodeFrozenPolicyFile(
  request: DecodeFrozenPolicyFileRequest,
): FrozenPolicyFile {
  const match =
    /^(100644|100755) blob ([0-9a-f]{40}) +([0-9]+)\t([^\0]+)\0$/u.exec(
      request.output,
    );
  if (!match || match[4] !== request.relativePath) {
    throw new Error('Executable skill policy is absent from the frozen tree.');
  }
  const bytes = Number(match[3]);
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error('Executable skill policy byte size is invalid.');
  }
  return {
    blobHash: match[2] ?? '',
    bytes,
    mode: match[1] ?? '',
  };
}

async function readPolicyDescriptor(
  request: ReadPolicyDescriptorRequest,
): Promise<Buffer> {
  const content = Buffer.alloc(request.maximumBytes);
  let offset = 0;
  while (offset < content.byteLength) {
    assertPolicyAuditActive(request.lifecycle);
    const readResult = await request.handle.read(
      content,
      offset,
      content.byteLength - offset,
      offset,
    );
    assertPolicyAuditActive(request.lifecycle);
    if (readResult.bytesRead === 0) break;
    offset += readResult.bytesRead;
  }
  return content.subarray(0, offset);
}

function gitBlobHash(content: Uint8Array): string {
  const header = Buffer.from(`blob ${content.byteLength}\0`, 'utf8');
  return createHash('sha1').update(header).update(content).digest('hex');
}

function assertPolicyAuditActive(request: BoundPolicyLifecycle): void {
  if (request.signal !== false && request.signal.aborted) {
    throw new Error('Executable skill registry audit was cancelled.');
  }
  if (Date.now() >= request.deadlineExpiresAt) {
    throw new Error('Executable skill registry audit deadline expired.');
  }
}
