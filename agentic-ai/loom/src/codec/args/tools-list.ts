import { ResultKind } from '../../result.ts';
import { decodeErr, decodeOk, type DecodeResult } from '../field-error.ts';
import { denyUnknownKeys, expectObject } from '../object.ts';

export type ToolsListArgs = Record<string, never>;

const ALLOWED = new Set<string>();

export function decodeToolsListArgs(
  value: unknown,
): DecodeResult<ToolsListArgs> {
  const object = expectObject(value, 'arguments');
  if (object.kind === ResultKind.Err) {
    return object;
  }
  const unknown = denyUnknownKeys(object.value, ALLOWED, 'arguments');
  if (unknown.length > 0) {
    return decodeErr(unknown);
  }
  return decodeOk({});
}

export const TOOLS_LIST_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {},
} as const;
