/** @typedef {import('@typescript-eslint/types').TSESTree.Node} AstNode */
/** @typedef {import('@typescript-eslint/types').NodeWithParent} AstNodeWithParent */
/** @typedef {import('@typescript-eslint/types').TSESTree.Expression} AstExpression */
/** @typedef {import('@typescript-eslint/types').TSESTree.Identifier} AstIdentifier */
/** @typedef {import('@typescript-eslint/types').TSESTree.MemberExpression} AstMemberExpression */
/** @typedef {import('@typescript-eslint/types').TSESTree.Property} AstProperty */
/** @typedef {import('@typescript-eslint/types').TSESTree.FunctionExpression | import('@typescript-eslint/types').TSESTree.ArrowFunctionExpression} AstCallable */
/** @typedef {import('@typescript-eslint/scope-manager').Scope} AnalysisScope */
/** @typedef {{ kind: 'not-found' } | { kind: 'found', value: string }} StaticStringLookup */
/** @typedef {{ kind: 'not-found' } | { kind: 'found', path: string[] }} ProjectionPathLookup */
/** @typedef {{ lengths: Set<number>, values: Map<number, Set<AstExpression>> }} ArraySummary */

export const VariableLookupKind = Object.freeze({
  NotFound: 'not-found',
  Found: 'found',
})

export const StaticKeyLookupKind = Object.freeze({
  NotFound: 'not-found',
  Found: 'found',
})

export const ProjectionPathLookupKind = Object.freeze({
  NotFound: 'not-found',
  Found: 'found',
})

export const ActiveCallScopeKind = Object.freeze({
  Inactive: 'inactive',
  Active: 'active',
})

/** @param {AstExpression} expression @returns {AstExpression} */
export function unwrapTypeScriptExpression(expression) {
  let current = expression
  while (
    current.type === 'ChainExpression' ||
    current.type === 'TSAsExpression' ||
    current.type === 'TSTypeAssertion' ||
    current.type === 'TSSatisfiesExpression' ||
    current.type === 'TSNonNullExpression'
  ) {
    current = current.expression
  }
  return current
}

/** @param {AstExpression} expression @returns {AstExpression} */
export function unwrapResultExpression(expression) {
  let current = unwrapTypeScriptExpression(expression)
  while (current.type === 'AwaitExpression') {
    current = unwrapTypeScriptExpression(current.argument)
  }
  return current
}

/**
 * @param {{ expression: AstExpression, staticPropertyKey: (member: AstMemberExpression) => StaticStringLookup }} args
 */
export function staticArrayAtAccessor(args) {
  const { expression, staticPropertyKey } = args
  if (
    expression.type !== 'CallExpression' ||
    expression.callee.type !== 'MemberExpression'
  ) {
    return { kind: StaticKeyLookupKind.NotFound }
  }
  const method = staticPropertyKey(expression.callee)
  if (method.kind === StaticKeyLookupKind.NotFound) return method
  if (method.value === 'pop' && expression.arguments.length === 0) {
    return {
      kind: StaticKeyLookupKind.Found,
      array: expression.callee.object,
      index: -1,
      limit: Number.POSITIVE_INFINITY,
    }
  }
  if (method.value === 'shift' && expression.arguments.length === 0) {
    return {
      kind: StaticKeyLookupKind.Found,
      array: expression.callee.object,
      index: 0,
      limit: 0,
    }
  }
  if (method.value !== 'at' || expression.arguments.length !== 1) {
    return { kind: StaticKeyLookupKind.NotFound }
  }
  const indexArgument = expression.arguments[0]
  if (!indexArgument || indexArgument.type === 'SpreadElement') {
    return { kind: StaticKeyLookupKind.NotFound }
  }
  const index = unwrapResultExpression(indexArgument)
  const value =
    index.type === 'Literal' && typeof index.value === 'number'
      ? index.value
      : index.type === 'UnaryExpression' &&
          index.operator === '-' &&
          index.argument.type === 'Literal' &&
          typeof index.argument.value === 'number'
        ? -index.argument.value
        : Number.NaN
  return Number.isInteger(value)
    ? {
        kind: StaticKeyLookupKind.Found,
        array: expression.callee.object,
        index: value,
        limit: value < 0 ? Number.POSITIVE_INFINITY : value,
      }
    : { kind: StaticKeyLookupKind.NotFound }
}

