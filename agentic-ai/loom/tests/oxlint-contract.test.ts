import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

const LOOM_ROOT = join(import.meta.dir, '..');

const LOOM_CONFIG = join(LOOM_ROOT, '.oxlintrc.json');

/** Every executable-skill package pins this exact configuration. */
const EXECUTABLE_SKILL_CONFIG = join(
  LOOM_ROOT,
  '../../.cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/.oxlintrc.json',
);

/** A strict project so the type-aware rules see real compiler types. */
const CONTRACT_TSCONFIG = {
  compilerOptions: {
    module: 'esnext',
    moduleResolution: 'bundler',
    noEmit: true,
    strict: true,
    target: 'es2022',
    types: [],
  },
  include: ['src/**/*.ts'],
};

type ContractSource = {
  readonly name: string;
  readonly source: string;
};

type LintContractSourcesRequest = {
  readonly config: string;
  readonly sources: readonly ContractSource[];
};

const OXLINT_REPORT = z.object({
  diagnostics: z.array(
    z.object({
      code: z.string(),
      filename: z.string(),
      labels: z.array(z.object({ span: z.object({ offset: z.number() }) })),
    }),
  ),
});

type OxlintDiagnostic = z.infer<typeof OXLINT_REPORT>['diagnostics'][number];

/**
 * Lints sources with a checked-in oxlint configuration, from a strict
 * throwaway project outside the package, so every configured rule (and no
 * path override) applies, and returns each source's rule codes in order.
 */
export class OxlintContractScenario {
  private constructor(private readonly request: LintContractSourcesRequest) {}

  static async ruleIds(source: string): Promise<readonly string[]> {
    const lint = await OxlintContractScenario.lint({
      config: LOOM_CONFIG,
      sources: [{ name: 'cli', source }],
    });
    const [ruleIds = []] = [lint.get('cli')];
    return ruleIds;
  }

  static lint(
    request: LintContractSourcesRequest,
  ): Promise<ReadonlyMap<string, readonly string[]>> {
    return new OxlintContractScenario(request).execute();
  }

