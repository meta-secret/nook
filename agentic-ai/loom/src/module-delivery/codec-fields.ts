import {
  UntrustedYamlPropertyPresence,
  UntrustedYamlBoundary,
} from '../lib/guards.ts';
import {
  type RequestFieldVocabulary,
  RequestFieldCatalog,
} from '../codec/field-vocabulary.ts';
import {
  MAX_MODULE_DELIVERY_STRING_CODE_UNITS,
  MAX_MODULE_DELIVERY_STRING_LIST_ENTRIES,
} from './evidence-limits.ts';
import {
  MAX_MODULE_DELIVERY_EDGE_CONTRACTS,
  MAX_MODULE_DELIVERY_NODES,
  ModuleDeliveryIssueCode,
} from './domain.ts';
import type {
  UntrustedYamlMap,
  UntrustedYamlNode,
  UntrustedYamlPropertyArgs,
} from '../lib/guards.ts';

export type ModulePlanObjectDecodeRequest = {
  readonly record: UntrustedYamlMap;
  readonly path: string;
};

export type ModulePlanTransportList = readonly UntrustedYamlNode[];

type ModulePlanDecodeFailureRequest = Readonly<{
  readonly message: string;
  readonly code?: ModuleDeliveryIssueCode;
  readonly path?: string;
}>;

export class ModulePlanDecodeFailure extends Error {
  readonly code: ModuleDeliveryIssueCode;
  readonly path: string;

  constructor(request: ModulePlanDecodeFailureRequest) {
    super(request.message);
    this.name = 'ModulePlanDecodeFailure';
    this.code = request.code ?? ModuleDeliveryIssueCode.InvalidField;
    this.path = request.path ?? '$';
  }
}

export enum ModuleDeliveryPlanTransportLimitCode {
  SerializedByteLimit = 'serialized-byte-limit',
  DepthLimit = 'depth-limit',
  ObjectKeyLimit = 'object-key-limit',
  ArrayEntryLimit = 'array-entry-limit',
  AggregateNodeLimit = 'aggregate-node-limit',
  AggregateStringLimit = 'aggregate-string-limit',
}

export class ModuleDeliveryPlanTransportLimit extends ModulePlanDecodeFailure {
  readonly limitCode: ModuleDeliveryPlanTransportLimitCode;
  readonly observed: number;
  readonly limit: number;

  constructor(request: {
    readonly code: ModuleDeliveryPlanTransportLimitCode;
    readonly observed: number;
    readonly limit: number;
    readonly path?: string;
  }) {
    super({
      code: ModuleDeliveryIssueCode.LimitExceeded,
      path: request.path,
      message: `Plan transport ${request.code} exceeded its bound (${request.observed} > ${request.limit}).`,
    });
    this.name = 'ModuleDeliveryPlanTransportLimit';
    this.limitCode = request.code;
    this.observed = request.observed;
    this.limit = request.limit;
  }
}

export class ModulePlanFields {
  readonly record: UntrustedYamlMap;
  readonly path: string;

  constructor(request: ModulePlanObjectDecodeRequest) {
    this.record = request.record;
    this.path = request.path;
  }

  requireExactKeys<FieldName extends string>(
    vocabulary: RequestFieldVocabulary<FieldName>,
  ): void {
    const actual = Object.keys(this.record).sort();
    const expected = [...RequestFieldCatalog.names(vocabulary)].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      this.fail(`: expected exactly ${expected.join(', ')}.`);
  }

  string(key: string): string {
    const value = this.value(key);
    if (
      typeof value !== 'string' ||
      value.trim() === '' ||
      value.length > MAX_MODULE_DELIVERY_STRING_CODE_UNITS ||
      ModulePlanFields.hasControlCharacter(value)
    )
      this.fail(`.${key}: expected a bounded non-empty string.`);
    return value;
  }

  identifier(key: string): string {
    const value = this.string(key);
    if (!/^[a-z][a-z0-9_-]{0,63}$/u.test(value))
      this.fail(`.${key}: expected a stable lowercase identifier.`);
    return value;
  }

  positiveInteger(key: string): number {
    const value = this.value(key);
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
      this.fail(`.${key}: expected a positive integer.`);
    return value;
  }

  trueValue(key: string): true {
    if (this.value(key) !== true) this.fail(`.${key}: expected true.`);
    return true;
  }

  nonEmptyStringList(key: string): readonly string[] {
    const values = this.stringList(key);
    if (values.length === 0)
      this.fail(`.${key}: expected a non-empty string array.`);
    return values;
  }

  stringList(key: string): readonly string[] {
    const value = this.value(key);
    if (!UntrustedYamlBoundary.isList(value))
      this.fail(`.${key}: expected a bounded string array.`);
    if (value.length > MAX_MODULE_DELIVERY_STRING_LIST_ENTRIES)
      this.failLimit({
        key,
        observed: value.length,
        maximum: MAX_MODULE_DELIVERY_STRING_LIST_ENTRIES,
      });
    const strings: string[] = [];
    for (const entry of value) {
      if (
        typeof entry !== 'string' ||
        entry.trim() === '' ||
        entry.length > MAX_MODULE_DELIVERY_STRING_CODE_UNITS ||
        ModulePlanFields.hasControlCharacter(entry)
      )
        this.fail(`.${key}: expected bounded non-empty entries.`);
      strings.push(entry);
    }
    return strings;
  }

  recordField(key: string): UntrustedYamlMap {
    const value = this.value(key);
    if (!UntrustedYamlBoundary.isRecord(value))
      this.fail(`.${key}: expected an object.`);
    return value;
  }

  nodeList(
    key: string,
    maximum = MAX_MODULE_DELIVERY_NODES,
  ): ModulePlanTransportList {
    const value = this.value(key);
    if (!UntrustedYamlBoundary.isList(value))
      this.fail(`.${key}: expected a non-empty array.`);
    if (value.length === 0) this.fail(`.${key}: expected a non-empty array.`);
    if (value.length > maximum)
      this.failLimit({ key, observed: value.length, maximum });
    return value;
  }

  list(
    key: string,
    maximum = MAX_MODULE_DELIVERY_EDGE_CONTRACTS,
  ): ModulePlanTransportList {
    const value = this.value(key);
    if (!UntrustedYamlBoundary.isList(value))
      this.fail(`.${key}: expected an array.`);
    if (value.length > maximum)
      this.failLimit({ key, observed: value.length, maximum });
    return value;
  }

  private value(key: string): UntrustedYamlNode {
    const propertyRequest: UntrustedYamlPropertyArgs = {
      record: this.record,
      key,
    };
    const property = UntrustedYamlBoundary.property(propertyRequest);
    if (property.presence === UntrustedYamlPropertyPresence.Absent)
      this.fail(`.${key}: required field is missing.`);
    return property.value;
  }

  private fail(message: string): never {
    throw new ModulePlanDecodeFailure({ message: `${this.path}${message}` });
  }

  private failLimit(request: {
    readonly key: string;
    readonly observed: number;
    readonly maximum: number;
  }): never {
    throw new ModulePlanDecodeFailure({
      message: `${this.path}.${request.key}: array contains ${request.observed} entries; maximum is ${request.maximum}.`,
      code: ModuleDeliveryIssueCode.LimitExceeded,
      path: `${this.path}.${request.key}`,
    });
  }

  private static hasControlCharacter(value: string): boolean {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code <= 31 || code === 127) return true;
    }
    return false;
  }
}
