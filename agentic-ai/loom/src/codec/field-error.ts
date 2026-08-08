import { ResultKind, type Ok } from '../result.ts';

export type FieldError = {
  readonly path: string;
  readonly message: string;
};

export type DecodeErr = {
  readonly kind: ResultKind.Err;
  readonly errors: readonly FieldError[];
};

export type DecodeResult<T> = Ok<T> | DecodeErr;

export function decodeOk<T>(value: T): Ok<T> {
  return { kind: ResultKind.Ok, value };
}

export function decodeErr(errors: readonly FieldError[]): DecodeErr {
  return { kind: ResultKind.Err, errors };
}

export function fieldError(path: string, message: string): FieldError {
  return { path, message };
}

export function joinPath(base: string, key: string): string {
  if (base.length === 0) {
    return key;
  }
  return `${base}.${key}`;
}
