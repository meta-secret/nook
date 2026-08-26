import { expect, test } from 'bun:test';
import {
  attemptExecutableSkillContainerCreation,
  type ExecutableSkillContainerCreationDependencies,
} from '../../src/executable-skills/runtime-docker-create.ts';

test('marks ambiguous container ownership before awaiting create', async () => {
  let containerMayExist = false;
  const dependencies: ExecutableSkillContainerCreationDependencies = {
    create: async () => {
      expect(containerMayExist).toBe(true);
      throw new Error('client lost the create response');
    },
    markContainerMayExist: () => {
      containerMayExist = true;
    },
  };

  await expect(
    attemptExecutableSkillContainerCreation(dependencies),
  ).rejects.toThrow('client lost the create response');
  expect(containerMayExist).toBe(true);
});
