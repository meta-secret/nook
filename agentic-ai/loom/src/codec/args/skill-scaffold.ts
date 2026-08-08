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
  expectString,
} from '../object.ts';

export type SkillScaffoldArgs = {
  readonly slug: string;
  readonly wrappers: boolean;
};

const ALLOWED = new Set(['slug', 'wrappers']);
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function decodeSkillScaffoldArgs(
  value: unknown,
): DecodeResult<SkillScaffoldArgs> {
  const object = expectObject(value, 'arguments');
  if (object.kind === ResultKind.Err) {
    return object;
  }
  const unknown = denyUnknownKeys(object.value, ALLOWED, 'arguments');
  const slug = expectString(object.value, 'slug', 'arguments');
  const wrappers = expectBoolean(object.value, 'wrappers', 'arguments');
  const errors = [
    ...unknown,
    ...(slug.kind === ResultKind.Err ? slug.errors : []),
    ...(wrappers.kind === ResultKind.Err ? wrappers.errors : []),
  ];
  if (slug.kind === ResultKind.Ok && !SLUG_RE.test(slug.value)) {
    errors.push(
      fieldError('arguments.slug', 'expected kebab-case slug [a-z0-9-]+'),
    );
  }
  if (errors.length > 0) {
    return decodeErr(errors);
  }
  return decodeOk({
    slug: (slug as { value: string }).value,
    wrappers: (wrappers as { value: boolean }).value,
  });
}

export const SKILL_SCAFFOLD_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['slug', 'wrappers'],
  properties: {
    slug: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
    wrappers: { type: 'boolean' },
  },
} as const;
