import { ResultKind } from '../../result.ts';
import { RequestKind } from '../enums.ts';
import { decodeErr, type DecodeResult } from '../field-error.ts';
import {
  collectDecode,
  denyUnknownKeys,
  expectBoolean,
  expectObject,
} from '../object.ts';

export type PrePushRequest = {
  readonly stageHostUpdates: boolean;
  readonly fetchOriginMain: boolean;
};

const ROOT = RequestKind.PrePush;
const ALLOWED = new Set(['stageHostUpdates', 'fetchOriginMain']);

export function decodePrePushRequest(
  value: unknown,
): DecodeResult<PrePushRequest> {
  const object = expectObject(value, ROOT);
  if (object.kind === ResultKind.Err) {
    return object;
  }
  const unknown = denyUnknownKeys(object.value, ALLOWED, ROOT);
  const stageHostUpdates = expectBoolean(
    object.value,
    'stageHostUpdates',
    ROOT,
  );
  const fetchOriginMain = expectBoolean(object.value, 'fetchOriginMain', ROOT);
  if (unknown.length > 0) {
    return decodeErr([
      ...unknown,
      ...(stageHostUpdates.kind === ResultKind.Err
        ? stageHostUpdates.errors
        : []),
      ...(fetchOriginMain.kind === ResultKind.Err
        ? fetchOriginMain.errors
        : []),
    ]);
  }
  return collectDecode([stageHostUpdates, fetchOriginMain], () => ({
    stageHostUpdates: (stageHostUpdates as { value: boolean }).value,
    fetchOriginMain: (fetchOriginMain as { value: boolean }).value,
  }));
}

export const PRE_PUSH_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['stageHostUpdates', 'fetchOriginMain'],
  properties: {
    stageHostUpdates: { type: 'boolean' },
    fetchOriginMain: { type: 'boolean' },
  },
} as const;
