import { expect, test } from 'bun:test';
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  isRequiredValeVersion,
  parseValeFilesOutput,
  runValeFiles,
  ValeAlertSeverity,
} from '../src/lib/vale-files.ts';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../../..');
const CONFIG_PATH = path.join(REPOSITORY_ROOT, '.vale.ini');
const VALID_FIXTURE = path.join(
  REPOSITORY_ROOT,
  '.vale/fixtures/cortex-navigation/valid/.cortex/article.md',
);
const INVALID_FIXTURE = path.join(
  REPOSITORY_ROOT,
  '.vale/fixtures/cortex-navigation/invalid/.cortex/article.md',
);
const REAL_TEMP_DIRECTORY = realpathSync(tmpdir());
const VALID_NATIVE_ALERT =
  '{"Action":{"Name":"","Params":null},"Span":[3,15],"Check":"Nook.CortexNavigation","Description":"","Link":"","Message":"Navigation is prohibited.","Severity":"error","Match":"Relationships","Line":3}';

type ValeReportJsonArgs = {
  readonly alert: string;
  readonly file?: string;
};

function valeReportJson(args: ValeReportJsonArgs): string {
  const [file = INVALID_FIXTURE] = [args.file];
  return `{${JSON.stringify(file)}:[${args.alert}]}`;
}

test('lints only the explicit ordered Markdown files and parses native alerts', () => {
  expect(
    runValeFiles({
      configPath: CONFIG_PATH,
      files: [VALID_FIXTURE],
      repoRoot: REPOSITORY_ROOT,
    }),
  ).toEqual({ alerts: [] });

  const result = runValeFiles({
    configPath: CONFIG_PATH,
    files: [INVALID_FIXTURE],
    repoRoot: REPOSITORY_ROOT,
  });
  expect(result.alerts).toEqual([
    {
      check: 'Nook.CortexNavigation',
      file: INVALID_FIXTURE,
      line: 3,
      message:
        'Inline `## Relationships` is prohibited; navigation is centralized in `.cortex/knowledge-graph.md`.',
      severity: ValeAlertSeverity.Error,
    },
    {
      check: 'Nook.CortexNavigation',
      file: INVALID_FIXTURE,
      line: 7,
      message:
        'Inline `## Document map` is prohibited; navigation is centralized in `.cortex/knowledge-graph.md`.',
      severity: ValeAlertSeverity.Error,
    },
  ]);
});

test('rejects empty, duplicate, and non-Markdown file lists', () => {
  for (const files of [[], [VALID_FIXTURE, VALID_FIXTURE], [CONFIG_PATH]]) {
    expect(() =>
      runValeFiles({
        configPath: CONFIG_PATH,
        files,
        repoRoot: REPOSITORY_ROOT,
      }),
    ).toThrow();
  }
});

test('fails closed on command errors', () => {
  const repoRoot = realpathSync(
    mkdtempSync(path.join(REAL_TEMP_DIRECTORY, 'vale-files-')),
  );
  try {
    const configPath = path.join(repoRoot, '.vale.ini');
    const markdown = path.join(repoRoot, 'article.md');
    writeFileSync(configPath, 'StylesPath = [\n');
    writeFileSync(markdown, '# Article\n');
    expect(() =>
      runValeFiles({
        configPath,
        files: [markdown],
        repoRoot,
      }),
    ).toThrow();
  } finally {
    rmSync(repoRoot, { force: true, recursive: true });
  }
});

test('rejects an in-repository path through a symlinked ancestor', () => {
  const repoRoot = realpathSync(
    mkdtempSync(path.join(REAL_TEMP_DIRECTORY, 'vale-repository-')),
  );
  const outside = realpathSync(
    mkdtempSync(path.join(REAL_TEMP_DIRECTORY, 'vale-outside-')),
  );
  try {
    const configPath = path.join(repoRoot, '.vale.ini');
    const outsideMarkdown = path.join(outside, 'article.md');
    const linkedDirectory = path.join(repoRoot, 'linked');
    writeFileSync(configPath, 'StylesPath = .vale/styles\n');
    writeFileSync(outsideMarkdown, '# Outside\n');
    symlinkSync(outside, linkedDirectory);
    expect(() =>
      runValeFiles({
        configPath,
        files: [path.join(linkedDirectory, 'article.md')],
        repoRoot,
      }),
    ).toThrow();
  } finally {
    rmSync(repoRoot, { force: true, recursive: true });
    rmSync(outside, { force: true, recursive: true });
  }
});

test('requires the pinned Vale version before linting', () => {
  expect(
    isRequiredValeVersion({
      exitCode: 0,
      signaled: false,
      stderr: '',
      stdout: 'vale version 3.19.0\n',
    }),
  ).toBe(true);
  for (const output of [
    {
      exitCode: 0,
      signaled: false,
      stderr: '',
      stdout: 'vale version 3.18.0\n',
    },
    {
      exitCode: 1,
      signaled: true,
      stderr: '',
      stdout: '',
    },
  ]) {
    expect(isRequiredValeVersion(output)).toBe(false);
  }
});

test('fails closed on invalid JSON and native alert schema', () => {
  for (const stdout of [
    '{',
    '[]',
    JSON.stringify({ [INVALID_FIXTURE]: false }),
    JSON.stringify({
      [INVALID_FIXTURE]: [
        { Check: '', Line: 0, Message: '', Severity: 'fatal' },
      ],
    }),
    valeReportJson({
      alert: VALID_NATIVE_ALERT.replace('"Line":3}', '"Line":3,"Extra":true}'),
    }),
    valeReportJson({
      alert: VALID_NATIVE_ALERT.replace(
        '"Params":null',
        '"Params":null,"Extra":true',
      ),
    }),
    valeReportJson({
      alert: VALID_NATIVE_ALERT.replace('"Params":null', '"Params":[]'),
    }),
    valeReportJson({
      alert: VALID_NATIVE_ALERT.replace('"Span":[3,15]', '"Span":[3]'),
    }),
    valeReportJson({
      alert: VALID_NATIVE_ALERT.replace(',"Link":""', ''),
    }),
    JSON.stringify({
      [VALID_FIXTURE]: [
        {
          Check: 'Nook.CortexNavigation',
          Line: 1,
          Message: 'Unexpected file.',
          Severity: 'error',
        },
      ],
    }),
  ]) {
    expect(() =>
      parseValeFilesOutput({ files: [INVALID_FIXTURE], stdout }),
    ).toThrow();
  }
});
