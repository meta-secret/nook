import ts from 'typescript';
import { posix } from 'node:path';
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
  if (request.call.arguments.length > 3)
    throw new Error(
      `Ambiguous github-script ${request.member} arguments are forbidden.`,
    );
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
  const source = parts.join(' ');
  const cwd = execCwd([request.call.arguments[2] ?? false, request.member]);
  return cwd === false ? source : `cd ${shellQuote(cwd)} && ${source}`;
}

function execCwd([options, member]: readonly [
  ts.Expression | false,
  string,
]): string | false {
  if (options === false) return false;
  if (!ts.isObjectLiteralExpression(options))
    throw new Error(`Dynamic github-script ${member} options are forbidden.`);
  let cwd: string | false = false;
  const names = new Set<string>();
  for (const property of options.properties) {
    if (ts.isSpreadAssignment(property))
      throw new Error(`Spread github-script ${member} options are forbidden.`);
    if (!ts.isPropertyAssignment(property))
      throw new Error(
        `Ambiguous github-script ${member} options are forbidden.`,
      );
    const name = propertyName(property.name);
    if (name === false || names.has(name))
      throw new Error(
        `Ambiguous github-script ${member} options are forbidden.`,
      );
    names.add(name);
    if (name === 'cwd') {
      const value = staticText(property.initializer);
      if (value === false)
        throw new Error(`Dynamic github-script ${member} cwd is forbidden.`);
      cwd = repositoryCwd(value);
    } else assertStaticInertOption([name, property.initializer, member]);
  }
  return cwd;
}

function propertyName(name: ts.PropertyName): string | false {
  return ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNoSubstitutionTemplateLiteral(name)
    ? name.text
    : false;
}

function assertStaticInertOption([name, value, member]: readonly [
  string,
  ts.Expression,
  string,
]): void {
  if (
    /^(?:failOnStdErr|ignoreReturnCode|silent|windowsHide|windowsVerbatimArguments)$/u.test(
      name,
    ) &&
    (value.kind === ts.SyntaxKind.TrueKeyword ||
      value.kind === ts.SyntaxKind.FalseKeyword)
  )
    return;
  if (name === 'delay' && ts.isNumericLiteral(value)) return;
  throw new Error(
    `Dynamic github-script ${member} option ${name} is forbidden.`,
  );
}

function repositoryCwd(value: string): string | false {
  if (
    value.includes('\\') ||
    /[\0\r\n]/u.test(value) ||
    /^(?:\/|[A-Za-z]:)/u.test(value)
  )
    throw new Error('github-script exec cwd escapes the repository.');
  const normalized = posix.normalize(value);
  if (normalized === '..' || normalized.startsWith('../'))
    throw new Error('github-script exec cwd escapes the repository.');
  return normalized === '.' ? false : normalized;
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