/** @param {{ summary: ArraySummary, index: number }} args */
export function arrayAtSummaryValues(args) {
  const { summary, index } = args
  /** @type {Set<AstExpression>} */
  const selected = new Set()
  for (const length of summary.lengths) {
    const selectedIndex = index < 0 ? length + index : index
    for (const value of ((v) => (v ? v : []))(
      summary.values.get(selectedIndex),
    )) {
      selected.add(value)
    }
  }
  return [...selected]
}

/** @param {AnalysisScope} scope @returns {AnalysisScope} */
export function executionScope(scope) {
  let current = scope
  while (
    current.upper &&
    current.type !== 'function' &&
    current.type !== 'module'
  ) {
    current = current.upper
  }
  return current
}

/** @param {{ possibleAncestor: AnalysisScope, scope: AnalysisScope }} args */
export function scopeContains(args) {
  const { possibleAncestor, scope } = args
  let current = scope
  while (current) {
    if (current === possibleAncestor) return true
    const upper = current.upper
    if (!upper) return false
    current = upper
  }
  return false
}

/**
 * @param {import('@typescript-eslint/types').TSESTree.BindingName} pattern
 * @param {AstIdentifier} target
 */
export function isObjectRestBinding(pattern, target) {
  if (pattern.type !== 'ObjectPattern') return false
  return pattern.properties.some(
    (property) =>
      property.type === 'RestElement' && property.argument === target,
  )
}

/** @param {AstIdentifier} identifier */
export function bindingPatternHasTypeAnnotation(identifier) {
  /** @type {AstNodeWithParent} */
  let current = identifier
  while (current) {
    if ('typeAnnotation' in current && current.typeAnnotation) return true
    /** @type {AstNode} */
    const parent = current.parent
    if (
      parent.type !== 'AssignmentPattern' &&
      parent.type !== 'Property' &&
      parent.type !== 'RestElement' &&
      parent.type !== 'ObjectPattern' &&
      parent.type !== 'ArrayPattern'
    ) {
      return false
    }
    current = parent
  }
  return false
}

/** @param {AstProperty} property @returns {AstExpression[]} */
export function objectPropertyValueExpressions(property) {
  if (property.parent.type !== 'ObjectExpression') return []
  if (
    property.value.type === 'ObjectPattern' ||
    property.value.type === 'ArrayPattern' ||
    property.value.type === 'AssignmentPattern' ||
    property.value.type === 'TSEmptyBodyFunctionExpression'
  ) {
    return []
  }
  if (property.kind === 'init') return [property.value]
  if (property.kind !== 'get' || property.value.type !== 'FunctionExpression')
    return []
  return functionReturnExpressions(property.value)
}

/** @param {AstCallable} callable @returns {AstExpression[]} */
export function functionReturnExpressions(callable) {
  if (callable.body.type !== 'BlockStatement') return [callable.body]
  /** @type {AstExpression[]} */
  const expressions = []
  /** @param {AstNode} node */
  function visit(node) {
    if (node.type === 'ReturnStatement') {
      if (node.argument) expressions.push(node.argument)
      return
    }
    if (
      node !== callable.body &&
      [
        'FunctionDeclaration',
        'FunctionExpression',
        'ArrowFunctionExpression',
      ].includes(node.type)
    ) {
      return
    }
    if (node.type === 'BlockStatement' || node.type === 'Program') {
      for (const statement of node.body) visit(statement)
      return
    }
    if (node.type === 'IfStatement') {
      visit(node.consequent)
      if (node.alternate) visit(node.alternate)
      return
    }
    if (node.type === 'SwitchStatement') {
      for (const branch of node.cases) {
        for (const statement of branch.consequent) visit(statement)
      }
      return
    }
    if (node.type === 'TryStatement') {
      visit(node.block)
      if (node.handler) visit(node.handler.body)
      if (node.finalizer) visit(node.finalizer)
      return
    }
    if (
      node.type === 'DoWhileStatement' ||
      node.type === 'ForInStatement' ||
      node.type === 'ForOfStatement' ||
      node.type === 'ForStatement' ||
      node.type === 'LabeledStatement' ||
      node.type === 'WhileStatement' ||
      node.type === 'WithStatement'
    ) {
      visit(node.body)
    }
  }
  visit(callable.body)
  return expressions
}

