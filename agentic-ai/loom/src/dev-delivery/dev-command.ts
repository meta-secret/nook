import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { err, ok, type Result } from 'neverthrow';

import {
  CommandExecutable,
  type CommandOutput,
  type CommandRequest,
  type CommandRunner,
  DevFailureKind,
  type DevFailure,
} from './dev-types.ts';

/** Owns the bounded host-process boundary for the dev delivery commands. */
export class ProcessCommandRunner implements CommandRunner {
  private static readonly maxOutputBytes = 16 * 1024 * 1024;

  private static readonly canonicalRemoteUrl =
    'https://github.com/meta-secret/nook.git';

  private static readonly gitOptions = [
    '-c',
    'core.attributesFile=/dev/null',
    '-c',
    'core.askPass=',
    '-c',
    'core.excludesFile=/dev/null',
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.gitProxy=none',
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'core.sshCommand=',
    '-c',
    'core.untrackedCache=false',
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
    'protocol.https.allow=always',
    '--no-pager',
    '--no-replace-objects',
    '--literal-pathspecs',
  ] as const;

  run(request: CommandRequest): Result<CommandOutput, DevFailure> {
    const git = request.executable === CommandExecutable.Git;
    const remoteOperation =
      git && ProcessCommandRunner.isRemoteOperation(request.args);
    const argsResult = git
      ? ProcessCommandRunner.gitArguments(request.args, remoteOperation)
      : ok<readonly string[], DevFailure>([...request.args]);
    if (argsResult.isErr()) return err(argsResult.error);
    const args = argsResult.value;
    if (remoteOperation) {
      const localConfig = ProcessCommandRunner.requireSafeLocalConfig(
        request.workingDirectory,
      );
      if (localConfig.isErr()) return err(localConfig.error);
    }
    try {
      const execution = spawnSync(request.executable, args, {
        cwd: request.workingDirectory,
        encoding: 'utf8',
        env: git
          ? ProcessCommandRunner.gitEnvironment(remoteOperation)
          : {
              ...process.env,
              GIT_TERMINAL_PROMPT: '0',
              LC_ALL: 'C',
            },
        maxBuffer: ProcessCommandRunner.maxOutputBytes,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const stdout = ProcessCommandRunner.text(execution.stdout);
      const stderr = ProcessCommandRunner.text(execution.stderr);
      const exitCode =
        typeof execution.status === 'number' ? execution.status : 1;
      if (execution.error) {
        return err({
          kind: DevFailureKind.Command,
          message: `${request.executable} could not start: ${execution.error.message}`,
        });
      }
      return ok({ exitCode, stdout, stderr });
    } catch {
      return err({
        kind: DevFailureKind.Command,
        message: `${request.executable} command invocation failed`,
      });
    }
  }

  private static isRemoteOperation(args: readonly string[]): boolean {
    const command = args.at(0);
    return command === 'fetch' || command === 'ls-remote' || command === 'push';
  }

  private static gitArguments(
    requestArgs: readonly string[],
    remoteOperation: boolean,
  ): Result<readonly string[], DevFailure> {
    if (!remoteOperation)
      return ok([...ProcessCommandRunner.gitOptions, ...requestArgs]);
    const args = [...requestArgs];
    const remoteIndex = args.findIndex(
      (argument, index) =>
        index > 0 &&
        (argument === 'origin' ||
          argument === ProcessCommandRunner.canonicalRemoteUrl),
    );
    if (remoteIndex < 0)
      return err({
        kind: DevFailureKind.Configuration,
        message: 'Git delivery requires the admitted canonical origin remote',
      });
    args[remoteIndex] = ProcessCommandRunner.canonicalRemoteUrl;
    const command = args.at(0);
    if (command === 'fetch') {
      const hasExplicitRefspec = args
        .slice(remoteIndex + 1)
        .some((argument) => !argument.startsWith('-'));
      if (!hasExplicitRefspec)
        args.push('+refs/heads/*:refs/remotes/origin/*');
    }
    if (command === 'push' && !args.includes('--no-verify'))
      args.splice(1, 0, '--no-verify');
    const credential = process.env.NOOK_GITHUB_PAT?.trim();
    const credentialOption =
      credential && !/[\u0000\r\n]/u.test(credential)
        ? ['--config-env=http.https://github.com/.extraheader=NOOK_GIT_EXTRAHEADER']
        : [];
    return ok([
      ...ProcessCommandRunner.gitOptions,
      ...credentialOption,
      ...args,
    ]);
  }

  private static gitEnvironment(remoteOperation: boolean): NodeJS.ProcessEnv {
    const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
    const environment: NodeJS.ProcessEnv = {
      COMSPEC: process.env.COMSPEC,
      PATH: process.env.PATH,
      Path: process.env.Path,
      PATHEXT: process.env.PATHEXT,
      SYSTEMROOT: process.env.SYSTEMROOT,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      TMPDIR: process.env.TMPDIR,
      WINDIR: process.env.WINDIR,
      GIT_ALLOW_PROTOCOL: 'https',
      GIT_ATTR_NOSYSTEM: '1',
      GIT_CONFIG: nullDevice,
      GIT_CONFIG_GLOBAL: nullDevice,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_SYSTEM: nullDevice,
      GIT_NO_REPLACE_OBJECTS: '1',
      GIT_OPTIONAL_LOCKS: '0',
      GIT_PAGER: '',
      GIT_TERMINAL_PROMPT: '0',
      LC_ALL: 'C',
    };
    if (remoteOperation) {
      const credential = process.env.NOOK_GITHUB_PAT?.trim();
      if (credential && !/[\u0000\r\n]/u.test(credential))
        environment.NOOK_GIT_EXTRAHEADER = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${credential}`).toString('base64')}`;
    }
    return environment;
  }

  private static requireSafeLocalConfig(
    workingDirectory: string,
  ): Result<void, DevFailure> {
    let inspection: SpawnSyncReturns<string | Buffer>;
    try {
      inspection = spawnSync(
        'git',
        [
          '-C',
          workingDirectory,
          'config',
          '--local',
          '--no-includes',
          '--name-only',
          '--get-regexp',
          '.*',
        ],
        {
          cwd: workingDirectory,
          encoding: 'utf8',
          env: ProcessCommandRunner.localConfigEnvironment(),
          maxBuffer: ProcessCommandRunner.maxOutputBytes,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
    } catch {
      return err({
        kind: DevFailureKind.Command,
        message: 'Git local configuration inspection failed',
      });
    }
    if (inspection.error)
      return err({
        kind: DevFailureKind.Command,
        message: 'Git local configuration inspection failed',
      });
    if (typeof inspection.status !== 'number' || inspection.status > 1)
      return err({
        kind: DevFailureKind.Configuration,
        message: 'Git local configuration could not be safely inspected',
      });
    const text = ProcessCommandRunner.text(inspection.stdout);
    if (
      text
        .split(/\r?\n/u)
        .some((key) => ProcessCommandRunner.isUnsafeConfigKey(key))
    )
      return err({
        kind: DevFailureKind.Configuration,
        message: 'Git delivery refused unsafe repository-local configuration',
      });
    return ok();
  }

  private static localConfigEnvironment(): NodeJS.ProcessEnv {
    const environment = ProcessCommandRunner.gitEnvironment(false);
    delete environment.GIT_CONFIG;
    return environment;
  }

  private static isUnsafeConfigKey(key: string): boolean {
    const normalized = key.trim().toLowerCase();
    return (
      /^include(?:if\..+)?\.path$/u.test(normalized) ||
      /^url\..+\.(?:insteadof|pushinsteadof|instead-of)$/u.test(normalized) ||
      /^https?\..*(?:proxy|extraheader|ssl|cookie)$/u.test(
        normalized,
      ) ||
      /^credential(?:\..*)?\.helper$/u.test(normalized) ||
      /^core\.(?:askpass|gitproxy|sshcommand)$/u.test(normalized) ||
      /^filter\..+\.(?:clean|process|required|smudge)$/u.test(normalized) ||
      /^protocol\..+$/u.test(normalized) ||
      /^remote\..+\.(?:pushurl|proxy|receivepack|uploadpack)$/u.test(
        normalized,
      ) ||
      /^pager\..*$/u.test(normalized)
    );
  }

  private static text(
    value: SpawnSyncReturns<string | Buffer>['stdout'],
  ): string {
    return typeof value === 'string'
      ? value
      : value instanceof Buffer
        ? value.toString('utf8')
        : '';
  }
}

export class CommandFailureMessage {
  constructor(private readonly request: CommandOutput) {}

  text(): string {
    const detail = this.request.stderr.trim() || this.request.stdout.trim();
    return detail || `command exited with status ${this.request.exitCode}`;
  }
}
