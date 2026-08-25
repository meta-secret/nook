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

enum ReflectRoot {
  Reflect = 'Reflect',
}

enum ObjectRecoveryMember {
  GetOwnPropertyDescriptor = 'getOwnPropertyDescriptor',
}

enum ObjectRoot {
  Object = 'Object',
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
  const reflectInspection: AmbientReflectGetInspection = {
    inspection,
    member,
    node,
  };
  if (isAmbientReflectGet(reflectInspection)) return true;
  const objectInspection: AmbientObjectRecoveryInspection = {
    inspection,
    member,
    node,
  };
  if (isAmbientObjectRecovery(objectInspection)) return true;
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

type AmbientObjectRecoveryInspection = {
  readonly inspection: DynamicEvaluatorInspection;
  readonly member: string;
  readonly node: ts.Node;
};

function isAmbientObjectRecovery(
  request: AmbientObjectRecoveryInspection,
): boolean {
  if (request.member !== ObjectRecoveryMember.GetOwnPropertyDescriptor) {
    return false;
  }
  if (
    !ts.isPropertyAccessExpression(request.node) &&
    !ts.isElementAccessExpression(request.node)
  ) {
    return false;
  }
  const root = unwrapExpression(request.node.expression);
  return (
    ts.isIdentifier(root) &&
    root.text === ObjectRoot.Object &&
    request.inspection.isAmbientIdentifier(root)
  );
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
    (root.text === ReflectRoot.Reflect || root.text === ObjectRoot.Object) &&
    inspection.isAmbientIdentifier(root)
  );
}

type AmbientReflectGetInspection = {
  readonly inspection: DynamicEvaluatorInspection;
  readonly member: string;
  readonly node: ts.Node;
};

function isAmbientReflectGet(request: AmbientReflectGetInspection): boolean {
  if (request.member !== ReflectEvaluatorMember.Get) return false;
  if (
    !ts.isPropertyAccessExpression(request.node) &&
    !ts.isElementAccessExpression(request.node)
  ) {
    return false;
  }
  const root = unwrapExpression(request.node.expression);
  return (
    ts.isIdentifier(root) &&
    root.text === ReflectRoot.Reflect &&
    request.inspection.isAmbientIdentifier(root)
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
