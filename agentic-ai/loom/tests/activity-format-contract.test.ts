import { expect, test } from 'bun:test';

const activityFixture = '00:00:PR1263:AI:TEST -> ready';

test('activity lines use a compact canonical actor token', () => {
  const activity = activityFixture.split('\n').at(-1);

  expect(activity).toMatch(
    /^\d{2}:\d{2}:PR(?:[1-9]\d*|pending|none):(GIZMO|AI|SRE|SKILL):[A-Z][A-Z0-9/-]* -> .+$/,
  );
  expect(activity).not.toContain('Team Agent');
});

test('activity lines carry both pre-PR states inline', () => {
  const pattern =
    /^\d{2}:\d{2}:PR(?:[1-9]\d*|pending|none):(GIZMO|AI|SRE|SKILL):[A-Z][A-Z0-9/-]* -> .+$/;

  expect('00:00:PRpending:GIZMO:STATE -> preparing').toMatch(pattern);
  expect('00:00:PRnone:SKILL:TEST -> verified').toMatch(pattern);
  expect('00:00:#1263:AI:TEST -> rejected').not.toMatch(pattern);
});
