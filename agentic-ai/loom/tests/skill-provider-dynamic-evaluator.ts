import ts from 'typescript';

export type DynamicEvaluatorInspection = {
  readonly checker: ts.TypeChecker;
  readonly isAmbientGlobalRoot: (node: ts.Node) => boolean;
  readonly isAmbientIdentifier: (node: ts.Identifier) => boolean;
  readonly node: ts.Node;
};

enum AmbientDynamicEvaluator {
  AsyncFunction = 'AsyncFunction',
  Eval = 'eval',
  Function = 'Function',
  GeneratorFunction = 'GeneratorFunction',
}

enum DynamicEvaluatorMember {
  Constructor = 'constructor',
}

enum ReflectEvaluatorMember {
  Get = 'get',
}

enum AmbientEvaluatorRoot {
  Object = 'Object',
  Reflect = 'Reflect',
}

enum ObjectRecoveryMember {
  GetOwnPropertyDescriptor = 'getOwnPropertyDescriptor',
}

const AMBIENT_DYNAMIC_EVALUATORS = new Set<string>(
  Object.values(AmbientDynamicEvaluator),
);
const DYNAMIC_EVALUATOR_MEMBERS = new Set<string>(
  Object.values(DynamicEvaluatorMember),
);

export function isAmbientDynamicEvaluator(
  inspection: DynamicEvaluatorInspection,
): boolean {
  const node = inspection.node;
  const bindingInspection: ConstructorBindingInspection = {
    checker: inspection.checker,
    node,
  };
  if (isConstructorBinding(bindingInspection)) return true;
  if (isUnboundedAmbientCapabilityRoot(inspection)) return true;
  if (ts.isIdentifier(node) && AMBIENT_DYNAMIC_EVALUATORS.has(node.text)) {
    if (isNonRuntimeIdentifierPosition(node)) return false;
    return inspection.isAmbientIdentifier(node);
  }
  const memberInspection: DynamicEvaluatorMemberInspection = {
    checker: inspection.checker,
    node,
  };
  const member = dynamicEvaluatorMember(memberInspection);
  if (member === false) {
    if (isUnboundedAmbientElementAccess(inspection)) return true;
    const computedInspection: ComputedElementInspection = {
      checker: inspection.checker,
      node,
    };
    return isComputedCallableElementAccess(computedInspection);
  }
  if (DYNAMIC_EVALUATOR_MEMBERS.has(member)) return true;
  const recoveryInspection: AmbientRecoveryInspection = {
    inspection,
    member,
    node,
  };
  if (isAmbientRecovery(recoveryInspection)) return true;
  if (!AMBIENT_DYNAMIC_EVALUATORS.has(member)) return false;
  if (
    !ts.isPropertyAccessExpression(node) &&
    !ts.isElementAccessExpression(node)
  ) {
    return false;
  }
  const root = node.expression;
  return inspection.isAmbientGlobalRoot(root);
}

type AmbientRecoveryInspection = {
  readonly inspection: DynamicEvaluatorInspection;
  readonly member: string;
  readonly node: ts.Node;
};

function isAmbientRecovery(request: AmbientRecoveryInspection): boolean {
  if (
    !ts.isPropertyAccessExpression(request.node) &&
    !ts.isElementAccessExpression(request.node)
  ) {
    return false;
  }
  const rootName =
    request.member === ObjectRecoveryMember.GetOwnPropertyDescriptor
      ? AmbientEvaluatorRoot.Object
      : request.member === ReflectEvaluatorMember.Get
        ? AmbientEvaluatorRoot.Reflect
        : false;
  if (rootName === false) return false;
  const rootInspection: AmbientNamedRootInspection = {
    expression: request.node.expression,
    inspection: request.inspection,
    rootName,
  };
  return isAmbientNamedRoot(rootInspection);
}

type DynamicEvaluatorMemberInspection = {
  readonly checker: ts.TypeChecker;
  readonly node: ts.Node;
};

function dynamicEvaluatorMember(
  inspection: DynamicEvaluatorMemberInspection,
): string | false {
  if (ts.isPropertyAccessExpression(inspection.node)) {
    return inspection.node.name.text;
  }
  if (ts.isElementAccessExpression(inspection.node)) {
    const resolution: StaticStringResolution = {
      checker: inspection.checker,
      expression: inspection.node.argumentExpression,
      seen: new Set<ts.Symbol>(),
    };
    return staticString(resolution);
  }
  return false;
}

function isUnboundedAmbientElementAccess(
  inspection: DynamicEvaluatorInspection,
): boolean {
  if (!ts.isElementAccessExpression(inspection.node)) return false;
  const root = unwrapExpression(inspection.node.expression);
  if (inspection.isAmbientGlobalRoot(root)) return true;
  return (
    ts.isIdentifier(root) &&
    (root.text === AmbientEvaluatorRoot.Reflect ||
      root.text === AmbientEvaluatorRoot.Object) &&
    inspection.isAmbientIdentifier(root)
  );
}

type AmbientNamedRootInspection = {
  readonly expression: ts.Expression;
  readonly inspection: DynamicEvaluatorInspection;
  readonly rootName: AmbientEvaluatorRoot;
};

