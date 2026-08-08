/**
 * Typed JSON Schema fragments for Loom toolsList discovery.
 *
 * These are Loom domain types, not untyped object bags and not ExternalValue.
 */

export enum JsonSchemaType {
  Object = 'object',
  Boolean = 'boolean',
  Integer = 'integer',
  String = 'string',
}

export type BooleanJsonSchema = {
  readonly type: JsonSchemaType.Boolean;
};

export type IntegerJsonSchema = {
  readonly type: JsonSchemaType.Integer;
  readonly minimum: number;
};

export type PlainStringJsonSchema = {
  readonly type: JsonSchemaType.String;
};

export type PatternStringJsonSchema = {
  readonly type: JsonSchemaType.String;
  readonly pattern: string;
};

export type StringJsonSchema = PlainStringJsonSchema | PatternStringJsonSchema;

export type JsonSchemaProperty =
  | BooleanJsonSchema
  | IntegerJsonSchema
  | StringJsonSchema;

export type ObjectJsonSchema = {
  readonly type: JsonSchemaType.Object;
  readonly additionalProperties: false;
  readonly required: readonly string[];
  readonly properties: {
    readonly [field: string]: JsonSchemaProperty;
  };
};

export function booleanJsonSchema(): BooleanJsonSchema {
  return { type: JsonSchemaType.Boolean };
}

export type IntegerJsonSchemaArgs = {
  readonly minimum: number;
};

export function integerJsonSchema(
  args: IntegerJsonSchemaArgs,
): IntegerJsonSchema {
  return { type: JsonSchemaType.Integer, minimum: args.minimum };
}

export function stringJsonSchema(): PlainStringJsonSchema {
  return { type: JsonSchemaType.String };
}

export type PatternStringJsonSchemaArgs = {
  readonly pattern: string;
};

export function patternStringJsonSchema(
  args: PatternStringJsonSchemaArgs,
): PatternStringJsonSchema {
  return { type: JsonSchemaType.String, pattern: args.pattern };
}

export type ObjectJsonSchemaArgs = {
  readonly required: readonly string[];
  readonly properties: {
    readonly [field: string]: JsonSchemaProperty;
  };
};

export function objectJsonSchema(args: ObjectJsonSchemaArgs): ObjectJsonSchema {
  return {
    type: JsonSchemaType.Object,
    additionalProperties: false,
    required: args.required,
    properties: args.properties,
  };
}
