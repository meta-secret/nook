export const typedApiRules = {
  'max-params': ['error', { max: 1 }],
  '@typescript-eslint/no-restricted-types': [
    'error',
    {
      types: {
        unknown: {
          message:
            'Nook web forbids unknown. Model a concrete domain type. A generic transport value is allowed only inside a dedicated untrusted-input adapter and must be narrowed immediately.',
        },
        ExternalValue: { message: 'Use a concrete Nook domain value.' },
        ExternalObject: { message: 'Use a concrete Nook domain object.' },
        JsonValue: { message: 'Use a concrete Nook domain value.' },
        GenericValue: { message: 'Use a concrete Nook domain value.' },
      },
    },
  ],
  'nook-typed-api/no-raw-object-arguments': 'error',
}
