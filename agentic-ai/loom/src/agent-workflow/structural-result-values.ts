import { z } from 'zod';

const missingFields = 'structural result contains missing or extra fields';
export const structuralError = (message: string) => ({
  error: (issue: { readonly code: string }) =>
    issue.code === 'invalid_type' ? missingFields : message,
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
      (value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value),
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

export function parseStructural<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new Error(
    `Invalid workflow structured result: ${result.error.issues.length > 0 ? result.error.issues[0]!.message : missingFields}.`,
  );
}