function isAmbientNamedRoot(request: AmbientNamedRootInspection): boolean {
  const root = unwrapExpression(request.expression);
  if (ts.isIdentifier(root) && root.text === request.rootName) {
    return request.inspection.isAmbientIdentifier(root);
  }
  return (
    ts.isPropertyAccessExpression(root) &&
    root.name.text === request.rootName &&
    request.inspection.isAmbientGlobalRoot(root.expression)
  );
}

function isUnboundedAmbientCapabilityRoot(
  inspection: DynamicEvaluatorInspection,
): boolean {
  const node = inspection.node;
  let ambient = false;
  if (
    ts.isIdentifier(node) &&
    (node.text === AmbientEvaluatorRoot.Object ||
      node.text === AmbientEvaluatorRoot.Reflect) &&
    !isNonRuntimeIdentifierPosition(node)
  ) {
    ambient = inspection.isAmbientIdentifier(node);
  } else if (
    ts.isPropertyAccessExpression(node) &&
    (node.name.text === AmbientEvaluatorRoot.Object ||
      node.name.text === AmbientEvaluatorRoot.Reflect)
  ) {
    ambient = inspection.isAmbientGlobalRoot(node.expression);
  }
  if (!ambient) return false;
  const parent = node.parent;
  if (
    ts.isIdentifier(node) &&
    node.text === AmbientEvaluatorRoot.Object &&
    (((ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
      parent.expression === node) ||
      (ts.isBinaryExpression(parent) &&
        parent.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
        parent.right === node))
  ) {
    return false;
  }
  return !(
    (ts.isPropertyAccessExpression(parent) ||
      ts.isElementAccessExpression(parent)) &&
    parent.expression === node
  );
}

type ComputedElementInspection = {
  readonly checker: ts.TypeChecker;
  readonly node: ts.Node;
};

function isComputedCallableElementAccess(
  inspection: ComputedElementInspection,
): boolean {
  if (!ts.isElementAccessExpression(inspection.node)) return false;
  const receiverType = inspection.checker.getTypeAtLocation(
    inspection.node.expression,
  );
  return (
    receiverType.getCallSignatures().length > 0 ||
    receiverType.getConstructSignatures().length > 0
  );
}

type ConstructorBindingInspection = {
  readonly checker: ts.TypeChecker;
  readonly node: ts.Node;
};

function isConstructorBinding(
  inspection: ConstructorBindingInspection,
): boolean {
  if (!ts.isBindingElement(inspection.node) || !inspection.node.propertyName) {
    return false;
  }
  if (
    ts.isIdentifier(inspection.node.propertyName) &&
    inspection.node.propertyName.text === DynamicEvaluatorMember.Constructor
  ) {
    return true;
  }
  if (ts.isStringLiteralLike(inspection.node.propertyName)) {
    return (
      inspection.node.propertyName.text === DynamicEvaluatorMember.Constructor
    );
  }
  if (!ts.isComputedPropertyName(inspection.node.propertyName)) return false;
  const resolution: StaticStringResolution = {
    checker: inspection.checker,
    expression: inspection.node.propertyName.expression,
    seen: new Set<ts.Symbol>(),
  };
  return staticString(resolution) === DynamicEvaluatorMember.Constructor;
}

type StaticStringResolution = {
  readonly checker: ts.TypeChecker | false;
  readonly expression: ts.Expression;
  readonly seen: ReadonlySet<ts.Symbol>;
};

function staticString(resolution: StaticStringResolution): string | false {
  const expression = unwrapExpression(resolution.expression);
  if (ts.isStringLiteralLike(expression)) return expression.text;
  if (!resolution.checker || !ts.isIdentifier(expression)) return false;
  const symbol = resolution.checker.getSymbolAtLocation(expression);
  if (!symbol || resolution.seen.has(symbol)) return false;
  const declaration = symbol.declarations?.find(
    (candidate): candidate is ts.VariableDeclaration =>
      ts.isVariableDeclaration(candidate) && Boolean(candidate.initializer),
  );
  if (!declaration?.initializer) return false;
  const seen = new Set(resolution.seen);
  seen.add(symbol);
  const nested: StaticStringResolution = {
    checker: resolution.checker,
    expression: declaration.initializer,
    seen,
  };
  return staticString(nested);
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    return unwrapExpression(expression.expression);
  }
  return expression;
}

function isNonRuntimeIdentifierPosition(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPartOfTypeNode(node)) return true;
  if (
    ((ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isEnumDeclaration(parent) ||
      ts.isEnumMember(parent) ||
      ts.isModuleDeclaration(parent) ||
      ts.isImportClause(parent) ||
      ts.isImportSpecifier(parent) ||
      ts.isNamespaceImport(parent) ||
      ts.isImportEqualsDeclaration(parent)) &&
      parent.name === node) ||
    (ts.isBindingElement(parent) && parent.propertyName === node)
  ) {
    return true;
  }
  if (
    ((ts.isPropertyAssignment(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent)) &&
      parent.name === node) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node)
  ) {
    return true;
  }
  return false;
}
