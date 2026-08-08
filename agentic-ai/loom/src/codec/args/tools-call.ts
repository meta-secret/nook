import { ResultKind } from '../../result.ts';
import {
  decodeErr,
  decodeOk,
  fieldError,
  type DecodeResult,
} from '../field-error.ts';
import { denyUnknownKeys, expectObject, expectString } from '../object.ts';

export type ToolsCallArgs = {
  readonly name: string;
  readonly arguments: unknown;
};

const ALLOWED = new Set(['name', 'arguments']);

export function decodeToolsCallArgs(
  value: unknown,
): DecodeResult<ToolsCallArgs> {
  const object = expectObject(value, 'arguments');
  if (object.kind === ResultKind.Err) {
    return object;
  }
  const unknown = denyUnknownKeys(object.value, ALLOWED, 'arguments');
  const name = expectString(object.value, 'name', 'arguments');
  if (!('arguments' in object.value)) {
    return decodeErr([
      ...unknown,
      ...(name.kind === ResultKind.Err ? name.errors : []),
      fieldError('arguments.arguments', 'missing required field'),
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

export const TOOLS_CALL_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'arguments'],
  properties: {
    name: { type: 'string' },
    arguments: { type: 'object' },
  },
} as const;
