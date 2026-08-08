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

function unwrapResultExpression(expression) {
  let current = unwrapTypeScriptExpression(expression)
  while (current.type === 'AwaitExpression') {
    current = unwrapTypeScriptExpression(current.argument)
  }
  return current
}

const VariableLookupKind = Object.freeze({
  NotFound: 'not-found',
  Found: 'found',
})

const StaticKeyLookupKind = Object.freeze({
  NotFound: 'not-found',
  Found: 'found',
})

const ProjectionPathLookupKind = Object.freeze({
  NotFound: 'not-found',
  Found: 'found',
})

const maximumArrayIndex = 2 ** 32 - 2

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
      const producesObject = variableProducesObject({
        variable,
        seenVariables: new Set(),
      })
      if (!producesObject) return
      for (const definition of variable.defs) {
        if (
          (definition.type === 'Variable' &&
            definition.node.type === 'VariableDeclarator' &&
            (definition.name.typeAnnotation ||
              definition.node.id.typeAnnotation)) ||
          (definition.type === 'Parameter' && definition.name.typeAnnotation)
        ) {
          return
        }
      }
      context.report({ node: argument, messageId: 'typedArgument' })
    }

    function inlineObjectExpressions(expression) {
      const unwrapped = unwrapResultExpression(expression)
      if (unwrapped.type === 'ObjectExpression') {
        return [expression]
      }
      if (unwrapped.type === 'AssignmentExpression') {
        return inlineObjectExpressions(unwrapped.right)
      }
      if (unwrapped.type === 'ConditionalExpression') {
        return [
          ...inlineObjectExpressions(unwrapped.consequent),
          ...inlineObjectExpressions(unwrapped.alternate),
        ]
      }
      if (unwrapped.type === 'LogicalExpression') {
        return [
          ...inlineObjectExpressions(unwrapped.left),
          ...inlineObjectExpressions(unwrapped.right),
        ]
      }
      if (unwrapped.type === 'SequenceExpression') {
        return inlineObjectExpressions(unwrapped.expressions.at(-1))
      }
      if (unwrapped.type === 'MemberExpression') {
        return projectedMemberExpressions({
          expression: unwrapped,
          seenVariables: new Set(),
        }).flatMap(inlineObjectExpressions)
      }
      return []
    }

    function staticPropertyKey(member) {
      if (!member.computed && member.property.type === 'Identifier') {
        return {
          kind: StaticKeyLookupKind.Found,
          value: member.property.name,
        }
      }
      if (
        member.computed &&
        member.property.type === 'Literal' &&
        (typeof member.property.value === 'string' ||
          typeof member.property.value === 'number')
      ) {
        return {
          kind: StaticKeyLookupKind.Found,
          value: String(member.property.value),
        }
      }
      return { kind: StaticKeyLookupKind.NotFound }
    }

    function staticObjectKey(property) {
      if (!property.computed && property.key.type === 'Identifier') {
        return {
          kind: StaticKeyLookupKind.Found,
          value: property.key.name,
        }
      }
      if (
        property.key.type === 'Literal' &&
        (typeof property.key.value === 'string' ||
          typeof property.key.value === 'number')
      ) {
        return {
          kind: StaticKeyLookupKind.Found,
          value: String(property.key.value),
        }
      }
      return { kind: StaticKeyLookupKind.NotFound }
    }

    function staticArrayIndex(key) {
      const value =
        typeof key === 'number'
          ? key
          : String(Number(key)) === key
            ? Number(key)
            : Number.NaN
      if (
        Number.isInteger(value) &&
        value >= 0 &&
        value <= maximumArrayIndex
      ) {
        return { kind: StaticKeyLookupKind.Found, value }
      }
      return { kind: StaticKeyLookupKind.NotFound }
    }

    function possibleExpressionValues(args) {
      const { expression, seenVariables } = args
      const unwrapped = unwrapResultExpression(expression)
      if (unwrapped.type === 'AssignmentExpression') {
        return possibleExpressionValues({
          expression: unwrapped.right,
          seenVariables,
        })
      }
      if (unwrapped.type === 'ConditionalExpression') {
        return [
          ...possibleExpressionValues({
            expression: unwrapped.consequent,
            seenVariables,
          }),
          ...possibleExpressionValues({
            expression: unwrapped.alternate,
            seenVariables,
          }),
        ]
      }
      if (unwrapped.type === 'LogicalExpression') {
        return [
          ...possibleExpressionValues({
            expression: unwrapped.left,
            seenVariables,
          }),
          ...possibleExpressionValues({
            expression: unwrapped.right,
            seenVariables,
          }),
        ]
      }
      if (unwrapped.type === 'SequenceExpression') {
        return possibleExpressionValues({
          expression: unwrapped.expressions.at(-1),
          seenVariables,
        })
      }
      if (unwrapped.type === 'MemberExpression') {
        return projectedMemberExpressions({
          expression: unwrapped,
          seenVariables,
        })
      }
      if (unwrapped.type !== 'Identifier') return [unwrapped]
      const lookup = declaredVariable(unwrapped)
      if (lookup.kind === VariableLookupKind.NotFound) return [unwrapped]
      const { variable } = lookup
      if (seenVariables.has(variable)) return []
      const nextSeenVariables = new Set(seenVariables)
      nextSeenVariables.add(variable)
      const values = []
      for (const definition of variable.defs) {
        values.push(
          ...variableDefinitionValues({
            definition,
            seenVariables: nextSeenVariables,
          }),
        )
      }
      for (const reference of variable.references) {
        values.push(
          ...writeReferenceValues({
            reference,
            seenVariables: nextSeenVariables,
          }),
        )
      }
      return values
    }

    function bindingProjectionPath(pattern, target) {
      if (pattern === target) {
        return { kind: ProjectionPathLookupKind.Found, path: [] }
      }
      if (pattern.type === 'AssignmentPattern') {
        return bindingProjectionPath(pattern.left, target)
      }
      if (pattern.type === 'RestElement') {
        return { kind: ProjectionPathLookupKind.NotFound }
      }
      if (pattern.type === 'ObjectPattern') {
        for (const property of pattern.properties) {
          if (property.type !== 'Property') continue
          const childLookup = bindingProjectionPath(property.value, target)
          if (childLookup.kind === ProjectionPathLookupKind.NotFound) continue
          const keyLookup = staticObjectKey(property)
          if (keyLookup.kind === StaticKeyLookupKind.NotFound) {
            return { kind: ProjectionPathLookupKind.NotFound }
          }
          return {
            kind: ProjectionPathLookupKind.Found,
            path: [keyLookup.value, ...childLookup.path],
          }
        }
      }
      if (pattern.type === 'ArrayPattern') {
        for (const [index, element] of pattern.elements.entries()) {
          if (!element) continue
          const childLookup = bindingProjectionPath(element, target)
          if (childLookup.kind === ProjectionPathLookupKind.Found) {
            return {
              kind: ProjectionPathLookupKind.Found,
              path: [String(index), ...childLookup.path],
            }
          }
        }
      }
      return { kind: ProjectionPathLookupKind.NotFound }
    }

    function isObjectRestBinding(pattern, target) {
      if (pattern.type !== 'ObjectPattern') return false
      return pattern.properties.some(
        (property) =>
          property.type === 'RestElement' && property.argument === target,
      )
    }

    function writeBindingPattern(identifier) {
      let current = identifier
      while (
        current.parent &&
        (current.parent.type === 'Property' ||
          current.parent.type === 'RestElement' ||
          current.parent.type === 'AssignmentPattern' ||
          current.parent.type === 'ObjectPattern' ||
          current.parent.type === 'ArrayPattern')
      ) {
        current = current.parent
      }
      if (
        (current.type === 'ObjectPattern' || current.type === 'ArrayPattern') &&
        current.parent?.type === 'AssignmentExpression' &&
        current.parent.left === current
      ) {
        return { kind: ProjectionPathLookupKind.Found, pattern: current }
      }
      return { kind: ProjectionPathLookupKind.NotFound }
    }

    function projectValuesAlongPath(args) {
      const { expression, path, seenVariables } = args
      let values = possibleExpressionValues({ expression, seenVariables })
      for (const selectedKey of path) {
        values = values.flatMap((container) =>
          projectedContainerValues({
            container,
            selectedKey,
            seenVariables,
          }),
        )
      }
      return values
    }

    function variableDefinitionValues(args) {
      const { definition, seenVariables } = args
      if (
        definition.type !== 'Variable' ||
        definition.node.type !== 'VariableDeclarator' ||
        !definition.node.init
      ) {
        return []
      }
      const pathLookup = bindingProjectionPath(
        definition.node.id,
        definition.name,
      )
      if (pathLookup.kind === ProjectionPathLookupKind.NotFound) return []
      return projectValuesAlongPath({
        expression: definition.node.init,
        path: pathLookup.path,
        seenVariables,
      })
    }

    function writeReferenceValues(args) {
      const { reference, seenVariables } = args
      if (!reference.isWrite() || reference.init || !reference.writeExpr) {
        return []
      }
      const patternLookup = writeBindingPattern(reference.identifier)
      if (patternLookup.kind === ProjectionPathLookupKind.NotFound) {
        return possibleExpressionValues({
          expression: reference.writeExpr,
          seenVariables,
        })
      }
      const pathLookup = bindingProjectionPath(
        patternLookup.pattern,
        reference.identifier,
      )
      if (pathLookup.kind === ProjectionPathLookupKind.NotFound) return []
      return projectValuesAlongPath({
        expression: reference.writeExpr,
        path: pathLookup.path,
        seenVariables,
      })
    }

    function projectedContainerValues(args) {
      const { container, selectedKey, seenVariables } = args
      if (container.type === 'ObjectExpression') {
        for (const property of [...container.properties].reverse()) {
          if (property.type === 'SpreadElement') {
            const spreadValues = possibleExpressionValues({
              expression: property.argument,
              seenVariables,
            }).flatMap((spreadContainer) =>
              projectedContainerValues({
                container: spreadContainer,
                selectedKey,
                seenVariables,
              }),
            )
            if (spreadValues.length > 0) return spreadValues
            continue
          }
          const objectKeyLookup = staticObjectKey(property)
          if (
            property.kind === 'init' &&
            objectKeyLookup.kind === StaticKeyLookupKind.Found &&
            objectKeyLookup.value === selectedKey
          ) {
            return possibleExpressionValues({
              expression: property.value,
              seenVariables,
            })
          }
        }
      }
      const arrayIndexLookup = staticArrayIndex(selectedKey)
      if (
        container.type === 'ArrayExpression' &&
        arrayIndexLookup.kind === StaticKeyLookupKind.Found
      ) {
        const elements = spreadArrayElements({
          expression: container,
          seenVariables,
        })
        const element = elements[arrayIndexLookup.value]
        if (element && element.type !== 'SpreadElement') {
          return possibleExpressionValues({ expression: element, seenVariables })
        }
      }
      return []
    }

    function projectedMemberExpressions(args) {
      const { expression, seenVariables } = args
      const selectedKeyLookup = staticPropertyKey(expression)
      if (selectedKeyLookup.kind === StaticKeyLookupKind.NotFound) return []
      const selectedKey = selectedKeyLookup.value
      const containers = possibleExpressionValues({
        expression: expression.object,
        seenVariables,
      })
      const projected = []
      for (const container of containers) {
        projected.push(
          ...projectedContainerValues({
            container,
            selectedKey,
            seenVariables,
          }),
        )
      }
      return projected
    }

    function expressionProducesObject(args) {
      const { expression, seenVariables } = args
      const unwrapped = unwrapResultExpression(expression)
      if (unwrapped.type === 'ObjectExpression') return true
      if (unwrapped.type === 'AssignmentExpression') {
        return expressionProducesObject({
          expression: unwrapped.right,
          seenVariables,
        })
      }
      if (unwrapped.type === 'ConditionalExpression') {
        return (
          expressionProducesObject({
            expression: unwrapped.consequent,
            seenVariables,
          }) ||
          expressionProducesObject({
            expression: unwrapped.alternate,
            seenVariables,
          })
        )
      }
      if (unwrapped.type === 'LogicalExpression') {
        return (
          expressionProducesObject({
            expression: unwrapped.left,
            seenVariables,
          }) ||
          expressionProducesObject({
            expression: unwrapped.right,
            seenVariables,
          })
        )
      }
      if (unwrapped.type === 'SequenceExpression') {
        return expressionProducesObject({
          expression: unwrapped.expressions.at(-1),
          seenVariables,
        })
      }
      if (unwrapped.type === 'MemberExpression') {
        return projectedMemberExpressions({
          expression: unwrapped,
          seenVariables,
        }).some((projected) =>
          expressionProducesObject({
            expression: projected,
            seenVariables,
          }),
        )
      }
      if (unwrapped.type !== 'Identifier') return false
      const lookup = declaredVariable(unwrapped)
      if (lookup.kind === VariableLookupKind.NotFound) return false
      return variableProducesObject({
        variable: lookup.variable,
        seenVariables,
      })
    }

    function variableProducesObject(args) {
      const { variable, seenVariables } = args
      if (seenVariables.has(variable)) return false
      seenVariables.add(variable)
      for (const definition of variable.defs) {
        if (
          definition.type === 'Variable' &&
          definition.node.type === 'VariableDeclarator' &&
          isObjectRestBinding(definition.node.id, definition.name)
        ) {
          return true
        }
        const values = variableDefinitionValues({ definition, seenVariables })
        if (
          values.some((value) =>
            expressionProducesObject({ expression: value, seenVariables }),
          )
        ) {
          return true
        }
      }
      for (const reference of variable.references) {
        const patternLookup = writeBindingPattern(reference.identifier)
        if (
          patternLookup.kind === ProjectionPathLookupKind.Found &&
          isObjectRestBinding(
            patternLookup.pattern,
            reference.identifier,
          )
        ) {
          return true
        }
        const values = writeReferenceValues({ reference, seenVariables })
        if (
          values.some((value) =>
            expressionProducesObject({ expression: value, seenVariables }),
          )
        ) {
          return true
        }
      }
      return false
    }

    function inspectInlineObjectExpressions(expression) {
      const objectExpressions = inlineObjectExpressions(expression)
      const seenObjectExpressions = new Set()
      for (const objectExpression of objectExpressions) {
        if (seenObjectExpressions.has(objectExpression)) continue
        seenObjectExpressions.add(objectExpression)
        context.report({
          node: objectExpression,
          messageId: 'namedArgument',
        })
      }
      return seenObjectExpressions.size > 0
    }

    function inspectSpreadArgument(argument) {
      const elements = spreadArrayElements({
        expression: argument.argument,
        seenVariables: new Set(),
      })
      const seenElements = new Set()
      for (const element of elements) {
        if (
          element &&
          element.type !== 'SpreadElement' &&
          !seenElements.has(element)
        ) {
          seenElements.add(element)
          if (!inspectInlineObjectExpressions(element)) {
            inspectNamedObjectArgument(element)
          }
        }
      }
    }

    function spreadArrayElements(args) {
      const { expression, seenVariables } = args
      const unwrapped = unwrapResultExpression(expression)
      if (unwrapped.type === 'ArrayExpression') {
        return unwrapped.elements.flatMap((element) => {
          if (!element || element.type !== 'SpreadElement') return [element]
          return spreadArrayElements({
            expression: element.argument,
            seenVariables,
          })
        })
      }
      if (unwrapped.type === 'AssignmentExpression') {
        return spreadArrayElements({
          expression: unwrapped.right,
          seenVariables,
        })
      }
      if (unwrapped.type === 'ConditionalExpression') {
        return [
          ...spreadArrayElements({
            expression: unwrapped.consequent,
            seenVariables,
          }),
          ...spreadArrayElements({
            expression: unwrapped.alternate,
            seenVariables,
          }),
        ]
      }
      if (unwrapped.type === 'LogicalExpression') {
        return [
          ...spreadArrayElements({
            expression: unwrapped.left,
            seenVariables,
          }),
          ...spreadArrayElements({
            expression: unwrapped.right,
            seenVariables,
          }),
        ]
      }
      if (unwrapped.type === 'SequenceExpression') {
        return spreadArrayElements({
          expression: unwrapped.expressions.at(-1),
          seenVariables,
        })
      }
      if (unwrapped.type !== 'Identifier') return []
      const lookup = declaredVariable(unwrapped)
      if (lookup.kind === VariableLookupKind.NotFound) return []
      const { variable } = lookup
      if (seenVariables.has(variable)) return []
      seenVariables.add(variable)
      const elements = []
      for (const definition of variable.defs) {
        if (
          definition.type === 'Variable' &&
          definition.node.type === 'VariableDeclarator' &&
          definition.node.init
        ) {
          elements.push(
            ...spreadArrayElements({
              expression: definition.node.init,
              seenVariables,
            }),
          )
        }
      }
      for (const reference of variable.references) {
        if (reference.isWrite() && !reference.init && reference.writeExpr) {
          elements.push(
            ...spreadArrayElements({
              expression: reference.writeExpr,
              seenVariables,
            }),
          )
        }
      }
      return elements
    }

    function inspectArguments(node) {
      for (const argument of node.arguments) {
        if (argument.type === 'SpreadElement') {
          inspectSpreadArgument(argument)
          continue
        }
        if (inspectInlineObjectExpressions(argument)) {
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
            'Nook web forbids unknown. Model a concrete domain type. A generic transport value is allowed only inside a dedicated untrusted-input adapter and must be narrowed immediately.',
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
