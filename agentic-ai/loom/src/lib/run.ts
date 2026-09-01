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

export enum CommandOutputPolicy {
  GitHubApi = 'githubApi',
}

const GITHUB_API_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

export type RunCommandArgs = {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly outputPolicy?: CommandOutputPolicy;
};

export function runCommand(input: RunCommandArgs): CommandOutput {
  const { command, args, cwd, outputPolicy } = input;
  const defaultOptions: SpawnSyncOptionsWithStringEncoding = {
    cwd,
    encoding: 'utf8',
  };
  const githubApiOptions: SpawnSyncOptionsWithStringEncoding = {
    cwd,
    encoding: 'utf8',
    maxBuffer: GITHUB_API_MAX_OUTPUT_BYTES,
  };
  const result =
    outputPolicy === CommandOutputPolicy.GitHubApi
      ? spawnSync(command, [...args], githubApiOptions)
      : spawnSync(command, [...args], defaultOptions);
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
