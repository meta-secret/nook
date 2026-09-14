import { spawnSync } from 'node:child_process';
import type { SpawnSyncOptionsWithStringEncoding } from 'node:child_process';
import {
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { err, ok, type Result } from 'neverthrow';
import {
  ExpertIsolationFailureKind,
  type ExpertIsolationFailure,
} from './isolation-failure.ts';
import type { ReadOnlyExpertContextFile } from './runtime-contract.ts';

export type RepositorySnapshotRequest = {
  readonly codexHome: string;
  readonly excludedPaths: readonly string[];
  readonly optionalScopePaths: readonly string[];
  readonly sourceCommit: string;
  readonly scopePaths: readonly string[];
  readonly workingDirectory: string;
};

type IsolatedCommandRequest = {
  readonly args: readonly string[];
  readonly command: SnapshotExecutable;
  readonly cwd: string;
  readonly gitDirectory?: string;
};

type IsolatedGitDirectory = {
  readonly path: string;
};

const ISOLATED_GIT_ARGUMENTS = [
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.untrackedCache=false',
  '--no-pager',
  '--no-replace-objects',
  '--literal-pathspecs',
] as const;

class SnapshotCommand {
  constructor(private readonly request: IsolatedCommandRequest) {}
  execute(): Result<string, ExpertIsolationFailure> {
    let output;
    try {
      const args =
        this.request.command === SnapshotExecutable.Git
          ? [
              ...ISOLATED_GIT_ARGUMENTS,
              ...(this.request.gitDirectory
                ? [`--git-dir=${this.request.gitDirectory}`]
                : []),
              ...this.request.args,
            ]
          : [...this.request.args];
      const options: SpawnSyncOptionsWithStringEncoding = {
        cwd: this.request.cwd,
        encoding: 'utf8',
        env: SnapshotCommand.isolatedEnvironment(),
      };
      output =
        this.request.command === SnapshotExecutable.Git
          ? spawnSync('git', args, options)
          : spawnSync('tar', args, options);
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

  private static isolatedEnvironment(): NodeJS.ProcessEnv {
    const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
    return {
      COMSPEC: process.env.COMSPEC,
      GIT_CONFIG_GLOBAL: nullDevice,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_SYSTEM: nullDevice,
      GIT_NO_REPLACE_OBJECTS: '1',
      GIT_OPTIONAL_LOCKS: '0',
      GIT_PAGER: '',
      GIT_TERMINAL_PROMPT: '0',
      PATH: process.env.PATH,
      Path: process.env.Path,
      PATHEXT: process.env.PATHEXT,
      SYSTEMROOT: process.env.SYSTEMROOT,
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR,
    };
  }
}

enum SnapshotExecutable {
  Git = 'git',
  Tar = 'tar',
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
    const isolatedGit = this.createIsolatedGitDirectory();
    if (isolatedGit.isErr()) return err(isolatedGit.error);
    let result: Result<string, ExpertIsolationFailure>;
    let cleanupFailed = false;
    try {
      const optionalPaths = this.trackedOptionalPaths(
        isolatedGit.value.path,
      );
      if (optionalPaths.isErr()) result = err(optionalPaths.error);
      else {
        const archived = new SnapshotCommand({
          command: SnapshotExecutable.Git,
          cwd: request.codexHome,
          gitDirectory: isolatedGit.value.path,
          args: [
            'archive',
            '--format=tar',
            '--no-worktree-attributes',
            `--output=${archivePath}`,
            request.sourceCommit,
            '--',
            ...request.scopePaths,
            ...optionalPaths.value,
          ],
        }).execute();
        if (archived.isErr()) result = err(archived.error);
        else {
          const extracted = new SnapshotCommand({
            command: SnapshotExecutable.Tar,
            cwd: request.codexHome,
            args: [
              '--extract',
              `--file=${archivePath}`,
              `--directory=${snapshotPath}`,
            ],
          }).execute();
          if (extracted.isErr()) result = err(extracted.error);
          else result = this.applyExclusions(snapshotPath);
        }
      }
    } finally {
      try {
        rmSync(archivePath, { force: true });
      } catch {
        cleanupFailed = true;
      }
      try {
        rmSync(isolatedGit.value.path, { force: true, recursive: true });
      } catch {
        cleanupFailed = true;
      }
    }
    if (cleanupFailed)
      return err({
        kind: ExpertIsolationFailureKind.Storage,
        message: 'Module expert snapshot temporary files could not be removed.',
      });
    return result;
  }

  private createIsolatedGitDirectory(): Result<
    IsolatedGitDirectory,
    ExpertIsolationFailure
  > {
    // Discovery is limited to the immutable object-store path. Archive and
    // ls-tree run from the temporary Git directory below, so repository-local
    // config (including executable hooks, filters, helpers, and transports)
    // is never loaded by either snapshot operation.
    const objectDirectory = new SnapshotCommand({
      command: SnapshotExecutable.Git,
      cwd: this.request.workingDirectory,
      args: ['rev-parse', '--path-format=absolute', '--git-path', 'objects'],
    }).execute();
    if (objectDirectory.isErr()) return err(objectDirectory.error);
    const objectsPath = objectDirectory.value.replace(/\r?\n$/u, '');
    if (
      objectsPath.length === 0 ||
      !isAbsolute(objectsPath) ||
      objectsPath.includes('\u0000') || /[\r\n]/u.test(objectsPath)
    )
      return err({
        kind: ExpertIsolationFailureKind.Snapshot,
        message: 'Module expert repository object directory is unsafe.',
      });
    try {
      if (!statSync(objectsPath).isDirectory())
        return err({
          kind: ExpertIsolationFailureKind.Snapshot,
          message: 'Module expert repository object directory is unavailable.',
        });
    } catch {
      return err({
        kind: ExpertIsolationFailureKind.Snapshot,
        message: 'Module expert repository object directory is unavailable.',
      });
    }
    let isolatedPath: string | undefined;
    try {
      isolatedPath = mkdtempSync(join(this.request.codexHome, '.git-'));
      const objectsDirectory = join(isolatedPath, 'objects');
      const alternatesDirectory = join(objectsDirectory, 'info');
      mkdirSync(alternatesDirectory, { recursive: true });
      mkdirSync(join(isolatedPath, 'refs', 'heads'), { recursive: true });
      mkdirSync(join(isolatedPath, 'refs', 'tags'), { recursive: true });
      writeFileSync(
        join(isolatedPath, 'HEAD'),
        `${this.request.sourceCommit}\n`,
        { encoding: 'utf8', flag: 'wx' },
      );
      writeFileSync(
        join(alternatesDirectory, 'alternates'),
        `${objectsPath}\n`,
        { encoding: 'utf8', flag: 'wx' },
      );
      return ok({ path: isolatedPath });
    } catch {
      if (isolatedPath !== undefined) {
        try {
          rmSync(isolatedPath, { force: true, recursive: true });
        } catch {
          // Preserve the original storage failure.
        }
      }
      return err({
        kind: ExpertIsolationFailureKind.Storage,
        message: 'Module expert isolated Git directory could not be created.',
      });
    }
  }

  private applyExclusions(
    snapshotPath: string,
  ): Result<string, ExpertIsolationFailure> {
    for (const excludedPath of this.request.excludedPaths) {
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
    return ok(snapshotPath);
  }

  private trackedOptionalPaths(
    gitDirectory: string,
  ): Result<readonly string[], ExpertIsolationFailure> {
    const request = this.request;
    if (request.optionalScopePaths.length === 0) return ok([]);
    const listed = new SnapshotCommand({
      command: SnapshotExecutable.Git,
      cwd: request.codexHome,
      gitDirectory,
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
    if (this.request.contextFiles.length === 0) return ok();
    const root = this.canonicalSnapshotRoot();
    if (root.isErr()) return err(root.error);
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
      const target = this.safeTarget(root.value, file.path);
      if (target.isErr()) return err(target.error);
      try {
        let descriptor: number | undefined;
        try {
          descriptor = openSync(
            target.value,
            constants.O_WRONLY |
              constants.O_CREAT |
              constants.O_EXCL |
              constants.O_NOFOLLOW,
            0o600,
          );
          writeFileSync(descriptor, file.content, {
            encoding: 'utf8',
          });
        } finally {
          if (descriptor !== undefined) closeSync(descriptor);
        }
      } catch {
        return err({
          kind: ExpertIsolationFailureKind.Storage,
          message: 'Read-only expert context file could not be created.',
        });
      }
    }
    return ok();
  }

  private canonicalSnapshotRoot(): Result<string, ExpertIsolationFailure> {
    const root = resolve(this.request.repositorySnapshot);
    try {
      const metadata = lstatSync(root);
      if (metadata.isSymbolicLink() || !metadata.isDirectory())
        return err({
          kind: ExpertIsolationFailureKind.ContextFiles,
          message: 'Read-only expert snapshot root is unsafe.',
        });
      const canonical = realpathSync(root);
      const canonicalMetadata = lstatSync(canonical);
      if (canonicalMetadata.isSymbolicLink() || !canonicalMetadata.isDirectory())
        return err({
          kind: ExpertIsolationFailureKind.ContextFiles,
          message: 'Read-only expert snapshot root is unsafe.',
        });
      return ok(canonical);
    } catch {
      return err({
        kind: ExpertIsolationFailureKind.Storage,
        message: 'Read-only expert snapshot root could not be inspected.',
      });
    }
  }

  private safeTarget(
    ...[canonicalRoot, path]: [canonicalRoot: string, path: string]
  ): Result<string, ExpertIsolationFailure> {
    const root = resolve(this.request.repositorySnapshot);
    const target = resolve(root, path);
    const targetRelative = relative(root, target);
    if (
      targetRelative === '' ||
      isAbsolute(targetRelative) ||
      targetRelative === '..' ||
      targetRelative.startsWith(`..${sep}`)
    )
      return err({
        kind: ExpertIsolationFailureKind.ContextFiles,
        message: 'Read-only expert context file is unsafe.',
      });
    const parent = this.safeParent(root, canonicalRoot, dirname(target));
    if (parent.isErr()) return err(parent.error);
    try {
      const metadata = lstatSync(target, { throwIfNoEntry: false });
      if (metadata?.isSymbolicLink())
        return err({
          kind: ExpertIsolationFailureKind.ContextFiles,
          message: 'Read-only expert context file is unsafe.',
        });
      if (metadata !== undefined) {
        const existingCanonical = realpathSync(target);
        const existingRelative = relative(canonicalRoot, existingCanonical);
        if (
          existingRelative === '' ||
          isAbsolute(existingRelative) ||
          existingRelative === '..' ||
          existingRelative.startsWith(`..${sep}`)
        )
          return err({
            kind: ExpertIsolationFailureKind.ContextFiles,
            message: 'Read-only expert context file is unsafe.',
          });
      }
      const canonicalTarget = join(parent.value, basename(target));
      const canonicalTargetRelative = relative(canonicalRoot, canonicalTarget);
      if (
        canonicalTargetRelative === '' ||
        isAbsolute(canonicalTargetRelative) ||
        canonicalTargetRelative === '..' ||
        canonicalTargetRelative.startsWith(`..${sep}`)
      )
        return err({
          kind: ExpertIsolationFailureKind.ContextFiles,
          message: 'Read-only expert context file is unsafe.',
        });
      return ok(canonicalTarget);
    } catch {
      return err({
        kind: ExpertIsolationFailureKind.Storage,
        message: 'Read-only expert context file could not be inspected.',
      });
    }
  }

  private safeParent(
    ...[root, canonicalRoot, parent]: [
      root: string,
      canonicalRoot: string,
      parent: string,
    ]
  ): Result<string, ExpertIsolationFailure> {
    const parentRelative = relative(root, parent);
    if (
      isAbsolute(parentRelative) ||
      parentRelative === '..' ||
      parentRelative.startsWith(`..${sep}`)
    )
      return err({
        kind: ExpertIsolationFailureKind.ContextFiles,
        message: 'Read-only expert context file is unsafe.',
      });
    try {
      let current = root;
      for (const component of parentRelative.split(sep).filter(Boolean)) {
        const candidate = join(current, component);
        let metadata = lstatSync(candidate, { throwIfNoEntry: false });
        if (metadata === undefined) {
          mkdirSync(candidate);
          metadata = lstatSync(candidate);
        }
        if (metadata.isSymbolicLink() || !metadata.isDirectory())
          return err({
            kind: ExpertIsolationFailureKind.ContextFiles,
            message: 'Read-only expert context file is unsafe.',
          });
        const canonical = realpathSync(candidate);
        const canonicalRelative = relative(canonicalRoot, canonical);
        if (
          isAbsolute(canonicalRelative) ||
          canonicalRelative === '..' ||
          canonicalRelative.startsWith(`..${sep}`)
        )
          return err({
            kind: ExpertIsolationFailureKind.ContextFiles,
            message: 'Read-only expert context file is unsafe.',
          });
        current = candidate;
      }
      const canonicalParent = realpathSync(parent);
      const canonicalParentRelative = relative(canonicalRoot, canonicalParent);
      if (
        isAbsolute(canonicalParentRelative) ||
        canonicalParentRelative === '..' ||
        canonicalParentRelative.startsWith(`..${sep}`)
      )
        return err({
          kind: ExpertIsolationFailureKind.ContextFiles,
          message: 'Read-only expert context file is unsafe.',
        });
      return ok(canonicalParent);
    } catch {
      return err({
        kind: ExpertIsolationFailureKind.Storage,
        message: 'Read-only expert context directory could not be created.',
      });
    }
  }
}
