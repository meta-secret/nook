import { EXECUTABLE_SKILL_CATALOG } from '../src/skill-action-registry.ts';
import { ok } from 'neverthrow';
import { expect, test } from 'bun:test';
import {
  AdmittedSkillAction,
  ExecutableSkillActions,
} from '../src/skill-action-registry.ts';
import { ExecutableSkillYaml } from '../src/skill-yaml-codec.ts';

test('only a decoded action exposes execution', () => {
  const yaml = ExecutableSkillYaml.from(
    EXECUTABLE_SKILL_CATALOG.example(),
  ).execute();
  expect(yaml.isOk()).toBe(true);
  if (!yaml.isOk()) return;
  const decoded = ExecutableSkillActions.from(yaml.value).execute();
  expect(decoded.isOk()).toBe(true);
  if (!decoded.isOk()) return;
  expect(decoded.value.execute()).toEqual(ok(EXECUTABLE_SKILL_CATALOG.list()));
  expect(ExecutableSkillActions.from({ invented: {} }).execute().isOk()).toBe(
    false,
  );
});

export class ForbiddenSkillAdmission {
  uncheckedConstruction(): void {
    // @ts-expect-error Request DTOs do not carry executable admission.
    new AdmittedSkillAction({});
  }
}
