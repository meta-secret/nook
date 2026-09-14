import { posix } from 'node:path';

import ts from 'typescript';

import { itemAt } from './skill-provider-command-types.ts';
import type { BoundedPackageLoaderInspection } from './skill-provider-bounded-package-loader.ts';

export class SkillProviderLocalDataLoaderScenario {
  constructor(private readonly inspection: BoundedPackageLoaderInspection) {}

  specialize(): string {
    const inspection = this.inspection;
    const sourceFile = ts.createSourceFile(
      inspection.path,
      inspection.source,
      ts.ScriptTarget.ES2022,
      true,
    );
    const declarations = new Map<string, ts.VariableDeclaration>();
    const imports: ts.CallExpression[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        declarations.set(node.name.text, node);
      }
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        imports.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    const replacements: SourceReplacement[] = [];
    for (const dynamicImport of imports) {
      const moduleArgument = dynamicImport.arguments[0];
      if (!moduleArgument || !ts.isIdentifier(moduleArgument)) continue;
      const moduleDeclaration = declarations.get(moduleArgument.text);
      if (!moduleDeclaration) continue;
      const sourceBinding = this.dataUrlSourceBinding(moduleDeclaration);
      if (sourceBinding === false) continue;
      const [sourceDeclaration = false] = [
        declarations.get(sourceBinding.text),
      ];
      const pathBinding = this.readFilePathBinding(sourceDeclaration);
      if (pathBinding === false) continue;
      const [pathDeclaration = false] = [declarations.get(pathBinding.text)];
      const trackedPath = this.trackedResolvedPath({
        declaration: pathDeclaration,
        sources: inspection.sources,
      });
      if (trackedPath === false) continue;
      const closure: LocalDataLoaderClosure = {
        dynamicImport,
        moduleArgument,
        moduleDeclaration,
        pathBinding,
        pathDeclaration,
        sourceBinding,
        sourceDeclaration,
        scope: this.nearestFunctionScope(moduleDeclaration),
      };
      if (closure.scope === false || !this.isClosed(closure)) continue;
      const relativePath = posix.relative(
        posix.dirname(inspection.path),
        trackedPath,
      );
      const specifier = relativePath.startsWith('.')
        ? relativePath
        : `./${relativePath}`;
      replacements.push({
        end: dynamicImport.end,
        replacement: `import('${specifier}')`,
        start: dynamicImport.getStart(sourceFile),
      });
    }
    let specialized = inspection.source;
    for (const replacement of replacements) {
      specialized = `${specialized.slice(0, replacement.start)}${replacement.replacement}${specialized.slice(replacement.end)}`;
    }
    return specialized;
  }

  private dataUrlSourceBinding(
    declaration: ts.VariableDeclaration | false,
  ): ts.Identifier | false {
    const initializer = declaration === false ? false : declaration.initializer;
    if (
      !initializer ||
      !ts.isTemplateExpression(initializer) ||
      initializer.head.text !== 'data:text/javascript;base64,' ||
      initializer.templateSpans.length !== 1
    ) {
      return false;
    }
    const expression = initializer.templateSpans[0]?.expression;
    if (
      !expression ||
      !ts.isCallExpression(expression) ||
      !ts.isPropertyAccessExpression(expression.expression) ||
      expression.expression.name.text !== 'toString' ||
      expression.arguments[0]?.getText() !== "'base64'" ||
      !ts.isCallExpression(expression.expression.expression) ||
      !ts.isPropertyAccessExpression(
        expression.expression.expression.expression,
      ) ||
      expression.expression.expression.expression.name.text !== 'from' ||
      !ts.isIdentifier(
        expression.expression.expression.expression.expression,
      ) ||
      expression.expression.expression.expression.expression.text !== 'Buffer'
    ) {
      return false;
    }
    const source = expression.expression.expression.arguments[0];
    return source && ts.isIdentifier(source) ? source : false;
  }

  private readFilePathBinding(
    declaration: ts.VariableDeclaration | false,
  ): ts.Identifier | false {
    const initializer = declaration === false ? false : declaration.initializer;
    const expression =
      initializer && ts.isAwaitExpression(initializer)
        ? initializer.expression
        : initializer;
    if (
      !expression ||
      !ts.isCallExpression(expression) ||
      !ts.isIdentifier(expression.expression) ||
      expression.expression.text !== 'readFile' ||
      expression.arguments.length !== 2 ||
      expression.arguments[1]?.getText() !== "'utf8'"
    ) {
      return false;
    }
    const path = expression.arguments[0];
    return path && ts.isIdentifier(path) ? path : false;
  }

  private trackedResolvedPath(
    inspection: TrackedResolvedPathInspection,
  ): string | false {
    const initializer =
      inspection.declaration === false
        ? false
        : inspection.declaration.initializer;
    if (
      !initializer ||
      !ts.isCallExpression(initializer) ||
      !ts.isIdentifier(initializer.expression) ||
      initializer.expression.text !== 'resolve'
    ) {
      return false;
    }
    const literals = initializer.arguments.filter(ts.isStringLiteralLike);
    if (literals.length !== 1) return false;
    const path = posix.normalize(itemAt([literals, 0]).text);
    return inspection.sources.has(path) ? path : false;
  }

  private nearestFunctionScope(node: ts.Node): ts.Node | false {
    let candidate = node.parent;
    while (!ts.isSourceFile(candidate)) {
      if (ts.isFunctionLike(candidate)) return candidate;
      candidate = candidate.parent;
    }
    return false;
  }

  private isClosed(closure: LocalDataLoaderClosure): boolean {
    if (closure.scope === false) return false;
    const allowed = new Set<ts.Identifier>([
      closure.moduleArgument,
      closure.pathBinding,
      closure.sourceBinding,
    ]);
    if (ts.isIdentifier(closure.moduleDeclaration.name)) {
      allowed.add(closure.moduleDeclaration.name);
    }
    if (
      closure.pathDeclaration &&
      ts.isIdentifier(closure.pathDeclaration.name)
    ) {
      allowed.add(closure.pathDeclaration.name);
    }
    if (
      closure.sourceDeclaration &&
      ts.isIdentifier(closure.sourceDeclaration.name)
    ) {
      allowed.add(closure.sourceDeclaration.name);
    }
    const ownedNames = new Set([
      closure.moduleArgument.text,
      closure.pathBinding.text,
      closure.sourceBinding.text,
    ]);
    let safe = true;
    const visit = (node: ts.Node): void => {
      if (
        safe &&
        ts.isIdentifier(node) &&
        ownedNames.has(node.text) &&
        !allowed.has(node)
      ) {
        safe = false;
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(closure.scope);
    return safe;
  }
}

type SourceReplacement = {
  readonly end: number;
  readonly replacement: string;
  readonly start: number;
};

type TrackedResolvedPathInspection = {
  readonly declaration: ts.VariableDeclaration | false;
  readonly sources: ReadonlyMap<string, string>;
};

type LocalDataLoaderClosure = {
  readonly dynamicImport: ts.CallExpression;
  readonly moduleArgument: ts.Identifier;
  readonly moduleDeclaration: ts.VariableDeclaration;
  readonly pathBinding: ts.Identifier;
  readonly pathDeclaration: ts.VariableDeclaration | false;
  readonly sourceBinding: ts.Identifier;
  readonly sourceDeclaration: ts.VariableDeclaration | false;
  readonly scope: ts.Node | false;
};