  private async execute(): Promise<ReadonlyMap<string, readonly string[]>> {
    const directory = await mkdtemp(join(tmpdir(), 'loom-oxlint-contract-'));
    try {
      await mkdir(join(directory, 'src'));
      await writeFile(
        join(directory, 'tsconfig.json'),
        JSON.stringify(CONTRACT_TSCONFIG),
      );
      const paths = new Map<string, string>();
      for (const { name, source } of this.request.sources) {
        const path = join(directory, 'src', `${name}.ts`);
        paths.set(path, name);
        await writeFile(path, source);
      }
      const result = Bun.spawnSync({
        cmd: [
          process.execPath,
          'x',
          'oxlint',
          '--config',
          this.request.config,
          '--format',
          'json',
          ...paths.keys(),
        ],
        cwd: LOOM_ROOT,
        stderr: 'pipe',
        stdout: 'pipe',
      });
      const report = OXLINT_REPORT.parse(JSON.parse(result.stdout.toString()));
      const ruleIds = new Map<string, string[]>(
        [...paths.values()].map((name) => [name, []]),
      );
      // A typed array sorts numerically, keeping same-offset reports in order.
      const offsets = Float64Array.from(
        new Set(report.diagnostics.map(OxlintContractScenario.offset)),
      ).sort();
      const ordered = [...offsets].flatMap((offset) =>
        report.diagnostics.filter(
          (diagnostic) => OxlintContractScenario.offset(diagnostic) === offset,
        ),
      );
      for (const diagnostic of ordered) {
        const name = paths.get(diagnostic.filename);
        if (!name) {
          throw new Error(
            `oxlint reported a foreign file: ${diagnostic.filename}`,
          );
        }
        ruleIds.get(name)?.push(diagnostic.code);
      }
      return ruleIds;
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }

  private static offset(diagnostic: OxlintDiagnostic): number {
    const [label] = diagnostic.labels;
    return label ? label.span.offset : 0;
  }
}

/** One deliberate violation of each type-aware rule both configs enable. */
const TYPE_AWARE_VIOLATIONS: readonly (ContractSource & {
  readonly rule: string;
})[] = [
  {
    name: 'unsafe-assignment',
    rule: 'typescript(no-unsafe-assignment)',
    source: "export const parsed = JSON.parse('1');",
  },
  {
    name: 'unsafe-argument',
    rule: 'typescript(no-unsafe-argument)',
    source: [
      'declare function take(value: number): void;',
      "take(JSON.parse('1'));",
    ].join('\n'),
  },
  {
    name: 'unsafe-call',
    rule: 'typescript(no-unsafe-call)',
    source: [
      'declare const value: ReturnType<typeof JSON.parse>;',
      'value();',
    ].join('\n'),
  },
  {
    name: 'unsafe-member-access',
    rule: 'typescript(no-unsafe-member-access)',
    source: [
      'declare const value: ReturnType<typeof JSON.parse>;',
      'void value.field;',
    ].join('\n'),
  },
  {
    name: 'unsafe-return',
    rule: 'typescript(no-unsafe-return)',
    source: "export function read(): number { return JSON.parse('1'); }",
  },
  {
    name: 'unsafe-type-assertion',
    rule: 'typescript(no-unsafe-type-assertion)',
    source: [
      'declare const value: string | number;',
      'export const text = value as string;',
    ].join('\n'),
  },
  {
    name: 'floating-promises',
    rule: 'typescript(no-floating-promises)',
    source: 'Promise.resolve(1);',
  },
  {
    name: 'misused-promises',
    rule: 'typescript(no-misused-promises)',
    source: [
      'declare const ready: Promise<boolean>;',
      'export const state = ready ? 1 : 0;',
    ].join('\n'),
  },
  {
    name: 'switch-exhaustiveness',
    rule: 'typescript(switch-exhaustiveness-check)',
    source: [
      "declare const kind: 'a' | 'b';",
      'switch (kind) {',
      "  case 'a':",
      '    break;',
      '}',
    ].join('\n'),
  },
];

describe('Loom oxlint contracts', () => {
  test('rejects generic object and unknown boundary types', async () => {
    expect(
      await OxlintContractScenario.ruleIds(`
        declare function decodeObject(message: object): void;
        declare function decodeUnknown(message: unknown): void;
      `),
    ).toEqual([
      'typescript(no-restricted-types)',
      'typescript(no-restricted-types)',
    ]);
  });

  test('rejects explicit any', async () => {
    expect(
      await OxlintContractScenario.ruleIds(
        'declare function decode(message: any): void;',
      ),
    ).toEqual(['typescript(no-explicit-any)']);
  });

  test('rejects generic transport and value aliases', async () => {
    expect(
      await OxlintContractScenario.ruleIds(`
        declare function decodeExternal(message: ExternalValue): void;
        declare function decodeJson(message: JsonValue): void;
        declare function decodeGeneric(message: GenericValue): void;
      `),
    ).toEqual([
      'typescript(no-restricted-types)',
      'typescript(no-restricted-types)',
      'typescript(no-restricted-types)',
    ]);
  });

  test('accepts local object literals and inline parameter shapes', async () => {
    expect(
      await OxlintContractScenario.ruleIds(`
        declare function consume(args: { name: string }): void;
        declare class Widget {
          constructor(args: { name: string });
        }
        function collectTags(tags: string[]): void { void tags; }
        function collectPair(pair: [string, number]): void { void pair; }
        function collectMapped<T>(values: { [K in keyof T]: T[K] }): void {
          void values;
        }
        consume({ name: 'Nook' });
        new Widget({ name: 'Vault' });
        collectTags(['one']);
        collectPair(['one', 1]);
        collectMapped({ name: 'Nook' });
      `),
    ).toEqual([]);
  });

  test('accepts concrete public contracts and local defaults', async () => {
    expect(
      await OxlintContractScenario.ruleIds(`
        export type DecodeManifestRequest = {
          readonly source: string;
        };
        export function decodeManifest(
          request: DecodeManifestRequest = { source: '' },
        ): void {
          void request;
        }
      `),
    ).toEqual([]);
  });

  for (const [label, config] of [
    ['Loom', LOOM_CONFIG],
    ['executable-skill', EXECUTABLE_SKILL_CONFIG],
  ] as const) {
    test(`the ${label} config reports every type-aware rule`, async () => {
      const ruleIds = await OxlintContractScenario.lint({
        config,
        sources: TYPE_AWARE_VIOLATIONS,
      });
      for (const violation of TYPE_AWARE_VIOLATIONS) {
        const reported = ruleIds.get(violation.name);
        expect({
          name: violation.name,
          reported: Boolean(reported && reported.includes(violation.rule)),
        }).toEqual({ name: violation.name, reported: true });
      }
    });
  }
});
