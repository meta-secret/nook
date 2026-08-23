import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { noRawObjectArguments } from '../../tooling/eslint-rules/no-raw-object-arguments.js';

/**
 * Loom-only static rules:
 * - max one function/method parameter
 * - ban authored `unknown` and `object`; require concrete domain values
 * - ban raw object-literal call arguments (name a typed value first)
 */
export default tseslint.config(
  {
    ignores: ['node_modules/**', 'eslint.config.js'],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      loom: {
        rules: {
          'no-raw-object-arguments': noRawObjectArguments,
        },
      },
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
          types: {
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
              message:
                'Loom forbids generic JSON values. Model a concrete domain value.',
            },
            GenericValue: {
              message:
                'Loom forbids generic value bags. Model a concrete domain value.',
            },
          },
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-empty-object-type': 'error',
      'loom/no-raw-object-arguments': 'error',
      'no-unused-vars': 'off',
      'no-undef': 'off',
    },
  },
);
