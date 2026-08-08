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
  type ObjectJsonSchema,
} from '../json-schema.ts';
import {
  denyUnknownKeys,
  expectBoolean,
  expectObject,
  expectPositiveInt,
  expectRemoteTask,
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

  const object = expectObject({ value, path });
  if (object.status === DecodeStatus.Failed) {
    return object;
  }
  const unknown = denyUnknownKeys({
    record: object.value,
    fields: PrLandPrField,
    path,
  });
  const prNumber = expectPositiveInt({
    record: object.value,
    key: PrLandPrField.PrNumber,
    path,
  });
  const errors = [
    ...unknown,
    ...(prNumber.status === DecodeStatus.Failed ? prNumber.errors : []),
  ];
  if (errors.length > 0) {
    return decodeErr(errors);
  }
  return decodeOk({
    prNumber: (prNumber as { value: number }).value,
  });
}

export type DecodePrLandValidatePayloadArgs = {
  readonly value: ExternalValue;
  readonly path: string;
};

export function decodePrLandValidatePayload(
  args: DecodePrLandValidatePayloadArgs,
): DecodeOutcome<PrLandValidateRequest> {
  const { value, path } = args;

  const object = expectObject({ value, path });
  if (object.status === DecodeStatus.Failed) {
    return object;
  }
  const unknown = denyUnknownKeys({
    record: object.value,
    fields: PrLandValidateField,
    path,
  });
  const prNumber = expectPositiveInt({
    record: object.value,
    key: PrLandValidateField.PrNumber,
    path,
  });
  const remoteTask = expectRemoteTask({
    record: object.value,
    key: PrLandValidateField.RemoteTask,
    path,
  });
  const runFullE2e = expectBoolean({
    record: object.value,
    key: PrLandValidateField.RunFullE2e,
    path,
  });
  const errors = [
    ...unknown,
    ...(prNumber.status === DecodeStatus.Failed ? prNumber.errors : []),
    ...(remoteTask.status === DecodeStatus.Failed ? remoteTask.errors : []),
    ...(runFullE2e.status === DecodeStatus.Failed ? runFullE2e.errors : []),
  ];
  if (errors.length > 0) {
    return decodeErr(errors);
  }
  return decodeOk({
    prNumber: (prNumber as { value: number }).value,
    remoteTask: (remoteTask as { value: RemoteTask }).value,
    runFullE2e: (runFullE2e as { value: boolean }).value,
  });
}

export const PR_LAND_PR_INPUT_SCHEMA: ObjectJsonSchema = objectJsonSchema({
  required: [PrLandPrField.PrNumber],
  properties: {
    [PrLandPrField.PrNumber]: integerJsonSchema({ minimum: 1 }),
  },
});

export const PR_LAND_VALIDATE_INPUT_SCHEMA: ObjectJsonSchema = objectJsonSchema(
  {
    required: [PrLandValidateField.PrNumber, PrLandValidateField.RunFullE2e],
    properties: {
      [PrLandValidateField.PrNumber]: integerJsonSchema({ minimum: 1 }),
      [PrLandValidateField.RemoteTask]: stringJsonSchema(),
      [PrLandValidateField.RunFullE2e]: booleanJsonSchema(),
    },
  },
);
