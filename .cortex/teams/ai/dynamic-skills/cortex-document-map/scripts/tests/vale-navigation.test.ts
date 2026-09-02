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

function runFixture(name: 'invalid' | 'valid') {
  return Bun.spawnSync({
    cmd: [
      'task',
      'vale:cortex',
      `CORTEX_ROOT=.vale/fixtures/cortex-navigation/${name}/.cortex`,
    ],
    cwd: REPOSITORY_ROOT,
    env: process.env,
    stderr: 'pipe',
    stdout: 'pipe',
  });
}

function report(stdout: Uint8Array): ValeReport {
  return JSON.parse(new TextDecoder().decode(stdout)) as ValeReport;
}

test('accepts non-matching Markdown and every knowledge-graph path', () => {
  const result = runFixture('valid');
  expect(new TextDecoder().decode(result.stderr)).toBe('');
  expect(result.exitCode).toBe(0);
  expect(report(result.stdout)).toEqual({});
});

test('reports each exact prohibited H2 through the Vale rule', () => {
  const result = runFixture('invalid');
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
