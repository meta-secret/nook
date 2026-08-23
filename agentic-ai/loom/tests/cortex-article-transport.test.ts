import { expect, test } from 'bun:test';
import { encodeCortexArticleRequest } from '../src/executable-skills/cortex-article-transport.ts';

type TransportBlock = {
  readonly comment?: boolean;
  readonly depth?: number;
  readonly line: number;
  readonly ordered?: boolean;
  readonly text?: string;
  readonly type: string;
};

type TransportRequest = {
  readonly documents: readonly {
    readonly blocks: readonly TransportBlock[];
    readonly relativePath: string;
  }[];
};

test('normalizes raw GFM into exact root block DTOs with source lines', () => {
  const content = `# Root *title*

## Document map

- Item
  - Nested
  ## Nested heading

> ## Quoted heading

Release
steps
-----

Name | Value
--- | ---
A | B

<!-- hidden -->

<div>visible HTML</div>

[manual]: https://example.com

## [Link *emphasis* \`code\`](#target) ![hidden](image.png) escaped \\*
`;
  const encodeRequest = {
    documents: [{ relativePath: '.cortex/example.md', content }],
    migrationBaselineEntries: false,
    migrationLedger: {
      relativePath: '.cortex/article-structure-migration.txt',
      content: false,
    },
  } as const;
  const serialized = encodeCortexArticleRequest(encodeRequest);
  const transport = JSON.parse(serialized) as TransportRequest;
  const document = transport.documents[0];
  if (!document) throw new Error('Normalized document is missing.');
  expect(Object.keys(document).sort()).toEqual(['blocks', 'relativePath']);
  expect(document.blocks).toEqual([
    { depth: 1, line: 1, text: 'Root title', type: 'heading' },
    { depth: 2, line: 3, text: 'Document map', type: 'heading' },
    { line: 5, ordered: false, type: 'list' },
    { line: 9, type: 'structure' },
    { depth: 2, line: 11, text: 'Release\nsteps', type: 'heading' },
    { line: 15, type: 'structure' },
    { comment: true, line: 19, type: 'html' },
    { comment: false, line: 21, type: 'html' },
    { line: 23, type: 'definition' },
    {
      depth: 2,
      line: 25,
      text: 'Link emphasis code  escaped *',
      type: 'heading',
    },
  ]);
  expect(serialized).not.toContain('https://example.com');
  expect(serialized).not.toContain('visible HTML');
  expect(serialized).not.toContain('Quoted heading');
});
