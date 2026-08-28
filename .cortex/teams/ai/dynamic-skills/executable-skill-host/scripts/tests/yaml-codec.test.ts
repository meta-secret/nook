import { expect, test } from 'bun:test';
import {
  parseSkillYamlText,
  stringifySkillYaml,
  type UntrustedSkillYamlNode,
} from '../src/skill-yaml-codec.ts';
const YAML_LINE_ENDINGS = ['\n', '\r\n', '\r'] as const;
function aliasExpansionYaml(lineEnding: string): string {
  const lines = ['level0: &level0 [safe, safe, safe, safe]'];
  for (let level = 1; level <= 12; level += 1) {
    const previous = `level${level - 1}`;
    const aliases = new Array<string>(8).fill(`*${previous}`).join(', ');
    lines.push(`level${level}: &level${level} [${aliases}]`);
  }
  return `${lines.join(lineEnding)}${lineEnding}`;
}
test('rejects anchors and aliases before they reach semantic decoding', () => {
  for (const yaml of [
    'value: &anchor text\n',
    'copy: *missing\n',
    'value: &anchor text\ncopy: *anchor\n',
    'value: !!str &anchor text\ncopy: *anchor\n',
    'value: [&anchor text, *anchor]\n',
    '- value\r- &anchor repeated\r- *anchor\r',
    ...YAML_LINE_ENDINGS.map((lineEnding) => aliasExpansionYaml(lineEnding)),
  ]) {
    const outcome = parseSkillYamlText(yaml);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('Expected YAML reference rejection.');
    expect(outcome.message).toContain('anchors and aliases');
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
    expect(parseSkillYamlText(yaml).ok).toBe(true);
  }
});
test('rejects duplicate mapping keys at root and nested levels', () => {
  for (const yaml of [
    'skillToolsList: {}\nskillToolsList: {}\n',
    'cortexArticleStructure:\n  audit:\n    kind: first\n    kind: second\n',
  ]) {
    const outcome = parseSkillYamlText(yaml);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('Expected duplicate-key rejection.');
    expect(outcome.message).toBe('Invalid YAML syntax.');
  }
});
test('rejects multiple YAML documents instead of selecting one', () => {
  const outcome = parseSkillYamlText(
    'skillToolsList:\n  list: {}\n---\nskillToolsList:\n  list: {}\n',
  );
  expect(outcome.ok).toBe(false);
  if (outcome.ok) throw new Error('Expected multi-document rejection.');
  expect(outcome.message).toBe('Invalid YAML syntax.');
});
test('rejects tagged keys before conversion can collapse them', () => {
  for (const yaml of [
    '!!binary YXVkaXQ=: hidden\naudit: visible\n',
    'cortexArticleStructure:\n  !!binary YXVkaXQ=: hidden\n  audit: visible\n',
  ]) {
    const outcome = parseSkillYamlText(yaml);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('Expected tagged-key rejection.');
    expect(outcome.message).toBe('Invalid YAML syntax.');
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
    expect(parseSkillYamlText(yaml).ok).toBe(false);
  }
});
test('rejects every YAML directive across accepted line endings', () => {
  for (const newline of ['\n', '\r\n', '\r']) {
    for (const directive of ['%YAML 1.2', '%TAG !! tag:yaml.org,2002:']) {
      expect(
        parseSkillYamlText(`${directive}${newline}---${newline}value: 1`).ok,
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
    expect(parseSkillYamlText(yaml).ok).toBe(false);
  }
});
test('preserves ordinary quoted and unquoted duplicate detection', () => {
  for (const yaml of [
    'plain: first\nplain: second\n',
    '"quoted": first\n\'quoted\': second\n',
  ]) {
    expect(parseSkillYamlText(yaml).ok).toBe(false);
  }
  expect(parseSkillYamlText('plain: first\n"quoted key": second\n').ok).toBe(
    true,
  );
});
test('rejects unsafe integer scalars without rejecting decimals', () => {
  for (const yaml of [
    'value: 9007199254740992\n',
    'value: -9007199254740992\n',
    'value: 1e100\n',
  ]) {
    expect(parseSkillYamlText(yaml).ok).toBe(false);
  }
  expect(parseSkillYamlText('value: 9007199254740991\ndecimal: 1.5\n').ok).toBe(
    true,
  );
});
test('stringify preserves scalar trailing line breaks and spaces', () => {
  for (const value of ['line\n', 'line\n\n', 'line  \n']) {
    const node: UntrustedSkillYamlNode = value;
    const outcome = parseSkillYamlText(stringifySkillYaml(node));
    if (!outcome.ok) throw new Error('Expected scalar round trip.');
    expect(outcome.value).toBe(value);
  }
});
