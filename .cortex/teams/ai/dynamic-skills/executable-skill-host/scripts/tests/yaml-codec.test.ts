import {
  ExecutableSkillYamlAdmission,
  ExecutableSkillYamlEncoding,
} from '../src/skill-yaml-codec.ts';
import { expect, test } from 'bun:test';

import {
  SKILL_YAML_DEPTH_LIMIT,
  SKILL_YAML_NODE_LIMIT,
  SKILL_YAML_SCALAR_BYTE_LIMIT,
  type UntrustedSkillYamlNode,
  ExecutableSkillYaml,
} from '../src/skill-yaml-codec.ts';

export class ExecutableSkillHostYamlCodecScenario {
  private constructor(private readonly request: string) {}

  static aliasExpansionYaml(lineEnding: string): string {
    return new ExecutableSkillHostYamlCodecScenario(lineEnding).execute();
  }

  private execute(): string {
    const lineEnding = this.request;
    const lines = ['level0: &level0 [safe, safe, safe, safe]'];
    for (let level = 1; level <= 12; level += 1) {
      const previous = `level${level - 1}`;
      const aliases = new Array<string>(8).fill(`*${previous}`).join(', ');
      lines.push(`level${level}: &level${level} [${aliases}]`);
    }
    return `${lines.join(lineEnding)}${lineEnding}`;
  }
}

const YAML_LINE_ENDINGS = ['\n', '\r\n', '\r'] as const;

test('rejects anchors and aliases before they reach semantic decoding', () => {
  for (const yaml of [
    'value: &anchor text\n',
    'copy: *missing\n',
    'value: &anchor text\ncopy: *anchor\n',
    'value: !!str &anchor text\ncopy: *anchor\n',
    'value: [&anchor text, *anchor]\n',
    '- value\r- &anchor repeated\r- *anchor\r',
    ...YAML_LINE_ENDINGS.map((lineEnding) =>
      ExecutableSkillHostYamlCodecScenario.aliasExpansionYaml(lineEnding),
    ),
  ]) {
    const outcome = ExecutableSkillYaml.from(yaml).execute();
    expect(outcome.isOk()).toBe(false);
    if (outcome.isOk()) return;
    expect(outcome.error.message).toContain('anchors and aliases');
  }
});

test('accepts anchor-like text inside quoted, plain, commented, and block scalars', () => {
  const lines = [
    'quoted: "&anchor *alias"',
    "singleQuoted: '&anchor *alias'",
    'plainPath: path/*/file?a=1&b=2',
    'plainWords: rock & roll and a * alias',
    'plainSuffix: value &anchor',
    'multilinePlain: value',
    '  &anchor *alias',
    'multilineQuoted: "value',
    '  &anchor *alias"',
    'commented: safe # &anchor *alias',
    'literal: |',
    '  &anchor',
    '  *alias',
    'folded: >-',
    '  &anchor *alias',
  ];
  for (const lineEnding of YAML_LINE_ENDINGS) {
    const yaml = `${lines.join(lineEnding)}${lineEnding}`;
    expect(ExecutableSkillYaml.from(yaml).execute().isOk()).toBe(true);
  }
});

test('rejects duplicate mapping keys at root and nested levels', () => {
  for (const yaml of [
    'skillToolsList: {}\nskillToolsList: {}\n',
    'cortexArticleStructure:\n  audit:\n    kind: first\n    kind: second\n',
  ]) {
    const outcome = ExecutableSkillYaml.from(yaml).execute();
    expect(outcome.isOk()).toBe(false);
    if (outcome.isOk()) return;
    expect(outcome.error.message).toBe('Invalid YAML syntax.');
  }
});

test('rejects multiple YAML documents instead of selecting one', () => {
  const outcome = ExecutableSkillYaml.from(
    'skillToolsList:\n  list: {}\n---\nskillToolsList:\n  list: {}\n',
  ).execute();
  expect(outcome.isOk()).toBe(false);
  if (outcome.isOk()) return;
  expect(outcome.error.message).toBe('Invalid YAML syntax.');
});

test('rejects tagged keys before conversion can collapse them', () => {
  for (const yaml of [
    '!!binary YXVkaXQ=: hidden\naudit: visible\n',
    'cortexArticleStructure:\n  !!binary YXVkaXQ=: hidden\n  audit: visible\n',
  ]) {
    const outcome = ExecutableSkillYaml.from(yaml).execute();
    expect(outcome.isOk()).toBe(false);
    if (outcome.isOk()) return;
    expect(outcome.error.message).toBe('Invalid YAML syntax.');
  }
});

test('rejects warnings and every explicit YAML tag', () => {
  for (const yaml of [
    '%YAML 1.2\n---\nvalue: marker\n',
    '%TAG !e! tag:example.com,2026:\n---\nvalue: marker\n',
    '%TAG !! tag:example.com,2026:\n---\nvalue: marker\n',
    '%TAG !e! tag:example.com,2026:\n---\nvalue: !e!secret marker\n',
    'value: !custom marker\n',
    'value: !!str marker\n',
    'value: !!binary bWFya2Vy\n',
    'value: !!timestamp 2026-08-27\n',
    'value: !!set { marker: ~ }\n',
    'value: !!omap\n  - marker: value\n',
  ]) {
    expect(ExecutableSkillYaml.from(yaml).execute().isOk()).toBe(false);
  }
});

test('rejects every YAML directive across accepted line endings', () => {
  for (const newline of ['\n', '\r\n', '\r']) {
    for (const directive of ['%YAML 1.2', '%TAG !! tag:yaml.org,2002:']) {
      expect(
        ExecutableSkillYaml.from(`${directive}${newline}---${newline}value: 1`)
          .execute()
          .isOk(),
      ).toBe(false);
    }
  }
});

