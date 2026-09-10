import { err, ok, type Result } from 'neverthrow';
import { UnknownSkillCommandPath } from './skill-command-path.ts';
import { ExecutableSkillYamlProperty } from './skill-yaml-codec.ts';
import { SkillYamlValue } from './skill-yaml-codec.ts';
import {
  SkillSchemaType,
  type SkillArraySchema,
  type SkillInputSchema,
  type SkillIntegerSchema,
  type SkillObjectSchema,
  type SkillStringSchema,
} from './skill-command-domain.ts';

import {
  type SkillYamlPropertyRequest,
  type UntrustedSkillYamlNode,
  ExecutableSkillYaml,
} from './skill-yaml-codec.ts';

import {
  type SkillCommandPathRequest,
  ExecutableSkillCommandPath,
} from './skill-command-path.ts';

export class ExecutableSkillInputSchema {
  private constructor(private readonly request: SkillSchemaValidationRequest) {}

  static from(
    request: SkillSchemaValidationRequest,
  ): ExecutableSkillInputSchema {
    return new ExecutableSkillInputSchema(request);
  }

  public execute(): SkillSchemaValidation {
    const request = this.request;
    if ('oneOf' in request.schema) {
      let selected: SkillSchemaValidation | false = false;
      let ambiguous = false;
      let matches = 0;
      for (const schema of request.schema.oneOf) {
        const variantRequest: SkillSchemaValidationRequest = {
          path: request.path,
          schema,
          value: request.value,
        };
        const result =
          ExecutableSkillInputSchema.from(variantRequest).execute();
        if (result.isOk()) {
          matches += 1;
          continue;
        }
        const discriminatorRequest: SkillDiscriminatorRequest = {
          schema,
          value: request.value,
        };
        if (!this.matchesVariant(discriminatorRequest)) continue;
        if (selected !== false) ambiguous = true;
        selected = result;
      }
      if (matches === 1) return ok();
      if (matches > 1)
        return this.invalidAt(request.path)('Value matches multiple variants.');
      if (selected !== false && !ambiguous) return selected;
      return this.invalidAt(request.path)(
        'Value does not match an allowed variant.',
      );
    }
    if ('const' in request.schema) {
      return request.value === request.schema.const
        ? ok()
        : this.invalidAt(request.path)('Expected false.');
    }
    if (request.schema.type === SkillSchemaType.Object) {
      const objectRequest: SkillObjectValidationRequest = {
        path: request.path,
        schema: request.schema,
        value: request.value,
      };
      return this.validateObject(objectRequest);
    }
    if (request.schema.type === SkillSchemaType.Array) {
      const arrayRequest: SkillArrayValidationRequest = {
        path: request.path,
        schema: request.schema,
        value: request.value,
      };
      return this.validateArray(arrayRequest);
    }
    if (request.schema.type === SkillSchemaType.String) {
      const stringRequest: SkillStringValidationRequest = {
        path: request.path,
        schema: request.schema,
        value: request.value,
      };
      return this.validateString(stringRequest);
    }
    if (request.schema.type === SkillSchemaType.Integer) {
      const integerRequest: SkillIntegerValidationRequest = {
        path: request.path,
        schema: request.schema,
        value: request.value,
      };
      return this.validateInteger(integerRequest);
    }
    return typeof request.value === 'boolean'
      ? ok()
      : this.invalidAt(request.path)('Expected a boolean.');
  }

  private matchesVariant(request: SkillDiscriminatorRequest): boolean {
    if ('const' in request.schema)
      return request.value === request.schema.const;
    if ('type' in request.schema) {
      if (request.schema.type === SkillSchemaType.Array) {
        return Array.isArray(request.value);
      }
      if (request.schema.type === SkillSchemaType.String) {
        return typeof request.value === 'string';
      }
      if (request.schema.type === SkillSchemaType.Integer) {
        return typeof request.value === 'number';
      }
      if (request.schema.type === SkillSchemaType.Boolean) {
        return typeof request.value === 'boolean';
      }
    }
    const candidate = new SkillYamlValue(request.value);
    if (
      !candidate.isMap() ||
      !('type' in request.schema) ||
      request.schema.type !== SkillSchemaType.Object
    ) {
      return false;
    }
    const kindSchema = request.schema.properties.kind;
    if (
      !kindSchema ||
      !('type' in kindSchema) ||
      kindSchema.type !== SkillSchemaType.String
    ) {
      return false;
    }
    const propertyRequest: SkillYamlPropertyRequest = {
      key: 'kind',
      map: candidate.value,
    };
    const property = new ExecutableSkillYamlProperty(propertyRequest).execute();
    return (
      property.found &&
      typeof property.value === 'string' &&
      Boolean(kindSchema.enum?.includes(property.value))
    );
  }

