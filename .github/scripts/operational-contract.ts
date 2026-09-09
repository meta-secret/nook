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
export class OperationalShellProbe {
  constructor(private readonly source: string) {}
  execute(): Result<OperationalProbeOutcome, OperationalContractFailure> {
    try {
      const outcome = Bun.spawnSync({
        cmd: ["bash"],
        stdin: new Blob([this.source]),
        stdout: "pipe",
        stderr: "pipe",
      });
      return ok({
        exitCode: outcome.exitCode,
        stdout: outcome.stdout.toString(),
        stderr: outcome.stderr.toString(),
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
      stdout: "pipe";
      stderr: "pipe";
    },
  ) {}
  execute(): Result<OperationalProbeOutcome, OperationalContractFailure> {
    try {
      const outcome = Bun.spawnSync(this.request);
      return ok({
        exitCode: outcome.exitCode,
        stdout: outcome.stdout.toString(),
        stderr: outcome.stderr.toString(),
      });
    } catch {
      return err({
        kind: OperationalContractFailureKind.Command,
        message: "Unable to execute operational contract command",
      });
    }
  }
}
