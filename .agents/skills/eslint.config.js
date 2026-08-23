import tseslint from 'typescript-eslint';
import { noRawObjectArguments } from '../../tooling/eslint-rules/no-raw-object-arguments.js';

export default tseslint.config({
  ignores: ['node_modules/**'],
  files: ['*/src/**/*.ts', '*/tests/**/*.ts'],
  plugins: {
    '@typescript-eslint': tseslint.plugin,
    nook: {
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
        },
      },
    ],
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-empty-object-type': 'error',
    'nook/no-raw-object-arguments': 'error',
    'no-unused-vars': 'off',
    'no-undef': 'off',
  },
});
