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

const CATEGORY_ID = /^CX-[A-Z][A-Z0-9]{1,7}$/u;
const SCOPED_ID = /^CX-[A-Z][A-Z0-9]{1,7}-[0-9A-HJKMNP-TV-Z]{5}$/u;
const CORTEX_REFERENCE_RELATIONS = new Set<string>(
  Object.values(CortexReferenceRelation),
);

export function assertCortexReferences(args: AssertCortexReferencesArgs): void {
  if (args.references.length > 16) {
    throw new Error('Agent activity Cortex references must be bounded.');
  }
  const seen = new Set<string>();
  for (const reference of args.references) {
    if (
      !validCortexIdentifier(reference.id) ||
      !CORTEX_REFERENCE_RELATIONS.has(reference.relation) ||
      seen.has(`${reference.id}:${reference.relation}`) ||
      (args.knownIdentifiers !== false &&
        !args.knownIdentifiers.has(reference.id))
    ) {
      throw new Error('Agent activity contains an invalid Cortex reference.');
    }
    seen.add(`${reference.id}:${reference.relation}`);
  }
}

export function validCortexIdentifier(identifier: string): boolean {
  return CATEGORY_ID.test(identifier) || SCOPED_ID.test(identifier);
}

export function validCortexCategoryIdentifier(identifier: string): boolean {
  return CATEGORY_ID.test(identifier);
}

export function validCortexScopedIdentifier(identifier: string): boolean {
  return SCOPED_ID.test(identifier);
}
