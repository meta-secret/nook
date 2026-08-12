import { describe, expect, test } from 'bun:test';
import { ESLint } from 'eslint';

type LintTextOptions = {
  filePath: string;
};

describe('Loom ESLint contracts', () => {
  test('rejects the generic object type', async () => {
    const eslint = new ESLint();
    const options: LintTextOptions = { filePath: 'src/cli.ts' };
    const results = await eslint.lintText(
      'declare function decode(message: object): void;',
      options,
    );

    expect(results[0]?.messages.map((message) => message.ruleId)).toEqual([
      '@typescript-eslint/no-restricted-types',
    ]);
  });

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
        type WidgetArgs = { name: string };
        declare class Widget {
          constructor(label: string, args: WidgetArgs);
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
        type WidgetArgs = { name: string };
        type WidgetArgumentSequence = WidgetArgs[];
        declare function consume(...args: WidgetArgumentSequence): void;
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

  test('rejects conditional and reassigned spread arrays', async () => {
    const eslint = new ESLint();
    const options: LintTextOptions = { filePath: 'src/cli.ts' };
    const results = await eslint.lintText(
      `
        type WidgetArgs = { name: string };
        type WidgetArgumentSequence = WidgetArgs[];
        declare const flag: boolean;
        declare function consume(...args: WidgetArgumentSequence): void;
        let packed = [];
        packed = [{ name: 'Vault' }];
        consume(...(flag ? [{ name: 'Nook' }] : []));
        consume(...packed);
      `,
      options,
    );

    expect(results[0]?.messages.map((message) => message.ruleId)).toEqual([
      'no-useless-assignment',
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
        type WidgetArgumentSequence = WidgetArgs[];
        declare function consume(...args: WidgetArgumentSequence): void;
        const packed: WidgetArgs[] = [{ name: 'Nook' }];
        consume(...packed);
      `,
      options,
    );

    expect(results[0]?.messages).toEqual([]);
  });

  test('rejects inline object parameter types', async () => {
    const eslint = new ESLint();
    const options: LintTextOptions = { filePath: 'src/cli.ts' };
    const results = await eslint.lintText(
      `
        function collectOutcomeObservation(args: {
          startedAt: number;
          authPath: string;
          sawMutation: boolean;
        }): void {
          void args;
        }
      `,
      options,
    );

    expect(results[0]?.messages.map((message) => message.ruleId)).toEqual([
      'loom/no-raw-object-arguments',
    ]);
  });

  test('rejects inline mapped parameter types', async () => {
    const eslint = new ESLint();
    const options: LintTextOptions = { filePath: 'src/cli.ts' };
    const results = await eslint.lintText(
      `
        function collectMappedValues<T>(args: { [K in keyof T]: T[K] }): void {
          void args;
        }
      `,
      options,
    );

    expect(results[0]?.messages.map((message) => message.ruleId)).toEqual([
      'loom/no-raw-object-arguments',
    ]);
  });

  test('rejects inline array and tuple parameter types', async () => {
    const eslint = new ESLint();
    const options: LintTextOptions = { filePath: 'src/cli.ts' };
    const results = await eslint.lintText(
      `
        function collectTags(tags: string[]): void { void tags; }
        function collectPair(pair: [string, number]): void { void pair; }
      `,
      options,
    );

    expect(results[0]?.messages.map((message) => message.ruleId)).toEqual([
      'loom/no-raw-object-arguments',
      'loom/no-raw-object-arguments',
    ]);
  });

  test('rejects generic-form inline array parameter types', async () => {
    const eslint = new ESLint();
    const options: LintTextOptions = { filePath: 'src/cli.ts' };
    const results = await eslint.lintText(
      `
        function collectTags(tags: Array<string>): void { void tags; }
        function inspectTags(tags: ReadonlyArray<string>): void { void tags; }
      `,
      options,
    );

    expect(results[0]?.messages.map((message) => message.ruleId)).toEqual([
      'loom/no-raw-object-arguments',
      'loom/no-raw-object-arguments',
    ]);
  });

  test('rejects built-in object and unresolved generic parameter references', async () => {
    const eslint = new ESLint();
    const options: LintTextOptions = { filePath: 'src/cli.ts' };
    const results = await eslint.lintText(
      `
        import type { Args } from './contracts';
        function collectLabels(labels: Record<string, string>): void {
          void labels;
        }
        type Account = { id: string; secret: string };
        function pickAccount(account: Pick<Account, 'id'>): void { void account; }
        function omitSecret(account: Omit<Account, 'secret'>): void { void account; }
        function consume(args: Args): void { void args; }
        function scalarKey(key: keyof { name: string }): void { void key; }
        function scalarIndexed(value: { name: string }['name']): void { void value; }
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

  test('accepts inline object return types from function-valued parameters', async () => {
    const eslint = new ESLint();
    const options: LintTextOptions = { filePath: 'src/cli.ts' };
    const results = await eslint.lintText(
      `
        type Builder = (name: string) => { name: string };
        function consume(build: () => { name: string }): void { void build; }
        function consumeNamed(build: Builder): void { void build; }
      `,
      options,
    );

    expect(results[0]?.messages).toEqual([]);
  });

  test('rejects generic referenced parameter contract names', async () => {
    const eslint = new ESLint();
    const options: LintTextOptions = { filePath: 'src/cli.ts' };
    const results = await eslint.lintText(
      `
        type Base = { value: string; other: string };
        type Args = Record<string, string>;
        type WriteArgs = Map<string, string>;
        type PickArgs = Pick<Base, 'value'>;
        type MergeArgs = Set<string>;
        type PutArgs = Omit<Base, 'other'>;
        type HitsArgs = { value: string };
        type ColumnsArgs = { value: string };
        type BranchArgs = { value: string };
        function consume(args: Args): void { void args; }
        function write(args: WriteArgs): void { void args; }
        function pick(args: PickArgs): void { void args; }
        function merge(args: MergeArgs): void { void args; }
        function put(args: PutArgs): void { void args; }
        function hits(args: HitsArgs): void { void args; }
        function columns(args: ColumnsArgs): void { void args; }
        function branch(args: BranchArgs): void { void args; }
      `,
      options,
    );

    expect(results[0]?.messages.map((message) => message.ruleId)).toEqual([
      'loom/no-raw-object-arguments',
      'loom/no-raw-object-arguments',
      'loom/no-raw-object-arguments',
      'loom/no-raw-object-arguments',
      'loom/no-raw-object-arguments',
      'loom/no-raw-object-arguments',
      'loom/no-raw-object-arguments',
      'loom/no-raw-object-arguments',
    ]);
  });

  test('rejects wrapped and qualified generic parameter contract names', async () => {
    const eslint = new ESLint();
    const options: LintTextOptions = { filePath: 'src/cli.ts' };
    const results = await eslint.lintText(
      `
        type Args = { value: string };
        namespace Contracts { export type Args = { value: string }; }
        type Marker = { readonly marker: true };
        function wrapped(args: Readonly<Args>): void { void args; }
        function qualified(args: Contracts.Args): void { void args; }
        function union(args: Args | string): void { void args; }
        function intersection(args: Args & Marker): void { void args; }
        function imported(args: import('./contracts').Args): void { void args; }
        const defaults = { value: 'Nook' };
        function derived(args: typeof defaults): void { void args; }
      `,
      options,
    );

    expect(results[0]?.messages.map((message) => message.ruleId)).toEqual([
      'loom/no-raw-object-arguments',
      'loom/no-raw-object-arguments',
      'loom/no-raw-object-arguments',
      'loom/no-raw-object-arguments',
      'loom/no-raw-object-arguments',
      'loom/no-raw-object-arguments',
    ]);
  });

  test('accepts generic-looking scalar aliases and enums', async () => {
    const eslint = new ESLint();
    const options: LintTextOptions = { filePath: 'src/cli.ts' };
    const results = await eslint.lintText(
      `
        type Result = string;
        enum State { Ready = 'ready' }
        function consume(result: Result): void { void result; }
        function transition(state: State): void { void state; }
      `,
      options,
    );

    expect(results[0]?.messages).toEqual([]);
  });

  test('accepts a domain-specific referenced parameter contract name', async () => {
    const eslint = new ESLint();
    const options: LintTextOptions = { filePath: 'src/cli.ts' };
    const results = await eslint.lintText(
      `
        type PersistExtensionPairingItemsRequest = { value: string };
        function persist(args: PersistExtensionPairingItemsRequest): void {
          void args;
        }
      `,
      options,
    );

    expect(results[0]?.messages).toEqual([]);
  });

  test('rejects inferred object parameter defaults', async () => {
    const eslint = new ESLint();
    const options: LintTextOptions = { filePath: 'src/cli.ts' };
    const results = await eslint.lintText(
      `
        function direct(args = { name: 'Nook' }): void { void args; }
        function destructured({ args = { name: 'Nook' } }): void {
          void args;
        }
      `,
      options,
    );

    expect(results[0]?.messages.map((message) => message.ruleId)).toEqual([
      'loom/no-raw-object-arguments',
      'loom/no-raw-object-arguments',
    ]);
  });

  test('rejects object defaults under a named parameter contract', async () => {
    const eslint = new ESLint();
    const options: LintTextOptions = { filePath: 'src/cli.ts' };
    const results = await eslint.lintText(
      `
        type ForwardConsumeRequest = { args?: { name: string } };
        function direct(args: ForwardConsumeRequest = {}): void {
          void args;
        }
        function forward(
          { args = { name: 'Nook' } }: ForwardConsumeRequest,
        ): void {
          void args;
        }
        function constructed(args = new Map()): void { void args; }
        const defaults: ForwardConsumeRequest = {};
        function buildDefaults(): ForwardConsumeRequest { return defaults; }
        function named(args = defaults): void { void args; }
        function factory(args = buildDefaults()): void { void args; }
        type DocumentQuery = { root?: ParentNode };
        function global({ root = document }: DocumentQuery): void { void root; }
        const runtime = { defaults };
        function member(args = runtime.defaults): void { void args; }
      `,
      options,
    );

    expect(results[0]?.messages.map((message) => message.ruleId)).toEqual([
      'loom/no-raw-object-arguments',
      'loom/no-raw-object-arguments',
      'loom/no-raw-object-arguments',
      'loom/no-raw-object-arguments',
      'loom/no-raw-object-arguments',
      'loom/no-raw-object-arguments',
      'loom/no-raw-object-arguments',
    ]);
  });
});
