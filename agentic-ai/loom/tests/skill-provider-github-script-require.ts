import ts from 'typescript';

import {
  type BindingCollectionRequest,
  type BindingLookupRequest,
  type LexicalBinding,
  type LexicalModel,
  SkillProviderTypescriptBindingsScenario,
} from './skill-provider-typescript-bindings.ts';

export class SkillProviderGithubScriptRequireScenario {
  private constructor(private readonly request: string) {}

  static githubScriptRequireSpecifiers(source: string): readonly string[] {
    return new SkillProviderGithubScriptRequireScenario(source).execute();
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
    const bindings: LexicalBinding[] = [];
    const collect = (node: ts.Node): void => {
      const request: BindingCollectionRequest = { node, target: bindings };
      SkillProviderTypescriptBindingsScenario.collectBinding(request);
      ts.forEachChild(node, collect);
    };
    collect(file);
    const model: LexicalModel = {
      bindings,
      dynamicCwdExemptions: [],
      path: 'github-script.ts',
    };
    const allowed = new Set<ts.Expression>();
    const specifiers: string[] = [];
    const capability = (input: RequireCapabilityRequest): boolean => {
      const [expression, location] = input;
      const request: RequireResolutionRequest = {
        expression,
        location,
        model,
        visited: new Set(),
      };
      return SkillProviderGithubScriptRequireScenario.resolvesInjectedRequire(
        request,
      );
    };
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && capability([node.expression, node])) {
        allowed.add(node.expression);
        const [argument] = node.arguments;
        if (
          node.arguments.length !== 1 ||
          !argument ||
          SkillProviderGithubScriptRequireScenario.staticText(argument) ===
            false
        )
          throw new Error('Dynamic github-script module load is forbidden.');
        const specifier =
          SkillProviderGithubScriptRequireScenario.staticText(argument);
        if (specifier === false)
          throw new Error('Dynamic github-script module load is forbidden.');
        specifiers.push(specifier);
      }
      if (
        ts.isVariableDeclaration(node) &&
        node.initializer &&
        capability([node.initializer, node])
      ) {
        if (
          !SkillProviderGithubScriptRequireScenario.isConstantIdentifierDeclaration(
            node,
          )
        )
          throw new Error(
            'github-script require capability escape is forbidden.',
          );
        allowed.add(node.initializer);
      }
      if (
        ts.isIdentifier(node) &&
        !allowed.has(node) &&
        SkillProviderGithubScriptRequireScenario.isValueIdentifier(node) &&
        capability([node, node])
      )
        throw new Error(
          'github-script require capability escape is forbidden.',
        );
      ts.forEachChild(node, visit);
    };
    visit(file);
    return specifiers;
  }

  static resolvesInjectedRequire(request: RequireResolutionRequest): boolean {
    const expression = SkillProviderGithubScriptRequireScenario.unwrap(
      request.expression,
    );
    if (!ts.isIdentifier(expression)) return false;
    const lookup: BindingLookupRequest = {
      location: request.location,
      model: request.model,
      name: expression.text,
    };
    const binding = SkillProviderTypescriptBindingsScenario.bindingAt(lookup);
    if (binding === false)
      return SkillProviderGithubScriptRequireScenario.isInjectedRequireName(
        expression.text,
      );
    if (
      !binding.constant ||
      binding.initializer === false ||
      request.visited.has(binding.initializer)
    )
      return false;
    const nested: RequireResolutionRequest = {
      ...request,
      expression: binding.initializer,
      location: binding.initializer,
      visited: new Set(request.visited).add(binding.initializer),
    };
    return SkillProviderGithubScriptRequireScenario.resolvesInjectedRequire(
      nested,
    );
  }

  static isInjectedRequireName(name: string): boolean {
    return name === 'require' || name === '__original_require__';
  }

  static isConstantIdentifierDeclaration(
    node: ts.VariableDeclaration,
  ): boolean {
    return (
      ts.isIdentifier(node.name) &&
      ts.isVariableDeclarationList(node.parent) &&
      Boolean(node.parent.flags & ts.NodeFlags.Const)
    );
  }

  static staticText(expression: ts.Expression): string | false {
    return ts.isStringLiteral(expression) ||
      ts.isNoSubstitutionTemplateLiteral(expression)
      ? expression.text
      : false;
  }

  static unwrap(expression: ts.Expression): ts.Expression {
    if (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isNonNullExpression(expression)
    )
      return SkillProviderGithubScriptRequireScenario.unwrap(
        expression.expression,
      );
    return expression;
  }

  static isValueIdentifier(node: ts.Identifier): boolean {
    const parent = node.parent;
    if (
      (ts.isVariableDeclaration(parent) ||
        ts.isParameter(parent) ||
        ts.isFunctionDeclaration(parent) ||
        ts.isClassDeclaration(parent)) &&
      parent.name === node
    )
      return false;
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

type RequireResolutionRequest = {
  readonly expression: ts.Expression;
  readonly location: ts.Node;
  readonly model: LexicalModel;
  readonly visited: ReadonlySet<ts.Node>;
};

type RequireCapabilityRequest = readonly [ts.Expression, ts.Node];
