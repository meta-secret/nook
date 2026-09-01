import { expect, test } from 'bun:test';

const activityFixture = '01:02:(1263):GIZMO:FIX -> message';
const actorPattern = '(?:GIZMO|AI|DEV-CORE|SECURITY|SRE|WEB-DEV|SKILL)';
const activityPattern = new RegExp(
  `^\\d{2}:\\d{2}:\\((?:[1-9]\\d*|pending|none)\\):${actorPattern}:[A-Z][A-Z0-9/-]* -> .+$`,
);

test('activity lines use a compact canonical actor token', () => {
  const activity = activityFixture.split('\n').at(-1);

  expect(activity).toMatch(activityPattern);
  expect(activity).not.toContain('Team Agent');
});

test('activity lines cover every canonical routed team actor', () => {
  const actors = [
    'GIZMO',
    'AI',
    'DEV-CORE',
    'SECURITY',
    'SRE',
    'WEB-DEV',
    'SKILL',
  ];

  for (const actor of actors) {
    expect(`01:02:(1263):${actor}:TEST -> ready`).toMatch(activityPattern);
  }
  expect('01:02:(1263):Sagan:TEST -> rejected').not.toMatch(activityPattern);
});

test('activity lines carry both pre-PR states inline', () => {
  expect('00:00:(pending):GIZMO:STATE -> preparing').toMatch(activityPattern);
  expect('00:00:(none):SKILL:TEST -> verified').toMatch(activityPattern);
  expect('00:00:(0):AI:TEST -> rejected').not.toMatch(activityPattern);
});
