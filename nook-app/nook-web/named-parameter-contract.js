const transparentParameterContractWrappers = new Set([
  "Partial",
  "Readonly",
  "Required",
]);
const inlineCollectionParameterTypes = new Set(["Array", "ReadonlyArray"]);
const inlineObjectParameterTypes = new Set([
  "Map",
  "ReadonlyMap",
  "ReadonlySet",
  "Record",
  "Set",
  "WeakMap",
  "WeakSet",
]);
const inlineMappedParameterTypes = new Set(["Omit", "Pick"]);
const objectRuntimeDefaultNames = new Set([
  "document",
  "globalThis",
  "navigator",
  "window",
]);
const scalarTypeBoundaryTypes = new Set([
  "TSIndexedAccessType",
  "TSTypeOperator",
]);

/** @typedef {import('@typescript-eslint/types').TSESTree.Node} AstNode */
/** @typedef {import('@typescript-eslint/types').NodeWithParent} AstNodeWithParent */
/** @typedef {import('@typescript-eslint/types').TSESTree.Expression} AstExpression */
/** @typedef {import('@typescript-eslint/types').TSESTree.TypeNode} AstTypeNode */
/** @typedef {import('@typescript-eslint/types').TSESTree.EntityName} AstTypeName */
/** @typedef {import('@typescript-eslint/types').TSESTree.ProgramStatement} AstDeclarationStatement */
/** @typedef {import('@typescript-eslint/types').TSESTree.TSTypeAliasDeclaration | import('@typescript-eslint/types').TSESTree.TSInterfaceDeclaration | import('@typescript-eslint/types').TSESTree.TSEnumDeclaration | import('@typescript-eslint/types').TSESTree.TSModuleDeclaration} AstTypeDeclaration */
/** @typedef {import('@typescript-eslint/utils').TSESLint.SourceCode} TypedSourceCode */
/** @typedef {'namedParameterType' | 'namedParameterDefault' | 'semanticParameterType'} NamedParameterMessageId */
/** @typedef {import('@typescript-eslint/utils').TSESLint.RuleContext<NamedParameterMessageId, readonly [{ enforceNamedParameterContracts?: boolean }] >} TypedRuleContext */
/** @typedef {{ kind: 'not-found' } | { kind: 'found', declaration: AstTypeDeclaration }} TypeDeclarationLookup */

const ParameterBindingLookupKind = Object.freeze({
  Found: "found",
  NotFound: "not-found",
});
const TypeDeclarationLookupKind = Object.freeze({
  Found: "found",
  NotFound: "not-found",
});

const genericParameterContractNames = new Set([
  "Args",
  "Arguments",
  "CallbackArgs",
  "Candidate",
  "CandidateArgs",
  "Config",
  "Configuration",
  "Context",
  "Data",
  "FunctionArgs",
  "Input",
  "Inputs",
  "Item",
  "Items",
  "MethodArgs",
  "Object",
  "Options",
  "Parameters",
  "Params",
  "Payload",
  "Query",
  "QueryArgs",
  "Record",
  "Request",
  "Response",
  "RespondArgs",
  "Result",
  "SetStatusArgs",
  "State",
  "TArgs",
  "Value",
  "Values",
  "CreateButtonArgs",
  "LookupArgs",
  "PadArgs",
]);

const genericParameterOperationName =
  /^(?:Branch|Build|Check|Collect|Columns|Create|Decode|Delete|Encode|Execute|Fetch|Find|Get|Handle|Hits|Load|Make|Merge|Parse|Pick|Process|Put|Read|Resolve|Run|Save|Set|Store|Update|Validate|Write)(?:Args|Arguments|Config|Context|Data|Input|Options|Parameters|Params|Payload|Request|Result|State|Value)$/u;
const lineDerivedParameterContractName =
  /(?:NookTyped)?(?:Args|Arguments|Parameters|Params)[_\d]/u;

/** @param {string} name */
function isGenericParameterContractName(name) {
  return (
    genericParameterContractNames.has(name) ||
    genericParameterOperationName.test(name) ||
    lineDerivedParameterContractName.test(name)
  );
}

