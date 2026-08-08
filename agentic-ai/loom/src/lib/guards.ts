/** Untrusted YAML/JSON scalar, array, or object payload. */
export type ExternalValue =
  string | number | boolean | readonly ExternalValue[] | ExternalObject;

/** Untrusted object map from YAML/JSON. */
export type ExternalObject = {
  readonly [key: string]: ExternalValue;
};

/** Mutable builder for encoding external objects. */
export type ExternalObjectBuilder = {
  [key: string]: ExternalValue;
};

export enum ExternalPropertyPresence {
  Present = 'present',
  Absent = 'absent',
}

export type ExternalProperty =
  | {
      readonly presence: ExternalPropertyPresence.Present;
      readonly value: ExternalValue;
    }
  | { readonly presence: ExternalPropertyPresence.Absent };

export function isRecord(value: ExternalValue): value is ExternalObject {
  return (
    typeof value === 'object' &&
    value instanceof Object &&
    !Array.isArray(value)
  );
}

export function isNonEmptyString(value: ExternalValue): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Narrow a host parse result into the Loom external-value model. */
export function asExternalValue(value: ExternalValue): ExternalValue {
  return value;
}

export type ExternalPropertyArgs = {
  readonly record: ExternalObject;
  readonly key: string;
};

/** Read one property without authoring `undefined` from index access. */
export function externalProperty(args: ExternalPropertyArgs): ExternalProperty {
  for (const [entryKey, value] of Object.entries(args.record)) {
    if (entryKey === args.key) {
      return {
        presence: ExternalPropertyPresence.Present,
        value,
      };
    }
  }
  return { presence: ExternalPropertyPresence.Absent };
}

export function sealExternalObject(
  builder: ExternalObjectBuilder,
): ExternalObject {
  return builder;
}
