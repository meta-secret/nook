import { DecodeStatus } from '../field-error.ts';
import {
  collectDecode,
  denyUnknownKeys,
  expectBoolean,
  expectObject,
} from '../object.ts';
import { RequestFamily } from '../enums.ts';
import { decodeErr, type DecodeOutcome } from '../field-error.ts';

export enum PrePushField {
  StageHostUpdates = 'stageHostUpdates',
  FetchOriginMain = 'fetchOriginMain',
}

export type PrePushRequest = {
  readonly stageHostUpdates: boolean;
  readonly fetchOriginMain: boolean;
};

const ROOT = RequestFamily.PrePush;

export function decodePrePushRequest(
  value: unknown,
): DecodeOutcome<PrePushRequest> {
  const object = expectObject(value, ROOT);
  if (object.status === DecodeStatus.Failed) {
    return object;
  }
  const unknown = denyUnknownKeys(object.value, PrePushField, ROOT);
  const stageHostUpdates = expectBoolean(
    object.value,
    PrePushField.StageHostUpdates,
    ROOT,
  );
  const fetchOriginMain = expectBoolean(
    object.value,
    PrePushField.FetchOriginMain,
    ROOT,
  );
  if (unknown.length > 0) {
    return decodeErr([
      ...unknown,
      ...(stageHostUpdates.status === DecodeStatus.Failed
        ? stageHostUpdates.errors
        : []),
      ...(fetchOriginMain.status === DecodeStatus.Failed
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
