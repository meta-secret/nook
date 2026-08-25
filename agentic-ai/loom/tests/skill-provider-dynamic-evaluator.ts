import ts from 'typescript';

export type DynamicEvaluatorInspection = {
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
  if (ts.isIdentifier(node) && AMBIENT_DYNAMIC_EVALUATORS.has(node.text)) {
    if (isNonRuntimeIdentifierPosition(node)) return false;
    return inspection.isAmbientIdentifier(node);
  }
  const member = dynamicEvaluatorMember(node);
  if (member === false) return false;
  if (DYNAMIC_EVALUATOR_MEMBERS.has(member)) return true;
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

function dynamicEvaluatorMember(node: ts.Node): string | false {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (
    ts.isElementAccessExpression(node) &&
    ts.isStringLiteral(node.argumentExpression)
  ) {
    return node.argumentExpression.text;
  }
  return false;
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
