import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok, type Result } from "neverthrow";
import {
  OperationalContractFailureKind,
  type OperationalContractFailure,
} from "./operational-contract";

export class FixtureFile {
  constructor(readonly path: string) {}
  read(): Result<string, OperationalContractFailure> {
    try {
      return ok(readFileSync(this.path, "utf8"));
    } catch {
      return err({
        kind: OperationalContractFailureKind.Source,
        message: `Unable to read fixture file ${this.path}`,
      });
    }
  }
  write(source: string): Result<void, OperationalContractFailure> {
    try {
      writeFileSync(this.path, source);
      return ok();
    } catch {
      return err({
        kind: OperationalContractFailureKind.Source,
        message: `Unable to write fixture file ${this.path}`,
      });
    }
  }
  copyFrom(source: string): Result<void, OperationalContractFailure> {
    try {
      copyFileSync(source, this.path);
      return ok();
    } catch {
      return err({
        kind: OperationalContractFailureKind.Source,
        message: `Unable to copy fixture file ${this.path}`,
      });
    }
  }
  makeExecutable(): Result<void, OperationalContractFailure> {
    try {
      chmodSync(this.path, 0o755);
      return ok();
    } catch {
      return err({
        kind: OperationalContractFailureKind.Source,
        message: `Unable to mark fixture executable ${this.path}`,
      });
    }
  }
}
export class FixtureDirectory {
  constructor(readonly path: string) {}
  create(): Result<void, OperationalContractFailure> {
    try {
      mkdirSync(this.path, { recursive: true });
      return ok();
    } catch {
      return err({
        kind: OperationalContractFailureKind.Source,
        message: `Unable to create fixture directory ${this.path}`,
      });
    }
  }
}
export class FixtureWorkspace {
  constructor(readonly path: string) {}
  finish<T>(
    outcome: Result<T, OperationalContractFailure>,
  ): Result<T, OperationalContractFailure> {
    const cleanup = this.remove();
    if (cleanup.isOk()) return outcome;
    if (outcome.isOk()) return err(cleanup.error);
    return err({
      kind: OperationalContractFailureKind.Combined,
      message: `${outcome.error.message}\n${cleanup.error.message}`,
      failures: [outcome.error, cleanup.error],
    });
  }
  private remove(): Result<void, OperationalContractFailure> {
    try {
      rmSync(this.path, { recursive: true, force: true });
      return ok();
    } catch {
      return err({
        kind: OperationalContractFailureKind.Cleanup,
        message: `Unable to remove fixture workspace ${this.path}`,
      });
    }
  }
}
export class FixtureWorkspaceRequest {
  constructor(private readonly prefix: string) {}
  create(): Result<FixtureWorkspace, OperationalContractFailure> {
    try {
      return ok(new FixtureWorkspace(mkdtempSync(join(tmpdir(), this.prefix))));
    } catch {
      return err({
        kind: OperationalContractFailureKind.Source,
        message: "Unable to create fixture workspace",
      });
    }
  }
}
export class FixtureEmbeddedSource {
  constructor(private readonly source: string) {}
  between(
    start: string,
    end: string,
  ): Result<string, OperationalContractFailure> {
    const startIndex = this.source.indexOf(start);
    const endIndex = this.source.indexOf(end, startIndex + start.length);
    if (startIndex < 0 || endIndex < 0)
      return err({
        kind: OperationalContractFailureKind.Requirement,
        message: "Operational fixture embedded source boundaries are missing",
      });
    return ok(this.source.slice(startIndex + start.length, endIndex));
  }
}
