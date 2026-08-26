export enum SkillRequestFamily {
  ToolsList = 'skillToolsList',
  CortexArticleStructure = 'cortexArticleStructure',
}

export enum SkillToolsOperation {
  List = 'list',
}

export enum CortexArticleStructureOperation {
  Audit = 'audit',
}

export enum SkillCommandPhase {
  Decode = 'decode',
  Execute = 'execute',
  Usage = 'usage',
}

export enum SkillCommandIssue {
  InvalidRequest = 'invalid-request',
  InvalidYaml = 'invalid-yaml',
  RequestFileReadFailed = 'request-file-read-failed',
  UsageError = 'usage-error',
}

export enum SkillSchemaType {
  Array = 'array',
  Boolean = 'boolean',
  Integer = 'integer',
  Object = 'object',
  String = 'string',
}

export type SkillStringSchema = {
  readonly type: SkillSchemaType.String;
  readonly enum?: readonly string[];
  readonly maxLength?: number;
  readonly pattern?: string;
};

export type SkillIntegerSchema = {
  readonly type: SkillSchemaType.Integer;
  readonly minimum: number;
  readonly maximum?: number;
};

export type SkillBooleanSchema = {
  readonly type: SkillSchemaType.Boolean;
};

export type SkillFalseSchema = {
  readonly const: false;
};

export type SkillArraySchema = {
  readonly type: SkillSchemaType.Array;
  readonly items: SkillInputSchema;
  readonly maxItems?: number;
};

export type SkillObjectSchema = {
  readonly type: SkillSchemaType.Object;
  readonly additionalProperties: false;
  readonly required: readonly string[];
  readonly properties: {
    readonly [field: string]: SkillInputSchema;
  };
};

export type SkillUnionSchema = {
  readonly oneOf: readonly SkillInputSchema[];
};

export type SkillInputSchema =
  | SkillArraySchema
  | SkillBooleanSchema
  | SkillFalseSchema
  | SkillIntegerSchema
  | SkillObjectSchema
  | SkillStringSchema
  | SkillUnionSchema;

export type DiscoverableSkillAction = {
  readonly skillId: string;
  readonly family: SkillRequestFamily;
  readonly operation: CortexArticleStructureOperation | SkillToolsOperation;
  readonly description: string;
  readonly exampleRequest: string;
  readonly exampleYaml: string;
  readonly inputSchema: SkillObjectSchema;
};

export type SkillToolsListResult = {
  readonly actions: readonly DiscoverableSkillAction[];
};

export type SkillCommandFieldError = {
  readonly path: string;
  readonly issue: SkillCommandIssue;
  readonly message: string;
};

export type SkillCommandExplanation = {
  readonly blueprintYaml: string;
  readonly receivedYaml: string;
  readonly parseMessage?: string;
};

export type SkillCommandErrorResponse = {
  readonly ok: false;
  readonly isError: true;
  readonly phase: SkillCommandPhase;
  readonly errors: readonly SkillCommandFieldError[];
  readonly explanation: SkillCommandExplanation;
  readonly recover: {
    readonly toolsListRequest: string;
    readonly hint: string;
  };
};
