import { DecodeStatus } from '../field-error.ts';
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
  value: unknown,
): DecodeOutcome<CortexAuditRequest> {
  const object = expectObject(value, ROOT);
  if (object.status === DecodeStatus.Failed) {
    return object;
  }
  const unknown = denyUnknownKeys(
    object.value,
    Object.values(CortexAuditField),
    ROOT,
  );
  const includeDensityLint = expectBoolean(
    object.value,
    CortexAuditField.IncludeDensityLint,
    ROOT,
  );
  if (unknown.length > 0) {
    return decodeErr([
      ...unknown,
      ...(includeDensityLint.status === DecodeStatus.Failed
        ? includeDensityLint.errors
        : []),
    ]);
  }
  return collectDecode([includeDensityLint], () => ({
    includeDensityLint: (includeDensityLint as { value: boolean }).value,
  }));
}

export const CORTEX_AUDIT_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['includeDensityLint'],
  properties: {
    includeDensityLint: { type: 'boolean' },
  },
} as const;
