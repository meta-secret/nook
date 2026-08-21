import type { UntrustedYamlNode } from '../../lib/guards.ts';
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

/** cortexSessionClean accepts no payload fields. */
export enum CortexSessionCleanField {}

export type CortexSessionCleanRequest = Record<string, never>;

const ROOT = RequestFamily.CortexSessionClean;

export function decodeCortexSessionCleanRequest(
  value: UntrustedYamlNode,
): DecodeOutcome<CortexSessionCleanRequest> {
  const objectArgs: ExpectObjectArgs = { value, path: ROOT };
  const object = expectObject(objectArgs);
  if (object.status === DecodeStatus.Failed) {
    return object;
  }
  const unknownArgs = {
    record: object.value,
    fields: CortexSessionCleanField,
    path: ROOT,
  };
  const unknown = denyUnknownKeys(unknownArgs);
  if (unknown.length > 0) {
    return decodeErr(unknown);
  }
  const emptyRequest: CortexSessionCleanRequest = {};
  return decodeOk(emptyRequest);
}

const cortexSessionCleanInputSchemaArgs: ObjectJsonSchemaArgs = {
  required: [],
  properties: {},
};

export const CORTEX_SESSION_CLEAN_INPUT_SCHEMA: ObjectJsonSchema =
  objectJsonSchema(cortexSessionCleanInputSchemaArgs);
