import { expect, test } from 'bun:test';
import { MINIMUM_EXECUTABLE_SKILL_TIMEOUT_MS } from '../../src/executable-skills/domain.ts';
import { decodeExecutableSkillManifest } from '../../src/executable-skills/manifest-codec.ts';
import { FIXTURE_REGISTRATION } from './fixture.ts';

test('aligns the manifest timeout with bounded process termination', () => {
  const acceptedLimits = {
    ...FIXTURE_REGISTRATION.manifest.limits,
    timeoutMs: MINIMUM_EXECUTABLE_SKILL_TIMEOUT_MS,
  };
  const rejectedLimits = {
    ...acceptedLimits,
    timeoutMs: MINIMUM_EXECUTABLE_SKILL_TIMEOUT_MS - 1,
  };
  const acceptedManifest = {
    ...FIXTURE_REGISTRATION.manifest,
    limits: acceptedLimits,
  };
  const rejectedManifest = {
    ...acceptedManifest,
    limits: rejectedLimits,
  };
  const acceptedText = JSON.stringify(acceptedManifest);
  const rejectedText = JSON.stringify(rejectedManifest);

  expect(decodeExecutableSkillManifest(acceptedText).limits.timeoutMs).toBe(
    MINIMUM_EXECUTABLE_SKILL_TIMEOUT_MS,
  );
  expect(() => decodeExecutableSkillManifest(rejectedText)).toThrow(
    'Invalid executable skill limits',
  );
});
