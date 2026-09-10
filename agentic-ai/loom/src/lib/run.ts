import {
  spawnSync,
  type SpawnSyncOptionsWithStringEncoding,
} from 'node:child_process';

import { err, ok, type Result } from 'neverthrow';
import { LoomFailureCode } from '../loom-failure.ts';

const githubApiOutputBytes = 16 * 1024 * 1024;

export class HostCommand {
  constructor(private readonly input: RunCommandArgs) {}

  execute(): Result<CommandOutput, HostCommandFailure> {
    const { command, args, cwd, outputPolicy } = this.input;
    const options: SpawnSyncOptionsWithStringEncoding = {
      cwd,
      encoding: 'utf8',
      ...(outputPolicy === CommandOutputPolicy.GitHubApi
        ? { maxBuffer: githubApiOutputBytes }
        : {}),
    };
    let result;
    try {
      result = spawnSync(command, [...args], options);
    } catch {
      return err({
        code: LoomFailureCode.CommandFailedToStart,
        message: `${command} failed to start`,
      });
    }
    if (result.error) {
      return err({
        code: LoomFailureCode.CommandFailedToStart,
        message: `${command} failed to start`,
      });
    }
    return ok({
      exitCode: typeof result.status === 'number' ? result.status : 1,
      signaled: typeof result.signal === 'string',
      stdout: typeof result.stdout === 'string' ? result.stdout : '',
      stderr: typeof result.stderr === 'string' ? result.stderr : '',
    });
  }
}

export type CommandOutput = {
  readonly exitCode: number;
  readonly signaled: boolean;
  readonly stdout: string;
  readonly stderr: string;
};

export enum CommandOutputPolicy {
  GitHubApi = 'githubApi',
}

export type RunCommandArgs = {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly outputPolicy?: CommandOutputPolicy;
};

export type HostCommandFailure = {
  readonly code: LoomFailureCode.CommandFailedToStart;
  readonly message: string;
};
