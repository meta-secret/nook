import { describe, expect, test } from 'bun:test';
import { ESLint } from 'eslint';

interface SkillLintTextOptions {
  readonly filePath: string;
}

type SkillLintResults = ESLint.LintResult[];

const sourceOptions: SkillLintTextOptions = {
  filePath: 'typescript-no-unknown/tests/eslint-contract.test.ts',
};

function ruleIds(results: SkillLintResults): Array<string> {
  return (
    results[0]?.messages.flatMap((message) =>
      message.ruleId ? [message.ruleId] : [],
    ) ?? []
  );
}

describe('executable-skill concrete value contract', () => {
  test('rejects generic value-bag aliases', async () => {
    const eslint = new ESLint();
    const results = await eslint.lintText(
      `
        type ExternalValue = string;
        type ExternalObject = Readonly<Record<string, string>>;
        type JsonValue = string | number;
        type GenericValue = string;
        declare function useExternalValue(value: ExternalValue): void;
        declare function useExternalObject(value: ExternalObject): void;
        declare function useJsonValue(value: JsonValue): void;
        declare function useGenericValue(value: GenericValue): void;
      `,
      sourceOptions,
    );

    expect(ruleIds(results)).toEqual([
      '@typescript-eslint/no-restricted-types',
      '@typescript-eslint/no-restricted-types',
      '@typescript-eslint/no-restricted-types',
      '@typescript-eslint/no-restricted-types',
    ]);
  });
});
