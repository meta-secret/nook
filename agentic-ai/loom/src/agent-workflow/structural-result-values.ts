import { z } from 'zod';
import type { UntrustedYamlNode } from '../lib/guards.ts';

const missingFields = 'structural result contains missing or extra fields';
export class StructuralResultErrorPolicy {
  private constructor() {}

  static forMessage(message: string) {
    return {
      error: (issue: { readonly code: string }) =>
        issue.code === 'invalid_type' && Reflect.get(issue, 'input') === void 0
          ? missingFields
          : message,
    };
  }
}

export class StructuralResultSchema {
  private constructor() {}

  static readonly objectError = { error: missingFields };

  static text(maximum = 4096) {
    return z
      .string(
        StructuralResultErrorPolicy.forMessage(
          'structural result string is invalid',
        ),
      )
      .min(1, 'structural result string is invalid')
      .max(maximum, 'structural result string is invalid')
      .refine(
        (value) => value.trim() !== '',
        'structural result string is invalid',
      )
      .refine(
        (value) =>
          !Array.from(value).some((character) => {
            const code = character.charCodeAt(0);
            return (
              code <= 8 ||
              code === 11 ||
              code === 12 ||
              code === 127 ||
              (code >= 14 && code <= 31)
            );
          }),
        'structural result string is invalid',
      )
      .meta({ pattern: '\\S' });
  }

  static readonly id = StructuralResultSchema.text(128).regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u,
    'structural result identifier is invalid',
  );

  static readonly integer = z
    .int(
      StructuralResultErrorPolicy.forMessage(
        'structural result integer is invalid',
      ),
    )
    .positive('structural result integer is invalid');

  static readonly path = StructuralResultSchema.text(512).refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !value
        .split('/')
        .some(
          (segment) => segment === '' || segment === '.' || segment === '..',
        ),
    'structural path is invalid',
  );

  static strings(minimum = 1) {
    return z
      .array(
        StructuralResultSchema.text(),
        StructuralResultErrorPolicy.forMessage(
          'structural result array is invalid',
        ),
      )
      .min(minimum, 'structural result array is invalid')
      .max(100, 'structural result array is invalid')
      .refine(
        (values) => new Set(values).size === values.length,
        'structural result strings must be unique',
      );
  }

  static paths(minimum = 1) {
    return z
      .array(
        StructuralResultSchema.path,
        StructuralResultErrorPolicy.forMessage(
          'structural result array is invalid',
        ),
      )
      .min(minimum, 'structural result array is invalid')
      .max(64, 'structural paths are invalid')
      .refine(
        (values) => new Set(values).size === values.length,
        'structural paths are invalid',
      );
  }
}

// Preserve the existing structural-result imports while keeping each factory owned by its schema policy.
export const structuralError = StructuralResultErrorPolicy.forMessage;
export const structuralObjectError = StructuralResultSchema.objectError;
export const structuralText = StructuralResultSchema.text;
export const STRUCTURAL_ID = StructuralResultSchema.id;
export const STRUCTURAL_INTEGER = StructuralResultSchema.integer;
export const STRUCTURAL_PATH = StructuralResultSchema.path;
export const structuralStrings = StructuralResultSchema.strings;
export const structuralPaths = StructuralResultSchema.paths;

type ParseStructuralRequest<T> = {
  readonly schema: z.ZodType<T>;
  readonly input: UntrustedYamlNode;
};

export class StructuralResultCodec {
  private constructor() {}
  static decode<T>(request: ParseStructuralRequest<T>): T {
    const result = request.schema.safeParse(request.input);
    if (result.success) return result.data;
    for (const issue of result.error.issues)
      throw new Error(`Invalid workflow structured result: ${issue.message}.`);
    throw new Error(`Invalid workflow structured result: ${missingFields}.`);
  }
}
