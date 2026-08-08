import js from '@eslint/js'
import noUnsanitized from 'eslint-plugin-no-unsanitized'
import svelte from 'eslint-plugin-svelte'
import globals from 'globals'
import ts from 'typescript-eslint'

const transparentTypeScriptWrappers = new Set([
  'TSAsExpression',
  'TSTypeAssertion',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
])

function unwrapTypeScriptExpression(expression) {
  let current = expression
  while (transparentTypeScriptWrappers.has(current.type)) {
    current = current.expression
  }
  return current
}

const VariableLookupKind = Object.freeze({
  NotFound: 'not-found',
  Found: 'found',
})

export const noRawObjectArgumentsRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      namedArgument:
        'Nook web forbids raw object-literal call and constructor arguments, including nested TypeScript wrappers. Assign a named typed value first, then pass that name.',
      typedArgument:
        'Nook web requires object-literal arguments to use an explicitly typed named declaration.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode

    function declaredVariable(identifier) {
      let scope = sourceCode.getScope(identifier)
      while (scope) {
        const variable = scope.set.get(identifier.name)
        if (variable) {
          return { kind: VariableLookupKind.Found, variable }
        }
        scope = scope.upper
      }
      return { kind: VariableLookupKind.NotFound }
    }

    function inspectNamedObjectArgument(argument) {
      if (argument.type !== 'Identifier') return
      const lookup = declaredVariable(argument)
      if (lookup.kind === VariableLookupKind.NotFound) return
      const { variable } = lookup
      for (const definition of variable.defs) {
        if (
          definition.type !== 'Variable' ||
          definition.node.type !== 'VariableDeclarator' ||
          !definition.node.init ||
          unwrapTypeScriptExpression(definition.node.init).type !==
            'ObjectExpression'
        ) {
          continue
        }
        if (!definition.name.typeAnnotation) {
          context.report({ node: argument, messageId: 'typedArgument' })
        }
        return
      }
    }

    function inspectSpreadArgument(argument) {
      const expression = unwrapTypeScriptExpression(argument.argument)
      if (expression.type !== 'ArrayExpression') return
      for (const element of expression.elements) {
        if (
          element &&
          element.type !== 'SpreadElement' &&
          unwrapTypeScriptExpression(element).type === 'ObjectExpression'
        ) {
          context.report({ node: element, messageId: 'namedArgument' })
        }
      }
    }

    function inspectArguments(node) {
      for (const argument of node.arguments) {
        if (argument.type === 'SpreadElement') {
          inspectSpreadArgument(argument)
          continue
        }
        if (unwrapTypeScriptExpression(argument).type === 'ObjectExpression') {
          context.report({ node: argument, messageId: 'namedArgument' })
          continue
        }
        inspectNamedObjectArgument(argument)
      }
    }
    return {
      CallExpression: inspectArguments,
      NewExpression: inspectArguments,
    }
  },
}

const nookTypedApiPlugin = {
  rules: {
    'no-raw-object-arguments': noRawObjectArgumentsRule,
  },
}

const typedApiRules = {
  'max-params': ['error', { max: 1 }],
  '@typescript-eslint/no-restricted-types': [
    'error',
    {
      types: {
        unknown: {
          message:
            'Nook web forbids unknown. Use ExternalValue / ExternalObject for untrusted data or a concrete platform type.',
        },
      },
    },
  ],
  'nook-typed-api/no-raw-object-arguments': 'error',
}

export default [
  {
    ignores: [
      '**/dist/**',
      '**/dist-prod/**',
      '**/node_modules/**',
      'nook-web-shared/src/vault-app/lib/nook-wasm*/**',
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
    // The shared config is invoked from both nook-web and nook-web-extension.
    files: [
      'nook-web-extension/src/**/*.{ts,svelte}',
      'src/**/*.{ts,svelte}',
    ],
    languageOptions: {
      globals: {
        ...globals.webextensions,
        chrome: 'readonly',
      },
    },
  },
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    ...ts.configs.disableTypeChecked,
    languageOptions: {
      ...ts.configs.disableTypeChecked.languageOptions,
      globals: globals.browser,
    },
  },
  {
    files: [
      'eslint.config.js',
      '**/eslint.config.js',
      '**/svelte.config.js',
      '**/scripts/**/*.{js,mjs,cjs}',
      '**/e2e/**/*.{js,mjs,cjs}',
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['**/*.ts', '**/*.svelte.ts'],
    rules: {
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
    // Migrate the extension from reusable boundaries outward. Keep both path
    // forms because extension lint runs from its package directory while the
    // application lint runs from the nook-web directory.
    files: [
      'nook-web-extension/src/lib/**/*.ts',
      'src/lib/**/*.ts',
    ],
    plugins: {
      'nook-typed-api': nookTypedApiPlugin,
    },
    rules: typedApiRules,
  },
  {
    files: ['**/tests/**', '**/e2e/**'],
    rules: {
      'no-unsanitized/property': 'off',
    },
  },
]
