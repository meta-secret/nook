import { spawnSync } from 'node:child_process';

import type {
  SpawnSyncOptionsWithBufferEncoding,
  SpawnSyncReturns,
} from 'node:child_process';

const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;
const PROCESS_LAUNCH_ENVIRONMENT_KEYS = [
  'COMSPEC',
  'PATH',
  'Path',
  'PATHEXT',
  'SYSTEMROOT',
  'SystemRoot',
  'WINDIR',
] as const;

export type GitCommandRequest = {
  readonly cwd: string;
  readonly args: readonly string[];
  readonly allowFailure?: boolean;
  readonly indexFile?: string;
  readonly commitTimestamp?: string;
};

export type GitCommandResult = {
  readonly exitCode: number;
  readonly stdout: Buffer;
  readonly stderr: string;
};

function minimalGitEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of PROCESS_LAUNCH_ENVIRONMENT_KEYS) {
    const value = process.env[name];
    if (typeof value === 'string') environment[name] = value;
  }
  environment.GIT_CONFIG_GLOBAL = '/dev/null';
  environment.GIT_CONFIG_NOSYSTEM = '1';
  environment.GIT_NO_REPLACE_OBJECTS = '1';
  environment.GIT_TERMINAL_PROMPT = '0';
  environment.LC_ALL = 'C';
  return environment;
}

export function runModuleDeliveryGit(
  request: GitCommandRequest,
): GitCommandResult {
  const args = [
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.untrackedCache=false',
    '--literal-pathspecs',
    ...request.args,
  ];
  const environment = minimalGitEnvironment();
  if (request.indexFile) environment.GIT_INDEX_FILE = request.indexFile;
  if (request.commitTimestamp) {
    if (!/^@[0-9]+ \+0000$/u.test(request.commitTimestamp)) {
      throw new Error('Git commit timestamp must be canonical UTC epoch time.');
    }
    environment.GIT_AUTHOR_DATE = request.commitTimestamp;
    environment.GIT_COMMITTER_DATE = request.commitTimestamp;
  }
  const options: SpawnSyncOptionsWithBufferEncoding = {
    cwd: request.cwd,
    env: environment,
    encoding: 'buffer',
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  };
  const execution: SpawnSyncReturns<Buffer> = spawnSync('git', args, options);
  const stdout = execution.stdout ?? Buffer.alloc(0);
  const stderr = (execution.stderr ?? Buffer.alloc(0)).toString('utf8').trim();
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

export function gitText(result: GitCommandResult): string {
  return result.stdout.toString('utf8').trim();
}
