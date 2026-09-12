import {
  UntrustedYamlPropertyPresence,
  type UntrustedYamlMap,
  type UntrustedYamlNode,
  UntrustedYamlBoundary,
} from '../lib/guards.ts';

import { RemoteTaskPresence, type RemoteTask } from './args/pr-land.ts';

import { AgentStatsOperation, PrLandOperation } from './enums.ts';

import { YamlNullBoundary } from './external.ts';

import {
  DecodeStatus,
  FieldIssue,
  type DecodeOutcome,
  type FieldError,
  FailedFieldDecode,
  SuccessfulFieldDecode,
  FieldDiagnosticText,
  FieldDiagnostic,
  FieldPath,
} from './field-error.ts';

import {
  type RequestFieldVocabulary,
  RequestFieldCatalog,
} from './field-vocabulary.ts';

import type { FieldErrorArgs, JoinPathArgs } from './field-error.ts';

import type { UntrustedYamlPropertyArgs } from '../lib/guards.ts';

export class YamlObjectField {
  private constructor(private readonly request: ExpectObjectArgs) {}
  static decode(args: ExpectObjectArgs): DecodeOutcome<UntrustedYamlMap> {
    return new YamlObjectField(args).execute();
  }
  private execute(): DecodeOutcome<UntrustedYamlMap> {
    const args = this.request;
    if (!UntrustedYamlBoundary.isRecord(args.value)) {
      const fieldErrorArgs12: FieldErrorArgs = {
        path: args.path,
        issue: FieldIssue.ExpectedObject,
      };
      return FailedFieldDecode.create([
        FieldDiagnostic.create(fieldErrorArgs12),
      ]);
    }
    return SuccessfulFieldDecode.create(args.value);
  }
}

/** Reject keys outside one request-payload field vocabulary enum. */
export class YamlObjectVocabulary<FieldName extends string> {
  private constructor(
    private readonly request: DenyUnknownKeysArgs<FieldName>,
  ) {}
  static unknownFields<FieldName extends string>(
    args: DenyUnknownKeysArgs<FieldName>,
  ): readonly FieldError[] {
    return new YamlObjectVocabulary<FieldName>(args).execute();
  }
  private execute(): readonly FieldError[] {
    const args = this.request;
    const allowed = new Set<string>(RequestFieldCatalog.names(args.fields));
    const errors: FieldError[] = [];
    for (const key of Object.keys(args.record)) {
      if (!allowed.has(key)) {
        const joinPathArgs3: JoinPathArgs = { base: args.path, key };
        const fieldErrorArgs11: FieldErrorArgs = {
          path: FieldPath.join(joinPathArgs3),
          issue: FieldIssue.UnknownField,
        };
        errors.push(FieldDiagnostic.create(fieldErrorArgs11));
      }
    }
    return errors;
  }
}

export class YamlBooleanField<FieldName extends string> {
  private constructor(private readonly request: ExpectFieldArgs<FieldName>) {}
  static decode<FieldName extends string>(
    args: ExpectFieldArgs<FieldName>,
  ): DecodeOutcome<boolean> {
    return new YamlBooleanField<FieldName>(args).execute();
  }
  private execute(): DecodeOutcome<boolean> {
    const args = this.request;
    const fieldPathArgs4: JoinPathArgs = { base: args.path, key: args.key };
    const fieldPath = FieldPath.join(fieldPathArgs4);
    const propertyArgs5: UntrustedYamlPropertyArgs = {
      record: args.record,
      key: args.key,
    };
    const property = UntrustedYamlBoundary.property(propertyArgs5);
    if (property.presence === UntrustedYamlPropertyPresence.Absent) {
      const fieldErrorArgs10: FieldErrorArgs = {
        path: fieldPath,
        issue: FieldIssue.MissingRequiredField,
      };
      return FailedFieldDecode.create([
        FieldDiagnostic.create(fieldErrorArgs10),
      ]);
    }
    if (typeof property.value !== 'boolean') {
      const fieldErrorArgs9: FieldErrorArgs = {
        path: fieldPath,
        issue: FieldIssue.ExpectedBoolean,
      };
      return FailedFieldDecode.create([
        FieldDiagnostic.create(fieldErrorArgs9),
      ]);
    }
    return SuccessfulFieldDecode.create(property.value);
  }
}

