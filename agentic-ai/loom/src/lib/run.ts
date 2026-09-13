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
    const {
      command,
      rootDirectory,
      workingDirectory,
      outputPolicy,
    } = request;
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
    if (
      request.command === RepositoryCommandExecutable.Git &&
      request.gitSecurity === RepositoryGitSecurityPolicy.ImmutableObjects
    ) {
      options.env = new RepositoryGitSecurityEnvironment(process.env).isolated();
    }
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
    | RepositoryCommandExecutable.Git
  >;
  readonly args: readonly string[];
};

type RepositoryGitCommandRequest = RepositoryCommandLocation & {
  readonly command: RepositoryCommandExecutable.Git;
  readonly args: readonly string[];
  readonly gitSecurity?: RepositoryGitSecurityPolicy;
};

export type RepositoryCommandRequest =
  | RepositoryBashCommandRequest
  | RepositoryBunCommandRequest
  | RepositoryBunxCommandRequest
  | RepositoryNodeCommandRequest
  | RepositoryHostCommandRequest
  | RepositoryGitCommandRequest;

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

/** Restricts Git's object identity checks to the repository's actual objects. */
export enum RepositoryGitSecurityPolicy {
  ImmutableObjects = 'immutableObjects',
}

export type RepositoryCommandFailure = {
  readonly code: LoomFailureCode.CommandFailedToStart;
  readonly message: string;
};

export type HostCommandFailure = RepositoryCommandFailure;

/** Owns the Git environment boundary for immutable repository object checks. */
class RepositoryGitSecurityEnvironment {
  constructor(private readonly inheritedEnvironment: NodeJS.ProcessEnv) {}

  isolated(): NodeJS.ProcessEnv {
    const environment = { ...this.inheritedEnvironment };
    for (const name of Object.keys(environment)) {
      if (
        name === 'GIT_CONFIG' ||
        name === 'GIT_CONFIG_COUNT' ||
        name === 'GIT_CONFIG_PARAMETERS' ||
        /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/u.test(name) ||
        name === 'GIT_DIR' ||
        name === 'GIT_WORK_TREE' ||
        name === 'GIT_COMMON_DIR' ||
        name === 'GIT_INDEX_FILE' ||
        name === 'GIT_OBJECT_DIRECTORY' ||
        name === 'GIT_ALTERNATE_OBJECT_DIRECTORIES' ||
        name === 'GIT_NAMESPACE'
      ) {
        delete environment[name];
      }
    }
    return {
      ...environment,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_NO_REPLACE_OBJECTS: '1',
    };
  }
}