/** @param {import('@typescript-eslint/types').TSESTree.TSTypeAnnotation} annotation */
function parameterOwnsTypeAnnotation(annotation) {
  /** @type {AstNode} */
  let current = annotation.parent;
  while (
    current?.parent &&
    (current.parent.type === "AssignmentPattern" ||
      current.parent.type === "RestElement" ||
      current.parent.type === "TSParameterProperty")
  ) {
    current = current.parent;
  }
  const parent = current.parent;
  return Boolean(
    parent &&
    "params" in parent &&
    parent.params.some((parameter) => parameter === current),
  );
}

/** @param {import('@typescript-eslint/types').TSESTree.TSTypeReference | import('@typescript-eslint/types').TSESTree.TSTypeQuery | import('@typescript-eslint/types').TSESTree.TSImportType} node */
function referencedTypeIsParameterContract(node) {
  /** @type {AstNodeWithParent} */
  let current = node;
  while (current.parent) {
    if (current.parent.type === "TSTypeAnnotation") {
      return parameterOwnsTypeAnnotation(current.parent);
    }
    if (
      current.parent.type === "TSTypeParameterInstantiation" &&
      current.parent.parent?.type === "TSTypeReference" &&
      current.parent.params.includes(current) &&
      transparentParameterContractWrappers.has(
        referencedTypeName(current.parent.parent.typeName),
      )
    ) {
      current = current.parent.parent;
      continue;
    }
    if (
      (current.parent.type === "TSIntersectionType" ||
        current.parent.type === "TSUnionType") &&
      current.parent.types.includes(current)
    ) {
      current = current.parent;
      continue;
    }
    return false;
  }
  return false;
}

/** @param {AstTypeName} typeName @returns {string} */
function referencedTypeName(typeName) {
  let current = typeName;
  while (current.type === "TSQualifiedName") {
    current = current.right;
  }
  return current.type === "Identifier" ? current.name : "";
}

/** @param {AstTypeName} typeName @returns {string[]} */
function referencedTypeNameParts(typeName) {
  if (typeName.type === "Identifier") return [typeName.name];
  if (typeName.type === "ThisExpression") return [];
  return [
    ...referencedTypeNameParts(typeName.left),
    ...referencedTypeNameParts(typeName.right),
  ];
}

/**
 * @param {AstDeclarationStatement[]} statements
 * @param {string[]} nameParts
 * @returns {TypeDeclarationLookup}
 */
function declarationInStatements(statements, nameParts) {
  const [name, ...remaining] = nameParts;
  const declaration = statements
    .map((statement) =>
      statement.type === "ExportNamedDeclaration" && statement.declaration
        ? statement.declaration
        : statement,
    )
    .find(
      (statement) =>
        (statement.type === "TSTypeAliasDeclaration" ||
          statement.type === "TSInterfaceDeclaration" ||
          statement.type === "TSEnumDeclaration" ||
          statement.type === "TSModuleDeclaration") &&
        statement.id.type === "Identifier" &&
        statement.id.name === name,
    );
  if (
    !declaration ||
    (declaration.type !== "TSTypeAliasDeclaration" &&
      declaration.type !== "TSInterfaceDeclaration" &&
      declaration.type !== "TSEnumDeclaration" &&
      declaration.type !== "TSModuleDeclaration")
  ) {
    return { kind: TypeDeclarationLookupKind.NotFound };
  }
  if (remaining.length === 0) {
    return { kind: TypeDeclarationLookupKind.Found, declaration };
  }
  if (
    declaration.type !== "TSModuleDeclaration" ||
    declaration.body?.type !== "TSModuleBlock"
  ) {
    return { kind: TypeDeclarationLookupKind.NotFound };
  }
  return declarationInStatements(declaration.body.body, remaining);
}

/**
 * @param {import('@typescript-eslint/types').TSESTree.TSTypeReference} node
 * @returns {TypeDeclarationLookup}
 */
function referencedTypeDeclaration(node) {
  const nameParts = referencedTypeNameParts(node.typeName);
  /** @type {AstNode} */
  let current = node;
  while (current.type !== "Program") {
    if (current.type === "TSModuleBlock") {
      const lookup = declarationInStatements(current.body, nameParts);
      if (lookup.kind === TypeDeclarationLookupKind.Found) return lookup;
    }
    current = current.parent;
  }
  const lookup = declarationInStatements(current.body, nameParts);
  if (lookup.kind === TypeDeclarationLookupKind.Found) return lookup;
  return { kind: TypeDeclarationLookupKind.NotFound };
}

