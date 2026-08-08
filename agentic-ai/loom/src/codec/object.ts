import {
  ExternalPropertyPresence,
  externalProperty,
  isRecord,
  type ExternalObject,
  type ExternalValue,
} from '../lib/guards.ts';
import { RemoteTaskPresence, type RemoteTask } from './args/pr-land.ts';
import { AgentStatsOperation, PrLandOperation } from './enums.ts';
import { isExternalNull } from './external.ts';
import {
  DecodeStatus,
  FieldIssue,
  decodeErr,
  decodeOk,
  fieldDetailText,
  fieldError,
  joinPath,
  type DecodeOutcome,
  type FieldError,
} from './field-error.ts';
import {
  fieldNamesOf,
  type RequestFieldVocabulary,
} from './field-vocabulary.ts';

export type ExpectObjectArgs = {
  readonly value: ExternalValue;
  readonly path: string;
};

export function expectObject(
  args: ExpectObjectArgs,
): DecodeOutcome<ExternalObject> {
  if (!isRecord(args.value)) {
    return decodeErr([
      fieldError({ path: args.path, issue: FieldIssue.ExpectedObject }),
    ]);
  }
  return decodeOk(args.value);
}

export type DenyUnknownKeysArgs<FieldName extends string> = {
  readonly record: ExternalObject;
  readonly fields: RequestFieldVocabulary<FieldName>;
  readonly path: string;
};

/** Reject keys outside one request-payload field vocabulary enum. */
export function denyUnknownKeys<FieldName extends string>(
  args: DenyUnknownKeysArgs<FieldName>,
): readonly FieldError[] {
  const allowed = new Set<string>(fieldNamesOf(args.fields));
  const errors: FieldError[] = [];
  for (const key of Object.keys(args.record)) {
    if (!allowed.has(key)) {
      errors.push(
        fieldError({
          path: joinPath({ base: args.path, key }),
          issue: FieldIssue.UnknownField,
        }),
      );
    }
  }
  return errors;
}

export type ExpectFieldArgs<FieldName extends string> = {
  readonly record: ExternalObject;
  readonly key: FieldName;
  readonly path: string;
};

export function expectBoolean<FieldName extends string>(
  args: ExpectFieldArgs<FieldName>,
): DecodeOutcome<boolean> {
  const fieldPath = joinPath({ base: args.path, key: args.key });
  const property = externalProperty({ record: args.record, key: args.key });
  if (property.presence === ExternalPropertyPresence.Absent) {
    return decodeErr([
      fieldError({ path: fieldPath, issue: FieldIssue.MissingRequiredField }),
    ]);
  }
  if (typeof property.value !== 'boolean') {
    return decodeErr([
      fieldError({ path: fieldPath, issue: FieldIssue.ExpectedBoolean }),
    ]);
  }
  return decodeOk(property.value);
}

export function expectString<FieldName extends string>(
  args: ExpectFieldArgs<FieldName>,
): DecodeOutcome<string> {
  const fieldPath = joinPath({ base: args.path, key: args.key });
  const property = externalProperty({ record: args.record, key: args.key });
  if (property.presence === ExternalPropertyPresence.Absent) {
    return decodeErr([
      fieldError({ path: fieldPath, issue: FieldIssue.MissingRequiredField }),
    ]);
  }
  if (typeof property.value !== 'string') {
    return decodeErr([
      fieldError({ path: fieldPath, issue: FieldIssue.ExpectedString }),
    ]);
  }
  return decodeOk(property.value);
}

export function expectPositiveInt<FieldName extends string>(
  args: ExpectFieldArgs<FieldName>,
): DecodeOutcome<number> {
  const fieldPath = joinPath({ base: args.path, key: args.key });
  const property = externalProperty({ record: args.record, key: args.key });
  if (property.presence === ExternalPropertyPresence.Absent) {
    return decodeErr([
      fieldError({ path: fieldPath, issue: FieldIssue.MissingRequiredField }),
    ]);
  }
  if (
    typeof property.value !== 'number' ||
    !Number.isInteger(property.value) ||
    property.value <= 0
  ) {
    return decodeErr([
      fieldError({
        path: fieldPath,
        issue: FieldIssue.ExpectedPositiveInteger,
      }),
    ]);
  }
  return decodeOk(property.value);
}

