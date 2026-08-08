import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const transparentTypeScriptWrappers = new Set([
  'ChainExpression',
  'TSAsExpression',
  'TSTypeAssertion',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
]);

function rawObjectExpressions(expression) {
  let current = expression;
  while (transparentTypeScriptWrappers.has(current.type)) {
    current = current.expression;
  }
  if (current.type === 'ObjectExpression') return [current];
  if (current.type === 'AssignmentExpression') {
    return rawObjectExpressions(current.right);
  }
  if (current.type === 'ConditionalExpression') {
    return [
      ...rawObjectExpressions(current.consequent),
      ...rawObjectExpressions(current.alternate),
    ];
  }
  if (current.type === 'LogicalExpression') {
    return [
      ...rawObjectExpressions(current.left),
      ...rawObjectExpressions(current.right),
    ];
  }
  if (current.type === 'SequenceExpression') {
    return rawObjectExpressions(current.expressions.at(-1));
  }
  return [];
}

const noRawObjectArguments = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      namedArgument:
        'Loom forbids raw object-literal call and constructor arguments. Assign a named typed value first, then pass that name.',
    },
  },
  create(context) {
    function inspectArguments(node) {
      for (const argument of node.arguments) {
        if (argument.type === 'SpreadElement') continue;
        for (const objectExpression of rawObjectExpressions(argument)) {
          context.report({
            node: objectExpression,
            messageId: 'namedArgument',
          });
        }
      }
    }
    return {
      CallExpression: inspectArguments,
      NewExpression: inspectArguments,
    };
  },
};

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
          },
        },
      ],
      'loom/no-raw-object-arguments': 'error',
      'no-unused-vars': 'off',
      'no-undef': 'off',
    },
  },
);