export class YamlStringField<FieldName extends string> {
  private constructor(private readonly request: ExpectFieldArgs<FieldName>) {}
  static decode<FieldName extends string>(
    args: ExpectFieldArgs<FieldName>,
  ): DecodeOutcome<string> {
    return new YamlStringField<FieldName>(args).execute();
  }
  private execute(): DecodeOutcome<string> {
    const args = this.request;
    const fieldPathArgs3: JoinPathArgs = { base: args.path, key: args.key };
    const fieldPath = FieldPath.join(fieldPathArgs3);
    const propertyArgs4: UntrustedYamlPropertyArgs = {
      record: args.record,
      key: args.key,
    };
    const property = UntrustedYamlBoundary.property(propertyArgs4);
    if (property.presence === UntrustedYamlPropertyPresence.Absent) {
      const fieldErrorArgs8: FieldErrorArgs = {
        path: fieldPath,
        issue: FieldIssue.MissingRequiredField,
      };
      return FailedFieldDecode.create([
        FieldDiagnostic.create(fieldErrorArgs8),
      ]);
    }
    if (typeof property.value !== 'string') {
      const fieldErrorArgs7: FieldErrorArgs = {
        path: fieldPath,
        issue: FieldIssue.ExpectedString,
      };
      return FailedFieldDecode.create([
        FieldDiagnostic.create(fieldErrorArgs7),
      ]);
    }
    return SuccessfulFieldDecode.create(property.value);
  }
}

export class YamlPositiveIntegerField<FieldName extends string> {
  private constructor(private readonly request: ExpectFieldArgs<FieldName>) {}
  static decode<FieldName extends string>(
    args: ExpectFieldArgs<FieldName>,
  ): DecodeOutcome<number> {
    return new YamlPositiveIntegerField<FieldName>(args).execute();
  }
  private execute(): DecodeOutcome<number> {
    const args = this.request;
    const fieldPathArgs2: JoinPathArgs = { base: args.path, key: args.key };
    const fieldPath = FieldPath.join(fieldPathArgs2);
    const propertyArgs3: UntrustedYamlPropertyArgs = {
      record: args.record,
      key: args.key,
    };
    const property = UntrustedYamlBoundary.property(propertyArgs3);
    if (property.presence === UntrustedYamlPropertyPresence.Absent) {
      const fieldErrorArgs6: FieldErrorArgs = {
        path: fieldPath,
        issue: FieldIssue.MissingRequiredField,
      };
      return FailedFieldDecode.create([
        FieldDiagnostic.create(fieldErrorArgs6),
      ]);
    }
    if (
      typeof property.value !== 'number' ||
      !Number.isInteger(property.value) ||
      property.value <= 0
    ) {
      const fieldErrorArgs5: FieldErrorArgs = {
        path: fieldPath,
        issue: FieldIssue.ExpectedPositiveInteger,
      };
      return FailedFieldDecode.create([
        FieldDiagnostic.create(fieldErrorArgs5),
      ]);
    }
    return SuccessfulFieldDecode.create(property.value);
  }
}

export class YamlRemoteTaskField<FieldName extends string> {
  private constructor(private readonly request: ExpectFieldArgs<FieldName>) {}
  static decode<FieldName extends string>(
    args: ExpectFieldArgs<FieldName>,
  ): DecodeOutcome<RemoteTask> {
    return new YamlRemoteTaskField<FieldName>(args).execute();
  }
  private execute(): DecodeOutcome<RemoteTask> {
    const args = this.request;
    const fieldPathArgs: JoinPathArgs = { base: args.path, key: args.key };
    const fieldPath = FieldPath.join(fieldPathArgs);
    const propertyArgs2: UntrustedYamlPropertyArgs = {
      record: args.record,
      key: args.key,
    };
    const property = UntrustedYamlBoundary.property(propertyArgs2);
    if (
      property.presence === UntrustedYamlPropertyPresence.Absent ||
      YamlNullBoundary.matches(property.value)
    ) {
      const omittedTask: RemoteTask = { presence: RemoteTaskPresence.Omitted };
      return SuccessfulFieldDecode.create(omittedTask);
    }
    if (typeof property.value !== 'string') {
      const fieldErrorArgs4: FieldErrorArgs = {
        path: fieldPath,
        issue: FieldIssue.ExpectedRemoteTaskString,
      };
      return FailedFieldDecode.create([
        FieldDiagnostic.create(fieldErrorArgs4),
      ]);
    }
    const specifiedTask: RemoteTask = {
      presence: RemoteTaskPresence.Specified,
      task: property.value,
    };
    return SuccessfulFieldDecode.create(specifiedTask);
  }
}

