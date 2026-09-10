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
        case 'bash':
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
        case 'bun':
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
          }
          break;
        case 'bunx':
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
        case 'cargo':
          result = spawnSync('cargo', [...request.args], options);
          break;
        case 'gh':
          result = spawnSync('gh', [...request.args], options);
          break;
        case 'git':
          result = spawnSync('git', [...request.args], options);
          break;
        case 'node':
          switch (request.script) {
            case RepositoryNodeScript.TestFixture:
              result = spawnSync(
                'node',
                [
                  'agentic-ai/loom/tests/repository-command.fixture.cjs',
                  ...request.args,
                ],
                options,
              );
              break;
            case RepositoryNodeScript.WorkbenchPublish:
              result = spawnSync(
                'node',
                ['.github/scripts/workbench-publish.cjs', ...request.args],
                options,
              );
              break;
          }
          break;
        case 'task':
          result = spawnSync('task', [...request.args], options);
          break;
        case 'vale':
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
  readonly command: 'bun';
  readonly script: RepositoryBunScript;
  readonly args: readonly string[];
};

type RepositoryBashCommandRequest = RepositoryCommandLocation & {
  readonly command: 'bash';
  readonly script: RepositoryBashScript;
  readonly args: readonly string[];
};

type RepositoryBunxCommandRequest = RepositoryCommandLocation & {
  readonly command: 'bunx';
  readonly executable: RepositoryBunxExecutable;
  readonly args: readonly string[];
};

type RepositoryNodeCommandRequest = RepositoryCommandLocation & {
  readonly command: 'node';
  readonly script: RepositoryNodeScript;
  readonly args: readonly string[];
};

type RepositoryHostCommandRequest = RepositoryCommandLocation & {
  readonly command: Exclude<
    RepositoryCommandExecutable,
    'bash' | 'bun' | 'bunx' | 'node'
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
}

export enum RepositoryBunxExecutable {
  Playwright = 'playwright',
  Vitest = 'vitest',
}

export enum RepositoryNodeScript {
  TestFixture = 'testFixture',
  WorkbenchPublish = 'workbenchPublish',
}

export type RepositoryCommandExecutable =
  'bash' | 'bun' | 'bunx' | 'cargo' | 'gh' | 'git' | 'node' | 'task' | 'vale';

export type RepositoryCommandFailure = {
  readonly code: LoomFailureCode.CommandFailedToStart;
  readonly message: string;
};

export type HostCommandFailure = RepositoryCommandFailure;
