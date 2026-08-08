import { ResultKind } from '../../result.ts';
import {
  decodeErr,
  decodeOk,
  fieldError,
  type DecodeResult,
} from '../field-error.ts';
import {
  denyUnknownKeys,
  expectBoolean,
  expectObject,
  expectPositiveInt,
  expectString,
  expectStringEnum,
} from '../object.ts';

export type AgentStatsAction = 'assemble' | 'validate' | 'publish';

export type AgentStatsAssembleArgs = {
  readonly action: 'assemble';
  readonly pr: number;
  readonly scratch: string;
  readonly out: string;
  readonly inventory: boolean;
};

export type AgentStatsFileArgs = {
  readonly action: 'validate' | 'publish';
  readonly file: string;
};

export type AgentStatsArgs = AgentStatsAssembleArgs | AgentStatsFileArgs;

const ACTIONS = ['assemble', 'validate', 'publish'] as const;

export function decodeAgentStatsArgs(
  value: unknown,
): DecodeResult<AgentStatsArgs> {
  const object = expectObject(value, 'arguments');
  if (object.kind === ResultKind.Err) {
    return object;
  }
  const action = expectStringEnum(object.value, 'action', 'arguments', ACTIONS);
  if (action.kind === ResultKind.Err) {
    return action;
  }

  if (action.value === 'assemble') {
    const allowed = new Set(['action', 'pr', 'scratch', 'out', 'inventory']);
    const unknown = denyUnknownKeys(object.value, allowed, 'arguments');
    const pr = expectPositiveInt(object.value, 'pr', 'arguments');
    const scratch = expectString(object.value, 'scratch', 'arguments');
    const out = expectString(object.value, 'out', 'arguments');
    const inventory = expectBoolean(object.value, 'inventory', 'arguments');
    const errors = [
      ...unknown,
      ...(pr.kind === ResultKind.Err ? pr.errors : []),
      ...(scratch.kind === ResultKind.Err ? scratch.errors : []),
      ...(out.kind === ResultKind.Err ? out.errors : []),
      ...(inventory.kind === ResultKind.Err ? inventory.errors : []),
    ];
    if (errors.length > 0) {
      return decodeErr(errors);
    }
    return decodeOk({
      action: 'assemble',
      pr: (pr as { value: number }).value,
      scratch: (scratch as { value: string }).value,
      out: (out as { value: string }).value,
      inventory: (inventory as { value: boolean }).value,
    });
  }

  const allowed = new Set(['action', 'file']);
  const unknown = denyUnknownKeys(object.value, allowed, 'arguments');
  const file = expectString(object.value, 'file', 'arguments');
  const errors = [
    ...unknown,
    ...(file.kind === ResultKind.Err ? file.errors : []),
  ];
  if (errors.length > 0) {
    return decodeErr(errors);
  }
  if (file.kind !== ResultKind.Ok) {
    return decodeErr([fieldError('arguments.file', 'missing required field')]);
  }
  return decodeOk({
    action: action.value,
    file: file.value,
  });
}

export const AGENT_STATS_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: { type: 'string', enum: ['assemble', 'validate', 'publish'] },
    pr: { type: 'integer', minimum: 1 },
    scratch: { type: 'string' },
    out: { type: 'string' },
    inventory: { type: 'boolean' },
    file: { type: 'string' },
  },
} as const;
