import tseslint from 'typescript-eslint';

const domainTypes = {
  ExternalValue: {
    message: 'Executable skills require concrete domain values.',
  },
  ExternalObject: {
    message: 'Executable skills require concrete domain values.',
  },
  JsonValue: {
    message: 'Executable skills require concrete domain values.',
  },
  GenericValue: {
    message: 'Executable skills require concrete domain values.',
  },
  unknown: {
    message: 'Executable skills require concrete domain values.',
  },
  object: {
    message: 'Executable skills require concrete domain values.',
  },
  Object: {
    message: 'Executable skills require concrete domain values.',
  },
  '{}': {
    message: 'Executable skills require concrete domain values.',
  },
};
const { unknown: untrustedInputType, ...ingressTypes } = domainTypes;
void untrustedInputType;

export default tseslint.config(
  {
    ignores: ['node_modules/**'],
    files: ['**/*.{ts,js,mjs,cjs}'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'max-params': ['error', { max: 1 }],
      '@typescript-eslint/no-restricted-types': [
        'error',
        {
          types: domainTypes,
        },
      ],
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-type-assertion': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-empty-object-type': 'error',
      'no-unused-vars': 'off',
      'no-undef': 'off',
    },
  },
  {
    // Only ingress codecs may hold unknown values before validation.
    files: ['src/codec.ts', 'src/result-codec.ts', 'src/skill-yaml-codec.ts'],
    rules: {
      '@typescript-eslint/no-restricted-types': [
        'error',
        { types: ingressTypes },
      ],
    },
  },
);
