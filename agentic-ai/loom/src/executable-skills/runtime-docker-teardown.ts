import {
  throwExecutableSkillRuntimeFailure,
  type ThrowExecutableSkillRuntimeFailureRequest,
} from './runtime-failure.ts';

export type ExecutableSkillResourceTeardownDependencies = {
  readonly assertContainerInventoryEmpty: () => Promise<void>;
  readonly confirmContainerRemoved: () => Promise<boolean>;
  readonly removeImage: () => Promise<void>;
};

export type ExecutableSkillResourceTeardownRequest = {
  readonly containerMayExist: boolean;
  readonly imageMayExist: boolean;
};

export type ExecuteExecutableSkillResourceTeardownWithDependenciesRequest = {
  readonly dependencies: ExecutableSkillResourceTeardownDependencies;
  readonly request: ExecutableSkillResourceTeardownRequest;
};

export async function executeExecutableSkillResourceTeardownWithDependencies(
  execution: ExecuteExecutableSkillResourceTeardownWithDependenciesRequest,
): Promise<void> {
  try {
    try {
      if (execution.request.containerMayExist) {
        let confirmed = false;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (await execution.dependencies.confirmContainerRemoved()) {
            confirmed = true;
            break;
          }
        }
        if (!confirmed) {
          throw new Error(
            'Executable skill container absence was not confirmed.',
          );
        }
        await execution.dependencies.assertContainerInventoryEmpty();
      }
    } finally {
      if (execution.request.imageMayExist) {
        await execution.dependencies.removeImage();
      }
    }
  } catch (error) {
    const failureRequest: ThrowExecutableSkillRuntimeFailureRequest = {
      error:
        error instanceof Error ? error : 'Executable skill teardown failed.',
    };
    throwExecutableSkillRuntimeFailure(failureRequest);
  }
}
