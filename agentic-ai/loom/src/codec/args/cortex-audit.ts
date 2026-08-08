import { ResultKind } from '../../result.ts';
import { decodeErr, type DecodeResult } from '../field-error.ts';
import {
  collectDecode,
  denyUnknownKeys,
  expectBoolean,
  expectObject,
} from '../object.ts';

export type CortexAuditArgs = {
  readonly density: boolean;
};

const ALLOWED = new Set(['density']);

export function decodeCortexAuditArgs(
  value: unknown,
): DecodeResult<CortexAuditArgs> {
  const object = expectObject(value, 'arguments');
  if (object.kind === ResultKind.Err) {
    return object;
  }
  const unknown = denyUnknownKeys(object.value, ALLOWED, 'arguments');
  const density = expectBoolean(object.value, 'density', 'arguments');
  if (unknown.length > 0) {
    return decodeErr([
      ...unknown,
      ...(density.kind === ResultKind.Err ? density.errors : []),
    ]);
  }
  return collectDecode([density], () => ({
    density: (density as { value: boolean }).value,
  }));
}

export const CORTEX_AUDIT_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['density'],
  properties: {
    density: { type: 'boolean' },
  },
} as const;
