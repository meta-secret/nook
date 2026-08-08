import type { ExternalValue } from '../../lib/guards.ts';
import { RequestFamily } from '../enums.ts';
import {
  DecodeStatus,
  FieldIssue,
  decodeErr,
  decodeOk,
  fieldError,
  type DecodeOutcome,
  type FieldErrorArgs,
} from '../field-error.ts';
import {
  booleanJsonSchema,
  objectJsonSchema,
  patternStringJsonSchema,
  type ObjectJsonSchema,
  type ObjectJsonSchemaArgs,
  type PatternStringJsonSchemaArgs,
} from '../json-schema.ts';
import {
  denyUnknownKeys,
  expectBoolean,
  expectObject,
  expectString,
  type DenyUnknownKeysArgs,
  type ExpectFieldArgs,
  type ExpectObjectArgs,
} from '../object.ts';

export enum SkillScaffoldField {
  SkillSlug = 'skillSlug',
  CreateExecutableWrappers = 'createExecutableWrappers',
}

export type SkillScaffoldRequest = {
  readonly skillSlug: string;
  readonly createExecutableWrappers: boolean;
};

const ROOT = RequestFamily.SkillScaffold;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function decodeSkillScaffoldRequest(
  value: ExternalValue,
): DecodeOutcome<SkillScaffoldRequest> {
  const objectArgs: ExpectObjectArgs = { value, path: ROOT };
  const object = expectObject(objectArgs);
  if (object.status === DecodeStatus.Failed) {
    return object;
  }
  const unknownArgs: DenyUnknownKeysArgs<SkillScaffoldField> = {
    record: object.value,
    fields: SkillScaffoldField,
    path: ROOT,
  };
  const unknown = denyUnknownKeys(unknownArgs);
  const skillSlugArgs: ExpectFieldArgs<SkillScaffoldField> = {
    record: object.value,
    key: SkillScaffoldField.SkillSlug,
    path: ROOT,
  };
  const skillSlug = expectString(skillSlugArgs);
  const createExecutableWrappersArgs: ExpectFieldArgs<SkillScaffoldField> = {
    record: object.value,
    key: SkillScaffoldField.CreateExecutableWrappers,
    path: ROOT,
  };
  const createExecutableWrappers = expectBoolean(createExecutableWrappersArgs);
  const errors = [
    ...unknown,
    ...(skillSlug.status === DecodeStatus.Failed ? skillSlug.errors : []),
    ...(createExecutableWrappers.status === DecodeStatus.Failed
      ? createExecutableWrappers.errors
      : []),
  ];
  if (skillSlug.status === DecodeStatus.Ok && !SLUG_RE.test(skillSlug.value)) {
    const fieldErrorArgs: FieldErrorArgs = {
      path: `${ROOT}.${SkillScaffoldField.SkillSlug}`,
      issue: FieldIssue.ExpectedKebabCaseSlug,
    };
    errors.push(fieldError(fieldErrorArgs));
  }
  if (errors.length > 0) {
    return decodeErr(errors);
  }
  const request: SkillScaffoldRequest = {
    skillSlug: (skillSlug as { value: string }).value,
    createExecutableWrappers: (createExecutableWrappers as { value: boolean })
      .value,
  };
  return decodeOk(request);
}

const skillSlugPatternArgs: PatternStringJsonSchemaArgs = {
  pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
};
const skillScaffoldInputSchemaArgs: ObjectJsonSchemaArgs = {
  required: [
    SkillScaffoldField.SkillSlug,
    SkillScaffoldField.CreateExecutableWrappers,
  ],
  properties: {
    [SkillScaffoldField.SkillSlug]:
      patternStringJsonSchema(skillSlugPatternArgs),
    [SkillScaffoldField.CreateExecutableWrappers]: booleanJsonSchema(),
  },
};
export const SKILL_SCAFFOLD_INPUT_SCHEMA: ObjectJsonSchema = objectJsonSchema(
  skillScaffoldInputSchemaArgs,
);