export function expectRemoteTask<FieldName extends string>(
  args: ExpectFieldArgs<FieldName>,
): DecodeOutcome<RemoteTask> {
  const fieldPath = joinPath({ base: args.path, key: args.key });
  const property = externalProperty({ record: args.record, key: args.key });
  if (
    property.presence === ExternalPropertyPresence.Absent ||
    isExternalNull(property.value)
  ) {
    return decodeOk({ presence: RemoteTaskPresence.Omitted });
  }
  if (typeof property.value !== 'string') {
    return decodeErr([
      fieldError({
        path: fieldPath,
        issue: FieldIssue.ExpectedRemoteTaskString,
      }),
    ]);
  }
  return decodeOk({
    presence: RemoteTaskPresence.Specified,
    task: property.value,
  });
}

export type DecodeExactlyOneOperationArgs<T extends string> = {
  readonly record: ExternalObject;
  readonly path: string;
  readonly operations: readonly T[];
};

export function decodeExactlyOneOperation<T extends string>(
  args: DecodeExactlyOneOperationArgs<T>,
): DecodeOutcome<{ readonly operation: T; readonly payload: ExternalValue }> {
  const keys = Object.keys(args.record);
  const operationKeys = keys.filter((key) =>
    args.operations.includes(key as T),
  );
  const unknownKeys = keys.filter((key) => !args.operations.includes(key as T));
  const errors: FieldError[] = unknownKeys.map((key) =>
    fieldError({
      path: joinPath({ base: args.path, key }),
      issue: FieldIssue.UnknownField,
    }),
  );
  if (operationKeys.length !== 1) {
    errors.push(
      fieldError({
        path: args.path,
        issue: FieldIssue.ExpectedExactlyOneOperationKey,
        detail: fieldDetailText(
          `expected exactly one operation key; known: ${args.operations.join(', ')}`,
        ),
      }),
    );
    return decodeErr(errors);
  }
  if (errors.length > 0) {
    return decodeErr(errors);
  }
  const operation = operationKeys[0] as T;
  const property = externalProperty({ record: args.record, key: operation });
  if (property.presence === ExternalPropertyPresence.Absent) {
    return decodeErr([
      fieldError({
        path: joinPath({ base: args.path, key: operation }),
        issue: FieldIssue.MissingRequiredField,
      }),
    ]);
  }
  return decodeOk({ operation, payload: property.value });
}

export type DecodeStatusCarrier =
  | { readonly status: DecodeStatus.Ok }
  | {
      readonly status: DecodeStatus.Failed;
      readonly errors: readonly FieldError[];
    };

export type CollectDecodeArgs<T> = {
  readonly results: readonly DecodeStatusCarrier[];
  readonly build: () => T;
};

export function collectDecode<T>(args: CollectDecodeArgs<T>): DecodeOutcome<T> {
  const errors: FieldError[] = [];
  for (const result of args.results) {
    if (result.status === DecodeStatus.Failed) {
      errors.push(...result.errors);
    }
  }
  if (errors.length > 0) {
    return decodeErr(errors);
  }
  return decodeOk(args.build());
}

export type MapDecodeArgs<T, U> = {
  readonly outcome: DecodeOutcome<T>;
  readonly build: (value: T) => U;
};

export function mapDecode<T, U>(args: MapDecodeArgs<T, U>): DecodeOutcome<U> {
  if (args.outcome.status === DecodeStatus.Failed) {
    return args.outcome;
  }
  return decodeOk(args.build(args.outcome.value));
}

export const AGENT_STATS_OPERATIONS = Object.values(AgentStatsOperation);
export const PR_LAND_OPERATIONS = Object.values(PrLandOperation);
