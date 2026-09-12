import { expect, test } from 'bun:test';

import path from 'node:path';

import {
  CortexDocumentMapValeReportDecoder,
  type CortexDocumentMapValeReport,
} from '../src/codec.ts';

export class CortexDocumentMapValeNavigationScenario {
  private constructor(private readonly request: Uint8Array) {}

  static runValidFixture() {
    return Bun.spawnSync({
      cmd: [
        'task',
        'vale:cortex',
        'CORTEX_ROOT=.vale/fixtures/cortex-navigation/valid/.cortex',
      ],
      stderr: 'pipe',
      stdout: 'pipe',
    });
  }

  static runInvalidFixture() {
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
      stderr: 'pipe',
      stdout: 'pipe',
    });
  }

  static runOrdinaryGraphFixture() {
    return Bun.spawnSync({
      cmd: [
        'task',
        'vale:cortex',
        'CORTEX_ROOT=.vale/fixtures/cortex-navigation/ordinary-graph/.cortex',
      ],
      stderr: 'pipe',
      stdout: 'pipe',
    });
  }

  static report(stdout: Uint8Array): ValeReport {
    return new CortexDocumentMapValeNavigationScenario(stdout).execute();
  }

  private execute(): ValeReport {
    const stdout = this.request;
    return CortexDocumentMapValeReportDecoder.from(
      new TextDecoder().decode(stdout),
    ).execute();
  }
}

type ValeReport = CortexDocumentMapValeReport;

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../../../../../../..');

test('accepts exclusions, ignored directories, and non-matching Markdown', () => {
  const result = CortexDocumentMapValeNavigationScenario.runValidFixture();
  expect(new TextDecoder().decode(result.stderr)).toBe('');
  expect(result.exitCode).toBe(0);
  expect(CortexDocumentMapValeNavigationScenario.report(result.stdout)).toEqual(
    {},
  );
});

test('reports each exact prohibited H2 through the Vale rule', () => {
  const result = CortexDocumentMapValeNavigationScenario.runInvalidFixture();
  expect(result.exitCode).not.toBe(0);
  const alerts = Object.values(
    CortexDocumentMapValeNavigationScenario.report(result.stdout),
  )
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

test('does not exempt an ordinary nested knowledge-graph document', () => {
  const result =
    CortexDocumentMapValeNavigationScenario.runOrdinaryGraphFixture();
  expect(result.exitCode).not.toBe(0);
});
