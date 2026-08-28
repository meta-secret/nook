import {
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
const YAML_STRINGIFY_OPTIONS = { indent: 2 } as const;
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
export function parseSkillYamlText(text: string): SkillYamlParseOutcome {
  try {
    const normalizedText = text.replace(/\r\n?/gu, '\n');
    if (/^%[A-Z]+(?:[ \t]|$)/mu.test(normalizedText)) {
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
/** Validate inert nodes before conversion can coerce keys or emit warnings. */
function validateSkillYamlAst(node: ParsedNode): SkillYamlAstIssue {
  if (isAlias(node) || typeof node.anchor === 'string') {
    return SkillYamlAstIssue.Reference;
  }
  if (typeof node.tag === 'string') return SkillYamlAstIssue.Unsupported;
  if (isScalar(node)) {
    if (
      typeof node.value === 'string' ||
      typeof node.value === 'boolean' ||
      (typeof node.value === 'number' && Number.isFinite(node.value))
    ) {
      return SkillYamlAstIssue.None;
    }
    return SkillYamlAstIssue.Unsupported;
  }
  if (isMap(node)) {
    for (const pair of node.items) {
      const keyIssue = validateSkillYamlAst(pair.key);
      if (keyIssue !== SkillYamlAstIssue.None) return keyIssue;
      if (!isScalar(pair.key) || typeof pair.key.value !== 'string') {
        return SkillYamlAstIssue.Unsupported;
      }
      if (!pair.value) return SkillYamlAstIssue.Unsupported;
      const valueIssue = validateSkillYamlAst(pair.value);
      if (valueIssue !== SkillYamlAstIssue.None) return valueIssue;
    }
    return SkillYamlAstIssue.None;
  }
  if (isSeq(node)) {
    for (const item of node.items) {
      const itemIssue = validateSkillYamlAst(item);
      if (itemIssue !== SkillYamlAstIssue.None) return itemIssue;
    }
    return SkillYamlAstIssue.None;
  }
  return SkillYamlAstIssue.Unsupported;
}
export function stringifySkillYaml(value: UntrustedSkillYamlNode): string {
  return `${stringify(value, YAML_STRINGIFY_OPTIONS).trimEnd()}\n`;
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
