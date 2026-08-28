import { expect, test } from 'bun:test';
import {
  SkillSchemaType,
  type SkillInputSchema,
} from '../src/skill-command-domain.ts';
import { listDiscoverableSkillActions } from '../src/skill-action-registry.ts';
import {
  validateSkillInput,
  type SkillSchemaValidationRequest,
} from '../src/skill-schema-validator.ts';
import {
  skillCommandPath,
  type SkillCommandPathRequest,
} from '../src/skill-command-path.ts';
function semanticBlockSchema(): SkillInputSchema {
  const action = listDiscoverableSkillActions().actions.at(1);
  const documents = action?.inputSchema.properties.documents;
  if (!documents || !('items' in documents))
    throw new Error('Missing documents.');
  if (!('properties' in documents.items))
    throw new Error('Missing document items.');
  const blocks = documents.items.properties.blocks;
  if (!blocks || !('items' in blocks)) throw new Error('Missing blocks.');
  return blocks.items;
}
test('preserves discriminated semantic block paths', () => {
  for (const [value, expectedPath] of [
    [{ kind: 'heading', line: 1, text: 'H' }, 'blocks[4].depth'],
    [{ depth: 'x', kind: 'heading', line: 1, text: 'H' }, 'blocks[4].depth'],
    [{ kind: 'paragraph' }, 'blocks[4].line'],
    [{ kind: 'paragraph', line: 'x' }, 'blocks[4].line'],
  ] as const) {
    const request: SkillSchemaValidationRequest = {
      path: 'blocks[4]',
      schema: semanticBlockSchema(),
      value,
    };
    const result = validateSkillInput(request);
    if (result.ok) throw new Error('Expected block rejection.');
    expect(result.path).toBe(expectedPath);
  }
});
test('keeps ambiguous and absent discriminators generic', () => {
  const stringSchema = { type: SkillSchemaType.String } as const;
  const sharedKind = { ...stringSchema, enum: ['shared'] } as const;
  const overlappingVariant: SkillInputSchema = {
    type: SkillSchemaType.Object,
    additionalProperties: false,
    required: ['kind', 'field'],
    properties: { kind: sharedKind, field: stringSchema },
  };
  const overlapping: SkillInputSchema = {
    oneOf: [overlappingVariant, overlappingVariant],
  };
  for (const [schema, value] of [
    [semanticBlockSchema(), { line: 1 }],
    [overlapping, { kind: 'shared' }],
  ] as const) {
    const request: SkillSchemaValidationRequest = {
      path: 'blocks[0]',
      schema,
      value,
    };
    const result = validateSkillInput(request);
    if (result.ok) throw new Error('Expected ambiguous rejection.');
    expect(result.path).toBe('blocks[0]');
  }
});
test('preserves array-union item and first-excess paths', () => {
  const schema: SkillInputSchema = {
    oneOf: [
      {
        type: SkillSchemaType.Array,
        maxItems: 2,
        items: { type: SkillSchemaType.String },
      },
      { const: false },
    ],
  };
  for (const [value, expectedPath] of [
    [['valid', 2], 'entries[1]'],
    [['one', 'two', 'three'], 'entries[2]'],
    [true, 'entries'],
  ] as const) {
    const request: SkillSchemaValidationRequest = {
      path: 'entries',
      schema,
      value,
    };
    const result = validateSkillInput(request);
    if (result.ok) throw new Error('Expected union rejection.');
    expect(result.path).toBe(expectedPath);
  }
});
test('uses bracket grammar for known hyphenated fields', () => {
  const request: SkillCommandPathRequest = {
    field: 'known-field',
    parent: 'root',
  };
  expect(skillCommandPath(request)).toBe('root["known-field"]');
});
