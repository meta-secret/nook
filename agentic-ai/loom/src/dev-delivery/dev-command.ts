import { spawnSync } from 'node:child_process';
import { err, ok, type Result } from 'neverthrow';

import {
  CommandExecutable,
  type CommandOutput,
  type CommandRequest,
  type CommandRunner,
  DevFailureKind,
  type DevFailure,
} from './dev-types.ts';

type ProcessOutput = string | Buffer | Uint8Array | null;

/** Owns the bounded host-process boundary for the dev delivery commands. */
export class ProcessCommandRunner implements CommandRunner {
  private static readonly maxOutputBytes = 16 * 1024 * 1024;

  run(request: CommandRequest): Result<CommandOutput, DevFailure> {
    const args =
      request.executable === CommandExecutable.Git
        ? [
            '-c',
            'core.hooksPath=/dev/null',
            '-c',
            'core.fsmonitor=false',
            '-c',
            'core.untrackedCache=false',
            '--literal-pathspecs',
            ...request.args,
          ]
        : [...request.args];
    try {
      const execution = spawnSync(request.executable, args, {
        cwd: request.workingDirectory,
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_CONFIG_NOSYSTEM: '1',
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

  private static text(value: ProcessOutput): string {
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
