import type { UntrustedYamlNode } from '../../lib/guards.ts';

import { RequestFamily } from '../enums.ts';

import {
  DecodeStatus,
  type DecodeOutcome,
  FailedFieldDecode,
  SuccessfulFieldDecode,
} from '../field-error.ts';

import {
  type ObjectJsonSchema,
  type ObjectJsonSchemaArgs,
  JsonSchemaDefinition,
} from '../json-schema.ts';

import {
  type ExpectObjectArgs,
  YamlObjectVocabulary,
  YamlObjectField,
} from '../object.ts';

export class CortexSessionCleanRequestDecoder {
  private constructor(private readonly request: UntrustedYamlNode) {}
  static decode(
    value: UntrustedYamlNode,
  ): DecodeOutcome<CortexSessionCleanRequest> {
    return new CortexSessionCleanRequestDecoder(value).execute();
  }
  private execute(): DecodeOutcome<CortexSessionCleanRequest> {
    const value = this.request;
    const objectArgs: ExpectObjectArgs = { value, path: ROOT };
    const object = YamlObjectField.decode(objectArgs);
    if (object.status === DecodeStatus.Failed) {
      return object;
    }
    const unknownArgs = {
      record: object.value,
      fields: CortexSessionCleanField,
      path: ROOT,
    };
    const unknown = YamlObjectVocabulary.unknownFields(unknownArgs);
    if (unknown.length > 0) {
      return FailedFieldDecode.create(unknown);
    }
    const emptyRequest: CortexSessionCleanRequest = {};
    return SuccessfulFieldDecode.create(emptyRequest);
  }
}

/** cortexSessionClean accepts no payload fields. */
export enum CortexSessionCleanField {}

export type CortexSessionCleanRequest = Record<string, never>;

const ROOT = RequestFamily.CortexSessionClean;

const cortexSessionCleanInputSchemaArgs: ObjectJsonSchemaArgs = {
  required: [],
  properties: {},
};

export const CORTEX_SESSION_CLEAN_INPUT_SCHEMA: ObjectJsonSchema =
  JsonSchemaDefinition.object(cortexSessionCleanInputSchemaArgs);
