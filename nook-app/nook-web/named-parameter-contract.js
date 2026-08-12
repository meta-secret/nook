const transparentTypeScriptWrappers = new Set([
  "ChainExpression",
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
]);
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

function isGenericParameterContractName(name) {
  return (
    genericParameterContractNames.has(name) ||
    genericParameterOperationName.test(name) ||
    lineDerivedParameterContractName.test(name)
  );
}

function parameterOwnsTypeAnnotation(annotation) {
  let current = annotation.parent;
  while (
    current?.parent &&
    (current.parent.type === "AssignmentPattern" ||
      current.parent.type === "RestElement" ||
      current.parent.type === "TSParameterProperty")
  ) {
    current = current.parent;
  }
  return (
    Array.isArray(current?.parent?.params) &&
    current.parent.params.includes(current)
  );
}

function referencedTypeIsParameterContract(node) {
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

function referencedTypeName(typeName) {
  let current = typeName;
  while (current.type === "TSQualifiedName") {
    current = current.right;
  }
  return current.type === "Identifier" ? current.name : "";
}

function referencedTypeNameParts(typeName) {
  if (typeName.type === "Identifier") return [typeName.name];
  return [
    ...referencedTypeNameParts(typeName.left),
    ...referencedTypeNameParts(typeName.right),
  ];
}

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
  if (!declaration) return { kind: TypeDeclarationLookupKind.NotFound };
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

function referencedTypeDeclaration(node) {
  const nameParts = referencedTypeNameParts(node.typeName);
  let current = node;
  while (current) {
    if (Array.isArray(current.body)) {
      const lookup = declarationInStatements(current.body, nameParts);
      if (lookup.kind === TypeDeclarationLookupKind.Found) return lookup;
    }
    current = current.parent;
  }
  return { kind: TypeDeclarationLookupKind.NotFound };
}

function typeAnnotationIsObjectShaped(node, seenNames = new Set()) {
  if (
    node.type === "TSTypeLiteral" ||
    node.type === "TSMappedType" ||
    node.type === "TSArrayType" ||
    node.type === "TSTupleType"
  ) {
    return true;
  }
  if (node.type === "TSParenthesizedType") {
    return typeAnnotationIsObjectShaped(node.typeAnnotation, seenNames);
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

function typeDeclarationIsObjectShaped(declaration, seenNames) {
  if (declaration.type === "TSInterfaceDeclaration") return true;
  if (declaration.type !== "TSTypeAliasDeclaration") return false;
  return typeAnnotationIsObjectShaped(declaration.typeAnnotation, seenNames);
}

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
      if (!definition) return false;
      if (
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
    scope = scope.upper;
  }
  return false;
}

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
    if (
      Array.isArray(current.parent.params) &&
      current.parent.params.includes(current)
    ) {
      return { kind: ParameterBindingLookupKind.Found, parameter: current };
    }
    if (!bindingContainers.has(current.parent.type)) {
      return { kind: ParameterBindingLookupKind.NotFound };
    }
    current = current.parent;
  }
  return { kind: ParameterBindingLookupKind.NotFound };
}

function defaultObjectExpressions(
  expression,
  sourceCode,
  seenVariables = new Set(),
) {
  let current = expression;
  while (transparentTypeScriptWrappers.has(current.type)) {
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
        if (!definition) return [];
        if (
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
      scope = scope.upper;
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
      scope = scope.upper;
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
        const property = definition?.node.init.properties.find(
          (candidate) =>
            candidate.type === "Property" &&
            !candidate.computed &&
            candidate.key.type === "Identifier" &&
            candidate.key.name === current.property.name,
        );
        return property?.type === "Property"
          ? defaultObjectExpressions(property.value, sourceCode, seenVariables)
          : [];
      }
      scope = scope.upper;
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
    return defaultObjectExpressions(
      current.expressions.at(-1),
      sourceCode,
      seenVariables,
    );
  }
  return [];
}

export function namedParameterContractListeners(context) {
  const sourceCode = context.sourceCode;
  function inspectInlineParameterType(node) {
    let current = node.parent;
    while (current && current.type !== "TSTypeAnnotation") {
      if (current.type === "TSFunctionType") return;
      if (scalarTypeBoundaryTypes.has(current.type)) return;
      current = current.parent;
    }
    if (current && parameterOwnsTypeAnnotation(current)) {
      context.report({ node, messageId: "namedParameterType" });
    }
  }

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

  function inspectTypeQueryParameter(node) {
    if (
      referencedTypeIsParameterContract(node) &&
      typeQueryIsObjectShaped(node, sourceCode)
    ) {
      context.report({ node, messageId: "namedParameterType" });
    }
  }

  function inspectImportTypeParameter(node) {
    if (!node.qualifier || !referencedTypeIsParameterContract(node)) return;
    const name = referencedTypeName(node.qualifier);
    if (isGenericParameterContractName(name)) {
      context.report({ node, messageId: "semanticParameterType" });
    }
  }

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
