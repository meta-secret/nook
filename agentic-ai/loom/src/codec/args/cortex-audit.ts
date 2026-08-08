import type { ExternalValue } from '../../lib/guards.ts';
import { RequestFamily } from '../enums.ts';
import { DecodeStatus, decodeErr, type DecodeOutcome } from '../field-error.ts';
import {
  booleanJsonSchema,
  objectJsonSchema,
  type ObjectJsonSchema,
  type ObjectJsonSchemaArgs,
} from '../json-schema.ts';
import {
  collectDecode,
  denyUnknownKeys,
  expectBoolean,
  expectObject,
  type CollectDecodeArgs,
  type DenyUnknownKeysArgs,
  type ExpectFieldArgs,
  type ExpectObjectArgs,
} from '../object.ts';

export enum CortexAuditField {
  IncludeDensityLint = 'includeDensityLint',
}

export type CortexAuditRequest = {
  readonly includeDensityLint: boolean;
};

const ROOT = RequestFamily.CortexAudit;

export function decodeCortexAuditRequest(
  value: ExternalValue,
): DecodeOutcome<CortexAuditRequest> {
  const objectArgs: ExpectObjectArgs = { value, path: ROOT };
  const object = expectObject(objectArgs);
  if (object.status === DecodeStatus.Failed) {
    return object;
  }
  const unknownArgs: DenyUnknownKeysArgs<CortexAuditField> = {
    record: object.value,
    fields: CortexAuditField,
    path: ROOT,
  };
  const unknown = denyUnknownKeys(unknownArgs);
  const includeDensityLintArgs: ExpectFieldArgs<CortexAuditField> = {
    record: object.value,
    key: CortexAuditField.IncludeDensityLint,
    path: ROOT,
  };
  const includeDensityLint = expectBoolean(includeDensityLintArgs);
  if (unknown.length > 0) {
    return decodeErr([
      ...unknown,
      ...(includeDensityLint.status === DecodeStatus.Failed
        ? includeDensityLint.errors
        : []),
    ]);
  }
  const collectDecodeArgs: CollectDecodeArgs<CortexAuditRequest> = {
    results: [includeDensityLint],
    build: () => ({
      includeDensityLint: (includeDensityLint as { value: boolean }).value,
    }),
  };
  return collectDecode(collectDecodeArgs);
}

const cortexAuditInputSchemaArgs: ObjectJsonSchemaArgs = {
  required: [CortexAuditField.IncludeDensityLint],
  properties: {
    [CortexAuditField.IncludeDensityLint]: booleanJsonSchema(),
  },
};
export const CORTEX_AUDIT_INPUT_SCHEMA: ObjectJsonSchema = objectJsonSchema(
  cortexAuditInputSchemaArgs,
);