test('requires every mapping key to be a plain string scalar', () => {
  for (const yaml of [
    '? [first, second]\n: value\n',
    '? { nested: key }\n: value\n',
    '1: numeric\n',
    'true: boolean\n',
    '~: empty\n',
  ]) {
    expect(ExecutableSkillYaml.from(yaml).execute().isOk()).toBe(false);
  }
});

test('preserves ordinary quoted and unquoted duplicate detection', () => {
  for (const yaml of [
    'plain: first\nplain: second\n',
    '"quoted": first\n\'quoted\': second\n',
  ]) {
    expect(ExecutableSkillYaml.from(yaml).execute().isOk()).toBe(false);
  }
  expect(
    ExecutableSkillYaml.from('plain: first\n"quoted key": second\n')
      .execute()
      .isOk(),
  ).toBe(true);
});

test('rejects unsafe integer scalars without rejecting decimals', () => {
  for (const yaml of [
    'value: 9007199254740992\n',
    'value: -9007199254740992\n',
    'value: 1e100\n',
  ]) {
    expect(ExecutableSkillYaml.from(yaml).execute().isOk()).toBe(false);
  }
  expect(
    ExecutableSkillYaml.from('value: 9007199254740991\ndecimal: 1.5\n')
      .execute()
      .isOk(),
  ).toBe(true);
});

test('enforces exact structural node and depth limits', () => {
  const exactNodes = `[${new Array<string>(SKILL_YAML_NODE_LIMIT - 1)
    .fill('true')
    .join(',')}]`;
  expect(ExecutableSkillYaml.from(exactNodes).execute().isOk()).toBe(true);
  expect(
    ExecutableSkillYaml.from(`${exactNodes.slice(0, -1)},true]`)
      .execute()
      .isOk(),
  ).toBe(false);
  const nested = (depth: number): string =>
    `${'['.repeat(depth)}true${']'.repeat(depth)}`;
  expect(
    ExecutableSkillYaml.from(nested(SKILL_YAML_DEPTH_LIMIT)).execute().isOk(),
  ).toBe(true);
  expect(
    ExecutableSkillYaml.from(nested(SKILL_YAML_DEPTH_LIMIT + 1))
      .execute()
      .isOk(),
  ).toBe(false);
});

test('admits only bounded YAML host values', () => {
  const externalNullBoundaryValue = ''.match(/unmatched-boundary-value/u);
  const omittedFieldBoundaryValue = new Map<string, string>().get('field');
  expect(
    ExecutableSkillYamlAdmission.from(
      Bun.YAML.parse('nested: [safe, 1.5, true]\n'),
    )
      .execute()
      .isOk(),
  ).toBe(true);
  expect(
    ExecutableSkillYamlAdmission.from({
      nested: ['safe', 1.5, true],
    })
      .execute()
      .isOk(),
  ).toBe(true);
  for (const value of [
    externalNullBoundaryValue,
    omittedFieldBoundaryValue,
    () => 'function',
    Symbol('symbol'),
    BigInt(1),
    NaN,
    Infinity,
    2 ** 53,
    { field: omittedFieldBoundaryValue },
    'é'.repeat(SKILL_YAML_SCALAR_BYTE_LIMIT / 2 + 1),
  ]) {
    expect(ExecutableSkillYamlAdmission.from(value).execute().isErr()).toBe(
      true,
    );
  }

  const shared = ['shared'];
  expect(
    ExecutableSkillYamlAdmission.from([shared, shared]).execute().isErr(),
  ).toBe(true);

  let nested: UntrustedSkillYamlNode = true;
  for (let depth = 0; depth <= SKILL_YAML_DEPTH_LIMIT; depth += 1) {
    nested = [nested];
  }
  expect(ExecutableSkillYamlAdmission.from(nested).execute().isErr()).toBe(
    true,
  );
  expect(
    ExecutableSkillYamlAdmission.from(
      new Array<boolean>(SKILL_YAML_NODE_LIMIT).fill(true),
    )
      .execute()
      .isErr(),
  ).toBe(true);
});

test('preserves YAML prototype keys without mutating the result prototype', () => {
  const source = { safe: 'value' };
  Object.defineProperty(source, '__proto__', {
    configurable: true,
    enumerable: true,
    value: { polluted: true },
    writable: true,
  });
  const outcome = ExecutableSkillYamlAdmission.from(source).execute();
  expect(outcome.isOk()).toBe(true);
  if (outcome.isErr()) return;
  if (
    typeof outcome.value !== 'object' ||
    outcome.value === null ||
    Array.isArray(outcome.value)
  )
    return;
  expect(Object.hasOwn(outcome.value, '__proto__')).toBe(true);
  expect(Object.getPrototypeOf(outcome.value)).toBe(Object.prototype);
  expect(Object.getOwnPropertyDescriptor(outcome.value, 'safe')?.value).toBe(
    'value',
  );
});

test('stringify preserves scalar trailing line breaks and spaces', () => {
  expect(
    new ExecutableSkillYamlEncoding(
      'é'.repeat(SKILL_YAML_SCALAR_BYTE_LIMIT / 2 + 1),
    )
      .execute()
      .isErr(),
  ).toBe(true);
  for (const value of [
    'line\n',
    'line\n\n',
    'line  \n',
    'é'.repeat(SKILL_YAML_SCALAR_BYTE_LIMIT / 2),
  ]) {
    const node: UntrustedSkillYamlNode = value;
    const outcome = new ExecutableSkillYamlEncoding(node)
      .execute()
      .andThen((yaml) => ExecutableSkillYaml.from(yaml).execute());
    expect(outcome.isOk()).toBe(true);
    if (outcome.isErr()) return;
    expect(outcome.value).toBe(value);
  }
});
