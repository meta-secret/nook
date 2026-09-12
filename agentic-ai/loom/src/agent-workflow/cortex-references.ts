export enum CortexReferenceRelation {
  Loaded = 'loaded',
  Cited = 'cited',
  Applied = 'applied',
  Validated = 'validated',
}

export type CortexReference = {
  readonly id: string;
  readonly relation: CortexReferenceRelation;
};

export type AssertCortexReferencesArgs = {
  readonly references: readonly CortexReference[];
  readonly knownIdentifiers: ReadonlySet<string> | false;
};

/** Owns the cortex identifier syntax registry and its capability transitions. */
export class CortexIdentifierSyntax {
  private constructor() {}
  private static readonly CATEGORY_ID = /^CX-[A-Z][A-Z0-9]{1,7}$/u;

  private static readonly SCOPED_ID =
    /^CX-[A-Z][A-Z0-9]{1,7}-[0-9A-HJKMNP-TV-Z]{5}$/u;

  private static readonly CORTEX_REFERENCE_RELATIONS = new Set<string>(
    Object.values(CortexReferenceRelation),
  );

  static assertCortexReferences(args: AssertCortexReferencesArgs): void {
    if (args.references.length > 16) {
      throw new Error('Agent activity Cortex references must be bounded.');
    }
    const seen = new Set<string>();
    for (const reference of args.references) {
      if (
        !reference ||
        typeof reference !== 'object' ||
        Array.isArray(reference) ||
        Object.keys(reference).length !== 2 ||
        !Object.hasOwn(reference, 'id') ||
        !Object.hasOwn(reference, 'relation') ||
        typeof reference.id !== 'string' ||
        typeof reference.relation !== 'string' ||
        !CortexIdentifierSyntax.validCortexIdentifier(reference.id) ||
        !CortexIdentifierSyntax.CORTEX_REFERENCE_RELATIONS.has(
          reference.relation,
        ) ||
        seen.has(`${reference.id}:${reference.relation}`) ||
        (args.knownIdentifiers !== false &&
          !args.knownIdentifiers.has(reference.id))
      ) {
        throw new Error('Agent activity contains an invalid Cortex reference.');
      }
      seen.add(`${reference.id}:${reference.relation}`);
    }
  }

  static validCortexIdentifier(identifier: string): boolean {
    return (
      CortexIdentifierSyntax.CATEGORY_ID.test(identifier) ||
      CortexIdentifierSyntax.SCOPED_ID.test(identifier)
    );
  }

  static validCortexCategoryIdentifier(identifier: string): boolean {
    return CortexIdentifierSyntax.CATEGORY_ID.test(identifier);
  }

  static validCortexScopedIdentifier(identifier: string): boolean {
    return CortexIdentifierSyntax.SCOPED_ID.test(identifier);
  }
}
