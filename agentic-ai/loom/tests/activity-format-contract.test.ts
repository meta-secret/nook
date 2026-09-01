import { expect, test } from 'bun:test';

const activityFixture = '01:02:(1263):GIZMO:FIX -> message';

test('activity lines use a compact canonical actor token', () => {
  const activity = activityFixture.split('\n').at(-1);

  expect(activity).toMatch(
    /^\d{2}:\d{2}:\((?:[1-9]\d*|pending|none)\):(GIZMO|AI|SRE|SKILL):[A-Z][A-Z0-9/-]* -> .+$/,
  );
  expect(activity).not.toContain('Team Agent');
});

test('activity lines carry both pre-PR states inline', () => {
  const pattern =
    /^\d{2}:\d{2}:\((?:[1-9]\d*|pending|none)\):(GIZMO|AI|SRE|SKILL):[A-Z][A-Z0-9/-]* -> .+$/;

  expect('00:00:(pending):GIZMO:STATE -> preparing').toMatch(pattern);
  expect('00:00:(none):SKILL:TEST -> verified').toMatch(pattern);
  expect('00:00:(0):AI:TEST -> rejected').not.toMatch(pattern);
});
