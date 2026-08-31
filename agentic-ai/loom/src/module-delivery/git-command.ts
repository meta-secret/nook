import { spawnSync } from 'node:child_process';

import type {
  SpawnSyncOptionsWithBufferEncoding,
  SpawnSyncReturns,
} from 'node:child_process';

const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_GIT_ARGUMENTS = 1024;
const MAX_GIT_ARGUMENT_BYTES = 1024 * 1024;

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

export function runModuleDeliveryGit(
  request: GitCommandRequest,
): GitCommandResult {
  if (
    request.commitTimestamp &&
    !/^@[0-9]+ \+0000$/u.test(request.commitTimestamp)
  )
    throw new Error('Git commit timestamp must be canonical UTC epoch time.');
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
  const options: SpawnSyncOptionsWithBufferEncoding = {
    cwd: request.cwd,
    env: {
      COMSPEC: process.env.COMSPEC,
      GIT_AUTHOR_DATE: request.commitTimestamp,
      GIT_COMMITTER_DATE: request.commitTimestamp,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_INDEX_FILE: request.indexFile,
      GIT_NO_REPLACE_OBJECTS: '1',
      GIT_TERMINAL_PROMPT: '0',
      LC_ALL: 'C',
      PATH: process.env.PATH,
      Path: process.env.Path,
      PATHEXT: process.env.PATHEXT,
      SYSTEMROOT: process.env.SYSTEMROOT,
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR,
    },
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
