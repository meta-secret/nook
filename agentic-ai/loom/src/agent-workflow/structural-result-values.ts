import { UntrustedYamlBoundary } from '../lib/guards.ts';
import type { UntrustedYamlMap, UntrustedYamlNode } from '../lib/guards.ts';

/** Owns the structural value boundary registry and its capability transitions. */
export class StructuralValueBoundary {
  private constructor() {}
  private static readonly MAX_ITEMS = 100;

  private static readonly MAX_TEXT = 4096;

  private static readonly MAX_EVIDENCE_PATHS = 64;

  static assertExactStructuralKeys(values: ExactStructuralKeys): void {
    const [node, expectedKeys] = values;
    const allowed = new Set(expectedKeys);
    const keys = Object.keys(node);
    if (keys.length !== allowed.size || keys.some((key) => !allowed.has(key))) {
      StructuralValueBoundary.invalid(
        'structural result contains missing or extra fields',
      );
    }
  }

  static structuralProperty(values: StructuralNodeProperty): UntrustedYamlNode {
    const [node, key] = values;
    if (!Object.prototype.hasOwnProperty.call(node, key)) {
      StructuralValueBoundary.invalid(
        'structural result contains missing or extra fields',
      );
    }
    return node[key] as UntrustedYamlNode;
  }

  static requiredStructuralRecord(
    values: LabeledStructuralNode,
  ): UntrustedYamlMap {
    const [node, label] = values;
    if (!UntrustedYamlBoundary.isRecord(node))
      StructuralValueBoundary.invalid(`${label} must be an object`);
    return node;
  }

  static requiredStructuralArray(
    values: BoundedStructuralArray,
  ): readonly UntrustedYamlNode[] {
    const [node, min] = values;
    if (
      !Array.isArray(node) ||
      node.length < min ||
      node.length > StructuralValueBoundary.MAX_ITEMS
    ) {
      StructuralValueBoundary.invalid('structural result array is invalid');
    }
    return node;
  }

  static boundedStructuralStrings(
    input: BoundedStructuralStrings,
  ): readonly string[] {
    const [node, min] = input;
    const values = StructuralValueBoundary.requiredStructuralArray([
      node,
      min,
    ]).map((entry) =>
      StructuralValueBoundary.boundedStructuralString([
        entry,
        StructuralValueBoundary.MAX_TEXT,
      ]),
    );
    if (new Set(values).size !== values.length) {
      StructuralValueBoundary.invalid(
        'structural result strings must be unique',
      );
    }
    return values;
  }

  static boundedStructuralString(values: BoundedStructuralString): string {
    const [node, max] = values;
    if (
      typeof node !== 'string' ||
      node.trim() === '' ||
      node.length > max ||
      StructuralValueBoundary.forbiddenControl(node)
    ) {
      StructuralValueBoundary.invalid('structural result string is invalid');
    }
    return node;
  }

  static safeStructuralId(node: UntrustedYamlNode): string {
    const value = StructuralValueBoundary.boundedStructuralString([node, 128]);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
      StructuralValueBoundary.invalid(
        'structural result identifier is invalid',
      );
    }
    return value;
  }

  static positiveStructuralInteger(node: UntrustedYamlNode): number {
    if (typeof node !== 'number' || !Number.isSafeInteger(node) || node < 1) {
      StructuralValueBoundary.invalid('structural result integer is invalid');
    }
    return node;
  }

  static safeStructuralPaths(input: BoundedStructuralPaths): readonly string[] {
    const [node, min] = input;
    const values = StructuralValueBoundary.requiredStructuralArray([
      node,
      min,
    ]).map((entry) => StructuralValueBoundary.safeStructuralPath(entry));
    if (
      values.length > StructuralValueBoundary.MAX_EVIDENCE_PATHS ||
      new Set(values).size !== values.length
    ) {
      StructuralValueBoundary.invalid('structural paths are invalid');
    }
    return values;
  }

  static safeStructuralPath(node: UntrustedYamlNode): string {
    const value = StructuralValueBoundary.boundedStructuralString([node, 512]);
    if (
      value.startsWith('/') ||
      value.includes('\\') ||
      value
        .split('/')
        .some(
          (segment) => segment === '' || segment === '.' || segment === '..',
        )
    ) {
      StructuralValueBoundary.invalid('structural path is invalid');
    }
    return value;
  }

  static structuralSha(node: UntrustedYamlNode): string {
    const value = StructuralValueBoundary.boundedStructuralString([node, 64]);
    if (!/^[0-9a-f]{64}$/u.test(value)) {
      StructuralValueBoundary.invalid('structural projection hash is invalid');
    }
    return value;
  }

  static structuralEnumValue<T extends string>(
    input: StructuralEnumValue<T>,
  ): T {
    const [node, values] = input;
    const value = StructuralValueBoundary.boundedStructuralString([node, 128]);
    if (!values.includes(value as T)) {
      StructuralValueBoundary.invalid(
        'structural closed vocabulary is invalid',
      );
    }
    return value as T;
  }

  static assertUniqueStructuralIds(request: UniqueStructuralIds): void {
    if (new Set(request.ids).size !== request.ids.length) {
      StructuralValueBoundary.invalid(
        `${request.label} identifiers must be unique`,
      );
    }
  }

  private static forbiddenControl(value: string): boolean {
    return Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return (
        code === 127 || (code < 32 && code !== 9 && code !== 10 && code !== 13)
      );
    });
  }

  private static invalid(detail: string): never {
    throw new Error(`Invalid workflow structured result: ${detail}.`);
  }
}

export type ExactStructuralKeys = readonly [
  UntrustedYamlMap,
  readonly string[],
];

export type StructuralNodeProperty = readonly [UntrustedYamlMap, string];

export type LabeledStructuralNode = readonly [UntrustedYamlNode, string];

export type BoundedStructuralArray = readonly [UntrustedYamlNode, number];

export type BoundedStructuralStrings = readonly [UntrustedYamlNode, number];

export type BoundedStructuralString = readonly [UntrustedYamlNode, number];

export type BoundedStructuralPaths = readonly [UntrustedYamlNode, number];

export type StructuralEnumValue<T extends string> = readonly [
  UntrustedYamlNode,
  readonly T[],
];

export type UniqueStructuralIds = {
  readonly ids: readonly string[];
  readonly label: string;
};
