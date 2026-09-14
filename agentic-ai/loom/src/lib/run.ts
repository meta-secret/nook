import {
  spawnSync,
  type SpawnSyncOptionsWithStringEncoding,
} from 'node:child_process';
import path from 'node:path';

import { err, ok, type Result } from 'neverthrow';
import { LoomFailureCode } from '../loom-failure.ts';

const githubApiOutputBytes = 16 * 1024 * 1024;
const defaultOutputBytes = 1024 * 1024;
const IMMUTABLE_GIT_ARGUMENTS = [
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.untrackedCache=false',
  '-c',
  'core.gitProxy=none',
  '-c',
  'core.attributesFile=/dev/null',
  '-c',
  'core.excludesFile=/dev/null',
  '-c',
  'core.sshCommand=',
  '-c',
  'credential.helper=',
  '-c',
  'filter.lfs.clean=',
  '-c',
  'filter.lfs.process=',
  '-c',
  'filter.lfs.required=false',
  '-c',
  'filter.lfs.smudge=',
  '-c',
  'http.proxy=',
  '-c',
  'http.noProxy=',
  '-c',
  'https.proxy=',
  '-c',
  'https.noProxy=',
  '-c',
  'protocol.allow=never',
  '-c',
  'protocol.ext.allow=never',
  '-c',
  'protocol.file.allow=never',
  '-c',
  'protocol.ftp.allow=never',
  '-c',
  'protocol.ftps.allow=never',
  '-c',
  'protocol.git.allow=never',
  '-c',
  'protocol.http.allow=never',
  '-c',
  'protocol.ssh.allow=never',
  '-c',
  'protocol.https.allow=never',
  '-c',
  'diff.external=',
  '-c',
  'core.pager=',
  '--no-pager',
  '--no-replace-objects',
  '--literal-pathspecs',
] as const;

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
    let args: readonly string[] = request.args;
    if (
      request.command === RepositoryCommandExecutable.Git &&
      request.gitSecurity === RepositoryGitSecurityPolicy.ImmutableObjects
    ) {
      const validation = ImmutableGitCommandPolicy.validate(request.args);
      if (validation.isErr()) return err(validation.error);
      options.env = new RepositoryGitSecurityEnvironment(
        process.env,
      ).isolated();
      args = [...IMMUTABLE_GIT_ARGUMENTS, ...validation.value];
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
          result = spawnSync('git', [...args], options);
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

/** Runs Git reads with the repository's immutable no-execution policy. */
export enum RepositoryGitSecurityPolicy {
  ImmutableObjects = 'immutableObjects',
}

export type RepositoryCommandFailure = {
  readonly code: LoomFailureCode.CommandFailedToStart;
  readonly message: string;
};

export type HostCommandFailure = RepositoryCommandFailure;

/** Owns the closed read-only command vocabulary for immutable Git checks. */
class ImmutableGitCommandPolicy {
  static validate(
    args: readonly string[],
  ): Result<readonly string[], RepositoryCommandFailure> {
    const [command = '', ...arguments_] = args;
    const valid =
      (command === 'merge-base' &&
        arguments_.length === 3 &&
        arguments_[0] === '--is-ancestor' &&
        ImmutableGitCommandPolicy.isRevision(arguments_[1]) &&
        ImmutableGitCommandPolicy.isRevision(arguments_[2])) ||
      (command === 'rev-parse' &&
        ((arguments_.length === 1 &&
          ImmutableGitCommandPolicy.isRevision(arguments_[0])) ||
          (arguments_.length === 2 &&
            arguments_[0] === '--verify' &&
            ImmutableGitCommandPolicy.isRevision(arguments_[1])))) ||
      (command === 'status' &&
        arguments_.length === 2 &&
        arguments_[0] === '--porcelain' &&
        arguments_[1] === '--untracked-files=normal');
    if (valid) return ok([...args]);
    return err({
      code: LoomFailureCode.CommandFailedToStart,
      message:
        'Immutable Git policy permits only validated read commands without caller configuration.',
    });
  }

  private static isRevision(value: string | undefined): boolean {
    return (
      value !== undefined &&
      /^(?:[0-9a-f]{40}|HEAD(?:\^\{commit\})?|refs\/remotes\/origin\/main\^\{commit\})$/u.test(
        value,
      )
    );
  }
}

/** Owns the Git environment boundary for immutable repository object checks. */
class RepositoryGitSecurityEnvironment {
  constructor(private readonly inheritedEnvironment: NodeJS.ProcessEnv) {}

  isolated(): NodeJS.ProcessEnv {
    const environment = this.inheritedEnvironment;
    const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
    return {
      COMSPEC: environment.COMSPEC,
      LC_ALL: 'C',
      PATH: environment.PATH,
      Path: environment.Path,
      PATHEXT: environment.PATHEXT,
      SYSTEMROOT: environment.SYSTEMROOT,
      SystemRoot: environment.SystemRoot,
      WINDIR: environment.WINDIR,
      GIT_ALLOW_PROTOCOL: '',
      GIT_ATTR_NOSYSTEM: '1',
      GIT_CONFIG: nullDevice,
      GIT_CONFIG_GLOBAL: nullDevice,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_SYSTEM: nullDevice,
      GIT_NO_REPLACE_OBJECTS: '1',
      GIT_OPTIONAL_LOCKS: '0',
      GIT_PAGER: '',
      GIT_TERMINAL_PROMPT: '0',
    };
  }
}