export class YamlOperationSelection<T extends string> {
  private constructor(
    private readonly request: DecodeExactlyOneOperationArgs<T>,
  ) {}
  static decode<T extends string>(
    args: DecodeExactlyOneOperationArgs<T>,
  ): DecodeOutcome<{
    readonly operation: T;
    readonly payload: UntrustedYamlNode;
  }> {
    return new YamlOperationSelection<T>(args).execute();
  }
  private execute(): DecodeOutcome<{
    readonly operation: T;
    readonly payload: UntrustedYamlNode;
  }> {
    const args = this.request;
    const keys = Object.keys(args.record);
    const operationKeys = keys.filter((key) =>
      args.operations.includes(key as T),
    );
    const unknownKeys = keys.filter(
      (key) => !args.operations.includes(key as T),
    );
    const errors: FieldError[] = unknownKeys.map((key) => {
      const joinPathArgs2: JoinPathArgs = { base: args.path, key };
      const fieldErrorArgs3: FieldErrorArgs = {
        path: FieldPath.join(joinPathArgs2),
        issue: FieldIssue.UnknownField,
      };
      return FieldDiagnostic.create(fieldErrorArgs3);
    });
    if (operationKeys.length !== 1) {
      const fieldErrorArgs2: FieldErrorArgs = {
        path: args.path,
        issue: FieldIssue.ExpectedExactlyOneOperationKey,
        detail: FieldDiagnosticText.create(
          `expected exactly one operation key; known: ${args.operations.join(', ')}`,
        ),
      };
      errors.push(FieldDiagnostic.create(fieldErrorArgs2));
      return FailedFieldDecode.create(errors);
    }
    if (errors.length > 0) {
      return FailedFieldDecode.create(errors);
    }
    const operation = operationKeys[0] as T;
    const propertyArgs: UntrustedYamlPropertyArgs = {
      record: args.record,
      key: operation,
    };
    const property = UntrustedYamlBoundary.property(propertyArgs);
    if (property.presence === UntrustedYamlPropertyPresence.Absent) {
      const joinPathArgs: JoinPathArgs = { base: args.path, key: operation };
      const fieldErrorArgs: FieldErrorArgs = {
        path: FieldPath.join(joinPathArgs),
        issue: FieldIssue.MissingRequiredField,
      };
      return FailedFieldDecode.create([FieldDiagnostic.create(fieldErrorArgs)]);
    }
    const decodeOkArgs = { operation, payload: property.value };
    return SuccessfulFieldDecode.create(decodeOkArgs);
  }
}

export class FieldDecodeCollection<T> {
  private constructor(private readonly request: CollectDecodeArgs<T>) {}
  static collect<T>(args: CollectDecodeArgs<T>): DecodeOutcome<T> {
    return new FieldDecodeCollection<T>(args).execute();
  }
  private execute(): DecodeOutcome<T> {
    const args = this.request;
    const errors: FieldError[] = [];
    for (const result of args.results) {
      if (result.status === DecodeStatus.Failed) {
        errors.push(...result.errors);
      }
    }
    if (errors.length > 0) {
      return FailedFieldDecode.create(errors);
    }
    return SuccessfulFieldDecode.create(args.build());
  }
}

export class FieldDecodeProjection<T, U> {
  private constructor(private readonly request: MapDecodeArgs<T, U>) {}
  static map<T, U>(args: MapDecodeArgs<T, U>): DecodeOutcome<U> {
    return new FieldDecodeProjection<T, U>(args).execute();
  }
  private execute(): DecodeOutcome<U> {
    const args = this.request;
    if (args.outcome.status === DecodeStatus.Failed) {
      return args.outcome;
    }
    return SuccessfulFieldDecode.create(args.build(args.outcome.value));
  }
}

export type ExpectObjectArgs = {
  readonly value: UntrustedYamlNode;
  readonly path: string;
};

export type DenyUnknownKeysArgs<FieldName extends string> = {
  readonly record: UntrustedYamlMap;
  readonly fields: RequestFieldVocabulary<FieldName>;
  readonly path: string;
};

export type ExpectFieldArgs<FieldName extends string> = {
  readonly record: UntrustedYamlMap;
  readonly key: FieldName;
  readonly path: string;
};

export type DecodeExactlyOneOperationArgs<T extends string> = {
  readonly record: UntrustedYamlMap;
  readonly path: string;
  readonly operations: readonly T[];
};

export type DecodeStatusCarrier =
  | { readonly status: DecodeStatus.Ok }
  | {
      readonly status: DecodeStatus.Failed;
      readonly errors: readonly FieldError[];
    };

export type CollectDecodeArgs<T> = {
  readonly results: readonly DecodeStatusCarrier[];
  readonly build: () => T;
};

export type MapDecodeArgs<T, U> = {
  readonly outcome: DecodeOutcome<T>;
  readonly build: (value: T) => U;
};

export const AGENT_STATS_OPERATIONS = Object.values(AgentStatsOperation);

export const PR_LAND_OPERATIONS = Object.values(PrLandOperation);
