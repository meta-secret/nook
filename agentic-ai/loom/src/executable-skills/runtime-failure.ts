import {
  LoomFailure,
  LoomFailureCode,
  loomFailureDetail,
} from '../loom-failure.ts';

export type ThrowExecutableSkillRuntimeFailureRequest = {
  readonly error: Error | string;
};

export function throwExecutableSkillRuntimeFailure(
  request: ThrowExecutableSkillRuntimeFailureRequest,
): never {
  if (request.error instanceof LoomFailure) throw request.error;
  const failureRequest = {
    code: LoomFailureCode.ExecutableSkillRuntimeFailed,
    text:
      request.error instanceof Error ? request.error.message : request.error,
  };
  loomFailureDetail(failureRequest);
}
