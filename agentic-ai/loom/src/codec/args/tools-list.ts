import type { ExternalValue } from '../../lib/guards.ts';
import { RequestFamily } from '../enums.ts';
import {
  DecodeStatus,
  decodeErr,
  decodeOk,
  type DecodeOutcome,
} from '../field-error.ts';
import { objectJsonSchema, type ObjectJsonSchema } from '../json-schema.ts';
import { denyUnknownKeys, expectObject } from '../object.ts';

/** toolsList accepts no payload fields. */
export enum ToolsListField {}

export type ToolsListRequest = Record<string, never>;

const ROOT = RequestFamily.ToolsList;

export function decodeToolsListRequest(
  value: ExternalValue,
): DecodeOutcome<ToolsListRequest> {
  const object = expectObject({ value, path: ROOT });
  if (object.status === DecodeStatus.Failed) {
    return object;
  }
  const unknown = denyUnknownKeys({
    record: object.value,
    fields: ToolsListField,
    path: ROOT,
  });
  if (unknown.length > 0) {
    return decodeErr(unknown);
  }
  return decodeOk({});
}

export const TOOLS_LIST_INPUT_SCHEMA: ObjectJsonSchema = objectJsonSchema({
  required: [],
  properties: {},
});
