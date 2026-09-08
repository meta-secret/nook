const remoteDecoder = `set -euo pipefail
encoded_program=
if ! IFS= read -r encoded_program || test -z "$encoded_program"; then
  echo "k0s worker restore: missing encoded program" >&2
  exit 2
fi
program_file="$(mktemp)"
cleanup() { rm -f "$program_file"; }
trap cleanup EXIT
if ! printf '%s' "$encoded_program" | base64 -d > "$program_file"; then
  echo "k0s worker restore: invalid encoded program" >&2
  exit 2
fi
if ! test -s "$program_file"; then
  echo "k0s worker restore: decoded program is empty" >&2
  exit 2
fi
bash -n "$program_file"
bash "$program_file" "$@"`;

export class WorkerRestoreTransportArguments {
  private constructor(
    readonly controller: string,
    readonly worker: string,
    readonly meshAddress: string,
    readonly arcTier: string,
    readonly encodedProgram: string,
  ) {}

  static parse(values: string[]): WorkerRestoreTransportArguments {
    if (values.length !== 5 || values.some((value) => value.length === 0)) {
      throw new Error(
        "usage: k0s-worker-restore-transport.ts <controller> <worker> <mesh-address> <arc-tier> <encoded-program>",
      );
    }
    return new WorkerRestoreTransportArguments(
      values[0],
      values[1],
      values[2],
      values[3],
      values[4],
    );
  }
}

export interface WorkerRestoreTransportWire {
  readonly arcTier: string;
  readonly meshAddress: string;
  readonly payload: string;
  readonly sshArguments: readonly string[];
}

export class WorkerRestoreTransport {
  static wire(
    argumentsValue: WorkerRestoreTransportArguments,
    token: string,
  ): WorkerRestoreTransportWire {
    if (token.length === 0) {
      throw new Error("k0s worker restore: missing worker token");
    }
    const remoteCommand = WorkerRestoreTransport.remoteCommand(argumentsValue);
    return {
      arcTier: argumentsValue.arcTier,
      meshAddress: argumentsValue.meshAddress,
      payload: `${argumentsValue.encodedProgram}\n${token}`,
      sshArguments: [
        "-o",
        "BatchMode=yes",
        "-J",
        argumentsValue.controller,
        argumentsValue.worker,
        remoteCommand,
      ],
    };
  }

  static async run(
    argumentsValue: WorkerRestoreTransportArguments,
  ): Promise<number> {
    const token = await Bun.stdin.text();
    const wire = WorkerRestoreTransport.wire(argumentsValue, token);
    const remoteCommand = WorkerRestoreTransport.remoteCommand(argumentsValue);
    const process = Bun.spawnSync({
      cmd: [
        "ssh",
        "-o",
        "BatchMode=yes",
        "-J",
        argumentsValue.controller,
        argumentsValue.worker,
        remoteCommand,
      ],
      stdin: new Blob([wire.payload]),
      stdout: "inherit",
      stderr: "inherit",
    });
    return process.exitCode;
  }

  private static remoteCommand(
    argumentsValue: WorkerRestoreTransportArguments,
  ): string {
    return [
      "bash",
      "-c",
      WorkerRestoreTransport.shellQuote(remoteDecoder),
      "bash",
      WorkerRestoreTransport.shellQuote(argumentsValue.meshAddress),
      WorkerRestoreTransport.shellQuote(argumentsValue.arcTier),
    ].join(" ");
  }

  private static shellQuote(value: string): string {
    return `'${value.replaceAll("'", `'"'"'`)}'`;
  }
}

if (import.meta.main) {
  try {
    const argumentsValue = WorkerRestoreTransportArguments.parse(
      process.argv.slice(2),
    );
    process.exit(await WorkerRestoreTransport.run(argumentsValue));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(2);
  }
}
