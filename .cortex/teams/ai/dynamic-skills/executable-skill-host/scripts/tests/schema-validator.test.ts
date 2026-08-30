import { expect, test } from 'bun:test';
import {
  SkillSchemaType,
  type SkillInputSchema,
} from '../src/skill-command-domain.ts';
import {
  validateSkillInput,
  type SkillSchemaValidationRequest,
} from '../src/skill-schema-validator.ts';
import {
  skillCommandPath,
  type SkillCommandPathRequest,
} from '../src/skill-command-path.ts';
import type { UntrustedSkillYamlNode } from '../src/skill-yaml-codec.ts';
const stringSchema = { type: SkillSchemaType.String } as const;
const semanticBlockSchema: SkillInputSchema = {
  oneOf: [
    {
      type: SkillSchemaType.Object,
      additionalProperties: false,
      required: ['depth', 'kind', 'line', 'text'],
      properties: {
        depth: { type: SkillSchemaType.Integer, minimum: 1, maximum: 6 },
        kind: { ...stringSchema, enum: ['heading'] },
        line: { type: SkillSchemaType.Integer, minimum: 1 },
        text: stringSchema,
      },
    },
    {
      type: SkillSchemaType.Object,
      additionalProperties: false,
      required: ['kind', 'line'],
      properties: {
        kind: { ...stringSchema, enum: ['paragraph'] },
        line: { type: SkillSchemaType.Integer, minimum: 1 },
      },
    },
  ],
};
type RejectionRequest = {
  readonly schema: SkillInputSchema;
  readonly value: UntrustedSkillYamlNode;
};
function reject(rejection: RejectionRequest): string {
  const request: SkillSchemaValidationRequest = {
    path: 'blocks[4]',
    schema: rejection.schema,
    value: rejection.value,
  };
  const result = validateSkillInput(request);
  if (result.ok) throw new Error('Expected schema rejection.');
  return result.path;
}
test('preserves discriminated and ambiguous union paths', () => {
  for (const [value, path] of [
    [{ kind: 'heading', line: 1, text: 'H' }, 'blocks[4].depth'],
    [{ depth: 'x', kind: 'heading', line: 1, text: 'H' }, 'blocks[4].depth'],
    [{ kind: 'paragraph' }, 'blocks[4].line'],
    [{ kind: 'paragraph', line: 'x' }, 'blocks[4].line'],
    [{ line: 1 }, 'blocks[4]'],
  ] as const) {
    const rejection: RejectionRequest = { schema: semanticBlockSchema, value };
    expect(reject(rejection)).toBe(path);
  }
  const overlappingVariant: SkillInputSchema = {
    type: SkillSchemaType.Object,
    additionalProperties: false,
    required: ['kind', 'field'],
    properties: {
      kind: { ...stringSchema, enum: ['shared'] },
      field: stringSchema,
    },
  };
  const rejection: RejectionRequest = {
    schema: { oneOf: [overlappingVariant, overlappingVariant] },
    value: { kind: 'shared' },
  };
  expect(reject(rejection)).toBe('blocks[4]');
});
test('preserves array-union item and first-excess paths', () => {
  const schema: SkillInputSchema = {
    oneOf: [
      { type: SkillSchemaType.Array, maxItems: 2, items: stringSchema },
      { const: false },
    ],
  };
  for (const [value, path] of [
    [['valid', 2], 'blocks[4][1]'],
    [['one', 'two', 'three'], 'blocks[4][2]'],
    [true, 'blocks[4]'],
  ] as const) {
    const rejection: RejectionRequest = { schema, value };
    expect(reject(rejection)).toBe(path);
  }
});
test('uses bracket grammar for known hyphenated fields', () => {
  const request: SkillCommandPathRequest = {
    field: 'known-field',
    parent: 'root',
  };
  expect(skillCommandPath(request)).toBe('root["known-field"]');
});
test('counts string limits in Unicode code points', () => {
  for (const [schema, accepted, rejected] of [
    [{ type: SkillSchemaType.String, maxLength: 2 }, '😀a', '😀ab'],
    [
      { type: SkillSchemaType.String, maxTrimmedLineLength: 2 },
      '  😀a  ',
      '  😀ab  ',
    ],
  ] as const) {
    const acceptedRequest: SkillSchemaValidationRequest = {
      path: 'text',
      schema,
      value: accepted,
    };
    expect(validateSkillInput(acceptedRequest).ok).toBe(true);
    const rejection: RejectionRequest = { schema, value: rejected };
    expect(reject(rejection)).toBe('blocks[4]');
  }
});
test('accepts only safe integer values', () => {
  const schema: SkillInputSchema = {
    type: SkillSchemaType.Integer,
    minimum: Number.MIN_SAFE_INTEGER,
    maximum: Number.MAX_SAFE_INTEGER,
  };
  for (const value of [Number.MIN_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER]) {
    const request: SkillSchemaValidationRequest = {
      path: 'line',
      schema,
      value,
    };
    expect(validateSkillInput(request).ok).toBe(true);
  }
  for (const value of [
    Number.MIN_SAFE_INTEGER - 1,
    Number.MAX_SAFE_INTEGER + 1,
    1.5,
  ]) {
    const rejection: RejectionRequest = { schema, value };
    expect(reject(rejection)).toBe('blocks[4]');
  }
});
