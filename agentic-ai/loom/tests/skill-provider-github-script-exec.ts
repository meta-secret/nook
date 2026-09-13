import ts from 'typescript';

import { posix } from 'node:path';

import { SkillProviderTypescriptRequireScenario } from './skill-provider-typescript-require.ts';

export class SkillProviderGithubScriptExecScenario {
  private constructor(private readonly request: string) {}

  static githubScriptExecCommands(source: string): readonly string[] {
    return new SkillProviderGithubScriptExecScenario(source).execute();
  }

  private execute(): readonly string[] {
    const source = this.request;
    const file = ts.createSourceFile(
      'github-script.ts',
      source,
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.TS,
    );
    const bindings: ExecBinding[] = [];
    const collect = (node: ts.Node): void => {
      if (SkillProviderGithubScriptExecScenario.declaresExec(node)) {
        const binding: ExecBinding = {
          scope: SkillProviderGithubScriptExecScenario.bindingScope(node),
        };
        bindings.push(binding);
      }
      ts.forEachChild(node, collect);
    };
    collect(file);
    const allowedOwners = new Set<ts.Identifier>();
    const commands: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const access = SkillProviderGithubScriptExecScenario.execMemberAccess(
          node.expression,
        );
        if (
          access !== false &&
          ts.isIdentifier(access.owner) &&
          access.owner.text === 'exec' &&
          !SkillProviderGithubScriptExecScenario.isBound([
            access.owner,
            bindings,
          ])
        ) {
          if (access.member === false || !EXEC_METHODS.has(access.member))
            throw new Error(
              'Dynamic github-script exec client use is forbidden.',
            );
          allowedOwners.add(access.owner);
          const request: ExecCallRequest = {
            call: node,
            member: access.member,
          };
          commands.push(
            SkillProviderGithubScriptExecScenario.execCommand(request),
          );
        }
      }
      if (
        ts.isIdentifier(node) &&
        node.text === 'exec' &&
        !allowedOwners.has(node) &&
        SkillProviderGithubScriptExecScenario.isValueIdentifier(node) &&
        !SkillProviderGithubScriptExecScenario.isBound([node, bindings])
      )
        throw new Error('Dynamic github-script exec client use is forbidden.');
      ts.forEachChild(node, visit);
    };
    visit(file);
    return commands;
  }

  static execCommand(request: ExecCallRequest): string {
    if (request.call.arguments.length > 3)
      throw new Error(
        `Ambiguous github-script ${request.member} arguments are forbidden.`,
      );
    const command = request.call.arguments[0];
    const commandText = command
      ? SkillProviderGithubScriptExecScenario.staticText(command)
      : false;
    if (commandText === false)
      throw new Error(
        `Dynamic github-script ${request.member} command is forbidden.`,
      );
    const parts = [commandText];
    const args = request.call.arguments[1];
    if (args) {
      if (!ts.isArrayLiteralExpression(args))
        throw new Error(
          `Dynamic github-script ${request.member} arguments are forbidden.`,
        );
      for (const argument of args.elements) {
        const argumentText = ts.isSpreadElement(argument)
          ? false
          : SkillProviderGithubScriptExecScenario.staticText(argument);
        if (argumentText === false)
          throw new Error(
            `Dynamic github-script ${request.member} arguments are forbidden.`,
          );
        parts.push(
          SkillProviderGithubScriptExecScenario.shellQuote(argumentText),
        );
      }
    }
    const source = parts.join(' ');
    const [defaulted1 = false] = [request.call.arguments[2]];
    const cwd = SkillProviderGithubScriptExecScenario.execCwd([
      defaulted1,
      request.member,
    ]);
    return cwd === false
      ? source
      : `cd ${SkillProviderGithubScriptExecScenario.shellQuote(cwd)} && ${source}`;
  }

  static execCwd([options, member]: readonly [ts.Expression | false, string]):
    string | false {
    if (options === false) return false;
    if (!ts.isObjectLiteralExpression(options))
      throw new Error(`Dynamic github-script ${member} options are forbidden.`);
    let cwd: string | false = false;
    const names = new Set<string>();
    for (const property of options.properties) {
      if (ts.isSpreadAssignment(property))
        throw new Error(
          `Spread github-script ${member} options are forbidden.`,
        );
      if (!ts.isPropertyAssignment(property))
        throw new Error(
          `Ambiguous github-script ${member} options are forbidden.`,
        );
      const name = SkillProviderGithubScriptExecScenario.propertyName(
        property.name,
      );
      if (name === false || names.has(name))
        throw new Error(
          `Ambiguous github-script ${member} options are forbidden.`,
        );
      names.add(name);
      if (name === 'cwd') {
        const value = SkillProviderGithubScriptExecScenario.staticText(
          property.initializer,
        );
        if (value === false)
          throw new Error(`Dynamic github-script ${member} cwd is forbidden.`);
        cwd = SkillProviderGithubScriptExecScenario.repositoryCwd(value);
      } else
        SkillProviderGithubScriptExecScenario.assertStaticInertOption([
          name,
          property.initializer,
          member,
        ]);
    }
    return cwd;
  }

  static propertyName(name: ts.PropertyName): string | false {
    return ts.isIdentifier(name) ||
      ts.isStringLiteral(name) ||
      ts.isNoSubstitutionTemplateLiteral(name)
      ? name.text
      : false;
  }

  static assertStaticInertOption([name, value, member]: readonly [
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

  static repositoryCwd(value: string): string | false {
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

  static staticText(expression: ts.Expression): string | false {
    return ts.isStringLiteral(expression) ||
      ts.isNoSubstitutionTemplateLiteral(expression)
      ? expression.text
      : false;
  }

  static shellQuote(value: string): string {
    return `'${value.replaceAll("'", "'\\''")}'`;
  }

  static execMemberAccess(expression: ts.Expression):
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

  static declaresExec(node: ts.Node): boolean {
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
      SkillProviderGithubScriptExecScenario.bindingNameContainsExec(node.name)
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

  static bindingNameContainsExec(name: ts.BindingName): boolean {
    if (ts.isIdentifier(name)) return name.text === 'exec';
    return name.elements.some(
      (element) =>
        ts.isBindingElement(element) &&
        SkillProviderGithubScriptExecScenario.bindingNameContainsExec(
          element.name,
        ),
    );
  }

  static bindingScope(node: ts.Node): ts.Node {
    if (
      ts.isImportClause(node) ||
      ts.isImportEqualsDeclaration(node) ||
      ts.isImportSpecifier(node) ||
      ts.isNamespaceImport(node)
    )
      return node.getSourceFile();
    return SkillProviderTypescriptRequireScenario.lexicalScope(node);
  }

  static isBound([location, bindings]: readonly [
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

  static isValueIdentifier(node: ts.Identifier): boolean {
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
}

type ExecBinding = { readonly scope: ts.Node };

type ExecCallRequest = {
  readonly call: ts.CallExpression;
  readonly member: string;
};

const EXEC_METHODS = new Set(['exec', 'getExecOutput']);
