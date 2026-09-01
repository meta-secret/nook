import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  lstat,
  link,
  mkdir,
  open,
  realpath,
  rename,
  unlink,
} from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

export type JournalStorageHook =
  | Readonly<{ presence: 'absent' }>
  | Readonly<{ presence: 'present'; run: () => void }>;

export async function canonicalTeamPlanJournalPath(
  journalPath: string,
): Promise<string> {
  const requested = resolve(journalPath);
  await mkdir(dirname(requested), { recursive: true });
  const parent = await realpath(dirname(requested));
  return resolve(parent, basename(requested));
}

export async function canonicalExistingJournalPath(
  journalPath: string,
): Promise<string> {
  const requested = resolve(journalPath);
  const status = await lstat(requested);
  if (status.isSymbolicLink() || !status.isFile() || status.nlink !== 1)
    throw new Error('Team Plan journal path is unsafe.');
  const parent = await realpath(dirname(requested));
  return resolve(parent, basename(requested));
}

export async function readBoundedTeamPlanJournal(
  request: Readonly<{
    path: string;
    maximumBytes: number;
    expectedLinkCount: number;
  }>,
): Promise<Readonly<{ serialized: string; mode: number }>> {
  const handle = await open(
    request.path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const status = await handle.stat();
    if (!status.isFile() || status.nlink !== request.expectedLinkCount)
      throw new Error('Team Plan journal path is unsafe.');
    if (status.size > request.maximumBytes)
      throw new Error('Team Plan journal is oversized or noncanonical.');
    const bytes = Buffer.alloc(status.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (result.bytesRead === 0)
        throw new Error('Team Plan journal changed while being read.');
      offset += result.bytesRead;
    }
    const overflow = Buffer.alloc(1);
    if ((await handle.read(overflow, 0, 1, offset)).bytesRead !== 0)
      throw new Error('Team Plan journal is oversized or noncanonical.');
    const named = await lstat(request.path);
    if (
      !named.isFile() ||
      status.dev !== named.dev ||
      status.ino !== named.ino ||
      named.nlink !== request.expectedLinkCount
    )
      throw new Error('Team Plan journal path is unsafe.');
    return { serialized: bytes.toString('utf8'), mode: status.mode & 0o777 };
  } finally {
    await handle.close();
  }
}

export async function publishNewJournalFile(request: {
  readonly path: string;
  readonly serialized: string;
}): Promise<void> {
  const temporary = await writeTemporaryFile({ ...request, mode: 0o600 });
  try {
    await link(temporary, request.path);
    await unlink(temporary);
    await syncParent(request.path);
  } catch (error) {
    await removeTemporary(temporary);
    throw error;
  }
}

export async function replaceJournalFile(request: {
  readonly path: string;
  readonly serialized: string;
  readonly mode: number;
  readonly beforeTemporarySync: JournalStorageHook;
  readonly afterTemporaryCleanupSync: JournalStorageHook;
  readonly beforeParentSync: JournalStorageHook;
}): Promise<void> {
  const temporary = await writeTemporaryFile(request);
  try {
    await rename(temporary, request.path);
    runStorageHook(request.beforeParentSync);
    await syncParent(request.path);
  } catch (error) {
    await removeTemporary(temporary);
    throw error;
  }
}

export async function publishDiscardTombstone(request: {
  readonly path: string;
  readonly tombstone: string;
  readonly beforeParentSync: JournalStorageHook;
}): Promise<void> {
  try {
    await link(request.path, request.tombstone);
  } catch (error) {
    if (nodeErrorCode(error as NodeJS.ErrnoException) !== 'EEXIST') throw error;
    const source = await lstat(request.path);
    const existing = await lstat(request.tombstone);
    if (source.dev !== existing.dev || source.ino !== existing.ino)
      throw new Error('Team Plan discard tombstone is forged.', {
        cause: error,
      });
  }
  runStorageHook(request.beforeParentSync);
  await syncParent(request.path);
  await unlink(request.path);
  runStorageHook(request.beforeParentSync);
  await syncParent(request.path);
}

export async function removeDiscardTombstone(request: {
  readonly path: string;
  readonly completion: string;
  readonly beforeParentSync: JournalStorageHook;
}): Promise<void> {
  await rename(request.path, request.completion);
  runStorageHook(request.beforeParentSync);
  await syncParent(request.path);
}

export async function removeDiscardCompletion(path: string): Promise<void> {
  await unlink(path);
  await syncParent(path);
}

export async function syncTeamPlanJournalParent(request: {
  readonly path: string;
  readonly beforeParentSync: JournalStorageHook;
}): Promise<void> {
  runStorageHook(request.beforeParentSync);
  await syncParent(request.path);
}

export async function resumeDiscardTombstone(request: {
  readonly path: string;
  readonly tombstone: string;
}): Promise<void> {
  await assertMatchingDiscardTombstone(request);
  await unlink(request.path);
  await syncParent(request.path);
}

export async function assertMatchingDiscardTombstone(request: {
  readonly path: string;
  readonly tombstone: string;
}): Promise<void> {
  const source = await lstat(request.path);
  const existing = await lstat(request.tombstone);
  if (
    source.dev !== existing.dev ||
    source.ino !== existing.ino ||
    source.nlink !== 2 ||
    existing.nlink !== 2
  )
    throw new Error('Team Plan discard tombstone is forged.');
}

export function storageHook(hook?: () => void): JournalStorageHook {
  return hook ? { presence: 'present', run: hook } : { presence: 'absent' };
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (nodeErrorCode(error as NodeJS.ErrnoException) === 'ENOENT')
      return false;
    throw error;
  }
}

async function writeTemporaryFile(request: {
  readonly path: string;
  readonly serialized: string;
  readonly mode: number;
  readonly beforeTemporarySync?: JournalStorageHook;
  readonly afterTemporaryCleanupSync?: JournalStorageHook;
}): Promise<string> {
  const temporary = resolve(
    dirname(request.path),
    `.${basename(request.path)}.${randomUUID()}.tmp`,
  );
  const handle = await open(temporary, 'wx', request.mode);
  try {
    await handle.chmod(request.mode);
    await handle.writeFile(request.serialized, 'utf8');
    if (request.beforeTemporarySync)
      runStorageHook(request.beforeTemporarySync);
    await handle.sync();
    await handle.close();
    return temporary;
  } catch (error) {
    await handle.close().catch(() => false);
    await removeTemporary(temporary);
    if (request.afterTemporaryCleanupSync)
      runStorageHook(request.afterTemporaryCleanupSync);
    throw error;
  }
}

async function syncParent(path: string): Promise<void> {
  const handle = await open(dirname(path), 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function removeTemporary(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (nodeErrorCode(error as NodeJS.ErrnoException) !== 'ENOENT') throw error;
    return;
  }
  await syncParent(path);
}

function runStorageHook(hook: JournalStorageHook): void {
  if (hook.presence === 'present') hook.run();
}

function nodeErrorCode(error: NodeJS.ErrnoException): string | false {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = error.code;
  return typeof code === 'string' ? code : false;
}
