import {
  spawnSync,
  type SpawnSyncOptionsWithStringEncoding,
} from 'node:child_process';
import {
  LoomFailure,
  LoomFailureCode,
  LoomFailureDetailKind,
} from '../loom-failure.ts';

export type CommandOutput = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type RunCommandArgs = {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly maxOutputBytes?: number;
};

export function runCommand(input: RunCommandArgs): CommandOutput {
  const { command, args, cwd, maxOutputBytes } = input;
  const spawnOptions: SpawnSyncOptionsWithStringEncoding = {
    cwd,
    encoding: 'utf8',
  };
  if (typeof maxOutputBytes === 'number')
    spawnOptions.maxBuffer = maxOutputBytes;
  const result = spawnSync(command, [...args], spawnOptions);
  if (result.error) {
    const loomFailureArgs = {
      code: LoomFailureCode.CommandFailedToStart,
      detail: {
        kind: LoomFailureDetailKind.Text,
        text: `${command} failed to start: ${result.error.message}`,
      },
    };
    throw new LoomFailure(loomFailureArgs);
  }
  const exitCode = typeof result.status === 'number' ? result.status : 1;
  return {
    exitCode,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  };
}
