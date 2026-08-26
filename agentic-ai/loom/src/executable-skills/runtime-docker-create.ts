export type ExecutableSkillContainerCreationDependencies = {
  readonly create: () => Promise<void>;
  readonly markContainerMayExist: () => void;
};

export async function attemptExecutableSkillContainerCreation(
  dependencies: ExecutableSkillContainerCreationDependencies,
): Promise<void> {
  dependencies.markContainerMayExist();
  await dependencies.create();
}
