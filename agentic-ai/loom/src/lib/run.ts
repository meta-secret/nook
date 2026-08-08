import { spawnSync } from 'node:child_process';
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

export function runCommand(
  command: string,
  args: readonly string[],
  cwd: string,
): CommandOutput {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: 'utf8',
    env: process.env,
  });
  if (result.error) {
    throw new LoomFailure(LoomFailureCode.CommandFailedToStart, {
      kind: LoomFailureDetailKind.Text,
      text: `${command} failed to start: ${result.error.message}`,
    });
  }
  const exitCode = typeof result.status === 'number' ? result.status : 1;
  return {
    exitCode,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  };
}
