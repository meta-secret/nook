import type { ExternalValue } from '../../lib/guards.ts';
import { RequestFamily } from '../enums.ts';
import {
  DecodeStatus,
  decodeErr,
  decodeOk,
  type DecodeOutcome,
} from '../field-error.ts';
import {
  objectJsonSchema,
  type ObjectJsonSchema,
  type ObjectJsonSchemaArgs,
} from '../json-schema.ts';
import {
  denyUnknownKeys,
  expectObject,
  type ExpectObjectArgs,
} from '../object.ts';

/** toolsList accepts no payload fields. */
export enum ToolsListField {}

export type ToolsListRequest = Record<string, never>;

const ROOT = RequestFamily.ToolsList;

export function decodeToolsListRequest(
  value: ExternalValue,
): DecodeOutcome<ToolsListRequest> {
  const objectArgs: ExpectObjectArgs = { value, path: ROOT };
  const object = expectObject(objectArgs);
  if (object.status === DecodeStatus.Failed) {
    return object;
  }
  const unknownArgs = {
    record: object.value,
    fields: ToolsListField,
    path: ROOT,
  };
  const unknown = denyUnknownKeys(unknownArgs);
  if (unknown.length > 0) {
    return decodeErr(unknown);
  }
  const emptyRequest: ToolsListRequest = {};
  return decodeOk(emptyRequest);
}

const toolsListInputSchemaArgs: ObjectJsonSchemaArgs = {
  required: [],
  properties: {},
};
export const TOOLS_LIST_INPUT_SCHEMA: ObjectJsonSchema = objectJsonSchema(
  toolsListInputSchemaArgs,
);
