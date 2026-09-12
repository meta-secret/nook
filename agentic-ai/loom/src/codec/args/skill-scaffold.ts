import type { UntrustedYamlNode } from '../../lib/guards.ts';

import { RequestFamily } from '../enums.ts';

import {
  DecodeStatus,
  FieldIssue,
  type DecodeOutcome,
  type FieldErrorArgs,
  FailedFieldDecode,
  FieldDecodeInvariantViolation,
  SuccessfulFieldDecode,
  FieldDiagnosticText,
  FieldDiagnostic,
} from '../field-error.ts';

import {
  type ObjectJsonSchema,
  type ObjectJsonSchemaArgs,
  type PatternStringJsonSchemaArgs,
  JsonSchemaDefinition,
} from '../json-schema.ts';

import {
  type DenyUnknownKeysArgs,
  type ExpectFieldArgs,
  type ExpectObjectArgs,
  YamlObjectVocabulary,
  YamlObjectField,
  YamlStringField,
} from '../object.ts';

export class SkillScaffoldRequestDecoder {
  private constructor(private readonly request: UntrustedYamlNode) {}
  static decode(value: UntrustedYamlNode): DecodeOutcome<SkillScaffoldRequest> {
    return new SkillScaffoldRequestDecoder(value).execute();
  }
  private execute(): DecodeOutcome<SkillScaffoldRequest> {
    const value = this.request;
    const objectArgs: ExpectObjectArgs = { value, path: ROOT };
    const object = YamlObjectField.decode(objectArgs);
    if (object.status === DecodeStatus.Failed) {
      return object;
    }
    const unknownArgs: DenyUnknownKeysArgs<SkillScaffoldField> = {
      record: object.value,
      fields: SkillScaffoldField,
      path: ROOT,
    };
    const unknown = YamlObjectVocabulary.unknownFields(unknownArgs);
    const skillSlugArgs: ExpectFieldArgs<SkillScaffoldField> = {
      record: object.value,
      key: SkillScaffoldField.SkillSlug,
      path: ROOT,
    };
    const skillSlug = YamlStringField.decode(skillSlugArgs);
    const skillOwnerArgs: ExpectFieldArgs<SkillScaffoldField> = {
      record: object.value,
      key: SkillScaffoldField.SkillOwner,
      path: ROOT,
    };
    const skillOwner = YamlStringField.decode(skillOwnerArgs);
    const errors = [
      ...unknown,
      ...(skillSlug.status === DecodeStatus.Failed ? skillSlug.errors : []),
      ...(skillOwner.status === DecodeStatus.Failed ? skillOwner.errors : []),
    ];
    if (
      skillSlug.status === DecodeStatus.Ok &&
      !SLUG_RE.test(skillSlug.value)
    ) {
      const fieldErrorArgs: FieldErrorArgs = {
        path: `${ROOT}.${SkillScaffoldField.SkillSlug}`,
        issue: FieldIssue.ExpectedKebabCaseSlug,
      };
      errors.push(FieldDiagnostic.create(fieldErrorArgs));
    }
    if (
      skillOwner.status === DecodeStatus.Ok &&
      !SKILL_OWNER_RE.test(skillOwner.value)
    ) {
      const fieldErrorArgs: FieldErrorArgs = {
        path: `${ROOT}.${SkillScaffoldField.SkillOwner}`,
        issue: FieldIssue.ExpectedOneOf,
        detail: FieldDiagnosticText.create(
          'shared|gizmo|ai|dev-core|security|sre|web-dev',
        ),
      };
      errors.push(FieldDiagnostic.create(fieldErrorArgs));
    }
    if (errors.length > 0) {
      return FailedFieldDecode.create(errors);
    }
    const request: SkillScaffoldRequest = {
      skillSlug: SuccessfulFieldDecode.requireValue(skillSlug),
      skillOwner: SkillOwnerVocabulary.require(
        SuccessfulFieldDecode.requireValue(skillOwner),
      ),
    };
    return SuccessfulFieldDecode.create(request);
  }
}

export enum SkillScaffoldField {
  SkillSlug = 'skillSlug',
  SkillOwner = 'skillOwner',
}

export enum SkillOwner {
  Shared = 'shared',
  Gizmo = 'gizmo',
  Ai = 'ai',
  DevCore = 'dev-core',
  Security = 'security',
  Sre = 'sre',
  WebDev = 'web-dev',
}

class SkillOwnerVocabulary {
  private constructor() {}
  static require(value: string): SkillOwner {
    switch (value) {
      case SkillOwner.Shared:
        return SkillOwner.Shared;
      case SkillOwner.Gizmo:
        return SkillOwner.Gizmo;
      case SkillOwner.Ai:
        return SkillOwner.Ai;
      case SkillOwner.DevCore:
        return SkillOwner.DevCore;
      case SkillOwner.Security:
        return SkillOwner.Security;
      case SkillOwner.Sre:
        return SkillOwner.Sre;
      case SkillOwner.WebDev:
        return SkillOwner.WebDev;
      default:
        throw new FieldDecodeInvariantViolation();
    }
  }
}

export type SkillScaffoldRequest = {
  readonly skillSlug: string;
  readonly skillOwner: SkillOwner;
};

const ROOT = RequestFamily.SkillScaffold;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const SKILL_OWNER_RE = /^(?:shared|gizmo|ai|dev-core|security|sre|web-dev)$/;

const skillSlugPatternArgs: PatternStringJsonSchemaArgs = {
  pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
};

const skillOwnerPatternArgs: PatternStringJsonSchemaArgs = {
  pattern: '^(?:shared|gizmo|ai|dev-core|security|sre|web-dev)$',
};

const skillScaffoldInputSchemaArgs: ObjectJsonSchemaArgs = {
  required: [SkillScaffoldField.SkillSlug, SkillScaffoldField.SkillOwner],
  properties: {
    [SkillScaffoldField.SkillSlug]:
      JsonSchemaDefinition.pattern(skillSlugPatternArgs),
    [SkillScaffoldField.SkillOwner]: JsonSchemaDefinition.pattern(
      skillOwnerPatternArgs,
    ),
  },
};

export const SKILL_SCAFFOLD_INPUT_SCHEMA: ObjectJsonSchema =
  JsonSchemaDefinition.object(skillScaffoldInputSchemaArgs);
