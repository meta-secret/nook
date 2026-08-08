import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Loom-only: every authored function/method takes at most one parameter. */
export default tseslint.config(
  {
    ignores: ['node_modules/**', 'eslint.config.js'],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'max-params': ['error', { max: 1 }],
      'no-unused-vars': 'off',
      'no-undef': 'off',
    },
  },
);
