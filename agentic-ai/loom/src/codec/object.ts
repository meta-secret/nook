import { isRecord, type UnknownRecord } from '../lib/guards.ts';
import { ResultKind } from '../result.ts';
import {
  decodeErr,
  decodeOk,
  fieldError,
  joinPath,
  type DecodeResult,
  type FieldError,
} from './field-error.ts';

export function expectObject(
  value: unknown,
  path: string,
): DecodeResult<UnknownRecord> {
  if (!isRecord(value)) {
    return decodeErr([fieldError(path, 'expected object')]);
  }
  return decodeOk(value);
}

export function denyUnknownKeys(
  record: UnknownRecord,
  allowed: ReadonlySet<string>,
  path: string,
): readonly FieldError[] {
  const errors: FieldError[] = [];
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      errors.push(fieldError(joinPath(path, key), 'unknown field'));
    }
  }
  return errors;
}

export function expectBoolean(
  record: UnknownRecord,
  key: string,
  path: string,
): DecodeResult<boolean> {
  const fieldPath = joinPath(path, key);
  if (!(key in record)) {
    return decodeErr([fieldError(fieldPath, 'missing required field')]);
  }
  const value = record[key];
  if (typeof value !== 'boolean') {
    return decodeErr([fieldError(fieldPath, 'expected boolean')]);
  }
  return decodeOk(value);
}

export function expectString(
  record: UnknownRecord,
  key: string,
  path: string,
): DecodeResult<string> {
  const fieldPath = joinPath(path, key);
  if (!(key in record)) {
    return decodeErr([fieldError(fieldPath, 'missing required field')]);
  }
  const value = record[key];
  if (typeof value !== 'string') {
    return decodeErr([fieldError(fieldPath, 'expected string')]);
  }
  return decodeOk(value);
}

export function expectPositiveInt(
  record: UnknownRecord,
  key: string,
  path: string,
): DecodeResult<number> {
  const fieldPath = joinPath(path, key);
  if (!(key in record)) {
    return decodeErr([fieldError(fieldPath, 'missing required field')]);
  }
  const value = record[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return decodeErr([fieldError(fieldPath, 'expected positive integer')]);
  }
  return decodeOk(value);
}

export function expectStringEnum<T extends string>(
  record: UnknownRecord,
  key: string,
  path: string,
  allowed: readonly T[],
): DecodeResult<T> {
  const fieldPath = joinPath(path, key);
  if (!(key in record)) {
    return decodeErr([fieldError(fieldPath, 'missing required field')]);
  }
  const value = record[key];
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    return decodeErr([
      fieldError(fieldPath, `expected one of: ${allowed.join(', ')}`),
    ]);
  }
  return decodeOk(value as T);
}

export function expectOptionalStringOrNull(
  record: UnknownRecord,
  key: string,
  path: string,
): DecodeResult<string | undefined> {
  const fieldPath = joinPath(path, key);
  if (!(key in record)) {
    return decodeOk(undefined);
  }
  const value = record[key];
  if (value === null) {
    return decodeOk(undefined);
  }
  if (typeof value !== 'string') {
    return decodeErr([
      fieldError(fieldPath, 'expected string, null, or omitted'),
    ]);
  }
  return decodeOk(value);
}

export function collectDecode<T>(
  results: readonly DecodeResult<unknown>[],
  build: () => T,
): DecodeResult<T> {
  const errors: FieldError[] = [];
  for (const result of results) {
    if (result.kind === ResultKind.Err) {
      errors.push(...result.errors);
    }
  }
  if (errors.length > 0) {
    return decodeErr(errors);
  }
  return decodeOk(build());
}
