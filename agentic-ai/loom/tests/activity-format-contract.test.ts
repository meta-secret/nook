import { expect, test } from 'bun:test';
import { fromMarkdown } from 'mdast-util-from-markdown';

test('Markdown transport preserves every live YAML metadata line', () => {
  const document = fromMarkdown(
    '\\---  \npr: "#1263"  \nteam: "AI"  \nagent: "Sagan"  \n...\n\n00:00 | STATE | ready',
  );
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
