import { ResultKind, type Maybe } from '../../result.ts';
import { RequestKind } from '../enums.ts';
import { decodeErr, decodeOk, type DecodeResult } from '../field-error.ts';
import {
  denyUnknownKeys,
  expectBoolean,
  expectObject,
  expectOptionalString,
  expectPositiveInt,
} from '../object.ts';

export type PrLandPrRequest = {
  readonly prNumber: number;
};

export type PrLandValidateRequest = {
  readonly prNumber: number;
  readonly remoteTask: Maybe<string>;
  readonly runFullE2e: boolean;
};

function decodePrOnly(
  value: unknown,
  root: string,
): DecodeResult<PrLandPrRequest> {
  const object = expectObject(value, root);
  if (object.kind === ResultKind.Err) {
    return object;
  }
  const unknown = denyUnknownKeys(object.value, new Set(['prNumber']), root);
  const prNumber = expectPositiveInt(object.value, 'prNumber', root);
  const errors = [
    ...unknown,
    ...(prNumber.kind === ResultKind.Err ? prNumber.errors : []),
  ];
  if (errors.length > 0) {
    return decodeErr(errors);
  }
  return decodeOk({
    prNumber: (prNumber as { value: number }).value,
  });
}

export function decodePrLandStatusRequest(
  value: unknown,
): DecodeResult<PrLandPrRequest> {
  return decodePrOnly(value, RequestKind.PrLandStatus);
}

export function decodePrLandReadyRequest(
  value: unknown,
): DecodeResult<PrLandPrRequest> {
  return decodePrOnly(value, RequestKind.PrLandReady);
}

export function decodePrLandMergeCheckRequest(
  value: unknown,
): DecodeResult<PrLandPrRequest> {
  return decodePrOnly(value, RequestKind.PrLandMergeCheck);
}

export function decodePrLandValidateRequest(
  value: unknown,
): DecodeResult<PrLandValidateRequest> {
  const root = RequestKind.PrLandValidate;
  const object = expectObject(value, root);
  if (object.kind === ResultKind.Err) {
    return object;
  }
  const allowed = new Set(['prNumber', 'remoteTask', 'runFullE2e']);
  const unknown = denyUnknownKeys(object.value, allowed, root);
  const prNumber = expectPositiveInt(object.value, 'prNumber', root);
  const remoteTask = expectOptionalString(object.value, 'remoteTask', root);
  const runFullE2e = expectBoolean(object.value, 'runFullE2e', root);
  const errors = [
    ...unknown,
    ...(prNumber.kind === ResultKind.Err ? prNumber.errors : []),
    ...(remoteTask.kind === ResultKind.Err ? remoteTask.errors : []),
    ...(runFullE2e.kind === ResultKind.Err ? runFullE2e.errors : []),
  ];
  if (errors.length > 0) {
    return decodeErr(errors);
  }
  return decodeOk({
    prNumber: (prNumber as { value: number }).value,
    remoteTask: (remoteTask as { value: Maybe<string> }).value,
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
