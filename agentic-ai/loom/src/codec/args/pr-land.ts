import { ResultKind, absent, present, type Maybe } from '../../result.ts';
import { decodeErr, decodeOk, type DecodeResult } from '../field-error.ts';
import {
  denyUnknownKeys,
  expectBoolean,
  expectObject,
  expectOptionalStringOrNull,
  expectPositiveInt,
  expectStringEnum,
} from '../object.ts';

export type PrLandAction = 'status' | 'validate' | 'ready' | 'merge-check';

export type PrLandArgs = {
  readonly action: PrLandAction;
  readonly pr: number;
  readonly remote: Maybe<string>;
  readonly fullE2e: boolean;
};

const ACTIONS = ['status', 'validate', 'ready', 'merge-check'] as const;
const ALLOWED = new Set(['action', 'pr', 'remote', 'full_e2e']);

export function decodePrLandArgs(value: unknown): DecodeResult<PrLandArgs> {
  const object = expectObject(value, 'arguments');
  if (object.kind === ResultKind.Err) {
    return object;
  }
  const unknown = denyUnknownKeys(object.value, ALLOWED, 'arguments');
  const action = expectStringEnum(object.value, 'action', 'arguments', ACTIONS);
  const pr = expectPositiveInt(object.value, 'pr', 'arguments');
  const remote = expectOptionalStringOrNull(
    object.value,
    'remote',
    'arguments',
  );
  const fullE2e = expectBoolean(object.value, 'full_e2e', 'arguments');
  const errors = [
    ...unknown,
    ...(action.kind === ResultKind.Err ? action.errors : []),
    ...(pr.kind === ResultKind.Err ? pr.errors : []),
    ...(remote.kind === ResultKind.Err ? remote.errors : []),
    ...(fullE2e.kind === ResultKind.Err ? fullE2e.errors : []),
  ];
  if (errors.length > 0) {
    return decodeErr(errors);
  }
  const remoteValue =
    remote.kind === ResultKind.Ok && typeof remote.value === 'string'
      ? present(remote.value)
      : absent();
  return decodeOk({
    action: (action as { value: PrLandAction }).value,
    pr: (pr as { value: number }).value,
    remote: remoteValue,
    fullE2e: (fullE2e as { value: boolean }).value,
  });
}

export const PR_LAND_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'pr', 'full_e2e'],
  properties: {
    action: {
      type: 'string',
      enum: ['status', 'validate', 'ready', 'merge-check'],
    },
    pr: { type: 'integer', minimum: 1 },
    remote: { type: ['string', 'null'] },
    full_e2e: { type: 'boolean' },
  },
} as const;
