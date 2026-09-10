import { ValeVersionAdmission } from '../src/lib/vale-files.ts';
import {
  ValeVersionOutput,
  ValeOutputDocument,
} from '../src/lib/vale-files.ts';
import assert from 'node:assert/strict';
import { expect, spyOn, test } from 'bun:test';
import { ok } from 'neverthrow';
import { HostCommand } from '../src/lib/run.ts';

import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';

import { tmpdir } from 'node:os';

import path from 'node:path';

import {
  ValeAlertSeverity,
  ValeFileDiagnostics,
} from '../src/lib/vale-files.ts';

import {
  CortexArticleFindingCode,
  CortexMarkdownArticle,
} from '../src/lib/cortex-article-structure.ts';

export class ValeFilesScenario {
  private constructor(private readonly request: ValeReportJsonArgs) {}

  static valeReportJson(args: ValeReportJsonArgs): string {
    return new ValeFilesScenario(args).execute();
  }

  private execute(): string {
    const args = this.request;
    const [file = INVALID_FIXTURE] = [args.file];
    return `{${JSON.stringify(file)}:[${args.alert}]}`;
  }
}

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

const DENSITY_CONFIG_PATH = path.join(REPOSITORY_ROOT, '.vale/density.ini');

const CAPABILITIES_CONFIG_PATH = path.join(
  REPOSITORY_ROOT,
  '.vale/capabilities.ini',
);

const TABLE_CAPABILITIES_FIXTURE = path.join(
  REPOSITORY_ROOT,
  '.vale/fixtures/capabilities/tables.md',
);

const DENSITY_CAPABILITIES_FIXTURE = path.join(
  REPOSITORY_ROOT,
  '.vale/fixtures/capabilities/density.md',
);

const VALID_DENSITY_FIXTURE = path.join(
  REPOSITORY_ROOT,
  '.vale/fixtures/density/valid.md',
);

const INVALID_DENSITY_FIXTURE = path.join(
  REPOSITORY_ROOT,
  '.vale/fixtures/density/invalid.md',
);

const VALID_LENGTH_FIXTURES = [
  path.join(REPOSITORY_ROOT, '.vale/fixtures/density/length-valid.md'),
  path.join(REPOSITORY_ROOT, '.vale/fixtures/density/length-inline-valid.md'),
  path.join(REPOSITORY_ROOT, '.vale/fixtures/density/length-unicode-valid.md'),
] as const;

const INVALID_LENGTH_FIXTURE = path.join(
  REPOSITORY_ROOT,
  '.vale/fixtures/density/length-invalid.md',
);

const INVALID_UNICODE_LENGTH_FIXTURE = path.join(
  REPOSITORY_ROOT,
  '.vale/fixtures/density/length-unicode-invalid.md',
);

const INVALID_INLINE_LENGTH_FIXTURE = path.join(
  REPOSITORY_ROOT,
  '.vale/fixtures/density/length-inline-invalid.md',
);

const REAL_TEMP_DIRECTORY = realpathSync(tmpdir());

const VALID_NATIVE_ALERT =
  '{"Action":{"Name":"","Params":null},"Span":[3,15],"Check":"Nook.CortexNavigation","Description":"","Link":"","Message":"Navigation is prohibited.","Severity":"error","Match":"Relationships","Line":3}';

type ValeReportJsonArgs = {
  readonly alert: string;
  readonly file?: string;
};

test('lints only the explicit ordered Markdown files and parses native alerts', () => {
  const valeResult1 = new ValeFileDiagnostics({
    configPath: CONFIG_PATH,
    files: [VALID_FIXTURE],
    repoRoot: REPOSITORY_ROOT,
  }).execute();
  assert(valeResult1.isOk());
  expect(valeResult1.value).toEqual({ alerts: [] });

  const valeResult2 = new ValeFileDiagnostics({
    configPath: CONFIG_PATH,
    files: [INVALID_FIXTURE],
    repoRoot: REPOSITORY_ROOT,
  }).execute();
  assert(valeResult2.isOk());
  const result = valeResult2.value;
  expect(result.alerts).toEqual([
    {
      check: 'Nook.CortexNavigation',
      file: INVALID_FIXTURE,
      line: 3,
      match: 'Relationships',
      message:
        'Inline `## Relationships` is prohibited; navigation is centralized in `.cortex/knowledge-graph.md`.',
      severity: ValeAlertSeverity.Error,
    },
    {
      check: 'Nook.CortexNavigation',
      file: INVALID_FIXTURE,
      line: 7,
      match: 'Document map',
      message:
        'Inline `## Document map` is prohibited; navigation is centralized in `.cortex/knowledge-graph.md`.',
      severity: ValeAlertSeverity.Error,
    },
  ]);
});

