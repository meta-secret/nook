import { describe, expect, test } from 'bun:test';
import { ESLint } from 'eslint';

type LintTextOptions = {
  filePath: string;
};

describe('Loom ESLint contracts', () => {
  test('rejects cast-wrapped constructor object arguments', async () => {
    const eslint = new ESLint();
    const options: LintTextOptions = { filePath: 'src/cli.ts' };
    const results = await eslint.lintText(
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
      'loom/no-raw-object-arguments',
    ]);
  });

  test('rejects object literals in multi-argument calls and constructors', async () => {
    const eslint = new ESLint();
    const options: LintTextOptions = { filePath: 'src/cli.ts' };
    const results = await eslint.lintText(
      `
        declare class Widget {
          constructor(label: string, args: { name: string });
        }
        Object.assign({}, { name: 'Nook' });
        new Widget('vault', { name: 'Nook' });
      `,
      options,
    );

    expect(results[0]?.messages.map((message) => message.ruleId)).toEqual([
      'loom/no-raw-object-arguments',
      'loom/no-raw-object-arguments',
      'loom/no-raw-object-arguments',
    ]);
  });

  test('rejects satisfies-wrapped call and constructor arguments', async () => {
    const eslint = new ESLint();
    const options: LintTextOptions = { filePath: 'src/cli.ts' };
    const results = await eslint.lintText(
      `
        type WidgetArgs = { name: string };
        declare function consume(args: WidgetArgs): void;
        declare class Widget {
          constructor(args: WidgetArgs);
        }
        consume({ name: 'Nook' } satisfies WidgetArgs);
        new Widget({ name: 'Vault' } satisfies WidgetArgs);
      `,
      options,
    );

    expect(results[0]?.messages.map((message) => message.ruleId)).toEqual([
      'loom/no-raw-object-arguments',
      'loom/no-raw-object-arguments',
    ]);
  });

  test('rejects angle assertions and nested TypeScript wrappers', async () => {
    const eslint = new ESLint();
    const options: LintTextOptions = { filePath: 'src/cli.ts' };
    const results = await eslint.lintText(
      `
        type WidgetArgs = { name: string };
        declare function consume(args: WidgetArgs): void;
        declare class Widget {
          constructor(args: WidgetArgs);
        }
        consume(<WidgetArgs>{ name: 'Nook' });
        consume(({ name: 'Vault' } as WidgetArgs)!);
        new Widget((({ name: 'Key' } satisfies WidgetArgs) as WidgetArgs)!);
      `,
      options,
    );

    expect(results[0]?.messages.map((message) => message.ruleId)).toEqual([
      'loom/no-raw-object-arguments',
      'loom/no-raw-object-arguments',
      'loom/no-raw-object-arguments',
    ]);
  });

  test('rejects object literals hidden in result expressions', async () => {
    const eslint = new ESLint();
    const options: LintTextOptions = { filePath: 'src/cli.ts' };
    const results = await eslint.lintText(
      `
        type WidgetArgs = { name: string };
        declare const flag: boolean;
        declare const typedArgs: WidgetArgs;
        declare function consume(args: WidgetArgs): void;
        declare class Widget { constructor(args: WidgetArgs); }
        consume(flag ? { name: 'Nook' } : typedArgs);
        consume(flag && { name: 'Vault' });
        consume((typedArgs, { name: 'Key' }));
        new Widget(flag ? typedArgs : { name: 'Sentinel' });
      `,
      options,
    );

    expect(results[0]?.messages.map((message) => message.ruleId)).toEqual([
      'loom/no-raw-object-arguments',
      'loom/no-raw-object-arguments',
      'loom/no-raw-object-arguments',
      'loom/no-raw-object-arguments',
    ]);
  });

  test('allows object literals returned by function-valued arguments', async () => {
    const eslint = new ESLint();
    const options: LintTextOptions = { filePath: 'src/cli.ts' };
    const results = await eslint.lintText(
      `
        type Widget = { name: string };
        type Factory = () => Widget;
        declare function consume(factory: Factory): void;
        consume((() => ({ name: 'Nook' })) as Factory);
      `,
      options,
    );

    expect(results[0]?.messages).toEqual([]);
  });

  test('rejects object literals expanded from spread arrays', async () => {
    const eslint = new ESLint();
    const options: LintTextOptions = { filePath: 'src/cli.ts' };
    const results = await eslint.lintText(
      `
        declare function consume(...args: { name: string }[]): void;
        const packed = [{ name: 'Sentinel' }];
        consume(...[{ name: 'Nook' }]);
        consume(...[...[{ name: 'Vault' }]]);
        consume(...packed);
      `,
      options,
    );

    expect(results[0]?.messages.map((message) => message.ruleId)).toEqual([
      'loom/no-raw-object-arguments',
      'loom/no-raw-object-arguments',
      'loom/no-raw-object-arguments',
    ]);
  });

  test('allows explicitly typed named spread arrays', async () => {
    const eslint = new ESLint();
    const options: LintTextOptions = { filePath: 'src/cli.ts' };
    const results = await eslint.lintText(
      `
        type WidgetArgs = { name: string };
        declare function consume(...args: WidgetArgs[]): void;
        const packed: WidgetArgs[] = [{ name: 'Nook' }];
        consume(...packed);
      `,
      options,
    );

    expect(results[0]?.messages).toEqual([]);
  });
});
