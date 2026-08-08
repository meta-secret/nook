import { ResultKind } from '../../result.ts';
import { RequestKind } from '../enums.ts';
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

export type SkillScaffoldRequest = {
  readonly skillSlug: string;
  readonly createExecutableWrappers: boolean;
};

const ROOT = RequestKind.SkillScaffold;
const ALLOWED = new Set(['skillSlug', 'createExecutableWrappers']);
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function decodeSkillScaffoldRequest(
  value: unknown,
): DecodeResult<SkillScaffoldRequest> {
  const object = expectObject(value, ROOT);
  if (object.kind === ResultKind.Err) {
    return object;
  }
  const unknown = denyUnknownKeys(object.value, ALLOWED, ROOT);
  const skillSlug = expectString(object.value, 'skillSlug', ROOT);
  const createExecutableWrappers = expectBoolean(
    object.value,
    'createExecutableWrappers',
    ROOT,
  );
  const errors = [
    ...unknown,
    ...(skillSlug.kind === ResultKind.Err ? skillSlug.errors : []),
    ...(createExecutableWrappers.kind === ResultKind.Err
      ? createExecutableWrappers.errors
      : []),
  ];
  if (skillSlug.kind === ResultKind.Ok && !SLUG_RE.test(skillSlug.value)) {
    errors.push(
      fieldError(`${ROOT}.skillSlug`, 'expected kebab-case slug [a-z0-9-]+'),
    );
  }
  if (errors.length > 0) {
    return decodeErr(errors);
  }
  return decodeOk({
    skillSlug: (skillSlug as { value: string }).value,
    createExecutableWrappers: (createExecutableWrappers as { value: boolean })
      .value,
  });
}

export const SKILL_SCAFFOLD_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['skillSlug', 'createExecutableWrappers'],
  properties: {
    skillSlug: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
    createExecutableWrappers: { type: 'boolean' },
  },
} as const;
