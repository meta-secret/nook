/** The host syntax edge; values leave it only through a concrete decoder. */
export class UntrustedYamlBoundary {
  private constructor(private readonly value: UntrustedYamlNode) {}
  static fromJson(value: UntrustedYamlNode): UntrustedYamlNode {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    )
      return value;
    if (Array.isArray(value))
      return value.map((item: UntrustedYamlNode) =>
        UntrustedYamlBoundary.fromJson(item),
      );
    if (typeof value === 'object' && value instanceof Object) {
      const result: UntrustedYamlMapBuilder = {};
      for (const [key, item] of Object.entries(value)) {
        // Match JSON omission for optional fields in already-typed values.
        const omitted = Symbol('omitted');
        const { admittedItem = omitted } = { admittedItem: item };
        if (admittedItem === omitted) continue;
        Object.defineProperty(result, key, {
          value: UntrustedYamlBoundary.fromJson(admittedItem),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return result;
    }
    throw new Error('Unsupported JSON syntax value.');
  }
  static isRecord(value: UntrustedYamlNode): value is UntrustedYamlMap {
    return (
      typeof value === 'object' &&
      value instanceof Object &&
      !Array.isArray(value)
    );
  }
  static isNonEmptyString(value: UntrustedYamlNode): value is string {
    return typeof value === 'string' && value.length > 0;
  }
  static fromHost(value: UntrustedYamlNode): UntrustedYamlNode {
    return new UntrustedYamlBoundary(value).value;
  }
  static seal(builder: UntrustedYamlMapBuilder): UntrustedYamlMap {
    return builder;
  }
  static property(args: UntrustedYamlPropertyArgs): UntrustedYamlProperty {
    return new UntrustedYamlObject(args.record).property(args.key);
  }
}
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

export type UntrustedYamlPropertyArgs = {
  readonly record: UntrustedYamlMap;
  readonly key: string;
};

/** Owns property-presence interpretation for one decoded host map. */
class UntrustedYamlObject {
  constructor(private readonly record: UntrustedYamlMap) {}
  property(key: string): UntrustedYamlProperty {
    for (const [entryKey, value] of Object.entries(this.record)) {
      if (entryKey === key)
        return { presence: UntrustedYamlPropertyPresence.Present, value };
    }
    return { presence: UntrustedYamlPropertyPresence.Absent };
  }
}
