import { isRecord, type UnknownRecord } from '../lib/guards.ts';
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

export function expectObject(
  value: unknown,
  path: string,
): DecodeOutcome<UnknownRecord> {
  if (!isRecord(value)) {
    return decodeErr([fieldError(path, FieldIssue.ExpectedObject)]);
  }
  return decodeOk(value);
}

/** Accept a field-name enum object; never a raw string allow-list. */
export function denyUnknownKeys(
  record: UnknownRecord,
  fieldEnum: Record<string, string>,
  path: string,
): readonly FieldError[] {
  const allowed = new Set(Object.values(fieldEnum));
  const errors: FieldError[] = [];
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      errors.push(fieldError(joinPath(path, key), FieldIssue.UnknownField));
    }
  }
  return errors;
}

export function expectBoolean(
  record: UnknownRecord,
  key: string,
  path: string,
): DecodeOutcome<boolean> {
  const fieldPath = joinPath(path, key);
  if (!(key in record)) {
    return decodeErr([fieldError(fieldPath, FieldIssue.MissingRequiredField)]);
  }
  const value = record[key];
  if (typeof value !== 'boolean') {
    return decodeErr([fieldError(fieldPath, FieldIssue.ExpectedBoolean)]);
  }
  return decodeOk(value);
}

export function expectString(
  record: UnknownRecord,
  key: string,
  path: string,
): DecodeOutcome<string> {
  const fieldPath = joinPath(path, key);
  if (!(key in record)) {
    return decodeErr([fieldError(fieldPath, FieldIssue.MissingRequiredField)]);
  }
  const value = record[key];
  if (typeof value !== 'string') {
    return decodeErr([fieldError(fieldPath, FieldIssue.ExpectedString)]);
  }
  return decodeOk(value);
}

export function expectPositiveInt(
  record: UnknownRecord,
  key: string,
  path: string,
): DecodeOutcome<number> {
  const fieldPath = joinPath(path, key);
  if (!(key in record)) {
    return decodeErr([fieldError(fieldPath, FieldIssue.MissingRequiredField)]);
  }
  const value = record[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return decodeErr([
      fieldError(fieldPath, FieldIssue.ExpectedPositiveInteger),
    ]);
  }
  return decodeOk(value);
}

export function expectStringEnum<T extends string>(
  record: UnknownRecord,
  key: string,
  path: string,
  allowed: readonly T[],
): DecodeOutcome<T> {
  const fieldPath = joinPath(path, key);
  if (!(key in record)) {
    return decodeErr([fieldError(fieldPath, FieldIssue.MissingRequiredField)]);
  }
  const value = record[key];
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    return decodeErr([
      fieldError(
        fieldPath,
        FieldIssue.ExpectedOneOf,
        fieldDetailText(allowed.join(', ')),
      ),
    ]);
  }
  return decodeOk(value as T);
}

export function expectRemoteTask(
  record: UnknownRecord,
  key: string,
  path: string,
): DecodeOutcome<RemoteTask> {
  const fieldPath = joinPath(path, key);
  if (!(key in record) || isExternalNull(record[key])) {
    return decodeOk({ presence: RemoteTaskPresence.Omitted });
  }
  const value = record[key];
  if (typeof value !== 'string') {
    return decodeErr([
      fieldError(fieldPath, FieldIssue.ExpectedRemoteTaskString),
    ]);
  }
  return decodeOk({ presence: RemoteTaskPresence.Specified, task: value });
}

export function decodeExactlyOneOperation<T extends string>(
  record: UnknownRecord,
  path: string,
  operations: readonly T[],
): DecodeOutcome<{ readonly operation: T; readonly payload: unknown }> {
  const keys = Object.keys(record);
  const operationKeys = keys.filter((key) => operations.includes(key as T));
  const unknownKeys = keys.filter((key) => !operations.includes(key as T));
  const errors: FieldError[] = unknownKeys.map((key) =>
    fieldError(joinPath(path, key), FieldIssue.UnknownField),
  );
  if (operationKeys.length !== 1) {
    errors.push(
      fieldError(
        path,
        FieldIssue.ExpectedExactlyOneOperationKey,
        fieldDetailText(
          `expected exactly one operation key; known: ${operations.join(', ')}`,
        ),
      ),
    );
    return decodeErr(errors);
  }
  if (errors.length > 0) {
    return decodeErr(errors);
  }
  const operation = operationKeys[0] as T;
  return decodeOk({ operation, payload: record[operation] });
}

export function collectDecode<T>(
  results: readonly DecodeOutcome<unknown>[],
  build: () => T,
): DecodeOutcome<T> {
  const errors: FieldError[] = [];
  for (const result of results) {
    if (result.status === DecodeStatus.Failed) {
      errors.push(...result.errors);
    }
  }
  if (errors.length > 0) {
    return decodeErr(errors);
  }
  return decodeOk(build());
}

export function mapDecode<T, U>(
  outcome: DecodeOutcome<T>,
  build: (value: T) => U,
): DecodeOutcome<U> {
  if (outcome.status === DecodeStatus.Failed) {
    return outcome;
  }
  return decodeOk(build(outcome.value));
}

export const AGENT_STATS_OPERATIONS = Object.values(AgentStatsOperation);
export const PR_LAND_OPERATIONS = Object.values(PrLandOperation);
