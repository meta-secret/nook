import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { err, ok, ResultAsync, type Result } from "neverthrow";
import { CiFailureKind, type CiFailure } from "./failure.js";
const executeFile = promisify(execFile);
export interface ProcessOutput {
  readonly stdout: string;
  readonly stderr: string;
}
export class CiProcess {
  constructor(
    private readonly command: string,
    private readonly args: readonly string[],
    private readonly options: {
      env?: NodeJS.ProcessEnv;
      cwd?: string;
      maxBuffer?: number;
      signal?: AbortSignal;
    } = {},
  ) {}
  execute(): ResultAsync<ProcessOutput, CiFailure> {
    return ResultAsync.fromPromise(
      executeFile(this.command, [...this.args], {
        ...this.options,
        encoding: "utf8",
      }),
      (cause): CiFailure => {
        const code =
          cause instanceof Error &&
          "code" in cause &&
          (typeof cause.code === "number" || typeof cause.code === "string")
            ? cause.code
            : undefined;
        return {
          kind: this.options.signal?.aborted
            ? CiFailureKind.Cancelled
            : CiFailureKind.Git,
          message: `${this.command} command failed`,
          ...(code === undefined ? {} : { code }),
        };
      },
    );
  }
}

export class CiWorkingDirectory {
  constructor(private readonly path: string) {}
  enter(): Result<void, CiFailure> {
    try {
      process.chdir(this.path);
      return ok();
    } catch {
      return err({
        kind: CiFailureKind.Filesystem,
        message: "Unable to enter agent working directory",
      });
    }
  }
}
