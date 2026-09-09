import type { z } from 'zod';

export enum CortexArticleRequestFailureKind {
  InvalidRequest = 'Invalid Cortex article-structure request.',
  InvalidDocument = 'Invalid Cortex article document.',
  DuplicateDocument = 'Duplicate Cortex article document path.',
  InvalidBlock = 'Invalid Cortex article semantic block.',
  InvalidHeading = 'Invalid Cortex article heading block.',
  InvalidBlockKind = 'Invalid Cortex article semantic block kind.',
  NonmonotonicLine = 'Cortex article block lines must be strictly ordered.',
  FindingCapacity = 'Cortex article request finding capacity exceeds its bound.',
  ResultBudget = 'Cortex article request result budget exceeds its bound.',
  RequestBytes = 'Cortex article request exceeds its byte bound.',
  InvalidResult = 'Invalid Cortex article-structure result.',
  InvalidFinding = 'Invalid Cortex article finding.',
  InvalidDiagnostics = 'Invalid Cortex article finding diagnostics.',
  Verification = 'Cortex article-structure semantic verification failed.',
  ResultBytes = 'Cortex article result exceeds its byte bound.',
}

type CortexArticleRequestDecodeFailure = {
  readonly kind: CortexArticleRequestFailureKind;
  readonly path: string;
};

export class CortexArticleRequestDecodeError {
  readonly message: string;
  readonly name: string;
  readonly kind: CortexArticleRequestFailureKind;
  readonly path: string;

  constructor(failure: CortexArticleRequestDecodeFailure) {
    this.message = failure.kind;
    this.name = 'CortexArticleRequestDecodeError';
    this.kind = failure.kind;
    this.path = failure.path;
  }
}

type CortexArticleSchemaFailureRequest = {
  readonly error: z.ZodError;
  readonly kind: CortexArticleRequestFailureKind;
  readonly path: string;
};

/** Translates library diagnostics into the established, payload-free contract. */
export class CortexArticleSchemaFailure {
  constructor(private readonly request: CortexArticleSchemaFailureRequest) {}

  error(): CortexArticleRequestDecodeError {
    const { error, kind, path } = this.request;
    const unknownKey = error.issues.find(
      (issue) => issue.code === 'unrecognized_keys',
    );
    if (unknownKey) {
      return new CortexArticleRequestDecodeError({
        kind,
        path: `${path}["<unknown-key>"]`,
      });
    }
    // Strict envelope/record key admission precedes ordinary field validation.
    // Zod supplies canonical schema order; missing fields retain the old leading dot.
    const missing = error.issues.find(
      (issue) => issue.path.length > 0 && issue.input === undefined,
    );
    const issue = missing ?? error.issues[0];
    const field = issue?.path[0];
    const fieldPath =
      field === undefined
        ? path
        : path.length > 0 || missing !== undefined
          ? `${path}.${String(field)}`
          : String(field);
    return new CortexArticleRequestDecodeError({ kind, path: fieldPath });
  }
}
