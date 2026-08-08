import { DecodeStatus } from '../field-error.ts';
import type { ExternalValue } from '../../lib/guards.ts';
import {
  collectDecode,
  denyUnknownKeys,
  expectBoolean,
  expectObject,
} from '../object.ts';
import { RequestFamily } from '../enums.ts';
import { decodeErr, type DecodeOutcome } from '../field-error.ts';

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
  const object = expectObject({ value, path: ROOT });
  if (object.status === DecodeStatus.Failed) {
    return object;
  }
  const unknown = denyUnknownKeys({
    record: object.value,
    fields: CortexAuditField,
    path: ROOT,
  });
  const includeDensityLint = expectBoolean({
    record: object.value,
    key: CortexAuditField.IncludeDensityLint,
    path: ROOT,
  });
  if (unknown.length > 0) {
    return decodeErr([
      ...unknown,
      ...(includeDensityLint.status === DecodeStatus.Failed
        ? includeDensityLint.errors
        : []),
    ]);
  }
  return collectDecode({
    results: [includeDensityLint],
    build: () => ({
      includeDensityLint: (includeDensityLint as { value: boolean }).value,
    }),
  });
}

export const CORTEX_AUDIT_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['includeDensityLint'],
  properties: {
    includeDensityLint: { type: 'boolean' },
  },
} as const;
