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

export class ToolsListRequestDecoder {
  private constructor(private readonly request: UntrustedYamlNode) {}
  static decode(value: UntrustedYamlNode): DecodeOutcome<ToolsListRequest> {
    return new ToolsListRequestDecoder(value).execute();
  }
  private execute(): DecodeOutcome<ToolsListRequest> {
    const value = this.request;
    const objectArgs: ExpectObjectArgs = { value, path: ROOT };
    const object = YamlObjectField.decode(objectArgs);
    if (object.status === DecodeStatus.Failed) {
      return object;
    }
    const unknownArgs = {
      record: object.value,
      fields: ToolsListField,
      path: ROOT,
    };
    const unknown = YamlObjectVocabulary.unknownFields(unknownArgs);
    if (unknown.length > 0) {
      return FailedFieldDecode.create(unknown);
    }
    const emptyRequest: ToolsListRequest = {};
    return SuccessfulFieldDecode.create(emptyRequest);
  }
}

/** toolsList accepts no payload fields. */
export enum ToolsListField {}

export type ToolsListRequest = Record<string, never>;

const ROOT = RequestFamily.ToolsList;

const toolsListInputSchemaArgs: ObjectJsonSchemaArgs = {
  required: [],
  properties: {},
};

export const TOOLS_LIST_INPUT_SCHEMA: ObjectJsonSchema =
  JsonSchemaDefinition.object(toolsListInputSchemaArgs);
