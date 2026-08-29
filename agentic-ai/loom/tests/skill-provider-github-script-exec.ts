import ts from 'typescript';
import { lexicalScope } from './skill-provider-typescript-require.ts';

type ExecBinding = { readonly scope: ts.Node };
type ExecCallRequest = {
  readonly call: ts.CallExpression;
  readonly member: string;
};

const EXEC_METHODS = new Set(['exec', 'getExecOutput']);

export function githubScriptExecCommands(source: string): readonly string[] {
  const file = ts.createSourceFile(
    'github-script.ts',
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const bindings: ExecBinding[] = [];
  const collect = (node: ts.Node): void => {
    if (declaresExec(node)) {
      const binding: ExecBinding = { scope: bindingScope(node) };
      bindings.push(binding);
    }
    ts.forEachChild(node, collect);
  };
  collect(file);
  const allowedOwners = new Set<ts.Identifier>();
  const commands: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const access = execMemberAccess(node.expression);
      if (
        access !== false &&
        ts.isIdentifier(access.owner) &&
        access.owner.text === 'exec' &&
        !isBound([access.owner, bindings])
      ) {
        if (access.member === false || !EXEC_METHODS.has(access.member))
          throw new Error(
            'Dynamic github-script exec client use is forbidden.',
          );
        allowedOwners.add(access.owner);
        const request: ExecCallRequest = { call: node, member: access.member };
        commands.push(execCommand(request));
      }
    }
    if (
      ts.isIdentifier(node) &&
      node.text === 'exec' &&
      !allowedOwners.has(node) &&
      isValueIdentifier(node) &&
      !isBound([node, bindings])
    )
      throw new Error('Dynamic github-script exec client use is forbidden.');
    ts.forEachChild(node, visit);
  };
  visit(file);
  return commands;
}

function execCommand(request: ExecCallRequest): string {
  const command = request.call.arguments[0];
  if (!command || staticText(command) === false)
    throw new Error(
      `Dynamic github-script ${request.member} command is forbidden.`,
    );
  const parts = [staticText(command) as string];
  const args = request.call.arguments[1];
  if (args) {
    if (!ts.isArrayLiteralExpression(args))
      throw new Error(
        `Dynamic github-script ${request.member} arguments are forbidden.`,
      );
    for (const argument of args.elements) {
      if (ts.isSpreadElement(argument) || staticText(argument) === false)
        throw new Error(
          `Dynamic github-script ${request.member} arguments are forbidden.`,
        );
      parts.push(shellQuote(staticText(argument) as string));
    }
  }
  return parts.join(' ');
}

function staticText(expression: ts.Expression): string | false {
  return ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
    ? expression.text
    : false;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function execMemberAccess(expression: ts.Expression):
  | {
      readonly member: string | false;
      readonly owner: ts.Expression;
    }
  | false {
  if (ts.isPropertyAccessExpression(expression))
    return { member: expression.name.text, owner: expression.expression };
  if (!ts.isElementAccessExpression(expression)) return false;
  const member = expression.argumentExpression;
  return {
    member:
      ts.isStringLiteral(member) || ts.isNoSubstitutionTemplateLiteral(member)
        ? member.text
        : false,
    owner: expression.expression,
  };
}

function declaresExec(node: ts.Node): boolean {
  if (
    (ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
    bindingNameContainsExec(node.name)
  )
    return true;
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isImportClause(node) ||
      ts.isImportEqualsDeclaration(node)) &&
    node.name?.text === 'exec'
  )
    return true;
  return (
    (ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) &&
    node.name.text === 'exec'
  );
}

function bindingNameContainsExec(name: ts.BindingName): boolean {
  if (ts.isIdentifier(name)) return name.text === 'exec';
  return name.elements.some(
    (element) =>
      ts.isBindingElement(element) && bindingNameContainsExec(element.name),
  );
}

function bindingScope(node: ts.Node): ts.Node {
  if (
    ts.isImportClause(node) ||
    ts.isImportEqualsDeclaration(node) ||
    ts.isImportSpecifier(node) ||
    ts.isNamespaceImport(node)
  )
    return node.getSourceFile();
  return lexicalScope(node);
}

function isBound([location, bindings]: readonly [
  ts.Node,
  readonly ExecBinding[],
]): boolean {
  let node: ts.Node = location;
  for (;;) {
    if (bindings.some((binding) => binding.scope === node)) return true;
    if (!node.parent) return false;
    node = node.parent;
  }
}

function isValueIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node)
    return false;
  if (
    (ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)) &&
    parent.name === node
  )
    return false;
  return true;
}
