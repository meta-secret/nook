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
    const request = this.request;
    const { command, rootDirectory, workingDirectory, outputPolicy } = request;
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
      switch (command) {
        case RepositoryCommandExecutable.Bash:
          switch (request.script) {
            case RepositoryBashScript.UiDemoContract:
              result = spawnSync(
                'bash',
                ['.github/scripts/ui-demo-contract.sh', ...request.args],
                options,
              );
              break;
          }
          break;
        case RepositoryCommandExecutable.Bun:
          switch (request.script) {
            case RepositoryBunScript.Loom:
              result = spawnSync(
                'bun',
                [
                  'run',
                  '--cwd',
                  'agentic-ai/loom',
                  'loom',
                  '--',
                  ...request.args,
                ],
                options,
              );
              break;
            case RepositoryBunScript.TestFixture:
              result = spawnSync(
                'bun',
                [
                  'agentic-ai/loom/tests/repository-command.fixture.cjs',
                  ...request.args,
                ],
                options,
              );
              break;
          }
          break;
        case RepositoryCommandExecutable.Bunx:
          switch (request.executable) {
            case RepositoryBunxExecutable.Playwright:
              result = spawnSync(
                'bunx',
                ['playwright', ...request.args],
                options,
              );
              break;
            case RepositoryBunxExecutable.Vitest:
              result = spawnSync('bunx', ['vitest', ...request.args], options);
              break;
          }
          break;
        case RepositoryCommandExecutable.Cargo:
          result = spawnSync('cargo', [...request.args], options);
          break;
        case RepositoryCommandExecutable.GitHub:
          result = spawnSync('gh', [...request.args], options);
          break;
        case RepositoryCommandExecutable.Git:
          result = spawnSync('git', [...request.args], options);
          break;
        case RepositoryCommandExecutable.Node:
          switch (request.script) {
            case RepositoryNodeScript.WorkbenchPublish:
              result = spawnSync(
                'node',
                ['.github/scripts/workbench-publish.cjs', ...request.args],
                options,
              );
              break;
          }
          break;
        case RepositoryCommandExecutable.Task:
          result = spawnSync('task', [...request.args], options);
          break;
        case RepositoryCommandExecutable.Vale:
          result = spawnSync('vale', [...request.args], options);
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

type RepositoryCommandLocation = {
  readonly rootDirectory: string;
  readonly workingDirectory: string;
  readonly outputPolicy?: CommandOutputPolicy;
};

type RepositoryBunCommandRequest = RepositoryCommandLocation & {
  readonly command: RepositoryCommandExecutable.Bun;
  readonly script: RepositoryBunScript;
  readonly args: readonly string[];
};

type RepositoryBashCommandRequest = RepositoryCommandLocation & {
  readonly command: RepositoryCommandExecutable.Bash;
  readonly script: RepositoryBashScript;
  readonly args: readonly string[];
};

type RepositoryBunxCommandRequest = RepositoryCommandLocation & {
  readonly command: RepositoryCommandExecutable.Bunx;
  readonly executable: RepositoryBunxExecutable;
  readonly args: readonly string[];
};

type RepositoryNodeCommandRequest = RepositoryCommandLocation & {
  readonly command: RepositoryCommandExecutable.Node;
  readonly script: RepositoryNodeScript;
  readonly args: readonly string[];
};

type RepositoryHostCommandRequest = RepositoryCommandLocation & {
  readonly command: Exclude<
    RepositoryCommandExecutable,
    | RepositoryCommandExecutable.Bash
    | RepositoryCommandExecutable.Bun
    | RepositoryCommandExecutable.Bunx
    | RepositoryCommandExecutable.Node
  >;
  readonly args: readonly string[];
};

export type RepositoryCommandRequest =
  | RepositoryBashCommandRequest
  | RepositoryBunCommandRequest
  | RepositoryBunxCommandRequest
  | RepositoryNodeCommandRequest
  | RepositoryHostCommandRequest;

export enum RepositoryBashScript {
  UiDemoContract = 'uiDemoContract',
}

export enum RepositoryBunScript {
  Loom = 'loom',
  TestFixture = 'testFixture',
}

export enum RepositoryBunxExecutable {
  Playwright = 'playwright',
  Vitest = 'vitest',
}

export enum RepositoryNodeScript {
  WorkbenchPublish = 'workbenchPublish',
}

export enum RepositoryCommandExecutable {
  Bash = 'bash',
  Bun = 'bun',
  Bunx = 'bunx',
  Cargo = 'cargo',
  GitHub = 'gh',
  Git = 'git',
  Node = 'node',
  Task = 'task',
  Vale = 'vale',
}

export type RepositoryCommandFailure = {
  readonly code: LoomFailureCode.CommandFailedToStart;
  readonly message: string;
};

export type HostCommandFailure = RepositoryCommandFailure;
