/**
 * Boundary-only YAML/JSON syntax node.
 *
 * This is the narrow transport exception to Loom's domain-value rule. Decode
 * it immediately. Never use it for command state, application APIs, or domain
 * results.
 */
export type UntrustedYamlNode =
  string | number | boolean | readonly UntrustedYamlNode[] | UntrustedYamlMap;

/** Untrusted object map from YAML/JSON. */
export type UntrustedYamlMap = {
  readonly [key: string]: UntrustedYamlNode;
};

/** Mutable adapter builder for a serialized Loom response map. */
export type UntrustedYamlMapBuilder = {
  [key: string]: UntrustedYamlNode;
};

export enum UntrustedYamlPropertyPresence {
  Present = 'present',
  Absent = 'absent',
}

export type UntrustedYamlProperty =
  | {
      readonly presence: UntrustedYamlPropertyPresence.Present;
      readonly value: UntrustedYamlNode;
    }
  | { readonly presence: UntrustedYamlPropertyPresence.Absent };

export function isRecord(value: UntrustedYamlNode): value is UntrustedYamlMap {
  return (
    typeof value === 'object' &&
    value instanceof Object &&
    !Array.isArray(value)
  );
}

export function isNonEmptyString(value: UntrustedYamlNode): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Boundary-only bridge for a host parse result before immediate decoding. */
export function asUntrustedYamlNode(value: UntrustedYamlNode): UntrustedYamlNode {
  return value;
}

export type UntrustedYamlPropertyArgs = {
  readonly record: UntrustedYamlMap;
  readonly key: string;
};

/** Read one property without authoring `undefined` from index access. */
export function untrustedYamlProperty(args: UntrustedYamlPropertyArgs): UntrustedYamlProperty {
  for (const [entryKey, value] of Object.entries(args.record)) {
    if (entryKey === args.key) {
      return {
        presence: UntrustedYamlPropertyPresence.Present,
        value,
      };
    }
  }
  return { presence: UntrustedYamlPropertyPresence.Absent };
}

export function sealUntrustedYamlMap(
  builder: UntrustedYamlMapBuilder,
): UntrustedYamlMap {
  return builder;
}
