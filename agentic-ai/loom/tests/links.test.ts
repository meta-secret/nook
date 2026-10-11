import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  MarkdownLinkDocument,
  RepositoryMarkdownLinks,
} from '../src/lib/links.ts';

import type {
  BrokenLink,
  FileMarkdownLink,
  FindBrokenRelativeLinksArgs,
  MarkdownLink,
} from '../src/lib/links.ts';
import type { MakeDirectoryOptions } from 'node:fs';
describe('findBrokenRelativeLinks', () => {
  test('parses reference links and images at their use-site lines', () => {
    const source = [
      '[Guide][DOC] and ![Icon][icon]',
      '[doc] and [doc][]',
      '',
      '[doc]: ./guide.md "Guide title"',
      '[icon]: ./icon.png',
    ].join('\n');
    const expected: readonly MarkdownLink[] = [
      { target: './guide.md', line: 1 },
      { target: './icon.png', line: 1 },
      { target: './guide.md', line: 2 },
      { target: './guide.md', line: 2 },
    ];
    expect(new MarkdownLinkDocument(source).links()).toEqual(expected);
  });

  test('ignores link-looking code, escaped text, HTML, and unused definitions', () => {
    const source = [
      '`[inline](./missing.md)`',
      '',
      '```md',
      '[example](./missing.md)',
      '```',
      '',
      '\\[escaped](./missing.md)',
      '',
      '<!-- [comment](./missing.md) -->',
      '',
      '[unused]: ./missing.md',
    ].join('\n');
    const expected: readonly MarkdownLink[] = [];
    expect(new MarkdownLinkDocument(source).links()).toEqual(expected);
  });

  test('preserves parenthesized targets and optional link titles', () => {
    const expected: readonly MarkdownLink[] = [
      { target: './guide(v2).md', line: 1 },
    ];
    expect(
      new MarkdownLinkDocument('[Guide](./guide(v2).md "Version two")').links(),
    ).toEqual(expected);
  });

  test('resolves duplicate reference definitions using the first definition', () => {
    const source = '[Guide][doc]\n\n[doc]: ./first.md\n[DOC]: ./second.md\n';
    const expected: readonly MarkdownLink[] = [
      { target: './first.md', line: 1 },
    ];
    expect(new MarkdownLinkDocument(source).links()).toEqual(expected);
  });

  test('resolves encoded paths and excludes external links from file targets', () => {
    const request: FindBrokenRelativeLinksArgs = {
      filePath: import.meta.path,
      repoRoot: path.resolve(import.meta.dir, '../../..'),
      content: [
        '[Local](./links%2Etest.ts?download=1#section)',
        '[Web](https://example.com/missing.md)',
        '[Mail](mailto:person@example.com)',
        '[Fragment](#section)',
        '[Empty]()',
      ].join('\n'),
    };
    const expected: readonly FileMarkdownLink[] = [
      {
        target: './links%2Etest.ts?download=1#section',
        line: 1,
        filePath: import.meta.path,
      },
    ];
    const expectedFindings: BrokenLink[] = [];
    const links = new RepositoryMarkdownLinks(request);
    expect(links.targets()).toEqual(expected);
    expect(links.findBroken()).toEqual(expectedFindings);
  });

  test('reports a missing reference target at the reference use site', () => {
    const request: FindBrokenRelativeLinksArgs = {
      filePath: import.meta.path,
      repoRoot: path.resolve(import.meta.dir, '../../..'),
      content:
        'Introduction.\n[Missing][doc]\n\n[doc]: ./nonexistent-reference-target.md\n',
    };
    const expected: BrokenLink[] = [
      {
        file: 'agentic-ai/loom/tests/links.test.ts',
        line: 2,
        target: './nonexistent-reference-target.md',
      },
    ];
    expect(new RepositoryMarkdownLinks(request).findBroken()).toEqual(expected);
  });

  test('reports an invalid encoded path separator instead of throwing from the audit', () => {
    const request: FindBrokenRelativeLinksArgs = {
      filePath: import.meta.path,
      repoRoot: path.resolve(import.meta.dir, '../../..'),
      content: '[Encoded separator](./bad%2Fname.md)',
    };
    const expected: BrokenLink[] = [
      {
        file: 'agentic-ai/loom/tests/links.test.ts',
        line: 1,
        target: './bad%2Fname.md',
      },
    ];
    const expectedTargets: readonly FileMarkdownLink[] = [];
    const links = new RepositoryMarkdownLinks(request);
    expect(links.findBroken()).toEqual(expected);
    expect(links.targets()).toEqual(expectedTargets);
  });

  test('reports missing relative targets', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'loom-links-'));
    const directoryOptions: MakeDirectoryOptions = { recursive: true };
    mkdirSync(path.join(root, '.cortex'), directoryOptions);
    const filePath = path.join(root, '.cortex', 'demo.md');
    writeFileSync(
      filePath,
      'See [missing](./nope.md) and [ok](./demo.md).\n',
      'utf8',
    );
    const content = readFileSync(filePath, 'utf8');
    const brokenArgs: FindBrokenRelativeLinksArgs = {
      filePath,
      content,
      repoRoot: root,
    };
    const broken = new RepositoryMarkdownLinks(brokenArgs).findBroken();
    const expected: BrokenLink[] = [
      {
        file: path.join('.cortex', 'demo.md'),
        line: 1,
        target: './nope.md',
      },
    ];
    expect(broken).toEqual(expected);
  });
});
