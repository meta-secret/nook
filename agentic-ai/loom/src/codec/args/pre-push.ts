import { ResultKind } from '../../result.ts';
import { decodeErr, decodeOk, type DecodeResult } from '../field-error.ts';
import {
  collectDecode,
  denyUnknownKeys,
  expectBoolean,
  expectObject,
} from '../object.ts';

export type PrePushArgs = {
  readonly stage: boolean;
  readonly fetch: boolean;
};

const ALLOWED = new Set(['stage', 'fetch']);

export function decodePrePushArgs(value: unknown): DecodeResult<PrePushArgs> {
  const object = expectObject(value, 'arguments');
  if (object.kind === ResultKind.Err) {
    return object;
  }
  const unknown = denyUnknownKeys(object.value, ALLOWED, 'arguments');
  const stage = expectBoolean(object.value, 'stage', 'arguments');
  const fetch = expectBoolean(object.value, 'fetch', 'arguments');
  if (unknown.length > 0) {
    const errors = [
      ...unknown,
      ...(stage.kind === ResultKind.Err ? stage.errors : []),
      ...(fetch.kind === ResultKind.Err ? fetch.errors : []),
    ];
    return decodeErr(errors);
  }
  return collectDecode([stage, fetch], () => ({
    stage: (stage as { value: boolean }).value,
    fetch: (fetch as { value: boolean }).value,
  }));
}

export const PRE_PUSH_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['stage', 'fetch'],
  properties: {
    stage: { type: 'boolean' },
    fetch: { type: 'boolean' },
  },
} as const;
