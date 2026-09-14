import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { err, ok, ResultAsync, type Result } from "neverthrow";
import { CiFailureKind, type CiFailure } from "./failure.js";
const executeFile = promisify(execFile);

/** Limits Git object identity checks to repository-owned objects and refs. */
export enum CiProcessGitSecurityPolicy {
  ImmutableObjects = "immutableObjects",
}

export interface CiProcessRequest {
  readonly gitSecurity?: CiProcessGitSecurityPolicy;
}

export interface ProcessOutput {
  readonly stdout: string;
  readonly stderr: string;
}
export class CiProcess {
  constructor(
    private readonly args: readonly string[],
    private readonly request: CiProcessRequest = {},
  ) {}
  execute(): ResultAsync<ProcessOutput, CiFailure> {
    return ResultAsync.fromPromise(
      executeFile("git", [...this.args], {
        encoding: "utf8",
        ...(this.request.gitSecurity ===
        CiProcessGitSecurityPolicy.ImmutableObjects
          ? {
              env: new CiGitSecurityEnvironment(process.env).isolated(),
            }
          : {}),
      }),
      (cause): CiFailure => {
        const code =
          cause instanceof Error &&
          "code" in cause &&
          (typeof cause.code === "number" || typeof cause.code === "string")
            ? cause.code
            : false;
        return {
          kind: CiFailureKind.Git,
          message: "git command failed",
          ...(code === false ? {} : { code }),
        };
      },
    );
  }
}

/** Owns the Git environment boundary for immutable repository object checks. */
class CiGitSecurityEnvironment {
  constructor(private readonly inheritedEnvironment: NodeJS.ProcessEnv) {}

  isolated(): NodeJS.ProcessEnv {
    const environment = { ...this.inheritedEnvironment };
    for (const name of Object.keys(environment)) {
      if (
        name === "GIT_CONFIG" ||
        name === "GIT_CONFIG_COUNT" ||
        name === "GIT_CONFIG_PARAMETERS" ||
        /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/u.test(name) ||
        name === "GIT_DIR" ||
        name === "GIT_WORK_TREE" ||
        name === "GIT_COMMON_DIR" ||
        name === "GIT_INDEX_FILE" ||
        name === "GIT_OBJECT_DIRECTORY" ||
        name === "GIT_ALTERNATE_OBJECT_DIRECTORIES" ||
        name === "GIT_NAMESPACE"
      ) {
        delete environment[name];
      }
    }
    return {
      ...environment,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_NO_REPLACE_OBJECTS: "1",
    };
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
