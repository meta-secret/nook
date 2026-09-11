import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const domainTypes = {
  unknown: {
    message:
      'Loom forbids unknown. Model a concrete domain type. A generic transport value is allowed only inside a dedicated untrusted-input codec and must be narrowed immediately.',
  },
  object: {
    message:
      'Loom forbids the generic object type. Model a concrete domain value or discriminated union.',
  },
  Object: {
    message:
      'Loom forbids the Object type. Model a concrete domain value or discriminated union.',
  },
  '{}': {
    message:
      'Loom forbids the empty object type. Model every valid branch explicitly.',
  },
  ExternalValue: {
    message:
      'Loom forbids generic external values. Model a concrete domain value.',
  },
  ExternalObject: {
    message:
      'Loom forbids generic external objects. Model a concrete domain object.',
  },
  JsonValue: {
    message: 'Loom forbids generic JSON values. Model a concrete domain value.',
  },
  GenericValue: {
    message: 'Loom forbids generic value bags. Model a concrete domain value.',
  },
};
const { unknown: untrustedInputType, ...ingressTypes } = domainTypes;
void untrustedInputType;

/**
 * Loom-only static rules:
 * - max one function/method parameter
 * - restrict `unknown` to ingress codecs; require concrete domain values
 */
export default tseslint.config(
  {
    ignores: ['node_modules/**'],
  },
  js.configs.recommended,
  {
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
    files: [
      'src/lib/guards.ts',
      'src/codec/yaml.ts',
      'src/codec/external.ts',
      'src/agent-workflow/attempt-codec.ts',
      'src/agent-workflow/delegation-codec.ts',
      'src/agent-workflow/structural-result-codec.ts',
      'src/agent-workflow/structured-result-codec.ts',
      'src/agent-workflow/structural-evidence-codec.ts',
      'src/module-experts/read-context-rpc-codec.ts',
      'src/module-experts/request-codec.ts',
      'src/structural-experts/request-codec.ts',
      'src/module-delivery/codec.ts',
      'src/module-delivery/codec-fields.ts',
      'src/module-delivery/cortex-authoring-codec.ts',
    ],
    rules: {
      '@typescript-eslint/no-restricted-types': [
        'error',
        { types: ingressTypes },
      ],
    },
  },
);
