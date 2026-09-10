import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CodexOptions } from '@openai/codex-sdk';
import { err, ok, type Result } from 'neverthrow';
import {
  ExpertIsolationFailureKind,
  type ExpertIsolationFailure,
} from './isolation-failure.ts';
import type { ReadOnlyExpertContextFile } from './runtime-contract.ts';

export type RepositorySnapshotRequest = {
  readonly codexHome: string;
  readonly environment: NonNullable<CodexOptions['env']>;
  readonly excludedPaths: readonly string[];
  readonly optionalScopePaths: readonly string[];
  readonly sourceCommit: string;
  readonly scopePaths: readonly string[];
  readonly workingDirectory: string;
};

type IsolatedCommandRequest = {
  readonly args: readonly string[];
  readonly command: string;
  readonly cwd: string;
  readonly environment: NonNullable<CodexOptions['env']>;
};

class SnapshotCommand {
  constructor(private readonly request: IsolatedCommandRequest) {}
  execute(): Result<string, ExpertIsolationFailure> {
    let output;
    try {
      output = spawnSync(this.request.command, [...this.request.args], {
        cwd: this.request.cwd,
        encoding: 'utf8',
        env: this.request.environment,
      });
    } catch {
      return err({
        kind: ExpertIsolationFailureKind.Snapshot,
        message: 'Module expert repository snapshot command could not start.',
      });
    }
    if (output.error || output.status !== 0)
      return err({
        kind: ExpertIsolationFailureKind.Snapshot,
        message: 'Module expert repository snapshot materialization failed.',
      });
    return ok(output.stdout);
  }
}

export class RepositorySnapshot {
  constructor(private readonly request: RepositorySnapshotRequest) {}
  materialize(): Result<string, ExpertIsolationFailure> {
    const request = this.request;
    const archivePath = join(request.codexHome, 'repository.tar');
    const snapshotPath = join(request.codexHome, 'repository');
    try {
      mkdirSync(snapshotPath);
    } catch {
      return err({
        kind: ExpertIsolationFailureKind.Storage,
        message: 'Module expert snapshot directory could not be created.',
      });
    }
    if (request.scopePaths.length === 0) return ok(snapshotPath);
    const optionalPaths = this.trackedOptionalPaths();
    if (optionalPaths.isErr()) return err(optionalPaths.error);
    const archived = new SnapshotCommand({
      command: 'git',
      cwd: request.workingDirectory,
      environment: request.environment,
      args: [
        'archive',
        '--format=tar',
        `--output=${archivePath}`,
        request.sourceCommit,
        '--',
        ...request.scopePaths,
        ...optionalPaths.value,
      ],
    }).execute();
    if (archived.isErr()) return err(archived.error);
    const extracted = new SnapshotCommand({
      command: 'tar',
      cwd: request.codexHome,
      environment: request.environment,
      args: [
        '--extract',
        `--file=${archivePath}`,
        `--directory=${snapshotPath}`,
      ],
    }).execute();
    if (extracted.isErr()) return err(extracted.error);
    for (const excludedPath of request.excludedPaths) {
      if (
        excludedPath.includes('\u0000') ||
        excludedPath.includes('\\') ||
        excludedPath.startsWith('/') ||
        excludedPath.split('/').includes('..')
      ) {
        return err({
          kind: ExpertIsolationFailureKind.Snapshot,
          message: 'Module expert snapshot exclusion is unsafe.',
        });
      }
      try {
        rmSync(join(snapshotPath, excludedPath), {
          recursive: true,
          force: true,
        });
      } catch {
        return err({
          kind: ExpertIsolationFailureKind.Storage,
          message: 'Module expert snapshot exclusion could not be applied.',
        });
      }
    }
    try {
      rmSync(archivePath, { force: true });
    } catch {
      return err({
        kind: ExpertIsolationFailureKind.Storage,
        message: 'Module expert snapshot archive could not be removed.',
      });
    }
    return ok(snapshotPath);
  }
  private trackedOptionalPaths(): Result<
    readonly string[],
    ExpertIsolationFailure
  > {
    const request = this.request;
    if (request.optionalScopePaths.length === 0) return ok([]);
    const listed = new SnapshotCommand({
      command: 'git',
      cwd: request.workingDirectory,
      environment: request.environment,
      args: [
        'ls-tree',
        '--name-only',
        '-z',
        request.sourceCommit,
        '--',
        ...request.optionalScopePaths,
      ],
    }).execute();
    if (listed.isErr()) return err(listed.error);
    return ok([
      ...new Set(
        listed.value
          .split('\u0000')
          .filter(
            (path) =>
              path.length > 0 && request.optionalScopePaths.includes(path),
          ),
      ),
    ]);
  }
}

export type SnapshotContextFilesRequest = {
  readonly contextFiles: readonly ReadOnlyExpertContextFile[];
  readonly repositorySnapshot: string;
};

export class SnapshotContextFiles {
  constructor(private readonly request: SnapshotContextFilesRequest) {}
  materialize(): Result<void, ExpertIsolationFailure> {
    let totalBytes = 0;
    for (const file of this.request.contextFiles)
      totalBytes += Buffer.byteLength(file.content, 'utf8');
    if (this.request.contextFiles.length > 64 || totalBytes > 1_048_576)
      return err({
        kind: ExpertIsolationFailureKind.ContextFiles,
        message: 'Read-only expert context files exceed their bounds.',
      });
    for (const file of this.request.contextFiles) {
      if (
        file.path === '' ||
        file.path.startsWith('/') ||
        file.path.includes('\\') ||
        file.path.includes('\u0000') ||
        file.path.split('/').includes('..') ||
        Buffer.byteLength(file.content, 'utf8') > 131_072
      )
        return err({
          kind: ExpertIsolationFailureKind.ContextFiles,
          message: 'Read-only expert context file is unsafe.',
        });
      const target = join(this.request.repositorySnapshot, file.path);
      try {
        mkdirSync(join(target, '..'), { recursive: true });
        writeFileSync(target, file.content, { encoding: 'utf8', flag: 'wx' });
      } catch {
        return err({
          kind: ExpertIsolationFailureKind.Storage,
          message: 'Read-only expert context file could not be created.',
        });
      }
    }
    return ok();
  }
}