test('uses Vale-native sentence and Markdown scopes for semicolon density', () => {
  const valeResult3 = new ValeFileDiagnostics({
    configPath: DENSITY_CONFIG_PATH,
    files: [VALID_DENSITY_FIXTURE, INVALID_DENSITY_FIXTURE],
    repoRoot: REPOSITORY_ROOT,
  }).execute();
  assert(valeResult3.isOk());
  const result = valeResult3.value;
  expect(
    result.alerts.filter((alert) => alert.file === VALID_DENSITY_FIXTURE),
  ).toEqual([]);
  expect(
    result.alerts.map((alert) => ({
      check: alert.check,
      file: alert.file,
      line: alert.line,
      message: alert.message,
      severity: alert.severity,
    })),
  ).toEqual(
    [3, 5, 7, 11, 12].map((line) => ({
      check: 'NookDensity.Semicolons',
      file: INVALID_DENSITY_FIXTURE,
      line,
      message: 'Use at most one semicolon per sentence.',
      severity: ValeAlertSeverity.Error,
    })),
  );
});

test('uses Vale-native character counting and cardinality for sentence length', () => {
  const valeResult4 = new ValeFileDiagnostics({
    configPath: DENSITY_CONFIG_PATH,
    files: [
      ...VALID_LENGTH_FIXTURES,
      INVALID_LENGTH_FIXTURE,
      INVALID_INLINE_LENGTH_FIXTURE,
      INVALID_UNICODE_LENGTH_FIXTURE,
    ],
    repoRoot: REPOSITORY_ROOT,
  }).execute();
  assert(valeResult4.isOk());
  const result = valeResult4.value;
  expect(
    result.alerts.filter((alert) =>
      VALID_LENGTH_FIXTURES.some((file) => file === alert.file),
    ),
  ).toEqual([]);
  expect(
    result.alerts.map((alert) => ({
      check: alert.check,
      file: alert.file,
      line: alert.line,
      message: alert.message,
      severity: alert.severity,
    })),
  ).toEqual([
    {
      check: 'NookDensity.SentenceLength',
      file: INVALID_INLINE_LENGTH_FIXTURE,
      line: 1,
      message: 'Keep sentences at 180 characters or fewer.',
      severity: ValeAlertSeverity.Error,
    },
    ...[3, 5, 8, 12, 13, 15].map((line) => ({
      check: 'NookDensity.SentenceLength',
      file: INVALID_LENGTH_FIXTURE,
      line,
      message: 'Keep sentences at 180 characters or fewer.',
      severity: ValeAlertSeverity.Error,
    })),
    {
      check: 'NookDensity.SentenceLength',
      file: INVALID_UNICODE_LENGTH_FIXTURE,
      line: 1,
      message: 'Keep sentences at 180 characters or fewer.',
      severity: ValeAlertSeverity.Error,
    },
  ]);
});

