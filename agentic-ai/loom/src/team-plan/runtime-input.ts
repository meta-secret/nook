import { O_NONBLOCK, O_RDONLY } from 'node:constants';
import { open, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

import { LoomFailureCode, loomFailureFromCause } from '../loom-failure.ts';

export type ReadBoundedTeamPlanFileRequest = Readonly<{
  planPath: string;
  maximumBytes: number;
}>;

export type BoundedTeamPlanFile = Readonly<{ path: string; text: string }>;

export async function readBoundedTeamPlanFile(
  request: ReadBoundedTeamPlanFileRequest,
): Promise<BoundedTeamPlanFile> {
  const path = await storageAction(() => realpath(resolve(request.planPath)));
  const handle = await storageAction(() => open(path, O_RDONLY | O_NONBLOCK));
  try {
    const status = await storageAction(() => handle.stat());
    if (!status.isFile()) throw validationFailure('must be a regular file');
    if (status.size > request.maximumBytes)
      throw validationFailure('is oversized');
    const bytes = Buffer.alloc(request.maximumBytes + 1);
    let total = 0;
    while (total < bytes.length) {
      const { bytesRead } = await storageAction(() =>
        handle.read(bytes, total, bytes.length - total, total),
      );
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > request.maximumBytes) throw validationFailure('is oversized');
    try {
      return {
        path,
        text: new TextDecoder('utf-8', { fatal: true }).decode(
          bytes.subarray(0, total),
        ),
      };
    } catch {
      throw validationFailure('must use UTF-8 encoding');
    }
  } finally {
    await storageAction(() => handle.close());
  }
}

function validationFailure(reason: string) {
  return loomFailureFromCause({
    code: LoomFailureCode.TeamPlanValidationFailed,
    cause: new Error(`Team Plan input ${reason}.`),
  });
}

async function storageAction<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (cause) {
    throw loomFailureFromCause({
      code: LoomFailureCode.TeamPlanStorageFailed,
      cause: cause instanceof Error ? cause : new Error('Plan input failed.'),
    });
  }
}
