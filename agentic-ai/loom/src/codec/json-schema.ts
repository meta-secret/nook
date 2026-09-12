export class JsonSchemaDefinition<TSchema extends JsonSchemaDefinitionValue> {
  private constructor(private readonly value: TSchema) {}
  static boolean(): BooleanJsonSchema {
    const schema: BooleanJsonSchema = { type: JsonSchemaType.Boolean };
    return new JsonSchemaDefinition(schema).value;
  }

  static integer(args: IntegerJsonSchemaArgs): IntegerJsonSchema {
    const schema: IntegerJsonSchema = {
      type: JsonSchemaType.Integer,
      minimum: args.minimum,
    };
    return new JsonSchemaDefinition(schema).value;
  }

  static string(): PlainStringJsonSchema {
    const schema: PlainStringJsonSchema = { type: JsonSchemaType.String };
    return new JsonSchemaDefinition(schema).value;
  }

  static pattern(args: PatternStringJsonSchemaArgs): PatternStringJsonSchema {
    const schema: PatternStringJsonSchema = {
      type: JsonSchemaType.String,
      pattern: args.pattern,
    };
    return new JsonSchemaDefinition(schema).value;
  }

  static object(args: ObjectJsonSchemaArgs): ObjectJsonSchema {
    const schema: ObjectJsonSchema = {
      type: JsonSchemaType.Object,
      additionalProperties: false,
      required: args.required,
      properties: args.properties,
    };
    return new JsonSchemaDefinition(schema).value;
  }
}
/**
 * Typed JSON Schema fragments for Loom toolsList discovery.
 *
 * These are Loom domain types, not untyped object bags and not UntrustedYamlNode.
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
  BooleanJsonSchema | IntegerJsonSchema | StringJsonSchema;

export type ObjectJsonSchema = {
  readonly type: JsonSchemaType.Object;
  readonly additionalProperties: false;
  readonly required: readonly string[];
  readonly properties: {
    readonly [field: string]: JsonSchemaProperty;
  };
};

export type IntegerJsonSchemaArgs = {
  readonly minimum: number;
};

export type PatternStringJsonSchemaArgs = {
  readonly pattern: string;
};

export type ObjectJsonSchemaArgs = {
  readonly required: readonly string[];
  readonly properties: {
    readonly [field: string]: JsonSchemaProperty;
  };
};

type JsonSchemaDefinitionValue = JsonSchemaProperty | ObjectJsonSchema;