test('pins Vale 3.19 structural boundaries for residual Markdown checks', () => {
  const valeResult5 = new ValeFileDiagnostics({
    configPath: CAPABILITIES_CONFIG_PATH,
    files: [TABLE_CAPABILITIES_FIXTURE],
    repoRoot: REPOSITORY_ROOT,
  }).execute();
  assert(valeResult5.isOk());
  const tableResult = valeResult5.value;
  expect(
    tableResult.alerts.map((alert) => ({
      check: alert.check,
      line: alert.line,
    })),
  ).toEqual(
    [3, 3, 5, 5].map((line) => ({
      check: 'NookCapabilities.TableCells',
      line,
    })),
  );
  const articleResult = CortexMarkdownArticle.from({
    documents: [
      {
        absolutePath: TABLE_CAPABILITIES_FIXTURE,
        relativePath: '.cortex/vale-capability-tables.md',
        content: readFileSync(TABLE_CAPABILITIES_FIXTURE, 'utf8'),
      },
    ],
  }).execute();
  assert(articleResult.isOk());
  expect(
    articleResult.value.map((finding) => ({
      code: finding.code,
      line: finding.line,
    })),
  ).toEqual(
    [3, 7].map((line) => ({
      code: CortexArticleFindingCode.MarkdownTable,
      line,
    })),
  );

  const valeResult6 = new ValeFileDiagnostics({
    configPath: CAPABILITIES_CONFIG_PATH,
    files: [DENSITY_CAPABILITIES_FIXTURE],
    repoRoot: REPOSITORY_ROOT,
  }).execute();
  assert(valeResult6.isOk());
  const andJoinResult = valeResult6.value;
  expect(andJoinResult.alerts).toEqual([
    {
      check: 'NookCapabilities.AndJoins',
      file: DENSITY_CAPABILITIES_FIXTURE,
      line: 6,
      match:
        'This ordinary paragraph uses enough padding xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx and one and two and three.',
      message: 'Vale exposes this long sentence with three "and" joins.',
      severity: ValeAlertSeverity.Error,
    },
  ]);

  const valeResult7 = new ValeFileDiagnostics({
    configPath: DENSITY_CONFIG_PATH,
    files: [DENSITY_CAPABILITIES_FIXTURE],
    repoRoot: REPOSITORY_ROOT,
  }).execute();
  assert(valeResult7.isOk());
  const densityResult = valeResult7.value;
  expect(densityResult.alerts).toEqual(
    [4, 8].map((line) => ({
      check: 'NookDensity.Semicolons',
      file: DENSITY_CAPABILITIES_FIXTURE,
      line,
      match: ';',
      message: 'Use at most one semicolon per sentence.',
      severity: ValeAlertSeverity.Error,
    })),
  );
});

