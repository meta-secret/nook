import { ResultKind } from '../../result.ts';
import { RequestKind } from '../enums.ts';
import { decodeErr, type DecodeResult } from '../field-error.ts';
import {
  collectDecode,
  denyUnknownKeys,
  expectBoolean,
  expectObject,
} from '../object.ts';

export type CortexAuditRequest = {
  readonly includeDensityLint: boolean;
};

const ROOT = RequestKind.CortexAudit;
const ALLOWED = new Set(['includeDensityLint']);

export function decodeCortexAuditRequest(
  value: unknown,
): DecodeResult<CortexAuditRequest> {
  const object = expectObject(value, ROOT);
  if (object.kind === ResultKind.Err) {
    return object;
  }
  const unknown = denyUnknownKeys(object.value, ALLOWED, ROOT);
  const includeDensityLint = expectBoolean(
    object.value,
    'includeDensityLint',
    ROOT,
  );
  if (unknown.length > 0) {
    return decodeErr([
      ...unknown,
      ...(includeDensityLint.kind === ResultKind.Err
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
