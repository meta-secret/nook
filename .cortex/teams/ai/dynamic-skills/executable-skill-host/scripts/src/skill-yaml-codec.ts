import {
  CST,
  Lexer,
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  stringify,
  type ParsedNode,
} from 'yaml';
/**
 * Boundary-only YAML syntax node. Decode it immediately into a concrete skill
 * request. Never retain it in skill domain state or expose it from actions.
 */
export type UntrustedSkillYamlNode =
  | string
  | number
  | boolean
  | readonly UntrustedSkillYamlNode[]
  | UntrustedSkillYamlMap;
export type UntrustedSkillYamlMap = {
  readonly [key: string]: UntrustedSkillYamlNode;
};
type SkillYamlContainer =
  readonly UntrustedSkillYamlNode[] | UntrustedSkillYamlMap;
export type SkillYamlParseSuccess = {
  readonly ok: true;
  readonly value: UntrustedSkillYamlNode;
};
export type SkillYamlParseFailure = {
  readonly ok: false;
  readonly message: string;
};
export type SkillYamlParseOutcome =
  SkillYamlParseFailure | SkillYamlParseSuccess;
const YAML_REFERENCE_FAILURE =
  'YAML anchors and aliases are not supported by executable skills.';
const YAML_SYNTAX_FAILURE = 'Invalid YAML syntax.';
const YAML_STRINGIFY_OPTIONS = {
  aliasDuplicateObjects: false,
  indent: 2,
} as const;
enum SkillYamlAstIssue {
  None = 'none',
  Reference = 'reference',
  Unsupported = 'unsupported',
}
const YAML_PARSE_OPTIONS = {
  prettyErrors: false,
  resolveKnownTags: false,
  schema: 'core',
  strict: true,
  uniqueKeys: true,
} as const;
const YAML_TO_JS_OPTIONS = { maxAliasCount: 0 } as const;
export const SKILL_YAML_NODE_LIMIT = 16_384;
export const SKILL_YAML_DEPTH_LIMIT = 64;
export const SKILL_YAML_SCALAR_BYTE_LIMIT = 1024 * 1024;
const UTF8_ENCODER = new TextEncoder();
const SKILL_YAML_DOCUMENT_BYTE_LIMIT = 4 * 1_024 * 1_024;
export function parseSkillYamlText(text: string): SkillYamlParseOutcome {
  try {
    const normalizedText = text.replace(/\r\n?/gu, '\n');
    if (
      !skillYamlSourceWithinBounds(normalizedText) ||
      /^%[A-Z]+(?:[ \t]|$)/mu.test(normalizedText)
    ) {
      return { ok: false, message: YAML_SYNTAX_FAILURE };
    }
    const document = parseDocument(normalizedText, YAML_PARSE_OPTIONS);
    if (
      document.errors.length > 0 ||
      document.warnings.length > 0 ||
      document.directives.yaml.explicit ||
      Object.entries(document.directives.tags).some(
        ([handle, prefix]) =>
          handle !== '!!' || prefix !== 'tag:yaml.org,2002:',
      ) ||
      !document.contents
    ) {
      return { ok: false, message: YAML_SYNTAX_FAILURE };
    }
    const astIssue = validateSkillYamlAst(document.contents);
    if (astIssue === SkillYamlAstIssue.Reference) {
      return { ok: false, message: YAML_REFERENCE_FAILURE };
    }
    if (astIssue === SkillYamlAstIssue.Unsupported) {
      return { ok: false, message: YAML_SYNTAX_FAILURE };
    }
    return {
      ok: true,
      value: document.toJS(YAML_TO_JS_OPTIONS) as UntrustedSkillYamlNode,
    };
  } catch {
    return { ok: false, message: YAML_SYNTAX_FAILURE };
  }
}
function skillYamlSourceWithinBounds(source: string): boolean {
  if (UTF8_ENCODER.encode(source).byteLength > SKILL_YAML_DOCUMENT_BYTE_LIMIT)
    return false;
  let depth = 0;
  let nodes = 0;
  let scalarFollows = false;
  let lineStart = true;
  for (const lexeme of new Lexer().lex(source)) {
    const type = CST.tokenType(lexeme);
    const scalarContent = scalarFollows;
    if (scalarFollows) {
      scalarFollows = false;
      if (UTF8_ENCODER.encode(lexeme).byteLength > SKILL_YAML_SCALAR_BYTE_LIMIT)
        return false;
    }
    if (type === 'scalar') {
      scalarFollows = true;
      nodes += 1;
    } else if (
      type === 'alias' ||
      type === 'single-quoted-scalar' ||
      type === 'double-quoted-scalar'
    ) {
      nodes += 1;
      if (UTF8_ENCODER.encode(lexeme).byteLength > SKILL_YAML_SCALAR_BYTE_LIMIT)
        return false;
    } else if (type === 'flow-map-start' || type === 'flow-seq-start') {
      nodes += 1;
      depth += 1;
    } else if (type === 'flow-map-end' || type === 'flow-seq-end') {
      depth -= 1;
    } else if (type === 'map-value-ind' || type === 'seq-item-ind') {
      nodes += 1;
    }
    if (
      !scalarContent &&
      lineStart &&
      type === 'space' &&
      lexeme.length >= SKILL_YAML_DEPTH_LIMIT
    )
      return false;
    lineStart = type === 'newline';
    if (nodes > SKILL_YAML_NODE_LIMIT || depth > SKILL_YAML_DEPTH_LIMIT)
      return false;
  }
  return true;
}
/** Validate inert nodes before conversion can coerce keys or emit warnings. */
function validateSkillYamlAst(node: ParsedNode): SkillYamlAstIssue {
  const pending: Array<{ readonly depth: number; readonly node: ParsedNode }> =
    [{ depth: 0, node }];
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) return SkillYamlAstIssue.Unsupported;
    nodes += 1;
    if (nodes > SKILL_YAML_NODE_LIMIT || current.depth > SKILL_YAML_DEPTH_LIMIT)
      return SkillYamlAstIssue.Unsupported;
    const item = current.node;
    if (isAlias(item) || typeof item.anchor === 'string')
      return SkillYamlAstIssue.Reference;
    if (typeof item.tag === 'string') return SkillYamlAstIssue.Unsupported;
    if (isScalar(item)) {
      if (
        typeof item.value !== 'string' &&
        typeof item.value !== 'boolean' &&
        (typeof item.value !== 'number' ||
          !Number.isFinite(item.value) ||
          (Number.isInteger(item.value) && !Number.isSafeInteger(item.value)))
      )
        return SkillYamlAstIssue.Unsupported;
      continue;
    }
    if (isMap(item)) {
      for (const pair of item.items) {
        if (!isScalar(pair.key) || typeof pair.key.value !== 'string') {
          return SkillYamlAstIssue.Unsupported;
        }
        if (!pair.value) return SkillYamlAstIssue.Unsupported;
        const value = { depth: current.depth + 1, node: pair.value };
        const key = { depth: current.depth + 1, node: pair.key };
        pending.push(value, key);
      }
      continue;
    }
    if (isSeq(item)) {
      for (const child of item.items) {
        if (!child) return SkillYamlAstIssue.Unsupported;
        const next = { depth: current.depth + 1, node: child };
        pending.push(next);
      }
      continue;
    }
    return SkillYamlAstIssue.Unsupported;
  }
  return SkillYamlAstIssue.None;
}
export function stringifySkillYaml(value: UntrustedSkillYamlNode): string {
  assertSerializableSkillYaml(value);
  const serialized = stringify(value, YAML_STRINGIFY_OPTIONS);
  return serialized.endsWith('\n') ? serialized : `${serialized}\n`;
}
function assertSerializableSkillYaml(value: UntrustedSkillYamlNode): void {
  const pending: Array<{
    readonly depth: number;
    readonly value: UntrustedSkillYamlNode;
  }> = [{ depth: 0, value }];
  const seen = new Set<SkillYamlContainer>();
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) throw new Error('Invalid YAML response.');
    nodes += 1;
    if (nodes > SKILL_YAML_NODE_LIMIT || current.depth > SKILL_YAML_DEPTH_LIMIT)
      throw new Error('Invalid YAML response.');
    if (
      typeof current.value === 'number' &&
      (!Number.isFinite(current.value) ||
        (Number.isInteger(current.value) &&
          !Number.isSafeInteger(current.value)))
    )
      throw new Error('Invalid YAML response.');
    if (oversizedSkillYamlScalar(current.value))
      throw new Error('Invalid YAML response.');
    if (typeof current.value !== 'object') continue;
    if (seen.has(current.value)) throw new Error('Invalid YAML response.');
    seen.add(current.value);
    const keys = Array.isArray(current.value) ? [] : Object.keys(current.value);
    if (keys.some(oversizedSkillYamlScalar))
      throw new Error('Invalid YAML response.');
    const values = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value);
    nodes += keys.length;
    for (const child of values) {
      const next = { depth: current.depth + 1, value: child };
      pending.push(next);
    }
  }
}
function oversizedSkillYamlScalar(value: UntrustedSkillYamlNode): boolean {
  return (
    typeof value === 'string' &&
    UTF8_ENCODER.encode(value).byteLength > SKILL_YAML_SCALAR_BYTE_LIMIT
  );
}
export function isSkillYamlMap(
  value: UntrustedSkillYamlNode,
): value is UntrustedSkillYamlMap {
  return (
    typeof value === 'object' &&
    value instanceof Object &&
    !Array.isArray(value)
  );
}
export type SkillYamlPropertyRequest = {
  readonly key: string;
  readonly map: UntrustedSkillYamlMap;
};
export type SkillYamlProperty =
  | { readonly found: true; readonly value: UntrustedSkillYamlNode }
  | { readonly found: false };
export function skillYamlProperty(
  request: SkillYamlPropertyRequest,
): SkillYamlProperty {
  for (const [key, value] of Object.entries(request.map)) {
    if (key === request.key) return { found: true, value };
  }
  return { found: false };
}
