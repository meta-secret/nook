import type { UntrustedYamlNode } from '../../lib/guards.ts';

import { RequestFamily } from '../enums.ts';

import {
  DecodeStatus,
  type DecodeOutcome,
  FailedFieldDecode,
} from '../field-error.ts';

import {
  type ObjectJsonSchema,
  type ObjectJsonSchemaArgs,
  JsonSchemaDefinition,
} from '../json-schema.ts';

import {
  type CollectDecodeArgs,
  type DenyUnknownKeysArgs,
  type ExpectFieldArgs,
  type ExpectObjectArgs,
  FieldDecodeCollection,
  YamlObjectVocabulary,
  YamlBooleanField,
  YamlObjectField,
} from '../object.ts';

export class PrePushRequestDecoder {
  private constructor(private readonly request: UntrustedYamlNode) {}
  static decode(value: UntrustedYamlNode): DecodeOutcome<PrePushRequest> {
    return new PrePushRequestDecoder(value).execute();
  }
  private execute(): DecodeOutcome<PrePushRequest> {
    const value = this.request;
    const objectArgs: ExpectObjectArgs = { value, path: ROOT };
    const object = YamlObjectField.decode(objectArgs);
    if (object.status === DecodeStatus.Failed) {
      return object;
    }
    const unknownArgs: DenyUnknownKeysArgs<PrePushField> = {
      record: object.value,
      fields: PrePushField,
      path: ROOT,
    };
    const unknown = YamlObjectVocabulary.unknownFields(unknownArgs);
    const stageHostUpdatesArgs: ExpectFieldArgs<PrePushField> = {
      record: object.value,
      key: PrePushField.StageHostUpdates,
      path: ROOT,
    };
    const stageHostUpdates = YamlBooleanField.decode(stageHostUpdatesArgs);
    const fetchOriginMainArgs: ExpectFieldArgs<PrePushField> = {
      record: object.value,
      key: PrePushField.FetchOriginMain,
      path: ROOT,
    };
    const fetchOriginMain = YamlBooleanField.decode(fetchOriginMainArgs);
    if (unknown.length > 0) {
      return FailedFieldDecode.create([
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
    return FieldDecodeCollection.collect(collectDecodeArgs);
  }
}

export enum PrePushField {
  StageHostUpdates = 'stageHostUpdates',
  FetchOriginMain = 'fetchOriginMain',
}

export type PrePushRequest = {
  readonly stageHostUpdates: boolean;
  readonly fetchOriginMain: boolean;
};

const ROOT = RequestFamily.PrePush;

const prePushInputSchemaArgs: ObjectJsonSchemaArgs = {
  required: [PrePushField.StageHostUpdates, PrePushField.FetchOriginMain],
  properties: {
    [PrePushField.StageHostUpdates]: JsonSchemaDefinition.boolean(),
    [PrePushField.FetchOriginMain]: JsonSchemaDefinition.boolean(),
  },
};

export const PRE_PUSH_INPUT_SCHEMA: ObjectJsonSchema =
  JsonSchemaDefinition.object(prePushInputSchemaArgs);
