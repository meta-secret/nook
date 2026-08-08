import { describe, expect, test } from 'bun:test';
import { ESLint, type LintResult } from 'eslint';

type LintTextOptions = {
  filePath: string;
};

describe('Loom ESLint contracts', () => {
  test('rejects cast-wrapped constructor object arguments', async () => {
    const eslint = new ESLint();
    const options: LintTextOptions = { filePath: 'src/eslint-fixture.ts' };
    const results: LintResult[] = await eslint.lintText(
      `
        type WidgetArgs = { name: string };
        declare class Widget {
          constructor(args: WidgetArgs);
        }
        new Widget({ name: 'Nook' } as WidgetArgs);
      `,
      options,
    );

    expect(results[0]?.messages.map((message) => message.ruleId)).toEqual([
      'no-restricted-syntax',
    ]);
  });
});
