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
    const sourceCode = context.sourceCode;

    function spreadObjectExpressions(args) {
      const { activeCall, expression, seenVariables } = args;
      let current = expression;
      while (transparentTypeScriptWrappers.has(current.type)) {
        current = current.expression;
      }
      if (current.type === 'Identifier') {
        let scope = sourceCode.getScope(current);
        while (scope) {
          const variable = scope.set.get(current.name);
          if (variable) {
            if (seenVariables.has(variable)) return [];
            const definition = variable.defs.find(
              (candidate) =>
                candidate.type === 'Variable' &&
                candidate.node.type === 'VariableDeclarator' &&
                candidate.node.init,
            );
            if (!definition || definition.name.typeAnnotation) return [];
            const nextSeen = new Set(seenVariables);
            nextSeen.add(variable);
            const values = [definition.node.init];
            for (const reference of variable.references) {
              if (
                reference.isWrite() &&
                !reference.init &&
                reference.writeExpr &&
                reference.identifier.range[0] < activeCall.range[0]
              ) {
                values.push(reference.writeExpr);
              }
            }
            return values.flatMap((value) =>
              spreadObjectExpressions({
                activeCall,
                expression: value,
                seenVariables: nextSeen,
              }),
            );
          }
          scope = scope.upper;
        }
        return [];
      }
      if (current.type === 'AssignmentExpression') {
        return spreadObjectExpressions({
          activeCall,
          expression: current.right,
          seenVariables,
        });
      }
      if (current.type === 'ConditionalExpression') {
        return [current.consequent, current.alternate].flatMap((branch) =>
          spreadObjectExpressions({
            activeCall,
            expression: branch,
            seenVariables,
          }),
        );
      }
      if (current.type === 'LogicalExpression') {
        return [current.left, current.right].flatMap((branch) =>
          spreadObjectExpressions({
            activeCall,
            expression: branch,
            seenVariables,
          }),
        );
      }
      if (current.type === 'SequenceExpression') {
        return spreadObjectExpressions({
          activeCall,
          expression: current.expressions.at(-1),
          seenVariables,
        });
      }
      if (current.type !== 'ArrayExpression') return [];
      return current.elements.flatMap((element) => {
        if (!element) return [];
        return element.type === 'SpreadElement'
          ? spreadObjectExpressions({
              activeCall,
              expression: element.argument,
              seenVariables,
            })
          : rawObjectExpressions(element);
      });
    }

    function inspectArguments(node) {
      for (const argument of node.arguments) {
        if (argument.type === 'SpreadElement') {
          const spreadArgs = {
            activeCall: node,
            expression: argument.argument,
            seenVariables: new Set(),
          };
          for (const objectExpression of spreadObjectExpressions(spreadArgs)) {
            context.report({
              node: objectExpression,
              messageId: 'namedArgument',
            });
          }
          continue;
        }
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
            ExternalValue: {
              message: 'Loom forbids generic external values. Model a concrete domain value.',
            },
            ExternalObject: {
              message: 'Loom forbids generic external objects. Model a concrete domain object.',
            },
            JsonValue: {
              message: 'Loom forbids generic JSON values. Model a concrete domain value.',
            },
            GenericValue: {
              message: 'Loom forbids generic value bags. Model a concrete domain value.',
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
