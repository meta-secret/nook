import {
  UntrustedYamlPropertyPresence,
  untrustedYamlProperty,
  isRecord,
  type UntrustedYamlMap,
  type UntrustedYamlNode,
} from '../lib/guards.ts';
import { RemoteTaskPresence, type RemoteTask } from './args/pr-land.ts';
import { AgentStatsOperation, PrLandOperation } from './enums.ts';
import { isExternalNull } from './external.ts';
import {
  DecodeStatus,
  FieldIssue,
  decodeErr,
  decodeOk,
  fieldDetailText,
  fieldError,
  joinPath,
  type DecodeOutcome,
  type FieldError,
} from './field-error.ts';
import {
  fieldNamesOf,
  type RequestFieldVocabulary,
} from './field-vocabulary.ts';

import type { FieldErrorArgs, JoinPathArgs } from './field-error.ts';
import type { UntrustedYamlPropertyArgs } from '../lib/guards.ts';
export type ExpectObjectArgs = {
  readonly value: UntrustedYamlNode;
  readonly path: string;
};

export function expectObject(
  args: ExpectObjectArgs,
): DecodeOutcome<UntrustedYamlMap> {
  if (!isRecord(args.value)) {
    const fieldErrorArgs12: FieldErrorArgs = {
      path: args.path,
      issue: FieldIssue.ExpectedObject,
    };
    return decodeErr([fieldError(fieldErrorArgs12)]);
  }
  return decodeOk(args.value);
}

export type DenyUnknownKeysArgs<FieldName extends string> = {
  readonly record: UntrustedYamlMap;
  readonly fields: RequestFieldVocabulary<FieldName>;
  readonly path: string;
};

/** Reject keys outside one request-payload field vocabulary enum. */
export function denyUnknownKeys<FieldName extends string>(
  args: DenyUnknownKeysArgs<FieldName>,
): readonly FieldError[] {
  const allowed = new Set<string>(fieldNamesOf(args.fields));
  const errors: FieldError[] = [];
  for (const key of Object.keys(args.record)) {
    if (!allowed.has(key)) {
      const joinPathArgs3: JoinPathArgs = { base: args.path, key };
      const fieldErrorArgs11: FieldErrorArgs = {
        path: joinPath(joinPathArgs3),
        issue: FieldIssue.UnknownField,
      };
      errors.push(fieldError(fieldErrorArgs11));
    }
  }
  return errors;
}

export type ExpectFieldArgs<FieldName extends string> = {
  readonly record: UntrustedYamlMap;
  readonly key: FieldName;
  readonly path: string;
};

export function expectBoolean<FieldName extends string>(
  args: ExpectFieldArgs<FieldName>,
): DecodeOutcome<boolean> {
  const fieldPathArgs4: JoinPathArgs = { base: args.path, key: args.key };
  const fieldPath = joinPath(fieldPathArgs4);
  const propertyArgs5: UntrustedYamlPropertyArgs = {
    record: args.record,
    key: args.key,
  };
  const property = untrustedYamlProperty(propertyArgs5);
  if (property.presence === UntrustedYamlPropertyPresence.Absent) {
    const fieldErrorArgs10: FieldErrorArgs = {
      path: fieldPath,
      issue: FieldIssue.MissingRequiredField,
    };
    return decodeErr([fieldError(fieldErrorArgs10)]);
  }
  if (typeof property.value !== 'boolean') {
    const fieldErrorArgs9: FieldErrorArgs = {
      path: fieldPath,
      issue: FieldIssue.ExpectedBoolean,
    };
    return decodeErr([fieldError(fieldErrorArgs9)]);
  }
  return decodeOk(property.value);
}

export function expectString<FieldName extends string>(
  args: ExpectFieldArgs<FieldName>,
): DecodeOutcome<string> {
  const fieldPathArgs3: JoinPathArgs = { base: args.path, key: args.key };
  const fieldPath = joinPath(fieldPathArgs3);
  const propertyArgs4: UntrustedYamlPropertyArgs = {
    record: args.record,
    key: args.key,
  };
  const property = untrustedYamlProperty(propertyArgs4);
  if (property.presence === UntrustedYamlPropertyPresence.Absent) {
    const fieldErrorArgs8: FieldErrorArgs = {
      path: fieldPath,
      issue: FieldIssue.MissingRequiredField,
    };
    return decodeErr([fieldError(fieldErrorArgs8)]);
  }
  if (typeof property.value !== 'string') {
    const fieldErrorArgs7: FieldErrorArgs = {
      path: fieldPath,
      issue: FieldIssue.ExpectedString,
    };
    return decodeErr([fieldError(fieldErrorArgs7)]);
  }
  return decodeOk(property.value);
}

