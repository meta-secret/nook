import { expect, test } from 'bun:test';
import { fromMarkdown } from 'mdast-util-from-markdown';

const activityFixture =
  '\\---  \npr: "#1263"  \nteam: "AI"  \nagent: "AI Team Agent"  \n...\n\n00:00:AI:STATE -> ready';

test('Markdown transport preserves every live YAML metadata line', () => {
  const document = fromMarkdown(activityFixture);
  const metadata = document.children[0];
  expect(metadata?.type).toBe('paragraph');
  if (!metadata || metadata.type !== 'paragraph') return;

  expect(metadata.children.map((child) => child.type)).toEqual([
    'text',
    'break',
    'text',
    'break',
    'text',
    'break',
    'text',
    'break',
    'text',
  ]);
  expect(document.children[1]?.type).toBe('paragraph');
});

test('activity metadata uses a canonical executor type', () => {
  const agent = activityFixture.match(/agent: "([^"]+)"/)?.[1];

  expect(agent).toMatch(/^(Gizmo Prime|[A-Z][A-Z0-9-]* Team Agent|Skill)$/);
});

test('activity lines use a compact canonical actor token', () => {
  const activity = activityFixture.split('\n').at(-1);

  expect(activity).toMatch(
    /^\d{2}:\d{2}:(GIZMO|AI|SRE|SKILL):[A-Z][A-Z0-9/-]* -> .+$/,
  );
  expect(activity).not.toContain('Team Agent');
});
