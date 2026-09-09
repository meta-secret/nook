import { ok } from 'neverthrow';
import { expect, test } from 'bun:test';
import {
  AdmittedSkillAction,
  ExecutableSkillActions,
} from '../src/skill-action-registry.ts';
import { ExecutableSkillYaml } from '../src/skill-yaml-codec.ts';

test('only a decoded action exposes execution', () => {
  const yaml = ExecutableSkillYaml.from(
    ExecutableSkillActions.defaultSkillBlueprint(),
  ).execute();
  expect(yaml.ok).toBe(true);
  if (!yaml.ok) return;
  const decoded = ExecutableSkillActions.decodeSkillActionRequest(yaml.value);
  expect(decoded.ok).toBe(true);
  if (!decoded.ok) return;
  expect(decoded.request.execute()).toEqual(
    ok(ExecutableSkillActions.listDiscoverableSkillActions()),
  );
  expect(
    ExecutableSkillActions.decodeSkillActionRequest({ invented: {} }).ok,
  ).toBe(false);
});

export class ForbiddenSkillAdmission {
  uncheckedConstruction(): void {
    // @ts-expect-error Request DTOs do not carry executable admission.
    new AdmittedSkillAction({});
  }
}
