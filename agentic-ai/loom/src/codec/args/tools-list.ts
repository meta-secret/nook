import { DecodeStatus } from '../field-error.ts';
import { denyUnknownKeys, expectObject } from '../object.ts';
import { RequestFamily } from '../enums.ts';
import { decodeErr, decodeOk, type DecodeOutcome } from '../field-error.ts';

export type ToolsListRequest = Record<string, never>;

const ROOT = RequestFamily.ToolsList;

export function decodeToolsListRequest(
  value: unknown,
): DecodeOutcome<ToolsListRequest> {
  const object = expectObject(value, ROOT);
  if (object.status === DecodeStatus.Failed) {
    return object;
  }
  const unknown = denyUnknownKeys(object.value, [], ROOT);
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
