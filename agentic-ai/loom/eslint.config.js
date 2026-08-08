import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Loom-only static rules:
 * - max one function/method parameter
 * - ban authored `unknown` (use ExternalValue / ExternalObject)
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
                'Loom forbids unknown. Use ExternalValue / ExternalObject for untrusted data.',
            },
          },
        },
      ],
      'no-unused-vars': 'off',
      'no-undef': 'off',
    },
  },
);
