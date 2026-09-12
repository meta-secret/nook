import {
  ActiveCallScopeKind,
  arrayAtSummaryValues,
  arrayCallbackElementParameter,
  bindingProjectionPath,
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
import { namedParameterContractListeners } from './named-parameter-contract.js'

/** @typedef {import('@typescript-eslint/types').TSESTree.Node} AstNode */
/** @typedef {import('@typescript-eslint/types').TSESTree.Expression} AstExpression */
/** @typedef {import('@typescript-eslint/types').TSESTree.Identifier} AstIdentifier */
/** @typedef {import('@typescript-eslint/types').TSESTree.MemberExpression} AstMemberExpression */
/** @typedef {import('@typescript-eslint/types').TSESTree.Property | import('@typescript-eslint/types').TSESTree.PropertyDefinition} AstProperty */
/** @typedef {import('@typescript-eslint/scope-manager').Variable} AnalysisVariable */
/** @typedef {import('@typescript-eslint/scope-manager').Reference} AnalysisReference */
/** @typedef {import('@typescript-eslint/scope-manager').Definition} AnalysisDefinition */
/** @typedef {import('@typescript-eslint/scope-manager').Scope} AnalysisScope */
/** @typedef {'namedArgument' | 'namedParameterType' | 'namedParameterDefault' | 'semanticParameterType' | 'typedArgument'} RuleMessageId */
/** @typedef {import('@typescript-eslint/utils').TSESLint.RuleContext<RuleMessageId, readonly [{ enforceNamedParameterContracts?: boolean }] >} TypedRuleContext */
/** @typedef {{ kind: 'not-found' } | { kind: 'found', value: string }} StaticStringLookup */
/** @typedef {{ kind: 'inactive' } | { kind: 'active', scope: AnalysisScope, node: AstNode }} ActiveCallScope */
/** @typedef {{ expression: AstExpression, seenVariables: Set<AnalysisVariable> }} ExpressionSearch */
/** @typedef {{ kind: 'not-found' } | { kind: 'found', expression: AstExpression }} ExpressionLookup */

const directObjectArgumentRunes = new Set(['$state', '$derived', '$bindable'])

/** @param {import('@typescript-eslint/types').TSESTree.CallExpression} node */
function isDirectObjectArgumentRune(node) {
  if (
    node.callee.type === 'Identifier' &&
    directObjectArgumentRunes.has(node.callee.name)
  ) {
    return true
  }
  return (
    node.callee.type === 'MemberExpression' &&
    !node.callee.computed &&
    node.callee.object.type === 'Identifier' &&
    node.callee.object.name === '$state' &&
    node.callee.property.type === 'Identifier' &&
    node.callee.property.name === 'raw'
  )
}

export const noRawObjectArgumentsRule = {
  meta: {
    type: 'problem',
    schema: [
      {
        type: 'object',
        properties: {
          enforceNamedParameterContracts: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      namedArgument:
        'Nook web forbids raw object-literal call and constructor arguments, including nested TypeScript wrappers. Assign a named typed value first, then pass that name.',
      namedParameterType:
        'Nook web forbids inline object types in function and method parameters. Declare and reuse a named semantic type, interface, or Rust-generated type.',
      namedParameterDefault:
        'Nook web forbids object-valued parameter defaults. Apply defaults at the call site or inside the function body.',
      semanticParameterType:
        'Nook web forbids generic parameter contract names. Name the type or interface after its domain value or request.',
      typedArgument:
        'Nook web requires object-literal arguments to use an explicitly typed named declaration.',
    },
  },
  /** @param {TypedRuleContext} context */
  create(context) {
    const sourceCode = context.sourceCode
    let activeValueFlowCutoff = Number.POSITIVE_INFINITY
    /** @type {ActiveCallScope} */
    let activeCallScope = { kind: ActiveCallScopeKind.Inactive }

    /** @param {AstNode} node */
    function nodeStart(node) {
      return ((...[v = sourceCode.getIndexFromLoc(node.loc.start)]) => v)(
        node.range?.[0],
      )
    }

    /** @param {AstNode} node */
    function occursBeforeActiveCallSite(node) {
      return nodeStart(node) < activeValueFlowCutoff
    }

    /** @param {AnalysisReference} reference */
    function isNonInitialWriteReference(reference) {
      return reference.isWrite() && !reference.init && reference.writeExpr
    }

    /** @param {AnalysisReference} reference */
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
    /** @param {AstIdentifier} identifier */
    function declaredVariable(identifier) {
      let scope = sourceCode.getScope(identifier)
      while (scope) {
        const variable = scope.set.get(identifier.name)
        if (variable) {
          return { kind: VariableLookupKind.Found, variable }
        }
        const upper = scope.upper
        if (!upper) break
        scope = upper
      }
      return { kind: VariableLookupKind.NotFound }
    }

    /** @param {AstExpression} argument */
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
            definition.name.type === 'Identifier' &&
            bindingPatternHasTypeAnnotation(definition.name))
        ) {
          return
        }
      }
      context.report({ node: argument, messageId: 'typedArgument' })
    }

    /** @param {AstExpression} expression @returns {AstExpression[]} */
    function inlineObjectExpressions(expression) {
      return inlineObjectResultExpressions({
        expression,
        projectMemberExpressions: projectedMemberExpressions,
        projectArrayAccessorExpressions: arrayAccessorExpressions,
      })
    }
    /** @param {AstExpression} expression @returns {AstExpression[]} */
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
    /** @param {AstMemberExpression} member @returns {StaticStringLookup} */
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
    /** @param {AstProperty} property @returns {StaticStringLookup} */
    function staticObjectKey(property) {
      if (!property.computed && property.key.type === 'Identifier') {
        return {
          kind: StaticKeyLookupKind.Found,
          value: property.key.name,
        }
      }
      if (property.key.type === 'Literal')
        return staticExpressionKey(property.key)
      return property.computed
        ? staticExpressionKey(property.key)
        : { kind: StaticKeyLookupKind.NotFound }
    }
    /** @param {AstExpression} expression @returns {StaticStringLookup} */
    function staticExpressionKey(expression) {
      return resolveStaticExpressionKey({ expression, declaredVariable })
    }
    /** @param {ExpressionSearch} args @returns {AstExpression[]} */
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
        const lastExpression = unwrapped.expressions.at(-1)
        if (!lastExpression) return []
        return possibleExpressionValues({
          expression: lastExpression,
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
    /** @param {ExpressionSearch & { path: string[] }} args @returns {AstExpression[]} */
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

    /** @param {{ definition: AnalysisDefinition, seenVariables: Set<AnalysisVariable> }} args @returns {AstExpression[]} */
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
        if (definition.name.type !== 'Identifier') return []
        const forOf = definition.node.parent?.parent
        if (
          forOf?.type === 'ForOfStatement' &&
          forOf.left === definition.node.parent
        ) {
          const pathLookup = bindingProjectionPath({
            pattern: definition.node.id,
            target: definition.name,
            staticObjectKey,
          })
          if (pathLookup.kind === ProjectionPathLookupKind.NotFound) return []
          return spreadArrayElements({
            expression: forOf.right,
            seenVariables,
          }).flatMap((element) =>
            element && element.type !== 'SpreadElement'
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
      if (definition.name.type !== 'Identifier') return []
      const pathLookup = bindingProjectionPath({
        pattern: definition.node.id,
        target: definition.name,
        staticObjectKey,
      })
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

    /** @param {{ definition: AnalysisDefinition, seenVariables: Set<AnalysisVariable> }} args @returns {AstExpression[]} */
    function callbackParameterValues(args) {
      const { definition, seenVariables } = args
      if (
        definition.type !== 'Parameter' ||
        definition.name.type !== 'Identifier' ||
        bindingPatternHasTypeAnnotation(definition.name)
      )
        return []
      const callback = definition.node
      const call = callback.parent
      if (
        (callback.type !== 'ArrowFunctionExpression' &&
          callback.type !== 'FunctionExpression') ||
        call?.type !== 'CallExpression' ||
        call.arguments[0] !== callback ||
        call.callee.type !== 'MemberExpression'
      ) {
        return []
      }
      const method = staticPropertyKey(call.callee)
      if (method.kind === StaticKeyLookupKind.NotFound) return []
      const elementParameter = arrayCallbackElementParameter(method.value)
      if (elementParameter.kind === StaticKeyLookupKind.NotFound) return []
      const parameter = callback.params[elementParameter.value]
      if (!parameter) return []
      const pathLookup = bindingProjectionPath({
        pattern: parameter,
        target: definition.name,
        staticObjectKey,
      })
      if (pathLookup.kind === ProjectionPathLookupKind.NotFound) return []
      return spreadArrayElements({
        expression: call.callee.object,
        seenVariables,
      }).flatMap((element) =>
        element && element.type !== 'SpreadElement'
          ? projectValuesAlongPath({
              expression: element,
              path: pathLookup.path,
              seenVariables,
            })
          : [],
      )
    }

    /** @param {{ reference: AnalysisReference, seenVariables: Set<AnalysisVariable> }} args @returns {AstExpression[]} */
    function writeReferenceValues(args) {
      const { reference, seenVariables } = args
      if (
        !isNonInitialWriteReference(reference) ||
        !occursBeforeActiveCallSite(reference.identifier) ||
        !referenceCanReachActiveCall(reference)
      ) {
        return []
      }
      const writeExpression = referenceWriteExpression(reference)
      if (writeExpression.kind === VariableLookupKind.NotFound) return []
      if (reference.identifier.type !== 'Identifier') return []
      const patternLookup = writeBindingPattern(reference.identifier)
      if (patternLookup.kind === ProjectionPathLookupKind.NotFound) {
        return possibleExpressionValues({
          expression: writeExpression.expression,
          seenVariables,
        })
      }
      const pathLookup = bindingProjectionPath({
        pattern: patternLookup.pattern,
        target: reference.identifier,
        staticObjectKey,
      })
      if (pathLookup.kind === ProjectionPathLookupKind.NotFound) return []
      return projectValuesAlongPath({
        expression: writeExpression.expression,
        path: pathLookup.path,
        seenVariables,
      })
    }

    /** @param {AnalysisReference} reference @returns {ExpressionLookup} */
    function referenceWriteExpression(reference) {
      if (reference.identifier.type !== 'Identifier') {
        return { kind: VariableLookupKind.NotFound }
      }
      const directAssignment = reference.identifier.parent
      if (
        directAssignment.type === 'AssignmentExpression' &&
        directAssignment.left === reference.identifier
      )
        return {
          kind: VariableLookupKind.Found,
          expression: directAssignment.right,
        }
      const binding = writeBindingPattern(reference.identifier)
      if (binding.kind === ProjectionPathLookupKind.NotFound) {
        return { kind: VariableLookupKind.NotFound }
      }
      const assignment = binding.pattern.parent
      return assignment.type === 'AssignmentExpression' &&
        assignment.left === binding.pattern
        ? { kind: VariableLookupKind.Found, expression: assignment.right }
        : { kind: VariableLookupKind.NotFound }
    }

    /** @param {{ container: AstExpression, selectedKey: string, seenVariables: Set<AnalysisVariable> }} args @returns {AstExpression[]} */
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
        return [
          ...((v) => (v ? v : []))(summary.values.get(arrayIndexLookup.value)),
        ].flatMap((element) =>
          possibleExpressionValues({ expression: element, seenVariables }),
        )
      }
      return []
    }

    /** @param {{ expression: AstMemberExpression, seenVariables: Set<AnalysisVariable> }} args @returns {AstExpression[]} */
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

    /** @param {{ expression: AstMemberExpression, selectedKey: string, seenVariables: Set<AnalysisVariable> }} args @returns {AstExpression[]} */
    function projectedMemberWriteValues(args) {
      const { expression, selectedKey, seenVariables } = args
      const target = staticMemberPath({ expression, staticPropertyKey })
      if (target.kind === ProjectionPathLookupKind.NotFound) return []
      const lookup = declaredVariable(target.root)
      if (lookup.kind === VariableLookupKind.NotFound) return []
      const values = []
      for (const reference of lookup.variable.references) {
        if (reference.identifier.type !== 'Identifier') continue
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

    /** @param {ExpressionSearch} args @returns {boolean} */
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
        const lastExpression = unwrapped.expressions.at(-1)
        if (!lastExpression) return false
        return expressionProducesObject({
          expression: lastExpression,
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

    /** @param {{ variable: AnalysisVariable, seenVariables: Set<AnalysisVariable> }} args @returns {boolean} */
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
        if (reference.identifier.type !== 'Identifier') continue
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

    /** @param {AstExpression} expression */
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

    /** @param {import('@typescript-eslint/types').TSESTree.SpreadElement} argument */
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

    /** @param {ExpressionSearch} args @returns {import('@typescript-eslint/types').TSESTree.ArrayExpression['elements']} */
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
        const lastExpression = unwrapped.expressions.at(-1)
        if (!lastExpression) return []
        return spreadArrayElements({
          expression: lastExpression,
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

    /** @param {ExpressionSearch} args @returns {{ value: AstExpression, seenVariables: Set<AnalysisVariable> }[]} */
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
        ...variable.references.flatMap((reference) => {
          if (
            !isNonInitialWriteReference(reference) ||
            !occursBeforeActiveCallSite(reference.identifier) ||
            !referenceCanReachActiveCall(reference)
          )
            return []
          const writeExpression = referenceWriteExpression(reference)
          return writeExpression.kind === VariableLookupKind.Found
            ? [writeExpression.expression]
            : []
        }),
      ].map((value) => ({ value, seenVariables: nextSeenVariables }))
    }

    /** @param {ExpressionSearch & { limit: number }} args @returns {ReturnType<typeof mergeArraySummaries>} */
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
        const lastExpression = unwrapped.expressions.at(-1)
        if (!lastExpression) {
          return { lengths: new Set([0]), values: new Map() }
        }
        return arrayProjectionSummary({
          expression: lastExpression,
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

    /** @param {import('@typescript-eslint/types').TSESTree.CallExpression | import('@typescript-eslint/types').TSESTree.NewExpression} node */
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
    /** @param {import('@typescript-eslint/types').TSESTree.CallExpression} node */
    function inspectCallArguments(node) {
      if (isDirectObjectArgumentRune(node)) {
        // Svelte compiler runes require direct placement and, for $derived,
        // direct reactive expression capture. A named intermediate either
        // fails compilation or freezes the initial value.
        return
      }
      inspectArguments(node)
    }
    const parameterContractListeners =
      context.options[0]?.enforceNamedParameterContracts === false
        ? {}
        : namedParameterContractListeners(context)
    return {
      ...parameterContractListeners,
      CallExpression: inspectCallArguments,
      NewExpression: inspectArguments,
    }
  },
}
