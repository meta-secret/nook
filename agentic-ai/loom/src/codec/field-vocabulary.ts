export class RequestFieldCatalog<FieldName extends string> {
  private constructor(
    private readonly request: RequestFieldVocabulary<FieldName>,
  ) {}
  static names<FieldName extends string>(
    vocabulary: RequestFieldVocabulary<FieldName>,
  ): readonly FieldName[] {
    return new RequestFieldCatalog<FieldName>(vocabulary).execute();
  }
  private execute(): readonly FieldName[] {
    const vocabulary = this.request;
    return Object.values(vocabulary);
  }
}
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
