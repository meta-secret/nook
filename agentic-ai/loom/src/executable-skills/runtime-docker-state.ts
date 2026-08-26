import type { BoundedProcessOutput } from './source-analysis-process.ts';
import { throwExecutableSkillRuntimeFailure } from './runtime-failure.ts';

export type ExecutableSkillContainerState = {
  readonly exitCode: number;
  readonly oomKilled: boolean;
};

export function resolveExecutableSkillContainerState(
  output: BoundedProcessOutput,
): ExecutableSkillContainerState {
  const fields = output.stdout.trim().split('|');
  const oomKilled = fields[0] ?? '';
  const exitCode = fields[1] ?? '';
  if (
    output.exitCode !== 0 ||
    output.stderr !== '' ||
    fields.length !== 2 ||
    (oomKilled !== 'true' && oomKilled !== 'false') ||
    !/^[0-9]+$/u.test(exitCode)
  ) {
    const failureRequest = {
      error: 'Executable skill container state is invalid.',
    };
    throwExecutableSkillRuntimeFailure(failureRequest);
  }
  const state: ExecutableSkillContainerState = {
    exitCode: Number(exitCode),
    oomKilled: oomKilled === 'true',
  };
  return Object.freeze(state);
}
