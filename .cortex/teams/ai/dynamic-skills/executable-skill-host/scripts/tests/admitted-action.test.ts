import { expect, test } from 'bun:test';
import {
  AdmittedSkillAction,
  ExecutableSkillActions,
} from '../src/skill-action-registry.ts';
import { ExecutableSkillYaml } from '../src/skill-yaml-codec.ts';

test('only a decoded action exposes execution', () => {
  const yaml = ExecutableSkillYaml.parseSkillYamlText(
    ExecutableSkillActions.defaultSkillBlueprint(),
  );
  if (!yaml.ok) throw new Error('Tools-list example must parse.');
  const decoded = ExecutableSkillActions.decodeSkillActionRequest(yaml.value);
  if (!decoded.ok) throw new Error(decoded.message);
  expect(decoded.request.execute()).toEqual(
    ExecutableSkillActions.listDiscoverableSkillActions(),
  );
  expect(
    ExecutableSkillActions.decodeSkillActionRequest({ invented: {} }).ok,
  ).toBe(false);
});

export class ForbiddenSkillAdmission {
  static uncheckedConstruction(): void {
    // @ts-expect-error Request DTOs do not carry executable admission.
    new AdmittedSkillAction({});
  }
}
