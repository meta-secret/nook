import type { ExternalValue } from '../../lib/guards.ts';
import { RequestFamily } from '../enums.ts';
import {
  DecodeStatus,
  FieldIssue,
  decodeErr,
  decodeOk,
  fieldError,
  type DecodeOutcome,
} from '../field-error.ts';
import {
  booleanJsonSchema,
  objectJsonSchema,
  patternStringJsonSchema,
  type ObjectJsonSchema,
} from '../json-schema.ts';
import {
  denyUnknownKeys,
  expectBoolean,
  expectObject,
  expectString,
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
  const object = expectObject({ value, path: ROOT });
  if (object.status === DecodeStatus.Failed) {
    return object;
  }
  const unknown = denyUnknownKeys({
    record: object.value,
    fields: SkillScaffoldField,
    path: ROOT,
  });
  const skillSlug = expectString({
    record: object.value,
    key: SkillScaffoldField.SkillSlug,
    path: ROOT,
  });
  const createExecutableWrappers = expectBoolean({
    record: object.value,
    key: SkillScaffoldField.CreateExecutableWrappers,
    path: ROOT,
  });
  const errors = [
    ...unknown,
    ...(skillSlug.status === DecodeStatus.Failed ? skillSlug.errors : []),
    ...(createExecutableWrappers.status === DecodeStatus.Failed
      ? createExecutableWrappers.errors
      : []),
  ];
  if (skillSlug.status === DecodeStatus.Ok && !SLUG_RE.test(skillSlug.value)) {
    errors.push(
      fieldError({
        path: `${ROOT}.${SkillScaffoldField.SkillSlug}`,
        issue: FieldIssue.ExpectedKebabCaseSlug,
      }),
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

export const SKILL_SCAFFOLD_INPUT_SCHEMA: ObjectJsonSchema = objectJsonSchema({
  required: [
    SkillScaffoldField.SkillSlug,
    SkillScaffoldField.CreateExecutableWrappers,
  ],
  properties: {
    [SkillScaffoldField.SkillSlug]: patternStringJsonSchema({
      pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
    }),
    [SkillScaffoldField.CreateExecutableWrappers]: booleanJsonSchema(),
  },
});
