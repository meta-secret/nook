import ts from 'typescript';
export type AuthoredCommandDeclaration =
  | ts.FunctionDeclaration
  | ts.MethodDeclaration;

export class SkillProviderTypescriptRequireScenario {
  private constructor(private readonly request: AuthoredCommandDeclaration) {}

  static isRunCommandDeclaration(node: AuthoredCommandDeclaration): boolean {
    return new SkillProviderTypescriptRequireScenario(node).execute();
  }

  private execute(): boolean {
    const node = this.request;
    const [parameter] = node.parameters;
    return (
      ts.isMethodDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'run' &&
      ts.isClassDeclaration(node.parent) &&
      node.parent.name?.text === 'HostCommand' &&
      /(?:^|\/)lib\/run\.ts$/u.test(node.getSourceFile().fileName) &&
      node.parameters.length === 1 &&
      Boolean(
        parameter &&
        ts.isIdentifier(parameter.name) &&
        parameter.name.text === 'input' &&
        parameter.type?.getText() === 'RunCommandArgs',
      )
    );
  }

  static lexicalScope(node: ts.Node): ts.Node {
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

  static isStaticChildProcessRequire(expression: ts.Expression): boolean {
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
}
