import { expect, test } from 'bun:test';
import path from 'node:path';

type ValeAlert = {
  readonly Check: string;
  readonly Line: number;
  readonly Message: string;
  readonly Severity: string;
};

type ValeReport = Readonly<Record<string, readonly ValeAlert[]>>;

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../../../../../../..');

function runValidFixture() {
  return Bun.spawnSync({
    cmd: [
      'task',
      'vale:cortex',
      'CORTEX_ROOT=.vale/fixtures/cortex-navigation/valid/.cortex',
    ],
    cwd: REPOSITORY_ROOT,
    stderr: 'pipe',
    stdout: 'pipe',
  });
}

function runInvalidFixture() {
  return Bun.spawnSync({
    cmd: [
      'vale',
      '--no-global',
      `--config=${path.join(REPOSITORY_ROOT, '.vale.ini')}`,
      '--output=JSON',
      path.join(
        REPOSITORY_ROOT,
        '.vale/fixtures/cortex-navigation/invalid/.cortex/article.md',
      ),
    ],
    cwd: REPOSITORY_ROOT,
    stderr: 'pipe',
    stdout: 'pipe',
  });
}

function report(stdout: Uint8Array): ValeReport {
  return JSON.parse(new TextDecoder().decode(stdout)) as ValeReport;
}

test('accepts exclusions, ignored directories, and non-matching Markdown', () => {
  const result = runValidFixture();
  expect(new TextDecoder().decode(result.stderr)).toBe('');
  expect(result.exitCode).toBe(0);
  expect(report(result.stdout)).toEqual({});
});

test('reports each exact prohibited H2 through the Vale rule', () => {
  const result = runInvalidFixture();
  expect(result.exitCode).not.toBe(0);
  const alerts = Object.values(report(result.stdout))
    .flat()
    .map(({ Check, Line, Message, Severity }) => ({
      Check,
      Line,
      Message,
      Severity,
    }));
  expect(alerts).toEqual([
    {
      Check: 'Nook.CortexNavigation',
      Line: 3,
      Message:
        'Inline `## Relationships` is prohibited; navigation is centralized in `.cortex/knowledge-graph.md`.',
      Severity: 'error',
    },
    {
      Check: 'Nook.CortexNavigation',
      Line: 7,
      Message:
        'Inline `## Document map` is prohibited; navigation is centralized in `.cortex/knowledge-graph.md`.',
      Severity: 'error',
    },
  ]);
});
