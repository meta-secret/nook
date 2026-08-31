import {
  UntrustedYamlPropertyPresence,
  isRecord,
  untrustedYamlProperty,
} from '../lib/guards.ts';
import {
  fieldNamesOf,
  type RequestFieldVocabulary,
} from '../codec/field-vocabulary.ts';
import {
  MAX_MODULE_DELIVERY_STRING_CODE_UNITS,
  MAX_MODULE_DELIVERY_STRING_LIST_ENTRIES,
} from './evidence-limits.ts';
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

export class ModulePlanDecodeFailure extends Error {}

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
    const expected = [...fieldNamesOf(vocabulary)].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      this.fail(`: expected exactly ${expected.join(', ')}.`);
  }

  string(key: string): string {
    const value = this.value(key);
    if (
      typeof value !== 'string' ||
      value.trim() === '' ||
      value.length > MAX_MODULE_DELIVERY_STRING_CODE_UNITS ||
      hasControlCharacter(value)
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
    if (
      !Array.isArray(value) ||
      value.length > MAX_MODULE_DELIVERY_STRING_LIST_ENTRIES
    )
      this.fail(`.${key}: expected a bounded string array.`);
    for (const entry of value) {
      if (
        typeof entry !== 'string' ||
        entry.trim() === '' ||
        entry.length > MAX_MODULE_DELIVERY_STRING_CODE_UNITS ||
        hasControlCharacter(entry)
      )
        this.fail(`.${key}: expected bounded non-empty entries.`);
    }
    return value;
  }

  recordField(key: string): UntrustedYamlMap {
    const value = this.value(key);
    if (!isRecord(value)) this.fail(`.${key}: expected an object.`);
    return value;
  }

  nodeList(key: string): ModulePlanTransportList {
    const value = this.value(key);
    if (!Array.isArray(value) || value.length === 0)
      this.fail(`.${key}: expected a non-empty array.`);
    return value;
  }

  list(key: string): ModulePlanTransportList {
    const value = this.value(key);
    if (!Array.isArray(value)) this.fail(`.${key}: expected an array.`);
    return value;
  }

  private value(key: string): UntrustedYamlNode {
    const propertyRequest: UntrustedYamlPropertyArgs = {
      record: this.record,
      key,
    };
    const property = untrustedYamlProperty(propertyRequest);
    if (property.presence === UntrustedYamlPropertyPresence.Absent)
      this.fail(`.${key}: required field is missing.`);
    return property.value;
  }

  private fail(message: string): never {
    throw new ModulePlanDecodeFailure(`${this.path}${message}`);
  }
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}
