import type { UntrustedYamlNode } from '../../lib/guards.ts';
import { RequestFamily } from '../enums.ts';
import {
  DecodeStatus,
  FieldIssue,
  decodeErr,
  decodeOk,
  fieldDetailText,
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
  SkillOwner = 'skillOwner',
  CreateExecutableWrappers = 'createExecutableWrappers',
}

export enum SkillOwner {
  Shared = 'shared',
  Ai = 'ai',
  DevCore = 'dev-core',
  Sre = 'sre',
  WebDev = 'web-dev',
}

export type SkillScaffoldRequest = {
  readonly skillSlug: string;
  readonly skillOwner: SkillOwner;
  readonly createExecutableWrappers: boolean;
};

const ROOT = RequestFamily.SkillScaffold;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKILL_OWNER_RE = /^(?:shared|ai|dev-core|sre|web-dev)$/;

export function decodeSkillScaffoldRequest(
  value: UntrustedYamlNode,
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
  const skillOwnerArgs: ExpectFieldArgs<SkillScaffoldField> = {
    record: object.value,
    key: SkillScaffoldField.SkillOwner,
    path: ROOT,
  };
  const skillOwner = expectString(skillOwnerArgs);
  const createExecutableWrappersArgs: ExpectFieldArgs<SkillScaffoldField> = {
    record: object.value,
    key: SkillScaffoldField.CreateExecutableWrappers,
    path: ROOT,
  };
  const createExecutableWrappers = expectBoolean(createExecutableWrappersArgs);
  const errors = [
    ...unknown,
    ...(skillSlug.status === DecodeStatus.Failed ? skillSlug.errors : []),
    ...(skillOwner.status === DecodeStatus.Failed ? skillOwner.errors : []),
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
  if (
    skillOwner.status === DecodeStatus.Ok &&
    !SKILL_OWNER_RE.test(skillOwner.value)
  ) {
    const fieldErrorArgs: FieldErrorArgs = {
      path: `${ROOT}.${SkillScaffoldField.SkillOwner}`,
      issue: FieldIssue.ExpectedOneOf,
      detail: fieldDetailText('shared|ai|dev-core|sre|web-dev'),
    };
    errors.push(fieldError(fieldErrorArgs));
  }
  if (errors.length > 0) {
    return decodeErr(errors);
  }
  const request: SkillScaffoldRequest = {
    skillSlug: (skillSlug as { value: string }).value,
    skillOwner: (skillOwner as { value: SkillOwner }).value,
    createExecutableWrappers: (createExecutableWrappers as { value: boolean })
      .value,
  };
  return decodeOk(request);
}

const skillSlugPatternArgs: PatternStringJsonSchemaArgs = {
  pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
};
const skillOwnerPatternArgs: PatternStringJsonSchemaArgs = {
  pattern: '^(?:shared|ai|dev-core|sre|web-dev)$',
};
const skillScaffoldInputSchemaArgs: ObjectJsonSchemaArgs = {
  required: [
    SkillScaffoldField.SkillSlug,
    SkillScaffoldField.SkillOwner,
    SkillScaffoldField.CreateExecutableWrappers,
  ],
  properties: {
    [SkillScaffoldField.SkillSlug]:
      patternStringJsonSchema(skillSlugPatternArgs),
    [SkillScaffoldField.SkillOwner]: patternStringJsonSchema(
      skillOwnerPatternArgs,
    ),
    [SkillScaffoldField.CreateExecutableWrappers]: booleanJsonSchema(),
  },
};
export const SKILL_SCAFFOLD_INPUT_SCHEMA: ObjectJsonSchema = objectJsonSchema(
  skillScaffoldInputSchemaArgs,
);
