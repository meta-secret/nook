import { spawnSync } from 'node:child_process'
import { ResultKind, err, ok, type Result } from '../result.ts'

export type CommandOutput = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export function runCommand(
  command: string,
  args: readonly string[],
  cwd: string,
): Result<CommandOutput> {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: 'utf8',
    env: process.env,
  })
  if (result.error) {
    return err(`${command} failed to start: ${result.error.message}`)
  }
  const exitCode = typeof result.status === 'number' ? result.status : 1
  return ok({
    exitCode,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  })
}

export function runCommandOrThrow(
  command: string,
  args: readonly string[],
  cwd: string,
): CommandOutput {
  const result = runCommand(command, args, cwd)
  if (result.kind === ResultKind.Err) {
    throw new Error(result.message)
  }
  return result.value
}
