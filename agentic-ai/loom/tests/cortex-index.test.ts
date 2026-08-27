import { expect, test } from 'bun:test';
import {
  extractCortexIndex,
  renderCortexIndexMarkdown,
  stripDocumentNavigation,
} from '../src/lib/cortex-index.ts';

test('extracts index metadata and renders markdown', () => {
  const documents = [
    {
      absolutePath: '/repo/.cortex/rules.md',
      relativePath: '.cortex/rules.md',
      content: `# Rules

Overview intro.

## Overview

Overview text.

## Golden principles

Golden text.
`,
    },
    {
      absolutePath: '/repo/.cortex/shared/product-specs/spec-a.md',
      relativePath: '.cortex/shared/product-specs/spec-a.md',
      content: `# Spec A

Spec intro.

## Product model

Model text.
`,
    },
  ];

  const extractArgs = { documents, repoRoot: '/repo' };
  const index = extractCortexIndex(extractArgs);
  expect(index.documents.length).toBe(2);

  const renderArgs = { index };
  const markdown = renderCortexIndexMarkdown(renderArgs);
  expect(markdown).toContain('# Cortex Context Router');
  expect(markdown).toContain('## Gizmo route');
  expect(markdown).toContain('[Gizmo](gizmo/knowledge-graph.md)');
  expect(markdown).not.toContain('[Gizmo](teams/gizmo/knowledge-graph.md)');
  expect(markdown).toContain('## Team routes');
  expect(markdown).toContain('[AI](teams/ai/knowledge-graph.md)');
  expect(markdown).toContain('[Security](teams/security/knowledge-graph.md)');
  expect(markdown).toContain('[Shared knowledge](shared/knowledge-graph.md)');
  expect(markdown).not.toContain('rules.md');
  expect(markdown).not.toContain('#overview');
});

test('stripDocumentNavigation strips relationships and document map', () => {
  const content = `# Sample Doc

Intro paragraph.

## Relationships

- [Other](other.md)
  - Other explanation.
  - Read when needed.

## Document map

- [Overview](#overview)
  - Overview explanation.
  - Read first.

## Overview

This is the actual overview text.
`;

  const stripArgs = { content };
  const stripped = stripDocumentNavigation(stripArgs);
  expect(stripped).toContain('# Sample Doc');
  expect(stripped).toContain('Intro paragraph.');
  expect(stripped).toContain('## Overview');
  expect(stripped).toContain('This is the actual overview text.');
  expect(stripped).not.toContain('## Relationships');
  expect(stripped).not.toContain('## Document map');
  expect(stripped).not.toContain('- [Other](other.md)');
});
