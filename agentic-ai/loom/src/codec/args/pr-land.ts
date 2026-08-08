import type { ExternalValue } from '../../lib/guards.ts';
import {
  DecodeStatus,
  decodeErr,
  decodeOk,
  type DecodeOutcome,
} from '../field-error.ts';
import {
  booleanJsonSchema,
  integerJsonSchema,
  objectJsonSchema,
  stringJsonSchema,
  type IntegerJsonSchemaArgs,
  type ObjectJsonSchema,
  type ObjectJsonSchemaArgs,
} from '../json-schema.ts';
import {
  denyUnknownKeys,
  expectBoolean,
  expectObject,
  expectPositiveInt,
  expectRemoteTask,
  type DenyUnknownKeysArgs,
  type ExpectFieldArgs,
  type ExpectObjectArgs,
} from '../object.ts';

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
  readonly value: ExternalValue;
  readonly path: string;
};

export function decodePrLandPrPayload(
  args: DecodePrLandPrPayloadArgs,
): DecodeOutcome<PrLandPrRequest> {
  const { value, path } = args;

  const objectArgs: ExpectObjectArgs = { value, path };
  const object = expectObject(objectArgs);
  if (object.status === DecodeStatus.Failed) {
    return object;
  }
  const unknownArgs: DenyUnknownKeysArgs<PrLandPrField> = {
    record: object.value,
    fields: PrLandPrField,
    path,
  };
  const unknown = denyUnknownKeys(unknownArgs);
  const prNumberArgs: ExpectFieldArgs<PrLandPrField> = {
    record: object.value,
    key: PrLandPrField.PrNumber,
    path,
  };
  const prNumber = expectPositiveInt(prNumberArgs);
  const errors = [
    ...unknown,
    ...(prNumber.status === DecodeStatus.Failed ? prNumber.errors : []),
  ];
  if (errors.length > 0) {
    return decodeErr(errors);
  }
  const request: PrLandPrRequest = {
    prNumber: (prNumber as { value: number }).value,
  };
  return decodeOk(request);
}

export type DecodePrLandValidatePayloadArgs = {
  readonly value: ExternalValue;
  readonly path: string;
};

export function decodePrLandValidatePayload(
  args: DecodePrLandValidatePayloadArgs,
): DecodeOutcome<PrLandValidateRequest> {
  const { value, path } = args;

  const objectArgs: ExpectObjectArgs = { value, path };
  const object = expectObject(objectArgs);
  if (object.status === DecodeStatus.Failed) {
    return object;
  }
  const unknownArgs: DenyUnknownKeysArgs<PrLandValidateField> = {
    record: object.value,
    fields: PrLandValidateField,
    path,
  };
  const unknown = denyUnknownKeys(unknownArgs);
  const prNumberArgs: ExpectFieldArgs<PrLandValidateField> = {
    record: object.value,
    key: PrLandValidateField.PrNumber,
    path,
  };
  const prNumber = expectPositiveInt(prNumberArgs);
  const remoteTaskArgs: ExpectFieldArgs<PrLandValidateField> = {
    record: object.value,
    key: PrLandValidateField.RemoteTask,
    path,
  };
  const remoteTask = expectRemoteTask(remoteTaskArgs);
  const runFullE2eArgs: ExpectFieldArgs<PrLandValidateField> = {
    record: object.value,
    key: PrLandValidateField.RunFullE2e,
    path,
  };
  const runFullE2e = expectBoolean(runFullE2eArgs);
  const errors = [
    ...unknown,
    ...(prNumber.status === DecodeStatus.Failed ? prNumber.errors : []),
    ...(remoteTask.status === DecodeStatus.Failed ? remoteTask.errors : []),
    ...(runFullE2e.status === DecodeStatus.Failed ? runFullE2e.errors : []),
  ];
  if (errors.length > 0) {
    return decodeErr(errors);
  }
  const request: PrLandValidateRequest = {
    prNumber: (prNumber as { value: number }).value,
    remoteTask: (remoteTask as { value: RemoteTask }).value,
    runFullE2e: (runFullE2e as { value: boolean }).value,
  };
  return decodeOk(request);
}

const positiveIntegerSchemaArgs: IntegerJsonSchemaArgs = { minimum: 1 };
const prLandPrInputSchemaArgs: ObjectJsonSchemaArgs = {
  required: [PrLandPrField.PrNumber],
  properties: {
    [PrLandPrField.PrNumber]: integerJsonSchema(positiveIntegerSchemaArgs),
  },
};
export const PR_LAND_PR_INPUT_SCHEMA: ObjectJsonSchema = objectJsonSchema(
  prLandPrInputSchemaArgs,
);

const prLandValidateInputSchemaArgs: ObjectJsonSchemaArgs = {
  required: [PrLandValidateField.PrNumber, PrLandValidateField.RunFullE2e],
  properties: {
    [PrLandValidateField.PrNumber]: integerJsonSchema(
      positiveIntegerSchemaArgs,
    ),
    [PrLandValidateField.RemoteTask]: stringJsonSchema(),
    [PrLandValidateField.RunFullE2e]: booleanJsonSchema(),
  },
};
export const PR_LAND_VALIDATE_INPUT_SCHEMA: ObjectJsonSchema = objectJsonSchema(
  prLandValidateInputSchemaArgs,
);
