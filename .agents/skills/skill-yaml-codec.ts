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

export function parseSkillYamlText(text: string): SkillYamlParseOutcome {
  try {
    return {
      ok: true,
      value: Bun.YAML.parse(text) as UntrustedSkillYamlNode,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function stringifySkillYaml(value: UntrustedSkillYamlNode): string {
  return `${Bun.YAML.stringify(value, undefined, 2).trimEnd()}\n`;
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
