import { err, ok, type Result } from "neverthrow";
import { z } from "zod";

export enum OperationalContractFailureKind {
  Source = "source",
  Schema = "schema",
  Requirement = "requirement",
  Command = "command",
  Cleanup = "cleanup",
  Combined = "combined",
}
export type OperationalContractFailure =
  | {
      readonly kind: Exclude<
        OperationalContractFailureKind,
        OperationalContractFailureKind.Combined
      >;
      readonly message: string;
    }
  | {
      readonly kind: OperationalContractFailureKind.Combined;
      readonly message: string;
      readonly failures: readonly OperationalContractFailure[];
    };
export class OperationalContractSource {
  constructor(private readonly path: string) {}
  async read(): Promise<Result<string, OperationalContractFailure>> {
    try {
      return ok(await Bun.file(this.path).text());
    } catch {
      return err({
        kind: OperationalContractFailureKind.Source,
        message: `Unable to read ${this.path}`,
      });
    }
  }
}
export class OperationalYamlDocument {
  constructor(private readonly source: string) {}
  decode<T>(schema: z.ZodType<T>): Result<T, OperationalContractFailure> {
    let value: unknown;
    try {
      value = Bun.YAML.parse(this.source);
    } catch {
      return err({
        kind: OperationalContractFailureKind.Schema,
        message: "Operational manifest is not valid YAML",
      });
    }
    const admitted = schema.safeParse(value);
    return admitted.success
      ? ok(admitted.data)
      : err({
          kind: OperationalContractFailureKind.Schema,
          message: "Operational manifest has an invalid schema",
        });
  }
}
export interface OperationalProbeOutcome {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}
export enum OperationalProbeStream {
  Ignore = "ignore",
  Pipe = "pipe",
  Inherit = "inherit",
}
enum OperationalProbeExecutable {
  Awk = "awk",
  Bash = "bash",
  Jq = "jq",
}
interface OperationalSpawnRequest {
  readonly executable: string;
  readonly args: string[];
}
export class OperationalShellProbe {
  constructor(private readonly source: string) {}
  execute(): Result<OperationalProbeOutcome, OperationalContractFailure> {
    try {
      const outcome = Bun.spawnSync({
        cmd: ["bash"],
        stdin: new Blob([this.source]),
        stdout: OperationalProbeStream.Pipe,
        stderr: OperationalProbeStream.Pipe,
      });
      return ok({
        exitCode: outcome.exitCode,
        stdout: outcome.stdout ? outcome.stdout.toString() : "",
        stderr: outcome.stderr ? outcome.stderr.toString() : "",
      });
    } catch {
      return err({
        kind: OperationalContractFailureKind.Command,
        message: "Unable to execute operational contract shell probe",
      });
    }
  }
}
export class OperationalCommandProbe {
  constructor(
    private readonly request: {
      cmd: string[];
      stdin?: Blob;
      env?: Record<string, string>;
      stdout: OperationalProbeStream;
      stderr: OperationalProbeStream;
    },
  ) {}
  private spawn(request: OperationalSpawnRequest) {
    const stdin =
      this.request.stdin instanceof Blob
        ? this.request.stdin
        : OperationalProbeStream.Ignore;
    switch (request.executable) {
      case OperationalProbeExecutable.Awk:
        return Bun.spawnSync({
          cmd: ["awk", ...request.args],
          stdin,
          stdout: this.request.stdout,
          stderr: this.request.stderr,
        });
      case OperationalProbeExecutable.Bash:
        return Bun.spawnSync({
          cmd: ["bash", ...request.args],
          stdin,
          stdout: this.request.stdout,
          stderr: this.request.stderr,
        });
      case OperationalProbeExecutable.Jq:
        return Bun.spawnSync({
          cmd: ["jq", ...request.args],
          stdin,
          stdout: this.request.stdout,
          stderr: this.request.stderr,
        });
      default:
        return request.executable.endsWith(".rb")
          ? Bun.spawnSync({
              cmd: ["ruby", request.executable, ...request.args],
              stdin,
              stdout: this.request.stdout,
              stderr: this.request.stderr,
            })
          : Bun.spawnSync({
              cmd: ["bash", request.executable, ...request.args],
              stdin,
              stdout: this.request.stdout,
              stderr: this.request.stderr,
            });
    }
  }
  execute(): Result<OperationalProbeOutcome, OperationalContractFailure> {
    const [executable, ...args] = this.request.cmd;
    if (!executable)
      return err({
        kind: OperationalContractFailureKind.Command,
        message: "Unable to execute empty operational contract command",
      });
    const originalEnvironment = new Map<string, string>();
    for (const [key, value] of Object.entries(process.env))
      if (typeof value === "string") originalEnvironment.set(key, value);
    try {
      if (this.request.env) Object.assign(process.env, this.request.env);
      const outcome = this.spawn({ executable, args });
      return ok({
        exitCode: outcome.exitCode,
        stdout: outcome.stdout ? outcome.stdout.toString() : "",
        stderr: outcome.stderr ? outcome.stderr.toString() : "",
      });
    } catch {
      return err({
        kind: OperationalContractFailureKind.Command,
        message: "Unable to execute operational contract command",
      });
    } finally {
      for (const key of Object.keys(process.env)) delete process.env[key];
      for (const [key, value] of originalEnvironment) process.env[key] = value;
    }
  }
}