/**
 * @param {AstTypeNode} node
 * @param {Set<string>} [seenNames]
 * @returns {boolean}
 */
function typeAnnotationIsObjectShaped(node, seenNames = new Set()) {
  if (
    node.type === "TSTypeLiteral" ||
    node.type === "TSMappedType" ||
    node.type === "TSArrayType" ||
    node.type === "TSTupleType"
  ) {
    return true;
  }
  if (node.type === "TSUnionType" || node.type === "TSIntersectionType") {
    return node.types.some((candidate) =>
      typeAnnotationIsObjectShaped(candidate, seenNames),
    );
  }
  if (node.type !== "TSTypeReference") return false;
  const name = referencedTypeName(node.typeName);
  if (
    inlineCollectionParameterTypes.has(name) ||
    inlineObjectParameterTypes.has(name) ||
    inlineMappedParameterTypes.has(name)
  ) {
    return true;
  }
  if (seenNames.has(name)) return false;
  const lookup = referencedTypeDeclaration(node);
  if (lookup.kind === TypeDeclarationLookupKind.NotFound) return false;
  return typeDeclarationIsObjectShaped(
    lookup.declaration,
    new Set(seenNames).add(name),
  );
}

/**
 * @param {AstTypeDeclaration} declaration
 * @param {Set<string>} seenNames
 * @returns {boolean}
 */
function typeDeclarationIsObjectShaped(declaration, seenNames) {
  if (declaration.type === "TSInterfaceDeclaration") return true;
  if (declaration.type !== "TSTypeAliasDeclaration") return false;
  return typeAnnotationIsObjectShaped(declaration.typeAnnotation, seenNames);
}

/**
 * @param {import('@typescript-eslint/types').TSESTree.TSTypeQuery} node
 * @param {TypedSourceCode} sourceCode
 */
function typeQueryIsObjectShaped(node, sourceCode) {
  if (node.exprName.type !== "Identifier") return false;
  let scope = sourceCode.getScope(node.exprName);
  while (scope) {
    const variable = scope.set.get(node.exprName.name);
    if (variable) {
      const definition = variable.defs.find(
        (candidate) =>
          candidate.type === "Variable" &&
          candidate.node.type === "VariableDeclarator",
      );
      if (
        !definition ||
        definition.type !== "Variable" ||
        definition.node.type !== "VariableDeclarator"
      )
        return false;
      if (
        "typeAnnotation" in definition.name &&
        definition.name.typeAnnotation &&
        typeAnnotationIsObjectShaped(
          definition.name.typeAnnotation.typeAnnotation,
        )
      ) {
        return true;
      }
      return Boolean(
        definition.node.init &&
        defaultObjectExpressions(definition.node.init, sourceCode).length,
      );
    }
    const upper = scope.upper;
    if (!upper) return false;
    scope = upper;
  }
  return false;
}

/** @param {AstNodeWithParent} node */
function enclosingParameterBinding(node) {
  let current = node;
  const bindingContainers = new Set([
    "ArrayPattern",
    "AssignmentPattern",
    "ObjectPattern",
    "Property",
    "RestElement",
    "TSParameterProperty",
  ]);
  while (current.parent) {
    const parent = current.parent;
    if (
      "params" in parent &&
      parent.params.some((parameter) => parameter === current)
    ) {
      return { kind: ParameterBindingLookupKind.Found, parameter: current };
    }
    if (!bindingContainers.has(parent.type)) {
      return { kind: ParameterBindingLookupKind.NotFound };
    }
    if (parent.type === "Program") {
      return { kind: ParameterBindingLookupKind.NotFound };
    }
    current = parent;
  }
  return { kind: ParameterBindingLookupKind.NotFound };
}

