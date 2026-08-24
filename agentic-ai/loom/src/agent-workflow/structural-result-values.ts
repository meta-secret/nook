import { isRecord } from '../lib/guards.ts';
import type { UntrustedYamlMap, UntrustedYamlNode } from '../lib/guards.ts';

const MAX_ITEMS = 100;
const MAX_TEXT = 4096;
const MAX_EVIDENCE_PATHS = 64;

export type ExactStructuralKeys = readonly [
  UntrustedYamlMap,
  readonly string[],
];

export function assertExactStructuralKeys(values: ExactStructuralKeys): void {
  const [node, expectedKeys] = values;
  const allowed = new Set(expectedKeys);
  const keys = Object.keys(node);
  if (keys.length !== allowed.size || keys.some((key) => !allowed.has(key))) {
    invalid('structural result contains missing or extra fields');
  }
}

export type StructuralNodeProperty = readonly [UntrustedYamlMap, string];

export function structuralProperty(
  values: StructuralNodeProperty,
): UntrustedYamlNode {
  const [node, key] = values;
  if (!Object.prototype.hasOwnProperty.call(node, key)) {
    invalid('structural result contains missing or extra fields');
  }
  return node[key] as UntrustedYamlNode;
}

export type LabeledStructuralNode = readonly [UntrustedYamlNode, string];

export function requiredStructuralRecord(
  values: LabeledStructuralNode,
): UntrustedYamlMap {
  const [node, label] = values;
  if (!isRecord(node)) invalid(`${label} must be an object`);
  return node;
}

export type BoundedStructuralArray = readonly [UntrustedYamlNode, number];

export function requiredStructuralArray(
  values: BoundedStructuralArray,
): readonly UntrustedYamlNode[] {
  const [node, min] = values;
  if (!Array.isArray(node) || node.length < min || node.length > MAX_ITEMS) {
    invalid('structural result array is invalid');
  }
  return node;
}

export type BoundedStructuralStrings = readonly [UntrustedYamlNode, number];

export function boundedStructuralStrings(
  input: BoundedStructuralStrings,
): readonly string[] {
  const [node, min] = input;
  const values = requiredStructuralArray([node, min]).map((entry) =>
    boundedStructuralString([entry, MAX_TEXT]),
  );
  if (new Set(values).size !== values.length) {
    invalid('structural result strings must be unique');
  }
  return values;
}

export type BoundedStructuralString = readonly [UntrustedYamlNode, number];

export function boundedStructuralString(
  values: BoundedStructuralString,
): string {
  const [node, max] = values;
  if (
    typeof node !== 'string' ||
    node.trim() === '' ||
    node.length > max ||
    forbiddenControl(node)
  ) {
    invalid('structural result string is invalid');
  }
  return node;
}

export function safeStructuralId(node: UntrustedYamlNode): string {
  const value = boundedStructuralString([node, 128]);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
    invalid('structural result identifier is invalid');
  }
  return value;
}

export function positiveStructuralInteger(node: UntrustedYamlNode): number {
  if (typeof node !== 'number' || !Number.isSafeInteger(node) || node < 1) {
    invalid('structural result integer is invalid');
  }
  return node;
}

export type BoundedStructuralPaths = readonly [UntrustedYamlNode, number];

export function safeStructuralPaths(
  input: BoundedStructuralPaths,
): readonly string[] {
  const [node, min] = input;
  const values = requiredStructuralArray([node, min]).map((entry) =>
    safeStructuralPath(entry),
  );
  if (
    values.length > MAX_EVIDENCE_PATHS ||
    new Set(values).size !== values.length
  ) {
    invalid('structural paths are invalid');
  }
  return values;
}

export function safeStructuralPath(node: UntrustedYamlNode): string {
  const value = boundedStructuralString([node, 512]);
  if (
    value.startsWith('/') ||
    value.includes('\\') ||
    value
      .split('/')
      .some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    invalid('structural path is invalid');
  }
  return value;
}

export function structuralSha(node: UntrustedYamlNode): string {
  const value = boundedStructuralString([node, 64]);
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    invalid('structural projection hash is invalid');
  }
  return value;
}

export type StructuralEnumValue<T extends string> = readonly [
  UntrustedYamlNode,
  readonly T[],
];

export function structuralEnumValue<T extends string>(
  input: StructuralEnumValue<T>,
): T {
  const [node, values] = input;
  const value = boundedStructuralString([node, 128]);
  if (!values.includes(value as T)) {
    invalid('structural closed vocabulary is invalid');
  }
  return value as T;
}

export type UniqueStructuralIds = {
  readonly ids: readonly string[];
  readonly label: string;
};

export function assertUniqueStructuralIds(request: UniqueStructuralIds): void {
  if (new Set(request.ids).size !== request.ids.length) {
    invalid(`${request.label} identifiers must be unique`);
  }
}

function forbiddenControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return (
      code === 127 || (code < 32 && code !== 9 && code !== 10 && code !== 13)
    );
  });
}

function invalid(detail: string): never {
  throw new Error(`Invalid workflow structured result: ${detail}.`);
}
