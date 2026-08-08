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
  value: ExternalValue,
): DecodeOutcome<PrePushRequest> {
  const objectArgs: ExpectObjectArgs = { value, path: ROOT };
  const object = expectObject(objectArgs);
  if (object.status === DecodeStatus.Failed) {
    return object;
  }
  const unknownArgs: DenyUnknownKeysArgs<PrePushField> = {
    record: object.value,
    fields: PrePushField,
    path: ROOT,
  };
  const unknown = denyUnknownKeys(unknownArgs);
  const stageHostUpdatesArgs: ExpectFieldArgs<PrePushField> = {
    record: object.value,
    key: PrePushField.StageHostUpdates,
    path: ROOT,
  };
  const stageHostUpdates = expectBoolean(stageHostUpdatesArgs);
  const fetchOriginMainArgs: ExpectFieldArgs<PrePushField> = {
    record: object.value,
    key: PrePushField.FetchOriginMain,
    path: ROOT,
  };
  const fetchOriginMain = expectBoolean(fetchOriginMainArgs);
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
  const collectDecodeArgs: CollectDecodeArgs<PrePushRequest> = {
    results: [stageHostUpdates, fetchOriginMain],
    build: () => ({
      stageHostUpdates: (stageHostUpdates as { value: boolean }).value,
      fetchOriginMain: (fetchOriginMain as { value: boolean }).value,
    }),
  };
  return collectDecode(collectDecodeArgs);
}

const prePushInputSchemaArgs: ObjectJsonSchemaArgs = {
  required: [PrePushField.StageHostUpdates, PrePushField.FetchOriginMain],
  properties: {
    [PrePushField.StageHostUpdates]: booleanJsonSchema(),
    [PrePushField.FetchOriginMain]: booleanJsonSchema(),
  },
};
export const PRE_PUSH_INPUT_SCHEMA: ObjectJsonSchema = objectJsonSchema(
  prePushInputSchemaArgs,
);