/** @param {AstExpression} expression @returns {AstExpression[]} */
export function inlineCallReturnExpressions(expression) {
  if (expression.type !== 'CallExpression') {
    return []
  }
  const callable = unwrapTypeScriptExpression(expression.callee)
  if (
    callable.type === 'ArrowFunctionExpression' ||
    callable.type === 'FunctionExpression'
  ) {
    return functionReturnExpressions(callable)
  }
  if (callable.type !== 'MemberExpression') return []
  const container = unwrapTypeScriptExpression(callable.object)
  if (container.type !== 'ObjectExpression') return []
  const selectedKey = inlineMemberKey(callable)
  if (selectedKey.kind === StaticKeyLookupKind.NotFound) return []
  return container.properties.flatMap((property) => {
    const propertyKey =
      property.type === 'Property'
        ? inlinePropertyKey(property)
        : { kind: StaticKeyLookupKind.NotFound }
    if (
      property.type !== 'Property' ||
      propertyKey.kind === StaticKeyLookupKind.NotFound ||
      propertyKey.value !== selectedKey.value ||
      (property.value.type !== 'ArrowFunctionExpression' &&
        property.value.type !== 'FunctionExpression')
    ) {
      return []
    }
    return functionReturnExpressions(property.value)
  })
}

/** @param {AstMemberExpression} member @returns {StaticStringLookup} */
function inlineMemberKey(member) {
  if (!member.computed && member.property.type === 'Identifier') {
    return { kind: StaticKeyLookupKind.Found, value: member.property.name }
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

/** @param {AstProperty} property @returns {StaticStringLookup} */
function inlinePropertyKey(property) {
  if (!property.computed && property.key.type === 'Identifier') {
    return { kind: StaticKeyLookupKind.Found, value: property.key.name }
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

/**
 * @param {{ expression: AstMemberExpression, staticObjectKey: (property: import('@typescript-eslint/types').TSESTree.PropertyDefinition) => StaticStringLookup }} args
 * @returns {AstExpression[]}
 */
export function thisClassFieldValueExpressions(args) {
  const { expression, staticObjectKey } = args
  if (expression.object.type !== 'ThisExpression') return []
  const selectedKey = inlineMemberKey(expression)
  if (selectedKey.kind === StaticKeyLookupKind.NotFound) return []
  /** @type {AstNode} */
  let current = expression.parent
  while (current.type !== 'ClassBody') {
    if (current.type === 'Program') return []
    current = current.parent
  }
  return current.body.flatMap((field) => {
    if (
      field.type !== 'PropertyDefinition' ||
      field.typeAnnotation ||
      !field.value
    ) {
      return []
    }
    const fieldKey = staticObjectKey(field)
    return fieldKey.kind === StaticKeyLookupKind.Found &&
      fieldKey.value === selectedKey.value
      ? [field.value]
      : []
  })
}

/**
 * @param {{ expression: AstExpression, projectMemberExpressions: (args: { expression: AstMemberExpression, seenVariables: Set<import('@typescript-eslint/scope-manager').Variable> }) => AstExpression[], projectArrayAccessorExpressions: (expression: AstExpression) => AstExpression[] }} args
 * @returns {AstExpression[]}
 */
export function inlineObjectResultExpressions(args) {
  const {
    expression,
    projectMemberExpressions,
    projectArrayAccessorExpressions,
  } = args
  /** @param {AstExpression} selected @returns {AstExpression[]} */
  function visit(selected) {
    const unwrapped = unwrapResultExpression(selected)
    if (unwrapped.type === 'ObjectExpression') return [selected]
    if (unwrapped.type === 'AssignmentExpression') return visit(unwrapped.right)
    if (unwrapped.type === 'ConditionalExpression') {
      return [...visit(unwrapped.consequent), ...visit(unwrapped.alternate)]
    }
    if (unwrapped.type === 'LogicalExpression') {
      return [...visit(unwrapped.left), ...visit(unwrapped.right)]
    }
    if (unwrapped.type === 'SequenceExpression') {
      const lastExpression = unwrapped.expressions.at(-1)
      return lastExpression ? visit(lastExpression) : []
    }
    if (unwrapped.type === 'MemberExpression') {
      return projectMemberExpressions({
        expression: unwrapped,
        seenVariables: new Set(),
      }).flatMap(visit)
    }
    return [
      ...projectArrayAccessorExpressions(unwrapped),
      ...inlineCallReturnExpressions(unwrapped),
    ].flatMap(visit)
  }
  return visit(expression)
}

/**
 * @param {{ expression: AstMemberExpression, staticPropertyKey: (member: AstMemberExpression) => StaticStringLookup }} args
 */
export function staticMemberPath(args) {
  const { expression, staticPropertyKey } = args
  const path = []
  /** @type {AstExpression} */
  let current = expression
  while (current.type === 'MemberExpression') {
    const key = staticPropertyKey(current)
    if (key.kind === StaticKeyLookupKind.NotFound) return key
    path.unshift(key.value)
    current = current.object
  }
  if (current.type !== 'Identifier') {
    return { kind: ProjectionPathLookupKind.NotFound }
  }
  return { kind: ProjectionPathLookupKind.Found, root: current, path }
}

/**
 * @param {{ identifier: AstIdentifier, staticPropertyKey: (member: AstMemberExpression) => StaticStringLookup }} args
 */
export function memberAssignmentPath(args) {
  const { identifier, staticPropertyKey } = args
  const path = []
  /** @type {AstNode} */
  let current = identifier
  while (
    current.parent?.type === 'MemberExpression' &&
    current.parent.object === current
  ) {
    /** @type {AstMemberExpression} */
    const member = current.parent
    const key = staticPropertyKey(member)
    if (key.kind === StaticKeyLookupKind.NotFound) return key
    path.push(key.value)
    current = member
  }
  const assignment = current.parent
  if (
    assignment?.type !== 'AssignmentExpression' ||
    assignment.left !== current
  ) {
    return { kind: ProjectionPathLookupKind.NotFound }
  }
  return {
    kind: ProjectionPathLookupKind.Found,
    assignment,
    path,
  }
}

/**
 * @param {{ expression: AstExpression, declaredVariable: (identifier: AstIdentifier) => ({ kind: 'not-found' } | { kind: 'found', variable: import('@typescript-eslint/scope-manager').Variable }) }} args
 * @returns {StaticStringLookup}
 */
export function staticExpressionKey(args) {
  const { expression, declaredVariable } = args
  if (
    expression.type === 'TemplateLiteral' &&
    expression.expressions.length === 0
  ) {
    const quasi = expression.quasis[0]
    if (!quasi) return { kind: StaticKeyLookupKind.NotFound }
    return {
      kind: StaticKeyLookupKind.Found,
      value: quasi.value.raw,
    }
  }
  if (
    expression.type === 'Literal' &&
    (typeof expression.value === 'string' ||
      typeof expression.value === 'number')
  ) {
    return { kind: StaticKeyLookupKind.Found, value: String(expression.value) }
  }
  if (expression.type !== 'Identifier') {
    return { kind: StaticKeyLookupKind.NotFound }
  }
  const lookup = declaredVariable(expression)
  if (lookup.kind === VariableLookupKind.NotFound) return lookup
  for (const definition of lookup.variable.defs) {
    if (
      definition.type === 'Variable' &&
      definition.node.type === 'VariableDeclarator' &&
      definition.parent?.kind === 'const' &&
      definition.node.init
    ) {
      return staticExpressionKey({
        expression: definition.node.init,
        declaredVariable,
      })
    }
  }
  return { kind: StaticKeyLookupKind.NotFound }
}

/** @param {string} method */
export function arrayCallbackElementParameter(method) {
  if (method === 'reduce' || method === 'reduceRight') {
    return { kind: StaticKeyLookupKind.Found, value: 1 }
  }
  if (
    [
      'every',
      'filter',
      'find',
      'findIndex',
      'findLast',
      'findLastIndex',
      'flatMap',
      'forEach',
      'map',
      'some',
    ].includes(method)
  ) {
    return { kind: StaticKeyLookupKind.Found, value: 0 }
  }
  return { kind: StaticKeyLookupKind.NotFound }
}

/** @param {AstIdentifier} identifier */
export function writeBindingPattern(identifier) {
  /** @type {AstNode} */
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

/**
 * @param {{ pattern: import('@typescript-eslint/types').TSESTree.DestructuringPattern | import('@typescript-eslint/types').TSESTree.TSParameterProperty, target: AstIdentifier, staticObjectKey: (property: AstProperty) => StaticStringLookup }} args
 * @returns {ProjectionPathLookup}
 */
export function bindingProjectionPath(args) {
  const { pattern, target, staticObjectKey } = args
  if (pattern === target) {
    return { kind: ProjectionPathLookupKind.Found, path: [] }
  }
  if (pattern.type === 'TSParameterProperty') {
    return bindingProjectionPath({
      pattern: pattern.parameter,
      target,
      staticObjectKey,
    })
  }
  if (pattern.type === 'AssignmentPattern') {
    return bindingProjectionPath({
      pattern: pattern.left,
      target,
      staticObjectKey,
    })
  }
  if (pattern.type === 'RestElement' || pattern.type === 'MemberExpression') {
    return { kind: ProjectionPathLookupKind.NotFound }
  }
  if (pattern.type === 'ObjectPattern') {
    for (const property of pattern.properties) {
      if (property.type !== 'Property') continue
      if (
        property.value.type !== 'AssignmentPattern' &&
        property.value.type !== 'ArrayPattern' &&
        property.value.type !== 'Identifier' &&
        property.value.type !== 'MemberExpression' &&
        property.value.type !== 'ObjectPattern'
      )
        continue
      const childLookup = bindingProjectionPath({
        pattern: property.value,
        target,
        staticObjectKey,
      })
      if (childLookup.kind === ProjectionPathLookupKind.NotFound) continue
      const keyLookup = staticObjectKey(property)
      if (keyLookup.kind === StaticKeyLookupKind.NotFound) return keyLookup
      return {
        kind: ProjectionPathLookupKind.Found,
        path: [keyLookup.value, ...childLookup.path],
      }
    }
  }
  if (pattern.type === 'ArrayPattern') {
    for (const [index, element] of pattern.elements.entries()) {
      if (!element) continue
      const childLookup = bindingProjectionPath({
        pattern: element,
        target,
        staticObjectKey,
      })
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

/** @param {AstExpression} expression @returns {AstExpression[]} */
export function namedResultAlternatives(expression) {
  const unwrapped = unwrapResultExpression(expression)
  if (unwrapped.type === 'AssignmentExpression') {
    return namedResultAlternatives(unwrapped.right)
  }
  if (unwrapped.type === 'ConditionalExpression') {
    return [
      ...namedResultAlternatives(unwrapped.consequent),
      ...namedResultAlternatives(unwrapped.alternate),
    ]
  }
  if (unwrapped.type === 'LogicalExpression') {
    return [
      ...namedResultAlternatives(unwrapped.left),
      ...namedResultAlternatives(unwrapped.right),
    ]
  }
  if (unwrapped.type === 'SequenceExpression') {
    const lastExpression = unwrapped.expressions.at(-1)
    return lastExpression ? namedResultAlternatives(lastExpression) : []
  }
  return [unwrapped]
}

/** @param {ArraySummary[]} summaries @returns {ArraySummary} */
export function mergeArraySummaries(summaries) {
  /** @type {ArraySummary} */
  const merged = { lengths: new Set(), values: new Map() }
  for (const summary of summaries) {
    for (const length of summary.lengths) merged.lengths.add(length)
    for (const [index, values] of summary.values) {
      const selected = merged.values.get(index) ?? new Set()
      for (const value of values) selected.add(value)
      merged.values.set(index, selected)
    }
  }
  return merged
}

/** @param {{ first: ArraySummary, second: ArraySummary, limit: number }} args @returns {ArraySummary} */
export function concatenateArraySummaries(args) {
  const { first, second, limit } = args
  /** @type {Set<number>} */
  const lengths = new Set()
  /** @type {Map<number, Set<AstExpression>>} */
  const values = new Map(
    [...first.values].map(([index, selected]) => [index, new Set(selected)]),
  )
  for (const firstLength of first.lengths) {
    for (const secondLength of second.lengths) {
      lengths.add(Math.min(limit + 1, firstLength + secondLength))
    }
    for (const [index, selectedValues] of second.values) {
      const shiftedIndex = firstLength + index
      if (shiftedIndex > limit) continue
      const shiftedValues = values.get(shiftedIndex) ?? new Set()
      for (const value of selectedValues) shiftedValues.add(value)
      values.set(shiftedIndex, shiftedValues)
    }
  }
  return { lengths, values }
}

/** @param {AstNode} node */
function branchArms(node) {
  const arms = new Map()
  let current = node
  while (current.parent) {
    const parent = current.parent
    if (
      (parent.type === 'IfStatement' ||
        parent.type === 'ConditionalExpression') &&
      (current === parent.consequent || current === parent.alternate)
    ) {
      arms.set(parent, current === parent.consequent ? 'yes' : 'no')
    }
    current = parent
  }
  return arms
}

/** @param {AstNode} node */
function enclosingSwitchCase(node) {
  let current = node
  while (current.parent) {
    if (
      current.type === 'SwitchCase' &&
      current.parent.type === 'SwitchStatement'
    ) {
      return { kind: StaticKeyLookupKind.Found, value: current }
    }
    current = current.parent
  }
  return { kind: StaticKeyLookupKind.NotFound }
}

/** @param {AstNode} statement @returns {boolean} */
function switchArmStatementTerminates(statement) {
  if (
    (statement.type === 'BreakStatement' && !statement.label) ||
    statement.type === 'ReturnStatement' ||
    statement.type === 'ThrowStatement'
  ) {
    return true
  }
  if (statement.type === 'BlockStatement') {
    return statement.body.some(switchArmStatementTerminates)
  }
  if (statement.type === 'IfStatement') {
    if (!statement.alternate) return false
    return (
      switchArmStatementTerminates(statement.consequent) &&
      switchArmStatementTerminates(statement.alternate)
    )
  }
  return false
}

/** @param {{ first: AstNode, second: AstNode }} args */
function switchCasesAreExclusive(args) {
  const first = enclosingSwitchCase(args.first)
  const second = enclosingSwitchCase(args.second)
  if (
    first.kind === StaticKeyLookupKind.NotFound ||
    second.kind === StaticKeyLookupKind.NotFound ||
    first.value.parent !== second.value.parent ||
    first.value === second.value
  ) {
    return false
  }
  const cases = first.value.parent.cases
  return (
    cases.indexOf(first.value) < cases.indexOf(second.value) &&
    first.value.consequent.some(switchArmStatementTerminates)
  )
}

/** @param {{ first: AstNode, second: AstNode }} args */
export function nodesUseExclusiveBranches(args) {
  if (switchCasesAreExclusive(args)) return true
  const firstArms = branchArms(args.first)
  for (const [branch, arm] of branchArms(args.second)) {
    if (firstArms.has(branch) && firstArms.get(branch) !== arm) return true
  }
  return false
}

/** @param {AstNode} statement @returns {boolean} */
function statementAlwaysTerminates(statement) {
  if (
    statement.type === 'ReturnStatement' ||
    statement.type === 'ThrowStatement'
  ) {
    return true
  }
  if (statement.type === 'BlockStatement') {
    return statement.body.some(statementAlwaysTerminates)
  }
  if (statement.type === 'IfStatement') {
    if (!statement.alternate) return false
    return (
      statementAlwaysTerminates(statement.consequent) &&
      statementAlwaysTerminates(statement.alternate)
    )
  }
  return false
}

/** @param {{ write: AstNode, following: AstNode }} args */
export function writeExitsBeforeFollowingNode(args) {
  const { write, following } = args
  let current = write
  while (current.parent) {
    const parent = current.parent
    if (
      parent.type === 'IfStatement' &&
      (current === parent.consequent || current === parent.alternate) &&
      statementAlwaysTerminates(current) &&
      ((...[v = Number.POSITIVE_INFINITY]) => v)(parent.range?.[1]) <=
        ((...[v = Number.NEGATIVE_INFINITY]) => v)(following.range?.[0])
    ) {
      return true
    }
    current = parent
  }
  return false
}

/** @param {string | number} key */
export function staticArrayIndex(key) {
  const maximumArrayIndex = 2 ** 32 - 2
  const value =
    typeof key === 'number'
      ? key
      : String(Number(key)) === key
        ? Number(key)
        : Number.NaN
  if (Number.isInteger(value) && value >= 0 && value <= maximumArrayIndex) {
    return { kind: StaticKeyLookupKind.Found, value }
  }
  return { kind: StaticKeyLookupKind.NotFound }
}