export function expectPositiveInt<FieldName extends string>(
  args: ExpectFieldArgs<FieldName>,
): DecodeOutcome<number> {
  const fieldPathArgs2: JoinPathArgs = { base: args.path, key: args.key };
  const fieldPath = joinPath(fieldPathArgs2);
  const propertyArgs3: UntrustedYamlPropertyArgs = {
    record: args.record,
    key: args.key,
  };
  const property = untrustedYamlProperty(propertyArgs3);
  if (property.presence === UntrustedYamlPropertyPresence.Absent) {
    const fieldErrorArgs6: FieldErrorArgs = {
      path: fieldPath,
      issue: FieldIssue.MissingRequiredField,
    };
    return decodeErr([fieldError(fieldErrorArgs6)]);
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
    return decodeErr([fieldError(fieldErrorArgs5)]);
  }
  return decodeOk(property.value);
}

export function expectRemoteTask<FieldName extends string>(
  args: ExpectFieldArgs<FieldName>,
): DecodeOutcome<RemoteTask> {
  const fieldPathArgs: JoinPathArgs = { base: args.path, key: args.key };
  const fieldPath = joinPath(fieldPathArgs);
  const propertyArgs2: UntrustedYamlPropertyArgs = {
    record: args.record,
    key: args.key,
  };
  const property = untrustedYamlProperty(propertyArgs2);
  if (
    property.presence === UntrustedYamlPropertyPresence.Absent ||
    isExternalNull(property.value)
  ) {
    const omittedTask: RemoteTask = { presence: RemoteTaskPresence.Omitted };
    return decodeOk(omittedTask);
  }
  if (typeof property.value !== 'string') {
    const fieldErrorArgs4: FieldErrorArgs = {
      path: fieldPath,
      issue: FieldIssue.ExpectedRemoteTaskString,
    };
    return decodeErr([fieldError(fieldErrorArgs4)]);
  }
  const specifiedTask: RemoteTask = {
    presence: RemoteTaskPresence.Specified,
    task: property.value,
  };
  return decodeOk(specifiedTask);
}

export type DecodeExactlyOneOperationArgs<T extends string> = {
  readonly record: UntrustedYamlMap;
  readonly path: string;
  readonly operations: readonly T[];
};

export function decodeExactlyOneOperation<T extends string>(
  args: DecodeExactlyOneOperationArgs<T>,
): DecodeOutcome<{ readonly operation: T; readonly payload: UntrustedYamlNode }> {
  const keys = Object.keys(args.record);
  const operationKeys = keys.filter((key) =>
    args.operations.includes(key as T),
  );
  const unknownKeys = keys.filter((key) => !args.operations.includes(key as T));
  const errors: FieldError[] = unknownKeys.map((key) => {
    const joinPathArgs2: JoinPathArgs = { base: args.path, key };
    const fieldErrorArgs3: FieldErrorArgs = {
      path: joinPath(joinPathArgs2),
      issue: FieldIssue.UnknownField,
    };
    return fieldError(fieldErrorArgs3);
  });
  if (operationKeys.length !== 1) {
    const fieldErrorArgs2: FieldErrorArgs = {
      path: args.path,
      issue: FieldIssue.ExpectedExactlyOneOperationKey,
      detail: fieldDetailText(
        `expected exactly one operation key; known: ${args.operations.join(', ')}`,
      ),
    };
    errors.push(fieldError(fieldErrorArgs2));
    return decodeErr(errors);
  }
  if (errors.length > 0) {
    return decodeErr(errors);
  }
  const operation = operationKeys[0] as T;
  const propertyArgs: UntrustedYamlPropertyArgs = {
    record: args.record,
    key: operation,
  };
  const property = untrustedYamlProperty(propertyArgs);
  if (property.presence === UntrustedYamlPropertyPresence.Absent) {
    const joinPathArgs: JoinPathArgs = { base: args.path, key: operation };
    const fieldErrorArgs: FieldErrorArgs = {
      path: joinPath(joinPathArgs),
      issue: FieldIssue.MissingRequiredField,
    };
    return decodeErr([fieldError(fieldErrorArgs)]);
  }
  const decodeOkArgs = { operation, payload: property.value };
  return decodeOk(decodeOkArgs);
}

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

export function collectDecode<T>(args: CollectDecodeArgs<T>): DecodeOutcome<T> {
  const errors: FieldError[] = [];
  for (const result of args.results) {
    if (result.status === DecodeStatus.Failed) {
      errors.push(...result.errors);
    }
  }
  if (errors.length > 0) {
    return decodeErr(errors);
  }
  return decodeOk(args.build());
}

export type MapDecodeArgs<T, U> = {
  readonly outcome: DecodeOutcome<T>;
  readonly build: (value: T) => U;
};

export function mapDecode<T, U>(args: MapDecodeArgs<T, U>): DecodeOutcome<U> {
  if (args.outcome.status === DecodeStatus.Failed) {
    return args.outcome;
  }
  return decodeOk(args.build(args.outcome.value));
}

export const AGENT_STATS_OPERATIONS = Object.values(AgentStatsOperation);
export const PR_LAND_OPERATIONS = Object.values(PrLandOperation);