/** @returns {AstExpression[]} */
function defaultObjectExpressions(
  /** @type {AstExpression} */
  expression,
  /** @type {TypedSourceCode} */
  sourceCode,
  /** @type {Set<import('@typescript-eslint/scope-manager').Variable>} */
  seenVariables = new Set(),
) {
  let current = expression;
  while (
    current.type === "ChainExpression" ||
    current.type === "TSAsExpression" ||
    current.type === "TSNonNullExpression" ||
    current.type === "TSSatisfiesExpression" ||
    current.type === "TSTypeAssertion"
  ) {
    current = current.expression;
  }
  if (
    current.type === "ObjectExpression" ||
    current.type === "ArrayExpression" ||
    current.type === "NewExpression"
  ) {
    return [current];
  }
  if (current.type === "Identifier") {
    let scope = sourceCode.getScope(current);
    while (scope) {
      const variable = scope.set.get(current.name);
      if (variable) {
        if (seenVariables.has(variable)) return [];
        const definition = variable.defs.find(
          (candidate) =>
            candidate.type === "Variable" &&
            candidate.node.type === "VariableDeclarator",
        );
        if (
          !definition ||
          definition.type !== "Variable" ||
          definition.node.type !== "VariableDeclarator"
        )
          return [];
        if (
          "typeAnnotation" in definition.name &&
          definition.name.typeAnnotation &&
          typeAnnotationIsObjectShaped(
            definition.name.typeAnnotation.typeAnnotation,
          )
        ) {
          return [current];
        }
        if (!definition.node.init) return [];
        return defaultObjectExpressions(
          definition.node.init,
          sourceCode,
          new Set(seenVariables).add(variable),
        );
      }
      const upper = scope.upper;
      if (!upper) break;
      scope = upper;
    }
    return objectRuntimeDefaultNames.has(current.name) ? [current] : [];
  }
  if (
    current.type === "CallExpression" &&
    current.callee.type === "Identifier"
  ) {
    let scope = sourceCode.getScope(current.callee);
    while (scope) {
      const variable = scope.set.get(current.callee.name);
      const definition = variable?.defs.find(
        (candidate) =>
          candidate.type === "FunctionName" || candidate.type === "Variable",
      );
      const functionDeclarationReturnsObject =
        definition?.type === "FunctionName" &&
        definition.node.returnType &&
        typeAnnotationIsObjectShaped(definition.node.returnType.typeAnnotation);
      const functionExpressionReturnsObject =
        definition?.node.type === "VariableDeclarator" &&
        definition.node.init &&
        (definition.node.init.type === "ArrowFunctionExpression" ||
          definition.node.init.type === "FunctionExpression") &&
        definition.node.init.returnType &&
        typeAnnotationIsObjectShaped(
          definition.node.init.returnType.typeAnnotation,
        );
      if (functionDeclarationReturnsObject || functionExpressionReturnsObject) {
        return [current];
      }
      if (variable) return [];
      const upper = scope.upper;
      if (!upper) break;
      scope = upper;
    }
    return [current];
  }
  if (
    current.type === "MemberExpression" &&
    !current.computed &&
    current.object.type === "Identifier" &&
    current.property.type === "Identifier"
  ) {
    if (objectRuntimeDefaultNames.has(current.object.name)) return [current];
    let scope = sourceCode.getScope(current.object);
    while (scope) {
      const variable = scope.set.get(current.object.name);
      if (variable) {
        const definition = variable.defs.find(
          (candidate) =>
            candidate.type === "Variable" &&
            candidate.node.type === "VariableDeclarator" &&
            candidate.node.init?.type === "ObjectExpression",
        );
        if (
          !definition ||
          definition.type !== "Variable" ||
          definition.node.type !== "VariableDeclarator" ||
          definition.node.init?.type !== "ObjectExpression"
        )
          return [];
        const property = definition?.node.init.properties.find(
          (candidate) =>
            candidate.type === "Property" &&
            !candidate.computed &&
            candidate.key.type === "Identifier" &&
            candidate.key.name === current.property.name,
        );
        if (
          property?.type !== "Property" ||
          property.value.type === "ObjectPattern" ||
          property.value.type === "ArrayPattern" ||
          property.value.type === "AssignmentPattern" ||
          property.value.type === "TSEmptyBodyFunctionExpression"
        )
          return [];
        return defaultObjectExpressions(
          property.value,
          sourceCode,
          seenVariables,
        );
      }
      const upper = scope.upper;
      if (!upper) break;
      scope = upper;
    }
  }
  if (current.type === "AssignmentExpression") {
    return defaultObjectExpressions(current.right, sourceCode, seenVariables);
  }
  if (current.type === "ConditionalExpression") {
    return [
      ...defaultObjectExpressions(
        current.consequent,
        sourceCode,
        seenVariables,
      ),
      ...defaultObjectExpressions(current.alternate, sourceCode, seenVariables),
    ];
  }
  if (current.type === "LogicalExpression") {
    return [
      ...defaultObjectExpressions(current.left, sourceCode, seenVariables),
      ...defaultObjectExpressions(current.right, sourceCode, seenVariables),
    ];
  }
  if (current.type === "SequenceExpression") {
    const lastExpression = current.expressions.at(-1);
    if (!lastExpression) return [];
    return defaultObjectExpressions(lastExpression, sourceCode, seenVariables);
  }
  return [];
}

