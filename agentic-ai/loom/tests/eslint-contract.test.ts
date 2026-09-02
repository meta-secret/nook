import { describe, expect, test } from 'bun:test';
import { ESLint } from 'eslint';

type LintTextOptions = {
  filePath: string;
};

const options: LintTextOptions = { filePath: 'src/cli.ts' };

async function ruleIds(source: string) {
  const eslint = new ESLint();
  const results = await eslint.lintText(source, options);
  const [defaulted1 = []] = [
    results[0]?.messages.map((message) => message.ruleId),
  ];
  return defaulted1;
}

describe('Loom ESLint contracts', () => {
  test('rejects generic object and unknown boundary types', async () => {
    expect(
      await ruleIds(`
        declare function decodeObject(message: object): void;
        declare function decodeUnknown(message: unknown): void;
      `),
    ).toEqual([
      '@typescript-eslint/no-restricted-types',
      '@typescript-eslint/no-restricted-types',
    ]);
  });

  test('rejects explicit any', async () => {
    expect(
      await ruleIds('declare function decode(message: any): void;'),
    ).toEqual(['@typescript-eslint/no-explicit-any']);
  });

  test('rejects generic transport and value aliases', async () => {
    expect(
      await ruleIds(`
        declare function decodeExternal(message: ExternalValue): void;
        declare function decodeJson(message: JsonValue): void;
        declare function decodeGeneric(message: GenericValue): void;
      `),
    ).toEqual([
      '@typescript-eslint/no-restricted-types',
      '@typescript-eslint/no-restricted-types',
      '@typescript-eslint/no-restricted-types',
    ]);
  });

  test('accepts local object literals and inline parameter shapes', async () => {
    expect(
      await ruleIds(`
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
      await ruleIds(`
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
});
