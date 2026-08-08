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
  const object = expectObject({ value, path: ROOT });
  if (object.status === DecodeStatus.Failed) {
    return object;
  }
  const unknown = denyUnknownKeys({
    record: object.value,
    fields: PrePushField,
    path: ROOT,
  });
  const stageHostUpdates = expectBoolean({
    record: object.value,
    key: PrePushField.StageHostUpdates,
    path: ROOT,
  });
  const fetchOriginMain = expectBoolean({
    record: object.value,
    key: PrePushField.FetchOriginMain,
    path: ROOT,
  });
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
  return collectDecode({
    results: [stageHostUpdates, fetchOriginMain],
    build: () => ({
      stageHostUpdates: (stageHostUpdates as { value: boolean }).value,
      fetchOriginMain: (fetchOriginMain as { value: boolean }).value,
    }),
  });
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
