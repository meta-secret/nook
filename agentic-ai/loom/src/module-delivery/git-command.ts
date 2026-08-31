import { spawnSync } from 'node:child_process';

import type { SpawnSyncOptions } from 'node:child_process';

const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_GIT_ARGUMENTS = 1024;
const MAX_GIT_ARGUMENT_BYTES = 1024 * 1024;

export type GitCommandRequest = {
  readonly cwd: string;
  readonly args: readonly string[];
  readonly allowFailure?: boolean;
  readonly indexFile?: string;
  readonly commitTimestamp?: string;
  readonly input?: string;
  readonly environment?: GitCommandEnvironment;
};

type GitEnvironmentKey =
  | 'COMSPEC'
  | 'PATH'
  | 'Path'
  | 'PATHEXT'
  | 'SYSTEMROOT'
  | 'SystemRoot'
  | 'WINDIR';

export type GitCommandEnvironment = Readonly<
  Partial<Record<GitEnvironmentKey, string>>
>;

export type GitCommandResult = {
  readonly exitCode: number;
  readonly stdout: Buffer;
  readonly stderr: string;
};

export function runModuleDeliveryGit(
  request: GitCommandRequest,
): GitCommandResult {
  if (
    request.commitTimestamp &&
    !/^@[0-9]+ \+0000$/u.test(request.commitTimestamp)
  )
    throw new Error('Git commit timestamp must be canonical UTC epoch time.');
  const environment = request.environment ?? moduleDeliveryGitEnvironment();
  for (const searchPath of [environment.PATH, environment.Path])
    if (typeof searchPath === 'string')
      assertAbsoluteExecutableSearchPath(searchPath);
  const args = [
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.untrackedCache=false',
    '--literal-pathspecs',
  ];
  if (request.args.length > MAX_GIT_ARGUMENTS)
    throw new Error('Git command arguments exceed bounded input.');
  let argumentBytes = 0;
  for (const argument of request.args) {
    argumentBytes += Buffer.byteLength(argument);
    if (argumentBytes > MAX_GIT_ARGUMENT_BYTES)
      throw new Error('Git command arguments exceed bounded input.');
    args.push(argument);
  }
  const options: SpawnSyncOptions = {
    cwd: request.cwd,
    env: {
      COMSPEC: environment.COMSPEC,
      GIT_AUTHOR_DATE: request.commitTimestamp,
      GIT_COMMITTER_DATE: request.commitTimestamp,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_INDEX_FILE: request.indexFile,
      GIT_NO_REPLACE_OBJECTS: '1',
      GIT_TERMINAL_PROMPT: '0',
      LC_ALL: 'C',
      PATH: environment.PATH,
      Path: environment.Path,
      PATHEXT: environment.PATHEXT,
      SYSTEMROOT: environment.SYSTEMROOT,
      SystemRoot: environment.SystemRoot,
      WINDIR: environment.WINDIR,
    },
    ...(typeof request.input === 'string'
      ? { input: Buffer.from(request.input, 'utf8') }
      : {}),
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    stdio: ['pipe', 'pipe', 'pipe'],
  };
  const execution = spawnSync('git', args, options);
  const stdout = Buffer.isBuffer(execution.stdout)
    ? execution.stdout
    : Buffer.from(execution.stdout ?? '', 'utf8');
  const stderr = Buffer.from(execution.stderr ?? '')
    .toString('utf8')
    .trim();
  const exitCode = execution.status ?? -1;
  if (execution.error) {
    throw new Error(`Git could not start: ${execution.error.message}`);
  }
  if (exitCode !== 0 && request.allowFailure !== true) {
    const detail = stderr.length > 0 ? `: ${stderr}` : '';
    throw new Error(`Git command failed (${exitCode})${detail}`);
  }
  return { exitCode, stdout, stderr };
}

export function moduleDeliveryGitEnvironment(): GitCommandEnvironment {
  const environment: Partial<Record<GitEnvironmentKey, string>> = {};
  const keys: readonly GitEnvironmentKey[] = [
    'COMSPEC',
    'PATH',
    'Path',
    'PATHEXT',
    'SYSTEMROOT',
    'SystemRoot',
    'WINDIR',
  ];
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === 'string') environment[key] = value;
  }
  return environment;
}

function assertAbsoluteExecutableSearchPath(value: string): void {
  const windows = process.platform === 'win32';
  const separator = windows ? ';' : ':';
  for (const entry of value.split(separator))
    if (
      windows
        ? !entry.startsWith('\\\\') && !/^[A-Za-z]:[\\/]/.test(entry)
        : !entry.startsWith('/')
    )
      throw new Error(
        'Git executable search path must contain absolute paths.',
      );
}

export function gitText(result: GitCommandResult): string {
  return result.stdout.toString('utf8').trim();
}