  private validateObject(
    request: SkillObjectValidationRequest,
  ): SkillSchemaValidation {
    const candidate = new SkillYamlValue(request.value);
    if (!candidate.isMap()) {
      return this.invalidAt(request.path)('Expected an object.');
    }
    const allowed = new Set(Object.keys(request.schema.properties));
    const unexpected = Object.keys(candidate.value).find(
      (key) => !allowed.has(key),
    );
    if (typeof unexpected === 'string') {
      return this.invalidAt(
        new UnknownSkillCommandPath(request.path).execute(),
      )('Unknown field.');
    }
    for (const field of request.schema.required) {
      if (!Object.hasOwn(candidate.value, field)) {
        return this.invalidAt(this.childPath(request.path)(field))(
          'Required field is missing.',
        );
      }
    }
    for (const [field, schema] of Object.entries(request.schema.properties)) {
      const propertyRequest: SkillYamlPropertyRequest = {
        key: field,
        map: candidate.value,
      };
      const property = new ExecutableSkillYamlProperty(
        propertyRequest,
      ).execute();
      if (!property.found) continue;
      const fieldRequest: SkillSchemaValidationRequest = {
        path: this.childPath(request.path)(field),
        schema,
        value: property.value,
      };
      const result = ExecutableSkillInputSchema.from(fieldRequest).execute();
      if (!result.isOk()) return result;
    }
    return ok();
  }

  private validateArray(
    request: SkillArrayValidationRequest,
  ): SkillSchemaValidation {
    if (!Array.isArray(request.value)) {
      return this.invalidAt(request.path)('Expected an array.');
    }
    if (
      typeof request.schema.maxItems === 'number' &&
      request.value.length > request.schema.maxItems
    ) {
      return this.invalidAt(`${request.path}[${request.schema.maxItems}]`)(
        `Expected at most ${request.schema.maxItems} items.`,
      );
    }
    for (const [index, value] of request.value.entries()) {
      const itemRequest: SkillSchemaValidationRequest = {
        path: `${request.path}[${index}]`,
        schema: request.schema.items,
        value,
      };
      const result = ExecutableSkillInputSchema.from(itemRequest).execute();
      if (!result.isOk()) return result;
    }
    return ok();
  }

  private validateString(
    request: SkillStringValidationRequest,
  ): SkillSchemaValidation {
    if (typeof request.value !== 'string') {
      return this.invalidAt(request.path)('Expected a string.');
    }
    if (
      typeof request.schema.maxUtf16CodeUnits === 'number' &&
      request.value.length > request.schema.maxUtf16CodeUnits
    ) {
      return this.invalidAt(request.path)(
        `Expected at most ${request.schema.maxUtf16CodeUnits} UTF-16 code units.`,
      );
    }
    const maximumLineLength = request.schema.maxTrimmedLineUtf16CodeUnits;
    const lines = request.value.split(/\r\n|\n|\r/u);
    if (
      typeof request.schema.maxTrimmedLines === 'number' &&
      lines.length > request.schema.maxTrimmedLines
    ) {
      return this.invalidAt(request.path)('Value contains too many lines.');
    }
    if (
      typeof maximumLineLength === 'number' &&
      lines.some((line) => line.trim().length > maximumLineLength)
    ) {
      return this.invalidAt(request.path)(
        'A trimmed line exceeds the allowed length.',
      );
    }
    if (request.schema.enum && !request.schema.enum.includes(request.value)) {
      return this.invalidAt(request.path)('Value is not in the allowed enum.');
    }
    if (
      request.schema.pattern &&
      !new RegExp(request.schema.pattern, 'u').test(request.value)
    ) {
      return this.invalidAt(request.path)(
        'Value does not match the required pattern.',
      );
    }
    return ok();
  }

  private validateInteger(
    request: SkillIntegerValidationRequest,
  ): SkillSchemaValidation {
    if (
      typeof request.value !== 'number' ||
      !Number.isSafeInteger(request.value)
    ) {
      return this.invalidAt(request.path)('Expected a safe integer.');
    }
    if (request.value < request.schema.minimum) {
      return this.invalidAt(request.path)(
        `Expected at least ${request.schema.minimum}.`,
      );
    }
    if (
      typeof request.schema.maximum === 'number' &&
      request.value > request.schema.maximum
    ) {
      return this.invalidAt(request.path)(
        `Expected at most ${request.schema.maximum}.`,
      );
    }
    return ok();
  }

  private childPath(parent: string): (child: string) => string {
    return (child: string) => {
      const request: SkillCommandPathRequest = { field: child, parent };
      return ExecutableSkillCommandPath.from(request).execute();
    };
  }

  private invalidAt(path: string): (message: string) => SkillSchemaValidation {
    return (message: string) => err({ path, message });
  }
}

export type SkillSchemaValidationRequest = {
  readonly path: string;
  readonly schema: SkillInputSchema;
  readonly value: UntrustedSkillYamlNode;
};

export type SkillSchemaFailure = {
  readonly path: string;
  readonly message: string;
};
export type SkillSchemaValidation = Result<void, SkillSchemaFailure>;

type SkillObjectValidationRequest = {
  readonly path: string;
  readonly schema: SkillObjectSchema;
  readonly value: UntrustedSkillYamlNode;
};

type SkillArrayValidationRequest = {
  readonly path: string;
  readonly schema: SkillArraySchema;
  readonly value: UntrustedSkillYamlNode;
};

type SkillStringValidationRequest = {
  readonly path: string;
  readonly schema: SkillStringSchema;
  readonly value: UntrustedSkillYamlNode;
};

type SkillIntegerValidationRequest = {
  readonly path: string;
  readonly schema: SkillIntegerSchema;
  readonly value: UntrustedSkillYamlNode;
};

type SkillDiscriminatorRequest = {
  readonly schema: SkillInputSchema;
  readonly value: UntrustedSkillYamlNode;
};
