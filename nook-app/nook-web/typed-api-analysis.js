const transparentTypeScriptWrappers = new Set([
  'ChainExpression',
  'TSAsExpression',
  'TSTypeAssertion',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
])

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

export function unwrapTypeScriptExpression(expression) {
  let current = expression
  while (transparentTypeScriptWrappers.has(current.type)) {
    current = current.expression
  }
  return current
}

export function unwrapResultExpression(expression) {
  let current = unwrapTypeScriptExpression(expression)
  while (current.type === 'AwaitExpression') {
    current = unwrapTypeScriptExpression(current.argument)
  }
  return current
}

export function staticArrayAtAccessor(args) {
  const { expression, staticPropertyKey } = args
  if (
    expression.type !== 'CallExpression' ||
    expression.callee.type !== 'MemberExpression'
  ) {
    return { kind: StaticKeyLookupKind.NotFound }
  }
  const method = staticPropertyKey(expression.callee)
  if (
    method.value === 'pop' &&
    expression.arguments.length === 0
  ) {
    return {
      kind: StaticKeyLookupKind.Found,
      array: expression.callee.object,
      index: -1,
      limit: Number.POSITIVE_INFINITY,
    }
  }
  if (
    method.value === 'shift' &&
    expression.arguments.length === 0
  ) {
    return {
      kind: StaticKeyLookupKind.Found,
      array: expression.callee.object,
      index: 0,
      limit: 0,
    }
  }
  if (
    method.value !== 'at' ||
    expression.arguments.length !== 1 ||
    expression.arguments[0].type === 'SpreadElement'
  ) {
    return { kind: StaticKeyLookupKind.NotFound }
  }
  const index = unwrapResultExpression(expression.arguments[0])
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

export function arrayAtSummaryValues(args) {
  const { summary, index } = args
  const selected = new Set()
  for (const length of summary.lengths) {
    const selectedIndex = index < 0 ? length + index : index
    for (const value of summary.values.get(selectedIndex) ?? []) {
      selected.add(value)
    }
  }
  return [...selected]
}

export function executionScope(scope) {
  let current = scope
  while (
    current.upper &&
    current.type !== 'function' &&
    current.type !== 'module' &&
    current.type !== 'global'
  ) {
    current = current.upper
  }
  return current
}

export function scopeContains(args) {
  const { possibleAncestor, scope } = args
  let current = scope
  while (current) {
    if (current === possibleAncestor) return true
    current = current.upper
  }
  return false
}

export function isObjectRestBinding(pattern, target) {
  if (pattern.type !== 'ObjectPattern') return false
  return pattern.properties.some(
    (property) =>
      property.type === 'RestElement' && property.argument === target,
  )
}

export function bindingPatternHasTypeAnnotation(identifier) {
  let current = identifier
  while (current) {
    if (current.typeAnnotation) return true
    const parent = current.parent
    if (
      !parent ||
      ![
        'AssignmentPattern',
        'Property',
        'RestElement',
        'ObjectPattern',
        'ArrayPattern',
      ].includes(parent.type)
    ) {
      return false
    }
    current = parent
  }
  return false
}

export function objectPropertyValueExpressions(property) {
  if (property.kind === 'init') return [property.value]
  if (property.kind !== 'get' || property.value.type !== 'FunctionExpression')
    return []
  return functionReturnExpressions(property.value)
}

export function functionReturnExpressions(callable) {
  if (callable.body.type !== 'BlockStatement') return [callable.body]
  const expressions = []
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
    for (const [key, value] of Object.entries(node)) {
      if (key === 'parent') continue
      const children = Array.isArray(value) ? value : [value]
      for (const child of children) {
        if (
          child &&
          typeof child === 'object' &&
          typeof child.type === 'string'
        ) {
          visit(child)
        }
      }
    }
  }
  visit(callable.body)
  return expressions
}

export function inlineCallReturnExpressions(expression) {
  if (expression.type !== 'CallExpression') {
    return []
  }
  const callable = unwrapTypeScriptExpression(expression.callee)
  if (
    ['ArrowFunctionExpression', 'FunctionExpression'].includes(callable.type)
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
      !['ArrowFunctionExpression', 'FunctionExpression'].includes(
        property.value.type,
      )
    ) {
      return []
    }
    return functionReturnExpressions(property.value)
  })
}

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

export function thisClassFieldValueExpressions(args) {
  const { expression, staticObjectKey } = args
  if (expression.object.type !== 'ThisExpression') return []
  const selectedKey = inlineMemberKey(expression)
  if (selectedKey.kind === StaticKeyLookupKind.NotFound) return []
  let current = expression.parent
  while (current && current.type !== 'ClassBody') current = current.parent
  if (!current) return []
  return current.body.flatMap((field) =>
    field.type === 'PropertyDefinition' &&
    !field.typeAnnotation &&
    field.value &&
    staticObjectKey(field).value === selectedKey.value
      ? [field.value]
      : [],
  )
}

export function inlineObjectResultExpressions(args) {
  const {
    expression,
    projectMemberExpressions,
    projectArrayAccessorExpressions,
  } = args
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
      return visit(unwrapped.expressions.at(-1))
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

export function staticMemberPath(args) {
  const { expression, staticPropertyKey } = args
  const path = []
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

export function memberAssignmentPath(args) {
  const { identifier, staticPropertyKey } = args
  const path = []
  let current = identifier
  while (
    current.parent?.type === 'MemberExpression' &&
    current.parent.object === current
  ) {
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

export function staticExpressionKey(args) {
  const { expression, declaredVariable } = args
  if (
    expression.type === 'TemplateLiteral' &&
    expression.expressions.length === 0
  ) {
    return {
      kind: StaticKeyLookupKind.Found,
      value: expression.quasis[0].value.raw,
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

export function writeBindingPattern(identifier) {
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
    return namedResultAlternatives(unwrapped.expressions.at(-1))
  }
  return [unwrapped]
}

export function mergeArraySummaries(summaries) {
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

export function concatenateArraySummaries(args) {
  const { first, second, limit } = args
  const lengths = new Set()
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
    return (
      switchArmStatementTerminates(statement.consequent) &&
      Boolean(statement.alternate) &&
      switchArmStatementTerminates(statement.alternate)
    )
  }
  return false
}

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

export function nodesUseExclusiveBranches(args) {
  if (switchCasesAreExclusive(args)) return true
  const firstArms = branchArms(args.first)
  for (const [branch, arm] of branchArms(args.second)) {
    if (firstArms.has(branch) && firstArms.get(branch) !== arm) return true
  }
  return false
}

function statementAlwaysTerminates(statement) {
  if (!statement) return false
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
    return (
      statementAlwaysTerminates(statement.consequent) &&
      statementAlwaysTerminates(statement.alternate)
    )
  }
  return false
}

export function writeExitsBeforeFollowingNode(args) {
  const { write, following } = args
  let current = write
  while (current.parent) {
    const parent = current.parent
    if (
      parent.type === 'IfStatement' &&
      (current === parent.consequent || current === parent.alternate) &&
      statementAlwaysTerminates(current) &&
      (parent.range?.[1] ?? Number.POSITIVE_INFINITY) <=
        (following.range?.[0] ?? Number.NEGATIVE_INFINITY)
    ) {
      return true
    }
    current = parent
  }
  return false
}

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
