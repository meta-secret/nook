/**
 * A TypeScript string enum whose members are YAML field names for one request
 * payload object (for example `typeof PrePushField`).
 *
 * This is intentionally not `Record<string, string>`: the value type is the
 * field-name enum member type, so callers pass a real vocabulary enum.
 */
export type RequestFieldVocabulary<FieldName extends string> = {
  readonly [EnumMember: string]: FieldName;
};

export function fieldNamesOf<FieldName extends string>(
  vocabulary: RequestFieldVocabulary<FieldName>,
): readonly FieldName[] {
  return Object.values(vocabulary);
}