/** @param {TypedRuleContext} context */
export function namedParameterContractListeners(context) {
  const sourceCode = context.sourceCode;
  /** @param {AstTypeNode} node */
  function inspectInlineParameterType(node) {
    /** @type {AstNode} */
    let current = node.parent;
    while (current.type !== "TSTypeAnnotation") {
      if (current.type === "TSFunctionType") return;
      if (scalarTypeBoundaryTypes.has(current.type)) return;
      if (current.type === "Program") return;
      current = current.parent;
    }
    if (parameterOwnsTypeAnnotation(current)) {
      context.report({ node, messageId: "namedParameterType" });
    }
  }

  /** @param {import('@typescript-eslint/types').TSESTree.TSTypeReference} node */
  function inspectReferencedParameterType(node) {
    const name = referencedTypeName(node.typeName);
    if (
      (inlineCollectionParameterTypes.has(name) ||
        inlineObjectParameterTypes.has(name) ||
        inlineMappedParameterTypes.has(name)) &&
      referencedTypeIsParameterContract(node)
    ) {
      context.report({ node, messageId: "namedParameterType" });
      return;
    }
    if (!isGenericParameterContractName(name)) {
      return;
    }
    const lookup = referencedTypeDeclaration(node);
    if (!referencedTypeIsParameterContract(node)) return;
    if (
      lookup.kind === TypeDeclarationLookupKind.NotFound ||
      typeDeclarationIsObjectShaped(lookup.declaration, new Set())
    ) {
      context.report({ node, messageId: "semanticParameterType" });
    }
  }

  /** @param {import('@typescript-eslint/types').TSESTree.TSTypeQuery} node */
  function inspectTypeQueryParameter(node) {
    if (
      referencedTypeIsParameterContract(node) &&
      typeQueryIsObjectShaped(node, sourceCode)
    ) {
      context.report({ node, messageId: "namedParameterType" });
    }
  }

  /** @param {import('@typescript-eslint/types').TSESTree.TSImportType} node */
  function inspectImportTypeParameter(node) {
    if (!node.qualifier || !referencedTypeIsParameterContract(node)) return;
    const name = referencedTypeName(node.qualifier);
    if (isGenericParameterContractName(name)) {
      context.report({ node, messageId: "semanticParameterType" });
    }
  }

  /** @param {import('@typescript-eslint/types').TSESTree.AssignmentPattern} node */
  function inspectParameterDefault(node) {
    const lookup = enclosingParameterBinding(node);
    if (lookup.kind === ParameterBindingLookupKind.NotFound) return;
    const parameterType = node.left.typeAnnotation?.typeAnnotation;
    const objectExpressions =
      parameterType && typeAnnotationIsObjectShaped(parameterType)
        ? [node.right]
        : defaultObjectExpressions(node.right, sourceCode);
    for (const objectExpression of objectExpressions) {
      context.report({
        node: objectExpression,
        messageId: "namedParameterDefault",
      });
    }
  }

  return {
    AssignmentPattern: inspectParameterDefault,
    TSArrayType: inspectInlineParameterType,
    TSImportType: inspectImportTypeParameter,
    TSMappedType: inspectInlineParameterType,
    TSTupleType: inspectInlineParameterType,
    TSTypeQuery: inspectTypeQueryParameter,
    TSTypeReference: inspectReferencedParameterType,
    TSTypeLiteral: inspectInlineParameterType,
  };
}
