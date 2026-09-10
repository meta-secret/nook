import {
  spawnSync,
  type SpawnSyncOptionsWithStringEncoding,
} from 'node:child_process';
import path from 'node:path';

import { err, ok, type Result } from 'neverthrow';
import { LoomFailureCode } from '../loom-failure.ts';

const githubApiOutputBytes = 16 * 1024 * 1024;
const defaultOutputBytes = 1024 * 1024;

export class RepositoryCommand {
  constructor(private readonly request: RepositoryCommandRequest) {}

  execute(): Result<CommandOutput, RepositoryCommandFailure> {
    const { command, args, rootDirectory, workingDirectory, outputPolicy } =
      this.request;
    const resolvedRoot = path.resolve(rootDirectory);
    const resolvedWorkingDirectory = path.resolve(workingDirectory);
    const relativeWorkingDirectory = path.relative(
      resolvedRoot,
      resolvedWorkingDirectory,
    );
    if (
      path.isAbsolute(relativeWorkingDirectory) ||
      relativeWorkingDirectory === '..' ||
      relativeWorkingDirectory.startsWith(`..${path.sep}`)
    ) {
      return err({
        code: LoomFailureCode.CommandFailedToStart,
        message: `${command} working directory is outside repository root`,
      });
    }
    const options: SpawnSyncOptionsWithStringEncoding = {
      cwd: resolvedWorkingDirectory,
      encoding: 'utf8',
      maxBuffer:
        outputPolicy === CommandOutputPolicy.GitHubApi
          ? githubApiOutputBytes
          : defaultOutputBytes,
    };
    let result;
    try {
      const commandArgs = [...args];
      switch (command) {
        case 'bash':
          result = spawnSync('bash', commandArgs, options);
          break;
        case 'bun':
          result = spawnSync('bun', commandArgs, options);
          break;
        case 'bunx':
          result = spawnSync('bunx', commandArgs, options);
          break;
        case 'cargo':
          result = spawnSync('cargo', commandArgs, options);
          break;
        case 'gh':
          result = spawnSync('gh', commandArgs, options);
          break;
        case 'git':
          result = spawnSync('git', commandArgs, options);
          break;
        case 'node':
          result = spawnSync('node', commandArgs, options);
          break;
        case 'task':
          result = spawnSync('task', commandArgs, options);
          break;
        case 'vale':
          result = spawnSync('vale', commandArgs, options);
          break;
      }
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

export type RepositoryCommandRequest = {
  readonly command: RepositoryCommandExecutable;
  readonly args: readonly string[];
  readonly rootDirectory: string;
  readonly workingDirectory: string;
  readonly outputPolicy?: CommandOutputPolicy;
};

export type RepositoryCommandExecutable =
  'bash' | 'bun' | 'bunx' | 'cargo' | 'gh' | 'git' | 'node' | 'task' | 'vale';

export type RepositoryCommandFailure = {
  readonly code: LoomFailureCode.CommandFailedToStart;
  readonly message: string;
};

export type HostCommandFailure = RepositoryCommandFailure;
