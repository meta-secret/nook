import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err, ok, ResultAsync, type Result } from 'neverthrow';

export enum ContractFailureKind {
  Files = 'files',
  Export = 'export',
  Schema = 'schema',
  Cleanup = 'cleanup',
  Combined = 'combined',
}
export type ContractFailure =
  | {
      readonly kind: Exclude<ContractFailureKind, ContractFailureKind.Combined>;
      readonly message: string;
    }
  | {
      readonly kind: ContractFailureKind.Combined;
      readonly message: string;
      readonly failures: readonly ContractFailure[];
    };
export class ContractDirectory {
  constructor(readonly path: string) {}
  create() {
    return ResultAsync.fromPromise(
      mkdir(this.path, { recursive: true }),
      (): ContractFailure => ({
        kind: ContractFailureKind.Files,
        message: 'Unable to create observer contract directory',
      }),
    ).map(() => {});
  }
  copyFrom(source: string) {
    return ResultAsync.fromPromise(
      cp(source, this.path, { recursive: true }),
      (): ContractFailure => ({
        kind: ContractFailureKind.Files,
        message: 'Unable to copy observer contracts',
      }),
    );
  }
  remove() {
    return ResultAsync.fromPromise(
      rm(this.path, { recursive: true, force: true }),
      (): ContractFailure => ({
        kind: ContractFailureKind.Cleanup,
        message: 'Unable to remove observer contract directory',
      }),
    );
  }
}
export class ContractFile {
  constructor(readonly path: string) {}
  read() {
    return ResultAsync.fromPromise(
      readFile(this.path, 'utf8'),
      (): ContractFailure => ({
        kind: ContractFailureKind.Files,
        message: 'Unable to read exported observer schema',
      }),
    );
  }
  write(source: string) {
    return ResultAsync.fromPromise(
      writeFile(this.path, source),
      (): ContractFailure => ({
        kind: ContractFailureKind.Files,
        message: 'Unable to write generated observer validator',
      }),
    );
  }
}
export class ContractWorkspaceRequest {
  create(): ResultAsync<ContractDirectory, ContractFailure> {
    return ResultAsync.fromPromise(
      mkdtemp(join(tmpdir(), 'hive-observer-contract-')),
      (): ContractFailure => ({
        kind: ContractFailureKind.Files,
        message: 'Unable to create observer contract workspace',
      }),
    ).map((path) => new ContractDirectory(path));
  }
}
export class NativeObserverExport {
  constructor(private readonly consoleRoot: string) {}
  execute(staged: string): Result<void, ContractFailure> {
    try {
      execFileSync(
        'cargo',
        [
          'run',
          '--locked',
          '--manifest-path',
          join(this.consoleRoot, '../Cargo.toml'),
          '-p',
          'hive',
          '--features',
          'observer-contract-export',
          '--bin',
          'hive-export-observer-contract',
          '--',
          '--output',
          staged,
        ],
        { stdio: 'inherit' },
      );
      return ok();
    } catch {
      return err({
        kind: ContractFailureKind.Export,
        message: 'Native observer contract export failed',
      });
    }
  }
}
