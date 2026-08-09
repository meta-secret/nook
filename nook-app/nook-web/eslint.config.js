import js from '@eslint/js'
import noUnsanitized from 'eslint-plugin-no-unsanitized'
import svelte from 'eslint-plugin-svelte'
import globals from 'globals'
import ts from 'typescript-eslint'
import { typedApiRules } from './typed-api-rules.js'
import { untrustedInputAdapterRules } from './typed-api-rules.js'
import {
  ActiveCallScopeKind,
  arrayAtSummaryValues,
  arrayCallbackElementParameter,
  bindingPatternHasTypeAnnotation,
  concatenateArraySummaries,
  executionScope,
  inlineObjectResultExpressions,
  objectPropertyValueExpressions,
  isObjectRestBinding,
  memberAssignmentPath,
  mergeArraySummaries,
  namedResultAlternatives,
  ProjectionPathLookupKind,
  scopeContains,
  StaticKeyLookupKind,
  VariableLookupKind,
  nodesUseExclusiveBranches,
  staticArrayIndex,
  staticArrayAtAccessor,
  staticExpressionKey as resolveStaticExpressionKey,
  staticMemberPath,
  thisClassFieldValueExpressions,
  unwrapResultExpression,
  writeBindingPattern,
  writeExitsBeforeFollowingNode,
} from './typed-api-analysis.js'

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
    let activeValueFlowCutoff = Number.POSITIVE_INFINITY
    let activeCallScope = { kind: ActiveCallScopeKind.Inactive }

    function nodeStart(node) {
      return node.range?.[0] ?? sourceCode.getIndexFromLoc(node.loc.start)
    }

    function occursBeforeActiveCallSite(node) {
      return nodeStart(node) < activeValueFlowCutoff
    }

    function isNonInitialWriteReference(reference) {
      return reference.isWrite() && !reference.init && reference.writeExpr
    }

    function referenceCanReachActiveCall(reference) {
      if (activeCallScope.kind === ActiveCallScopeKind.Inactive) return true
      const referenceExecutionScope = executionScope(reference.from)
      const args = {
        possibleAncestor: referenceExecutionScope,
        scope: activeCallScope.scope,
      }
      return (
        scopeContains(args) &&
        !nodesUseExclusiveBranches({
          first: reference.identifier,
          second: activeCallScope.node,
        }) &&
        !writeExitsBeforeFollowingNode({
          write: reference.identifier,
          following: activeCallScope.node,
        })
      )
    }
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
          (definition.type === 'Parameter' &&
            bindingPatternHasTypeAnnotation(definition.name))
        ) {
          return
        }
      }
      context.report({ node: argument, messageId: 'typedArgument' })
    }

    function inlineObjectExpressions(expression) {
      return inlineObjectResultExpressions({
        expression,
        projectMemberExpressions: projectedMemberExpressions,
        projectArrayAccessorExpressions: arrayAccessorExpressions,
      })
    }
    function arrayAccessorExpressions(expression) {
      const accessor = staticArrayAtAccessor({
        expression,
        staticPropertyKey,
      })
      if (accessor.kind === StaticKeyLookupKind.NotFound) return []
      const summary = arrayProjectionSummary({
        expression: accessor.array,
        seenVariables: new Set(),
        limit: accessor.limit,
      })
      return arrayAtSummaryValues({ summary, index: accessor.index })
    }
    function staticPropertyKey(member) {
      if (!member.computed && member.property.type === 'Identifier') {
        return {
          kind: StaticKeyLookupKind.Found,
          value: member.property.name,
        }
      }
      return member.computed
        ? staticExpressionKey(member.property)
        : { kind: StaticKeyLookupKind.NotFound }
    }
    function staticObjectKey(property) {
      if (!property.computed && property.key.type === 'Identifier') {
        return {
          kind: StaticKeyLookupKind.Found,
          value: property.key.name,
        }
      }
      return staticExpressionKey(property.key)
    }
    function staticExpressionKey(expression) {
      return resolveStaticExpressionKey({ expression, declaredVariable })
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
        definition.type === 'Parameter' &&
        definition.name.parent?.type === 'AssignmentPattern' &&
        definition.name.parent.left === definition.name
      ) {
        return possibleExpressionValues({
          expression: definition.name.parent.right,
          seenVariables,
        })
      }
      if (definition.type === 'Parameter') {
        return callbackParameterValues({ definition, seenVariables })
      }
      if (
        definition.type === 'Variable' &&
        definition.node.type === 'VariableDeclarator'
      ) {
        const forOf = definition.node.parent?.parent
        if (
          forOf?.type === 'ForOfStatement' &&
          forOf.left === definition.node.parent
        ) {
          const pathLookup = bindingProjectionPath(
            definition.node.id,
            definition.name,
          )
          if (pathLookup.kind === ProjectionPathLookupKind.NotFound) return []
          return spreadArrayElements({
            expression: forOf.right,
            seenVariables,
          }).flatMap((element) =>
            element
              ? projectValuesAlongPath({
                  expression: element,
                  path: pathLookup.path,
                  seenVariables,
                })
              : [],
          )
        }
      }
      if (
        definition.type !== 'Variable' ||
        definition.node.type !== 'VariableDeclarator' ||
        !definition.node.init ||
        !occursBeforeActiveCallSite(definition.node.init)
      ) {
        return []
      }
      const pathLookup = bindingProjectionPath(
        definition.node.id,
        definition.name,
      )
      if (pathLookup.kind === ProjectionPathLookupKind.NotFound) return []
      const values = projectValuesAlongPath({
        expression: definition.node.init,
        path: pathLookup.path,
        seenVariables,
      })
      if (definition.name.parent?.type === 'AssignmentPattern') {
        values.push(
          ...possibleExpressionValues({
            expression: definition.name.parent.right,
            seenVariables,
          }),
        )
      }
      return values
    }

    function callbackParameterValues(args) {
      const { definition, seenVariables } = args
      if (bindingPatternHasTypeAnnotation(definition.name)) return []
      const callback = definition.node
      const call = callback.parent
      if (
        call?.type !== 'CallExpression' ||
        call.arguments[0] !== callback ||
        call.callee.type !== 'MemberExpression'
      ) {
        return []
      }
      const elementParameter = arrayCallbackElementParameter(
        staticPropertyKey(call.callee).value,
      )
      if (elementParameter.kind === StaticKeyLookupKind.NotFound) return []
      const parameter = callback.params[elementParameter.value]
      if (!parameter) return []
      const pathLookup = bindingProjectionPath(parameter, definition.name)
      if (pathLookup.kind === ProjectionPathLookupKind.NotFound) return []
      return spreadArrayElements({
        expression: call.callee.object,
        seenVariables,
      }).flatMap((element) =>
        element
          ? projectValuesAlongPath({
              expression: element,
              path: pathLookup.path,
              seenVariables,
            })
          : [],
      )
    }

    function writeReferenceValues(args) {
      const { reference, seenVariables } = args
      if (
        !isNonInitialWriteReference(reference) ||
        !occursBeforeActiveCallSite(reference.identifier) ||
        !referenceCanReachActiveCall(reference)
      ) {
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
        const possibleValues = []
        for (const property of [...container.properties].reverse()) {
          if (property.type === 'SpreadElement') {
            const spreadContainers = possibleExpressionValues({
              expression: property.argument,
              seenVariables,
            })
            const projections = spreadContainers.map((spreadContainer) =>
              projectedContainerValues({
                container: spreadContainer,
                selectedKey,
                seenVariables,
              }),
            )
            possibleValues.push(...projections.flat())
            if (
              projections.length > 0 &&
              projections.every((values) => values.length > 0)
            ) {
              return possibleValues
            }
            continue
          }
          const objectKeyLookup = staticObjectKey(property)
          if (
            objectKeyLookup.kind === StaticKeyLookupKind.Found &&
            objectKeyLookup.value === selectedKey
          ) {
            const projectedExpressions =
              objectPropertyValueExpressions(property)
            return [
              ...possibleValues,
              ...projectedExpressions.flatMap((expression) =>
                possibleExpressionValues({ expression, seenVariables }),
              ),
            ]
          }
        }
        return possibleValues
      }
      const arrayIndexLookup = staticArrayIndex(selectedKey)
      if (
        container.type === 'ArrayExpression' &&
        arrayIndexLookup.kind === StaticKeyLookupKind.Found
      ) {
        const summary = arrayProjectionSummary({
          expression: container,
          seenVariables,
          limit: arrayIndexLookup.value,
        })
        return [...(summary.values.get(arrayIndexLookup.value) ?? [])].flatMap(
          (element) =>
            possibleExpressionValues({ expression: element, seenVariables }),
        )
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
      projected.push(
        ...thisClassFieldValueExpressions({ expression, staticObjectKey }),
        ...projectedMemberWriteValues({
          expression,
          selectedKey,
          seenVariables,
        }),
      )
      return projected
    }

    function projectedMemberWriteValues(args) {
      const { expression, selectedKey, seenVariables } = args
      const target = staticMemberPath({ expression, staticPropertyKey })
      if (target.kind === ProjectionPathLookupKind.NotFound) return []
      const lookup = declaredVariable(target.root)
      if (lookup.kind === VariableLookupKind.NotFound) return []
      const values = []
      for (const reference of lookup.variable.references) {
        const write = memberAssignmentPath({
          identifier: reference.identifier,
          staticPropertyKey,
        })
        if (
          write.kind === ProjectionPathLookupKind.NotFound ||
          write.path.length !== target.path.length ||
          !write.path.every((key, index) => key === target.path[index]) ||
          target.path.at(-1) !== selectedKey ||
          !occursBeforeActiveCallSite(write.assignment) ||
          !referenceCanReachActiveCall(reference)
        ) {
          continue
        }
        values.push(
          ...possibleExpressionValues({
            expression: write.assignment.right,
            seenVariables,
          }),
        )
      }
      return values
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
          occursBeforeActiveCallSite(definition.node) &&
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
        if (
          !occursBeforeActiveCallSite(reference.identifier) ||
          !referenceCanReachActiveCall(reference)
        ) {
          continue
        }
        const patternLookup = writeBindingPattern(reference.identifier)
        if (
          patternLookup.kind === ProjectionPathLookupKind.Found &&
          isObjectRestBinding(patternLookup.pattern, reference.identifier)
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
        return unwrapped.elements.flatMap((element) =>
          element?.type === 'SpreadElement'
            ? spreadArrayElements({
                expression: element.argument,
                seenVariables,
              })
            : [element],
        )
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
          ...spreadArrayElements({ expression: unwrapped.left, seenVariables }),
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
      return namedArrayValues({ expression: unwrapped, seenVariables }).flatMap(
        (entry) =>
          spreadArrayElements({
            expression: entry.value,
            seenVariables: entry.seenVariables,
          }),
      )
    }

    function namedArrayValues(args) {
      const { expression, seenVariables } = args
      if (expression.type !== 'Identifier') return []
      const lookup = declaredVariable(expression)
      if (lookup.kind === VariableLookupKind.NotFound) return []
      const { variable } = lookup
      if (seenVariables.has(variable)) return []
      const nextSeenVariables = new Set(seenVariables)
      nextSeenVariables.add(variable)
      return [
        ...variable.defs.flatMap((definition) =>
          definition.type === 'Variable' &&
          definition.node.type === 'VariableDeclarator' &&
          definition.node.init &&
          occursBeforeActiveCallSite(definition.node.init)
            ? [definition.node.init]
            : [],
        ),
        ...variable.references.flatMap((reference) =>
          isNonInitialWriteReference(reference) &&
          occursBeforeActiveCallSite(reference.identifier) &&
          referenceCanReachActiveCall(reference)
            ? [reference.writeExpr]
            : [],
        ),
      ].map((value) => ({ value, seenVariables: nextSeenVariables }))
    }

    function arrayProjectionSummary(args) {
      const { expression, seenVariables, limit } = args
      const unwrapped = unwrapResultExpression(expression)
      if (unwrapped.type === 'ArrayExpression') {
        let summary = { lengths: new Set([0]), values: new Map() }
        for (const element of unwrapped.elements) {
          const addition =
            element?.type === 'SpreadElement'
              ? arrayProjectionSummary({
                  expression: element.argument,
                  seenVariables,
                  limit,
                })
              : {
                  lengths: new Set([1]),
                  values: element
                    ? new Map([[0, new Set([element])]])
                    : new Map(),
                }
          summary = concatenateArraySummaries({
            first: summary,
            second: addition,
            limit,
          })
        }
        return summary
      }
      if (unwrapped.type === 'AssignmentExpression') {
        return arrayProjectionSummary({
          expression: unwrapped.right,
          seenVariables,
          limit,
        })
      }
      if (
        unwrapped.type === 'ConditionalExpression' ||
        unwrapped.type === 'LogicalExpression'
      ) {
        const first =
          unwrapped.type === 'ConditionalExpression'
            ? unwrapped.consequent
            : unwrapped.left
        const second =
          unwrapped.type === 'ConditionalExpression'
            ? unwrapped.alternate
            : unwrapped.right
        return mergeArraySummaries([
          arrayProjectionSummary({ expression: first, seenVariables, limit }),
          arrayProjectionSummary({ expression: second, seenVariables, limit }),
        ])
      }
      if (unwrapped.type === 'SequenceExpression') {
        return arrayProjectionSummary({
          expression: unwrapped.expressions.at(-1),
          seenVariables,
          limit,
        })
      }
      const namedValues = namedArrayValues({
        expression: unwrapped,
        seenVariables,
      })
      if (namedValues.length === 0)
        return { lengths: new Set([0]), values: new Map() }
      return mergeArraySummaries(
        namedValues.map((entry) =>
          arrayProjectionSummary({
            expression: entry.value,
            seenVariables: entry.seenVariables,
            limit,
          }),
        ),
      )
    }

    function inspectArguments(node) {
      for (const argument of node.arguments) {
        activeValueFlowCutoff = nodeStart(argument)
        activeCallScope = {
          kind: ActiveCallScopeKind.Active,
          scope: executionScope(sourceCode.getScope(argument)),
          node: argument,
        }
        try {
          if (argument.type === 'SpreadElement') {
            inspectSpreadArgument(argument)
            continue
          }
          if (inspectInlineObjectExpressions(argument)) {
            continue
          }
          for (const result of new Set(namedResultAlternatives(argument))) {
            inspectNamedObjectArgument(result)
          }
        } finally {
          activeValueFlowCutoff = Number.POSITIVE_INFINITY
          activeCallScope = { kind: ActiveCallScopeKind.Inactive }
        }
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
    files: ['nook-web-extension/src/**/*.{ts,svelte}', 'src/**/*.{ts,svelte}'],
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
    files: [
      'nook-web-extension/src/**/*.{ts,svelte}',
      'nook-web-shared/src/**/*.{ts,svelte}',
      'nook-web-app/src/**/*.{ts,svelte}',
      'nook-web-research/src/**/*.{ts,svelte}',
      'nook-vault-{simple,sentinel}/**/*.{ts,svelte}',
    ],
    plugins: {
      'nook-typed-api': nookTypedApiPlugin,
    },
    rules: typedApiRules,
  },
  {
    files: [
      'nook-web-app/src/landing/github-stars-state.ts',
      'nook-web-extension/src/chrome.d.ts',
      'nook-web-extension/src/content/simple-vault-bridge.ts',
      'nook-web-extension/src/content/webauthn-content.ts',
      'nook-web-extension/src/content/webauthn-page.ts',
      'nook-web-shared/src/extension/runtime-messages.ts',
      'nook-web-shared/src/vault-app/lib/auth/icloud/auth-errors.ts',
      'nook-web-shared/src/vault-app/lib/auth/icloud/cloudkit-runtime.ts',
      'nook-web-shared/src/vault-app/lib/auth/icloud/web-auth-wait.ts',
      'nook-web-shared/src/vault-app/lib/auth/google/oauth.ts',
      'nook-web-shared/src/vault-app/lib/auth/passkey-device-protection.ts',
      'nook-web-shared/src/vault-app/lib/extension/connect.ts',
      'nook-web-shared/src/vault-app/lib/extension/install.ts',
      'nook-web-shared/src/vault-app/lib/runtime/log.ts',
    ],
    rules: untrustedInputAdapterRules,
  },
  {
    files: ['**/tests/**', '**/e2e/**'],
    rules: {
      'no-unsanitized/property': 'off',
    },
  },
]
