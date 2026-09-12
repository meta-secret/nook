import js from '@eslint/js'
import noUnsanitized from 'eslint-plugin-no-unsanitized'
import svelte from 'eslint-plugin-svelte'
import globals from 'globals'
import ts from 'typescript-eslint'
import { typedApiRules } from './typed-api-rules.js'
import {
  concreteObjectTypeRules,
  typedApiSourceFiles,
  untrustedInputAdapterFiles,
  untrustedInputAdapterRules,
} from './typed-api-rules.js'
import { noRawObjectArgumentsRule } from "./no-raw-object-arguments-rule.js"

export { noRawObjectArgumentsRule }

const nookTypedApiPlugin = {
  rules: {
    'no-raw-object-arguments': noRawObjectArgumentsRule,
  },
}

export default [
  {
    ignores: [
      '**/dist/**',
      '**/dist-prod/**',
      '**/node_modules/**',
      'nook-web-shared/src/vault-app/lib/nook-wasm*/**',
      'nook-web-shared/src/extension/nook-companion-wasm/**',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs['flat/recommended'],
  noUnsanitized.configs.recommended,
  {
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['nook-web-extension/src/**/*.{ts,svelte}', 'src/**/*.{ts,svelte}'],
    languageOptions: {
      globals: {
        ...globals.webextensions,
        chrome: 'readonly',
      },
    },
  },
  {
    files: [
      'eslint.config.js',
      '**/eslint.config.js',
      '**/svelte.config.js',
      '*.js',
      '**/scripts/**/*.{js,mjs,cjs}',
      '**/e2e/**/*.{js,mjs,cjs}',
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['**/*.{ts,js,mjs,cjs}'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-type-assertion': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: false },
      ],
    },
    languageOptions: {
      parser: ts.parser,
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.svelte'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-type-assertion': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: false },
      ],
    },
    languageOptions: {
      parserOptions: {
        parser: ts.parser,
        project: './tsconfig.eslint.json',
        extraFileExtensions: ['.svelte'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.{ts,svelte}'],
    rules: concreteObjectTypeRules,
  },
  {
    files: typedApiSourceFiles,
    plugins: {
      'nook-typed-api': nookTypedApiPlugin,
    },
    rules: typedApiRules,
  },
  {
    files: untrustedInputAdapterFiles,
    rules: untrustedInputAdapterRules,
  },
  {
    files: ['**/tests/**', '**/e2e/**'],
    rules: {
      'no-unsanitized/property': 'off',
    },
  },
]
