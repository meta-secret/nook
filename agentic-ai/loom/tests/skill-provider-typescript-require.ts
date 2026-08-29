import ts from 'typescript';

export function isRunCommandDeclaration(node: ts.FunctionDeclaration): boolean {
  const [parameter] = node.parameters;
  return (
    node.name?.text === 'runCommand' &&
    node.parameters.length === 1 &&
    Boolean(
      parameter &&
      ts.isIdentifier(parameter.name) &&
      parameter.name.text === 'input' &&
      parameter.type?.getText() === 'RunCommandArgs',
    )
  );
}

export function lexicalScope(node: ts.Node): ts.Node {
  let parent = node.parent;
  while (
    parent.parent &&
    !ts.isBlock(parent) &&
    !ts.isFunctionLike(parent) &&
    !ts.isSourceFile(parent)
  )
    parent = parent.parent;
  return parent;
}

export function isStaticChildProcessRequire(
  expression: ts.Expression,
): boolean {
  if (
    !ts.isCallExpression(expression) ||
    !ts.isIdentifier(expression.expression) ||
    expression.expression.text !== 'require' ||
    expression.arguments.length !== 1
  )
    return false;
  const [specifier] = expression.arguments;
  return Boolean(
    specifier &&
    ts.isStringLiteral(specifier) &&
    /^(?:node:)?child_process$/u.test(specifier.text),
  );
}
