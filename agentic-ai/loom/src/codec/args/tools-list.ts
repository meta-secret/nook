import { ResultKind } from '../../result.ts';
import { RequestKind } from '../enums.ts';
import { decodeErr, decodeOk, type DecodeResult } from '../field-error.ts';
import { denyUnknownKeys, expectObject } from '../object.ts';

export type ToolsListRequest = Record<string, never>;

const ROOT = RequestKind.ToolsList;
const ALLOWED = new Set<string>();

export function decodeToolsListRequest(
  value: unknown,
): DecodeResult<ToolsListRequest> {
  const object = expectObject(value, ROOT);
  if (object.kind === ResultKind.Err) {
    return object;
  }
  const unknown = denyUnknownKeys(object.value, ALLOWED, ROOT);
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
