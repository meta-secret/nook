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
  type CollectDecodeArgs,
  type DenyUnknownKeysArgs,
  type ExpectFieldArgs,
  type ExpectObjectArgs,
  FieldDecodeCollection,
  YamlObjectVocabulary,
  YamlBooleanField,
  YamlObjectField,
} from '../object.ts';

export class CortexAuditRequestDecoder {
  private constructor(private readonly request: UntrustedYamlNode) {}
  static decode(value: UntrustedYamlNode): DecodeOutcome<CortexAuditRequest> {
    return new CortexAuditRequestDecoder(value).execute();
  }
  private execute(): DecodeOutcome<CortexAuditRequest> {
    const value = this.request;
    const objectArgs: ExpectObjectArgs = { value, path: ROOT };
    const object = YamlObjectField.decode(objectArgs);
    if (object.status === DecodeStatus.Failed) {
      return object;
    }
    const unknownArgs: DenyUnknownKeysArgs<CortexAuditField> = {
      record: object.value,
      fields: CortexAuditField,
      path: ROOT,
    };
    const unknown = YamlObjectVocabulary.unknownFields(unknownArgs);
    const includeDensityLintArgs: ExpectFieldArgs<CortexAuditField> = {
      record: object.value,
      key: CortexAuditField.IncludeDensityLint,
      path: ROOT,
    };
    const includeDensityLint = YamlBooleanField.decode(includeDensityLintArgs);
    if (unknown.length > 0) {
      return FailedFieldDecode.create([
        ...unknown,
        ...(includeDensityLint.status === DecodeStatus.Failed
          ? includeDensityLint.errors
          : []),
      ]);
    }
    const collectDecodeArgs: CollectDecodeArgs<CortexAuditRequest> = {
      results: [includeDensityLint],
      build: () => ({
        includeDensityLint:
          SuccessfulFieldDecode.requireValue(includeDensityLint),
      }),
    };
    return FieldDecodeCollection.collect(collectDecodeArgs);
  }
}

export enum CortexAuditField {
  IncludeDensityLint = 'includeDensityLint',
}

export type CortexAuditRequest = {
  readonly includeDensityLint: boolean;
};

const ROOT = RequestFamily.CortexAudit;

const cortexAuditInputSchemaArgs: ObjectJsonSchemaArgs = {
  required: [CortexAuditField.IncludeDensityLint],
  properties: {
    [CortexAuditField.IncludeDensityLint]: JsonSchemaDefinition.boolean(),
  },
};

export const CORTEX_AUDIT_INPUT_SCHEMA: ObjectJsonSchema =
  JsonSchemaDefinition.object(cortexAuditInputSchemaArgs);