test('rejects empty, duplicate, and non-Markdown file lists', () => {
  for (const files of [[], [VALID_FIXTURE, VALID_FIXTURE], [CONFIG_PATH]]) {
    expect(
      new ValeFileDiagnostics({
        configPath: CONFIG_PATH,
        files,
        repoRoot: REPOSITORY_ROOT,
      })
        .execute()
        .isErr(),
    ).toBe(true);
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
    expect(
      new ValeFileDiagnostics({
        configPath,
        files: [markdown],
        repoRoot,
      })
        .execute()
        .isErr(),
    ).toBe(true);
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
  const command = spyOn(HostCommand.prototype, 'execute').mockReturnValue(
    ok({
      exitCode: 0,
      signaled: false,
      stdout: 'vale version 3.19.0',
      stderr: '',
    }),
  );
  try {
    const configPath = path.join(repoRoot, '.vale.ini');
    const outsideMarkdown = path.join(outside, 'article.md');
    const linkedDirectory = path.join(repoRoot, 'linked');
    writeFileSync(configPath, 'StylesPath = .vale/styles\n');
    writeFileSync(outsideMarkdown, '# Outside\n');
    symlinkSync(outside, linkedDirectory);
    expect(
      new ValeFileDiagnostics({
        configPath,
        files: [path.join(linkedDirectory, 'article.md')],
        repoRoot,
      })
        .execute()
        .isErr(),
    ).toBe(true);
    expect(command).not.toHaveBeenCalled();
  } finally {
    command.mockRestore();
    rmSync(repoRoot, { force: true, recursive: true });
    rmSync(outside, { force: true, recursive: true });
  }
});

test('requires the pinned Vale version before linting', () => {
  expect(
    new ValeVersionOutput({
      exitCode: 0,
      signaled: false,
      stderr: '',
      stdout: 'vale version 3.19.0\n',
    }).admission(),
  ).toBe(ValeVersionAdmission.Admitted);
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
    expect(new ValeVersionOutput(output).admission()).toBe(
      ValeVersionAdmission.Rejected,
    );
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
    ValeFilesScenario.valeReportJson({
      alert: VALID_NATIVE_ALERT.replace('"Line":3}', '"Line":3,"Extra":true}'),
    }),
    ValeFilesScenario.valeReportJson({
      alert: VALID_NATIVE_ALERT.replace(
        '"Params":null',
        '"Params":null,"Extra":true',
      ),
    }),
    ValeFilesScenario.valeReportJson({
      alert: VALID_NATIVE_ALERT.replace('"Params":null', '"Params":[]'),
    }),
    ValeFilesScenario.valeReportJson({
      alert: VALID_NATIVE_ALERT.replace('"Span":[3,15]', '"Span":[3]'),
    }),
    ValeFilesScenario.valeReportJson({
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
    expect(
      new ValeOutputDocument({
        files: [INVALID_FIXTURE],
        stdout,
      })
        .decode()
        .isErr(),
    ).toBe(true);
  }
});

test('returns decoded Vale alerts without nesting the Result', () => {
  const command = spyOn(HostCommand.prototype, 'execute');
  try {
    for (const stdout of [
      '{}',
      ValeFilesScenario.valeReportJson({ alert: VALID_NATIVE_ALERT }),
    ]) {
      command.mockReturnValueOnce(
        ok({
          exitCode: 0,
          signaled: false,
          stdout: 'vale version 3.19.0',
          stderr: '',
        }),
      );
      command.mockReturnValueOnce(
        ok({
          exitCode: stdout === '{}' ? 0 : 1,
          signaled: false,
          stdout,
          stderr: '',
        }),
      );
      const result = new ValeFileDiagnostics({
        configPath: CONFIG_PATH,
        files: [INVALID_FIXTURE],
        repoRoot: REPOSITORY_ROOT,
      }).execute();
      assert(result.isOk());
      expect(result.value.alerts).toEqual(
        stdout === '{}'
          ? []
          : [
              {
                check: 'Nook.CortexNavigation',
                file: INVALID_FIXTURE,
                line: 3,
                match: 'Relationships',
                message: 'Navigation is prohibited.',
                severity: ValeAlertSeverity.Error,
              },
            ],
      );
    }
  } finally {
    command.mockRestore();
  }
});

test('propagates malformed Vale output as a decoding failure', () => {
  const command = spyOn(HostCommand.prototype, 'execute');
  try {
    command.mockReturnValueOnce(
      ok({
        exitCode: 0,
        signaled: false,
        stdout: 'vale version 3.19.0',
        stderr: '',
      }),
    );
    command.mockReturnValueOnce(
      ok({ exitCode: 0, signaled: false, stdout: '{', stderr: '' }),
    );
    const result = new ValeFileDiagnostics({
      configPath: CONFIG_PATH,
      files: [VALID_FIXTURE],
      repoRoot: REPOSITORY_ROOT,
    }).execute();
    assert(result.isErr());
    expect(result.error.message).toContain('returned invalid JSON');
  } finally {
    command.mockRestore();
  }
});

test('rejects invalid requests and external config before starting Vale', () => {
  const outside = realpathSync(
    mkdtempSync(path.join(REAL_TEMP_DIRECTORY, 'vale-admission-')),
  );
  const command = spyOn(HostCommand.prototype, 'execute').mockReturnValue(
    ok({
      exitCode: 0,
      signaled: false,
      stdout: 'vale version 3.19.0',
      stderr: '',
    }),
  );
  try {
    const externalConfig = path.join(outside, '.vale.ini');
    writeFileSync(externalConfig, 'StylesPath = .vale/styles\n');
    for (const request of [
      { configPath: CONFIG_PATH, files: [] },
      { configPath: CONFIG_PATH, files: [VALID_FIXTURE, VALID_FIXTURE] },
      { configPath: externalConfig, files: [VALID_FIXTURE] },
    ]) {
      const result = new ValeFileDiagnostics({
        ...request,
        repoRoot: REPOSITORY_ROOT,
      }).execute();
      assert(result.isErr());
    }
    expect(command).not.toHaveBeenCalled();
  } finally {
    command.mockRestore();
    rmSync(outside, { force: true, recursive: true });
  }
});
