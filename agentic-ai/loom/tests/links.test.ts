import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findBrokenRelativeLinks } from '../src/lib/links.ts';

describe('findBrokenRelativeLinks', () => {
  test('reports missing relative targets', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'loom-links-'));
    mkdirSync(path.join(root, '.cortex'), { recursive: true });
    const filePath = path.join(root, '.cortex', 'demo.md');
    writeFileSync(
      filePath,
      'See [missing](./nope.md) and [ok](./demo.md).\n',
      'utf8',
    );
    const content = readFileSync(filePath, 'utf8');
    const broken = findBrokenRelativeLinks({
      filePath,
      content,
      repoRoot: root,
    });
    expect(broken).toEqual([
      {
        file: path.join('.cortex', 'demo.md'),
        line: 1,
        target: './nope.md',
      },
    ]);
  });
});
