import {
  DecodeStatus,
  decodeErr,
  decodeOk,
  type DecodeOutcome,
} from '../field-error.ts';
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

export function decodePrLandPrPayload(
  value: unknown,
  path: string,
): DecodeOutcome<PrLandPrRequest> {
  const object = expectObject(value, path);
  if (object.status === DecodeStatus.Failed) {
    return object;
  }
  const unknown = denyUnknownKeys(object.value, PrLandPrField, path);
  const prNumber = expectPositiveInt(
    object.value,
    PrLandPrField.PrNumber,
    path,
  );
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

export function decodePrLandValidatePayload(
  value: unknown,
  path: string,
): DecodeOutcome<PrLandValidateRequest> {
  const object = expectObject(value, path);
  if (object.status === DecodeStatus.Failed) {
    return object;
  }
  const unknown = denyUnknownKeys(object.value, PrLandValidateField, path);
  const prNumber = expectPositiveInt(
    object.value,
    PrLandValidateField.PrNumber,
    path,
  );
  const remoteTask = expectRemoteTask(
    object.value,
    PrLandValidateField.RemoteTask,
    path,
  );
  const runFullE2e = expectBoolean(
    object.value,
    PrLandValidateField.RunFullE2e,
    path,
  );
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

export const PR_LAND_PR_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['prNumber'],
  properties: {
    prNumber: { type: 'integer', minimum: 1 },
  },
} as const;

export const PR_LAND_VALIDATE_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['prNumber', 'runFullE2e'],
  properties: {
    prNumber: { type: 'integer', minimum: 1 },
    remoteTask: { type: 'string' },
    runFullE2e: { type: 'boolean' },
  },
} as const;
