import { ResultKind } from '../result.ts';
import {
  decodeErr,
  decodeOk,
  fieldError,
  type DecodeResult,
} from './field-error.ts';
import { denyUnknownKeys, expectObject, expectString } from './object.ts';

export type LoomRequest = {
  readonly name: string;
  readonly arguments: unknown;
};

const ALLOWED = new Set(['name', 'arguments']);

export function decodeLoomRequest(value: unknown): DecodeResult<LoomRequest> {
  const object = expectObject(value, '');
  if (object.kind === ResultKind.Err) {
    return object;
  }
  const unknown = denyUnknownKeys(object.value, ALLOWED, '');
  const name = expectString(object.value, 'name', '');
  if (!('arguments' in object.value)) {
    return decodeErr([
      ...unknown,
      ...(name.kind === ResultKind.Err ? name.errors : []),
      fieldError('arguments', 'missing required field'),
    ]);
  }
  if (name.kind === ResultKind.Err) {
    return decodeErr([...unknown, ...name.errors]);
  }
  if (unknown.length > 0) {
    return decodeErr(unknown);
  }
  return decodeOk({
    name: name.value,
    arguments: object.value.arguments,
  });
}
