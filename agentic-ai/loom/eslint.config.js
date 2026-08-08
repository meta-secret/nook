import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Loom-only static rules:
 * - max one function/method parameter
 * - ban authored `unknown`; require domain values after boundary decoding
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
          },
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[arguments.length=1] > ObjectExpression",
          message:
            'Loom forbids raw object-literal call arguments. Assign a named typed value first, then pass that name.',
        },
        {
          selector:
            "CallExpression[arguments.length=1] > TSAsExpression > ObjectExpression",
          message:
            'Loom forbids raw object-literal call arguments (including `as` casts). Assign a named typed value first, then pass that name.',
        },
        {
          selector:
            "NewExpression[arguments.length=1] > ObjectExpression",
          message:
            'Loom forbids raw object-literal constructor arguments. Assign a named typed value first, then pass that name.',
        },
        {
          selector:
            "NewExpression[arguments.length=1] > TSAsExpression > ObjectExpression",
          message:
            'Loom forbids raw object-literal constructor arguments (including `as` casts). Assign a named typed value first, then pass that name.',
        },
      ],
      'no-unused-vars': 'off',
      'no-undef': 'off',
    },
  },
);
