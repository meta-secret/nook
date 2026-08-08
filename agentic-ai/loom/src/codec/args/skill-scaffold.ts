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
  value: unknown,
): DecodeOutcome<SkillScaffoldRequest> {
  const object = expectObject(value, ROOT);
  if (object.status === DecodeStatus.Failed) {
    return object;
  }
  const unknown = denyUnknownKeys(
    object.value,
    Object.values(SkillScaffoldField),
    ROOT,
  );
  const skillSlug = expectString(
    object.value,
    SkillScaffoldField.SkillSlug,
    ROOT,
  );
  const createExecutableWrappers = expectBoolean(
    object.value,
    SkillScaffoldField.CreateExecutableWrappers,
    ROOT,
  );
  const errors = [
    ...unknown,
    ...(skillSlug.status === DecodeStatus.Failed ? skillSlug.errors : []),
    ...(createExecutableWrappers.status === DecodeStatus.Failed
      ? createExecutableWrappers.errors
      : []),
  ];
  if (skillSlug.status === DecodeStatus.Ok && !SLUG_RE.test(skillSlug.value)) {
    errors.push(
      fieldError(
        `${ROOT}.${SkillScaffoldField.SkillSlug}`,
        FieldIssue.ExpectedKebabCaseSlug,
      ),
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
