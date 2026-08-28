import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
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

test('renders the complete canonical Cortex context router', () => {
  const renderArgs = { index: { documents: [] } };
  const markdown = renderCortexIndexMarkdown(renderArgs);
  const canonicalRouter = readFileSync(
    new URL('../../../.cortex/knowledge-graph.md', import.meta.url),
    'utf8',
  );

  expect(markdown).toBe(canonicalRouter);

  const requiredSections = [
    '## Entry contract',
    '## Gizmo route',
    '## Team routes',
    '## Shared route',
    '## Routing rules',
  ];
  for (const section of requiredSections) {
    expect(markdown).toContain(section);
  }

  const teamOwnershipContracts = [
    '[AI](teams/ai/knowledge-graph.md) owns Cortex, Loom, agent skills, agent',
    '[Development core](teams/dev-core/knowledge-graph.md) owns portable Rust,',
    '[Security](teams/security/knowledge-graph.md) owns security architecture,',
    '[SRE](teams/sre/knowledge-graph.md) owns CI/CD, clusters, deployments,',
    '[Web development](teams/web-dev/knowledge-graph.md) owns TypeScript and Svelte',
  ];
  for (const contract of teamOwnershipContracts) {
    expect(markdown).toContain(contract);
  }

  const routingRules = markdown.match(/^\d+\. /gm) ?? [];
  expect(routingRules).toHaveLength(20);
  expect(markdown).toContain(
    'Loom/Nook computes eligible candidates, conflicts, capacity, leases, and',
  );
  expect(markdown).toContain(
    'admission-authorizes records, and freezes and owns their starting frontiers.',
  );
  expect(markdown).toContain(
    'alone creates and operates attempts and never selects or admits records or',
  );
  expect(markdown).toContain(
    'the complete old generation for immutable generation restart.',
  );
  expect(markdown).toContain('Worker termination does not release a lease.');
  expect(markdown).toContain(
    'immutable generation restart; do not implicitly or selectively invalidate',
  );
  expect(markdown).toContain(
    'Parent-owned Gizmo control operations remain outside',
  );
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
