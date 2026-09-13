import { z } from 'zod';
import type { UntrustedYamlNode } from '../lib/guards.ts';

const missingFields = 'structural result contains missing or extra fields';
export const structuralError = (message: string) => ({
  error: (issue: { readonly code: string }) =>
    issue.code === 'invalid_type' && Reflect.get(issue, 'input') === void 0
      ? missingFields
      : message,
});
export const structuralObjectError = { error: missingFields };

export const structuralText = (maximum = 4096) =>
  z
    .string(structuralError('structural result string is invalid'))
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
export const STRUCTURAL_ID = structuralText(128).regex(
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u,
  'structural result identifier is invalid',
);
export const STRUCTURAL_INTEGER = z
  .int(structuralError('structural result integer is invalid'))
  .positive('structural result integer is invalid');
export const STRUCTURAL_PATH = structuralText(512).refine(
  (value) =>
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !value
      .split('/')
      .some((segment) => segment === '' || segment === '.' || segment === '..'),
  'structural path is invalid',
);
export const structuralStrings = (minimum = 1) =>
  z
    .array(
      structuralText(),
      structuralError('structural result array is invalid'),
    )
    .min(minimum, 'structural result array is invalid')
    .max(100, 'structural result array is invalid')
    .refine(
      (values) => new Set(values).size === values.length,
      'structural result strings must be unique',
    );
export const structuralPaths = (minimum = 1) =>
  z
    .array(
      STRUCTURAL_PATH,
      structuralError('structural result array is invalid'),
    )
    .min(minimum, 'structural result array is invalid')
    .max(64, 'structural paths are invalid')
    .refine(
      (values) => new Set(values).size === values.length,
      'structural paths are invalid',
    );

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
