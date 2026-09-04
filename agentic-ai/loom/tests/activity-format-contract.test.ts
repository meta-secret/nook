import { expect, test } from 'bun:test';

const activityFixture = `\`\`\`text
01:02:(1263):Gizmo Prime:FIX
\`\`\`
Updated the **activity contract**.`;
const actorPattern = '(?:Gizmo Prime|AI|DEV-CORE|SECURITY|SRE|WEB-DEV|SKILL)';
const metadataPattern = new RegExp(
  `^\\d{2}:\\d{2}:\\((?:[1-9]\\d*|pending|none)\\):${actorPattern}:[A-Z][A-Z0-9/-]*$`,
);

test('activities fence metadata and follow it with ordinary Markdown', () => {
  const [opening, metadata, closing, description] = activityFixture.split('\n');

  expect(opening).toBe('```text');
  expect(metadata).toMatch(metadataPattern);
  expect(metadata).not.toContain('->');
  expect(closing).toBe('```');
  expect(description).toBe('Updated the **activity contract**.');
});

test('metadata covers every canonical routed team actor', () => {
  const actors = [
    'Gizmo Prime',
    'AI',
    'DEV-CORE',
    'SECURITY',
    'SRE',
    'WEB-DEV',
    'SKILL',
  ];

  for (const actor of actors) {
    expect(`01:02:(1263):${actor}:TEST`).toMatch(metadataPattern);
  }
  expect('01:02:(1263):GIZMO:TEST').not.toMatch(metadataPattern);
  expect('01:02:(1263):Sagan:TEST').not.toMatch(metadataPattern);
});

test('metadata carries numbered and pre-PR states without descriptions', () => {
  expect('00:00:(pending):Gizmo Prime:STATE').toMatch(metadataPattern);
  expect('00:00:(none):SKILL:TEST').toMatch(metadataPattern);
  expect('00:00:(0):AI:TEST').not.toMatch(metadataPattern);
  expect('00:00:(pending):Gizmo Prime:STATE -> preparing').not.toMatch(
    metadataPattern,
  );
});
