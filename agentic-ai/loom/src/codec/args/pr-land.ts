import type { UntrustedYamlNode } from '../../lib/guards.ts';

import {
  DecodeStatus,
  type DecodeOutcome,
  FailedFieldDecode,
  SuccessfulFieldDecode,
} from '../field-error.ts';

import {
  type IntegerJsonSchemaArgs,
  type ObjectJsonSchema,
  type ObjectJsonSchemaArgs,
  JsonSchemaDefinition,
} from '../json-schema.ts';

import {
  type DenyUnknownKeysArgs,
  type ExpectFieldArgs,
  type ExpectObjectArgs,
  YamlObjectVocabulary,
  YamlBooleanField,
  YamlObjectField,
  YamlPositiveIntegerField,
  YamlRemoteTaskField,
} from '../object.ts';

export class PrLandPullRequestPayload {
  private constructor(private readonly request: DecodePrLandPrPayloadArgs) {}
  static decode(
    args: DecodePrLandPrPayloadArgs,
  ): DecodeOutcome<PrLandPrRequest> {
    return new PrLandPullRequestPayload(args).execute();
  }
  private execute(): DecodeOutcome<PrLandPrRequest> {
    const args = this.request;
    const { value, path } = args;

    const objectArgs: ExpectObjectArgs = { value, path };
    const object = YamlObjectField.decode(objectArgs);
    if (object.status === DecodeStatus.Failed) {
      return object;
    }
    const unknownArgs: DenyUnknownKeysArgs<PrLandPrField> = {
      record: object.value,
      fields: PrLandPrField,
      path,
    };
    const unknown = YamlObjectVocabulary.unknownFields(unknownArgs);
    const prNumberArgs: ExpectFieldArgs<PrLandPrField> = {
      record: object.value,
      key: PrLandPrField.PrNumber,
      path,
    };
    const prNumber = YamlPositiveIntegerField.decode(prNumberArgs);
    const errors = [
      ...unknown,
      ...(prNumber.status === DecodeStatus.Failed ? prNumber.errors : []),
    ];
    if (errors.length > 0) {
      return FailedFieldDecode.create(errors);
    }
    const request: PrLandPrRequest = {
      prNumber: SuccessfulFieldDecode.requireValue(prNumber),
    };
    return SuccessfulFieldDecode.create(request);
  }
}

export class PrLandValidationPayload {
  private constructor(
    private readonly request: DecodePrLandValidatePayloadArgs,
  ) {}
  static decode(
    args: DecodePrLandValidatePayloadArgs,
  ): DecodeOutcome<PrLandValidateRequest> {
    return new PrLandValidationPayload(args).execute();
  }
  private execute(): DecodeOutcome<PrLandValidateRequest> {
    const args = this.request;
    const { value, path } = args;

    const objectArgs: ExpectObjectArgs = { value, path };
    const object = YamlObjectField.decode(objectArgs);
    if (object.status === DecodeStatus.Failed) {
      return object;
    }
    const unknownArgs: DenyUnknownKeysArgs<PrLandValidateField> = {
      record: object.value,
      fields: PrLandValidateField,
      path,
    };
    const unknown = YamlObjectVocabulary.unknownFields(unknownArgs);
    const prNumberArgs: ExpectFieldArgs<PrLandValidateField> = {
      record: object.value,
      key: PrLandValidateField.PrNumber,
      path,
    };
    const prNumber = YamlPositiveIntegerField.decode(prNumberArgs);
    const remoteTaskArgs: ExpectFieldArgs<PrLandValidateField> = {
      record: object.value,
      key: PrLandValidateField.RemoteTask,
      path,
    };
    const remoteTask = YamlRemoteTaskField.decode(remoteTaskArgs);
    const runFullE2eArgs: ExpectFieldArgs<PrLandValidateField> = {
      record: object.value,
      key: PrLandValidateField.RunFullE2e,
      path,
    };
    const runFullE2e = YamlBooleanField.decode(runFullE2eArgs);
    const errors = [
      ...unknown,
      ...(prNumber.status === DecodeStatus.Failed ? prNumber.errors : []),
      ...(remoteTask.status === DecodeStatus.Failed ? remoteTask.errors : []),
      ...(runFullE2e.status === DecodeStatus.Failed ? runFullE2e.errors : []),
    ];
    if (errors.length > 0) {
      return FailedFieldDecode.create(errors);
    }
    const request: PrLandValidateRequest = {
      prNumber: SuccessfulFieldDecode.requireValue(prNumber),
      remoteTask: SuccessfulFieldDecode.requireValue(remoteTask),
      runFullE2e: SuccessfulFieldDecode.requireValue(runFullE2e),
    };
    return SuccessfulFieldDecode.create(request);
  }
}

export enum RemoteTaskPresence {
  Specified = 'specified',
  Omitted = 'omitted',
}

export type RemoteTask =
  | { readonly presence: RemoteTaskPresence.Specified; readonly task: string }
  | { readonly presence: RemoteTaskPresence.Omitted };

export enum PrLandPrField {
  PrNumber = 'prNumber',
}

export enum PrLandValidateField {
  PrNumber = 'prNumber',
  RemoteTask = 'remoteTask',
  RunFullE2e = 'runFullE2e',
}

export type PrLandPrRequest = {
  readonly prNumber: number;
};

export type PrLandValidateRequest = {
  readonly prNumber: number;
  readonly remoteTask: RemoteTask;
  readonly runFullE2e: boolean;
};

export type DecodePrLandPrPayloadArgs = {
  readonly value: UntrustedYamlNode;
  readonly path: string;
};

export type DecodePrLandValidatePayloadArgs = {
  readonly value: UntrustedYamlNode;
  readonly path: string;
};

const positiveIntegerSchemaArgs: IntegerJsonSchemaArgs = { minimum: 1 };

const prLandPrInputSchemaArgs: ObjectJsonSchemaArgs = {
  required: [PrLandPrField.PrNumber],
  properties: {
    [PrLandPrField.PrNumber]: JsonSchemaDefinition.integer(
      positiveIntegerSchemaArgs,
    ),
  },
};

export const PR_LAND_PR_INPUT_SCHEMA: ObjectJsonSchema =
  JsonSchemaDefinition.object(prLandPrInputSchemaArgs);

const prLandValidateInputSchemaArgs: ObjectJsonSchemaArgs = {
  required: [PrLandValidateField.PrNumber, PrLandValidateField.RunFullE2e],
  properties: {
    [PrLandValidateField.PrNumber]: JsonSchemaDefinition.integer(
      positiveIntegerSchemaArgs,
    ),
    [PrLandValidateField.RemoteTask]: JsonSchemaDefinition.string(),
    [PrLandValidateField.RunFullE2e]: JsonSchemaDefinition.boolean(),
  },
};

export const PR_LAND_VALIDATE_INPUT_SCHEMA: ObjectJsonSchema =
  JsonSchemaDefinition.object(prLandValidateInputSchemaArgs);
