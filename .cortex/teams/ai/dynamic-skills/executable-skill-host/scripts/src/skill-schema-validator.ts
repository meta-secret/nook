import {
  SkillSchemaType,
  type SkillArraySchema,
  type SkillInputSchema,
  type SkillIntegerSchema,
  type SkillObjectSchema,
  type SkillStringSchema,
} from './skill-command-domain.ts';
import {
  isSkillYamlMap,
  skillYamlProperty,
  type SkillYamlPropertyRequest,
  type UntrustedSkillYamlNode,
} from './skill-yaml-codec.ts';
import {
  skillCommandPath,
  unknownSkillCommandPath,
  type SkillCommandPathRequest,
} from './skill-command-path.ts';
export type SkillSchemaValidationRequest = {
  readonly path: string;
  readonly schema: SkillInputSchema;
  readonly value: UntrustedSkillYamlNode;
};
export type SkillSchemaValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly path: string; readonly message: string };
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
export function validateSkillInput(
  request: SkillSchemaValidationRequest,
): SkillSchemaValidation {
  if ('oneOf' in request.schema) {
    let selected: SkillSchemaValidation | false = false;
    let ambiguous = false;
    for (const schema of request.schema.oneOf) {
      const variantRequest: SkillSchemaValidationRequest = {
        path: request.path,
        schema,
        value: request.value,
      };
      const result = validateSkillInput(variantRequest);
      if (result.ok) return result;
      const discriminatorRequest: SkillDiscriminatorRequest = {
        schema,
        value: request.value,
      };
      if (!matchesVariant(discriminatorRequest)) continue;
      if (selected !== false) ambiguous = true;
      selected = result;
    }
    if (selected !== false && !ambiguous) return selected;
    return invalidAt(request.path)('Value does not match an allowed variant.');
  }
  if ('const' in request.schema) {
    return request.value === request.schema.const
      ? { ok: true }
      : invalidAt(request.path)('Expected false.');
  }
  if (request.schema.type === SkillSchemaType.Object) {
    const objectRequest: SkillObjectValidationRequest = {
      path: request.path,
      schema: request.schema,
      value: request.value,
    };
    return validateObject(objectRequest);
  }
  if (request.schema.type === SkillSchemaType.Array) {
    const arrayRequest: SkillArrayValidationRequest = {
      path: request.path,
      schema: request.schema,
      value: request.value,
    };
    return validateArray(arrayRequest);
  }
  if (request.schema.type === SkillSchemaType.String) {
    const stringRequest: SkillStringValidationRequest = {
      path: request.path,
      schema: request.schema,
      value: request.value,
    };
    return validateString(stringRequest);
  }
  if (request.schema.type === SkillSchemaType.Integer) {
    const integerRequest: SkillIntegerValidationRequest = {
      path: request.path,
      schema: request.schema,
      value: request.value,
    };
    return validateInteger(integerRequest);
  }
  return typeof request.value === 'boolean'
    ? { ok: true }
    : invalidAt(request.path)('Expected a boolean.');
}
function matchesVariant(request: SkillDiscriminatorRequest): boolean {
  if ('const' in request.schema) return request.value === request.schema.const;
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
  if (
    !isSkillYamlMap(request.value) ||
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
    map: request.value,
  };
  const property = skillYamlProperty(propertyRequest);
  return (
    property.found &&
    typeof property.value === 'string' &&
    Boolean(kindSchema.enum?.includes(property.value))
  );
}
function validateObject(
  request: SkillObjectValidationRequest,
): SkillSchemaValidation {
  if (!isSkillYamlMap(request.value)) {
    return invalidAt(request.path)('Expected an object.');
  }
  const allowed = new Set(Object.keys(request.schema.properties));
  const unexpected = Object.keys(request.value).find(
    (key) => !allowed.has(key),
  );
  if (typeof unexpected === 'string') {
    return invalidAt(unknownSkillCommandPath(request.path))('Unknown field.');
  }
  for (const field of request.schema.required) {
    if (!Object.hasOwn(request.value, field)) {
      return invalidAt(childPath(request.path)(field))(
        'Required field is missing.',
      );
    }
  }
  for (const [field, schema] of Object.entries(request.schema.properties)) {
    const propertyRequest: SkillYamlPropertyRequest = {
      key: field,
      map: request.value,
    };
    const property = skillYamlProperty(propertyRequest);
    if (!property.found) continue;
    const fieldRequest: SkillSchemaValidationRequest = {
      path: childPath(request.path)(field),
      schema,
      value: property.value,
    };
    const result = validateSkillInput(fieldRequest);
    if (!result.ok) return result;
  }
  return { ok: true };
}
function validateArray(
  request: SkillArrayValidationRequest,
): SkillSchemaValidation {
  if (!Array.isArray(request.value)) {
    return invalidAt(request.path)('Expected an array.');
  }
  if (
    typeof request.schema.maxItems === 'number' &&
    request.value.length > request.schema.maxItems
  ) {
    return invalidAt(`${request.path}[${request.schema.maxItems}]`)(
      `Expected at most ${request.schema.maxItems} items.`,
    );
  }
  for (const [index, value] of request.value.entries()) {
    const itemRequest: SkillSchemaValidationRequest = {
      path: `${request.path}[${index}]`,
      schema: request.schema.items,
      value,
    };
    const result = validateSkillInput(itemRequest);
    if (!result.ok) return result;
  }
  return { ok: true };
}

function validateString(
  request: SkillStringValidationRequest,
): SkillSchemaValidation {
  if (typeof request.value !== 'string') {
    return invalidAt(request.path)('Expected a string.');
  }
  if (
    typeof request.schema.maxLength === 'number' &&
    request.value.length > request.schema.maxLength
  ) {
    return invalidAt(request.path)(
      `Expected at most ${request.schema.maxLength} characters.`,
    );
  }
  const maximumLineLength = request.schema.maxTrimmedLineLength;
  if (
    typeof maximumLineLength === 'number' &&
    request.value
      .split(/\r?\n/u)
      .some((line) => line.trim().length > maximumLineLength)
  ) {
    return invalidAt(request.path)(
      'A trimmed line exceeds the allowed length.',
    );
  }
  if (request.schema.enum && !request.schema.enum.includes(request.value)) {
    return invalidAt(request.path)('Value is not in the allowed enum.');
  }
  if (
    request.schema.pattern &&
    !new RegExp(request.schema.pattern, 'u').test(request.value)
  ) {
    return invalidAt(request.path)(
      'Value does not match the required pattern.',
    );
  }
  return { ok: true };
}

function validateInteger(
  request: SkillIntegerValidationRequest,
): SkillSchemaValidation {
  if (typeof request.value !== 'number' || !Number.isInteger(request.value)) {
    return invalidAt(request.path)('Expected an integer.');
  }
  if (request.value < request.schema.minimum) {
    return invalidAt(request.path)(
      `Expected at least ${request.schema.minimum}.`,
    );
  }
  if (
    typeof request.schema.maximum === 'number' &&
    request.value > request.schema.maximum
  ) {
    return invalidAt(request.path)(
      `Expected at most ${request.schema.maximum}.`,
    );
  }
  return { ok: true };
}

function childPath(parent: string): (child: string) => string {
  return (child: string) => {
    const request: SkillCommandPathRequest = { field: child, parent };
    return skillCommandPath(request);
  };
}

function invalidAt(path: string): (message: string) => SkillSchemaValidation {
  return (message: string) => ({ ok: false, path, message });
}
