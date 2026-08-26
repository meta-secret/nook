import { createHash } from 'node:crypto';
import type { MakeDirectoryOptions } from 'node:fs';
import { lstat, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Database } from 'bun:sqlite';
import {
  throwExecutableSkillRuntimeFailure,
  type ThrowExecutableSkillRuntimeFailureRequest,
} from './runtime-failure.ts';

export type ExecuteWithExecutableSkillDockerLeaseRequest = {
  readonly daemonId: string;
  readonly endpoint: string;
  readonly execute: () => Promise<void>;
  readonly recover: () => Promise<void>;
};

type ExecutableSkillHostLease = {
  readonly database: Database;
};

type ExecutableSkillLeaseDatabaseOptions = {
  readonly create: true;
  readonly strict: true;
};

const LEASE_DIRECTORY_PREFIX = 'nook-executable-skill-runtime';

export async function executeWithExecutableSkillDockerLease(
  request: ExecuteWithExecutableSkillDockerLeaseRequest,
): Promise<void> {
  let lease: ExecutableSkillHostLease | false = false;
  try {
    lease = await acquireExecutableSkillHostLease(request);
    await request.recover();
    await request.execute();
  } catch (error) {
    const failureRequest: ThrowExecutableSkillRuntimeFailureRequest = {
      error:
        error instanceof Error ? error : 'Executable skill host lease failed.',
    };
    throwExecutableSkillRuntimeFailure(failureRequest);
  } finally {
    if (lease !== false) releaseExecutableSkillHostLease(lease);
  }
}

async function acquireExecutableSkillHostLease(
  request: ExecuteWithExecutableSkillDockerLeaseRequest,
): Promise<ExecutableSkillHostLease> {
  assertLeaseIdentity(request);
  const userId = resolveExecutableSkillHostUserId();
  const directory = path.join(
    tmpdir(),
    `${LEASE_DIRECTORY_PREFIX}-${String(userId)}`,
  );
  try {
    const directoryOptions: MakeDirectoryOptions = { mode: 0o700 };
    await mkdir(directory, directoryOptions);
  } catch {
    // Existing lease directories are validated below before use.
  }
  const metadata = await lstat(directory);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== userId ||
    (metadata.mode & 0o777) !== 0o700
  ) {
    throw new Error('Executable skill host lease directory is invalid.');
  }
  const identity = createHash('sha256')
    .update(request.daemonId)
    .update('\0')
    .update(request.endpoint)
    .digest('hex');
  const databaseOptions: ExecutableSkillLeaseDatabaseOptions = {
    create: true,
    strict: true,
  };
  const database = new Database(
    path.join(directory, `${identity}.sqlite`),
    databaseOptions,
  );
  try {
    database.exec('PRAGMA busy_timeout = 0');
    database.exec('BEGIN EXCLUSIVE');
  } catch {
    database.close();
    throw new Error('Executable skill host lease is already owned.');
  }
  const lease: ExecutableSkillHostLease = { database };
  return Object.freeze(lease);
}

export function resolveExecutableSkillHostUserId(): number {
  if (typeof process.getuid !== 'function') {
    throw new Error('Executable skill host lease requires a POSIX user ID.');
  }
  return process.getuid();
}

function releaseExecutableSkillHostLease(
  lease: ExecutableSkillHostLease,
): void {
  try {
    lease.database.exec('ROLLBACK');
  } finally {
    lease.database.close();
  }
}

function assertLeaseIdentity(
  request: ExecuteWithExecutableSkillDockerLeaseRequest,
): void {
  const endpointPath = request.endpoint.slice('unix://'.length);
  if (
    !/^[A-Za-z0-9-]{16,128}$/u.test(request.daemonId) ||
    !request.endpoint.startsWith('unix:///') ||
    !path.isAbsolute(endpointPath) ||
    path.normalize(endpointPath) !== endpointPath ||
    endpointPath === '/'
  ) {
    throw new Error('Executable skill host lease identity is invalid.');
  }
}
