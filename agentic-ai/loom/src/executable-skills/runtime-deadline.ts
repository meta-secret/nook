import {
  throwExecutableSkillRuntimeFailure,
  type ThrowExecutableSkillRuntimeFailureRequest,
} from './runtime-failure.ts';

export const MINIMUM_EXECUTABLE_SKILL_TOTAL_MILLISECONDS = 40_000;
export const MAXIMUM_EXECUTABLE_SKILL_TOTAL_MILLISECONDS = 5 * 60 * 1_000;

export type ExecutableSkillContainerDeadlineValidationRequest = {
  readonly deadlineExpiresAt: number;
  readonly now: number;
  readonly signalAborted: boolean;
};

export function assertExecutableSkillContainerDeadline(
  request: ExecutableSkillContainerDeadlineValidationRequest,
): void {
  try {
    const remaining = request.deadlineExpiresAt - request.now;
    if (
      !Number.isSafeInteger(request.deadlineExpiresAt) ||
      !Number.isSafeInteger(request.now) ||
      remaining < MINIMUM_EXECUTABLE_SKILL_TOTAL_MILLISECONDS ||
      remaining > MAXIMUM_EXECUTABLE_SKILL_TOTAL_MILLISECONDS ||
      request.signalAborted
    ) {
      throw new Error('Executable skill runtime deadline is invalid.');
    }
  } catch (error) {
    const failureRequest: ThrowExecutableSkillRuntimeFailureRequest = {
      error:
        error instanceof Error
          ? error
          : 'Executable skill runtime deadline validation failed.',
    };
    throwExecutableSkillRuntimeFailure(failureRequest);
  }
}
