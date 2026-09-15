import ts from 'typescript';

import { itemAt } from './skill-provider-command-types.ts';

import { stringMapFromHost } from './skill-provider-command-types.ts';

import { SkillProviderGeneratedArtifactLoaderScenario } from './skill-provider-generated-artifact-loader.ts';

import { SkillProviderLocalDataLoaderScenario } from './skill-provider-local-data-loader.ts';

import { UntrustedYamlBoundary } from '../src/lib/guards.ts';

export class SkillProviderBoundedPackageLoaderScenario {
  static specializeBoundedPackageLoaders(
    inspection: BoundedPackageLoaderInspection,
  ): string {
    const sourceFile = ts.createSourceFile(
      inspection.path,
      inspection.source,
      ts.ScriptTarget.ES2022,
      true,
    );
    const candidates =
      SkillProviderBoundedPackageLoaderScenario.boundedLoaderCandidates(
        sourceFile,
      );
    const replacements: SourceReplacement[] = [];
    for (const candidate of candidates) {
      const validation: CandidateValidation = {
        candidate,
        inspection,
        sourceFile,
      };
      if (
        !SkillProviderBoundedPackageLoaderScenario.isClosedBoundedLoader(
          validation,
        )
      )
        continue;
      const importReplacement: SourceReplacement = {
        end: candidate.createRequireImport.moduleSpecifier.end,
        replacement: "'bounded-package-loader'",
        start:
          candidate.createRequireImport.moduleSpecifier.getStart(sourceFile),
      };
      replacements.push(importReplacement);
      const dynamicImportReplacement: SourceReplacement = {
        end: candidate.dynamicImport.end,
        replacement: 'Promise.resolve(false)',
        start: candidate.dynamicImport.getStart(sourceFile),
      };
      replacements.push(dynamicImportReplacement);
    }
    let specialized = inspection.source;
    const pending = [...replacements];
    while (pending.length > 0) {
      let latestIndex = 0;
      for (let index = 1; index < pending.length; index += 1) {
        if (
          itemAt([pending, index]).start > itemAt([pending, latestIndex]).start
        ) {
          latestIndex = index;
        }
      }
      const replacement = pending.splice(latestIndex, 1)[0];
      if (!replacement) continue;
      specialized = `${specialized.slice(0, replacement.start)}${replacement.replacement}${specialized.slice(replacement.end)}`;
    }
    return specialized;
  }

  static specializeProvenGeneratedArtifactLoader(
    inspection: BoundedPackageLoaderInspection,
  ): string {
    return new SkillProviderGeneratedArtifactLoaderScenario(
      inspection,
    ).specialize();
  }

  static specializeBoundedLocalDataLoaders(
    inspection: BoundedPackageLoaderInspection,
  ): string {
    return new SkillProviderLocalDataLoaderScenario(inspection).specialize();
  }

  static boundedLoaderCandidates(
    sourceFile: ts.SourceFile,
  ): readonly BoundedLoaderCandidate[] {
    const createRequireImports = new Map<string, ts.ImportDeclaration>();
    const pathToFileUrlImports = new Set<string>();
    const variableDeclarations = new Map<string, ts.VariableDeclaration>();
    const functionDeclarations: BoundedLoaderDeclaration[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteralLike(node.moduleSpecifier) &&
        (node.moduleSpecifier.text === 'node:module' ||
          node.moduleSpecifier.text === 'module') &&
        node.importClause?.namedBindings &&
        ts.isNamedImports(node.importClause.namedBindings) &&
        !node.importClause.name &&
        node.importClause.namedBindings.elements.length === 1
      ) {
        for (const element of node.importClause.namedBindings.elements) {
          const [imported = element.name.text] = [element.propertyName?.text];
          if (imported === 'createRequire') {
            createRequireImports.set(element.name.text, node);
          }
        }
      }
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteralLike(node.moduleSpecifier) &&
        node.moduleSpecifier.text === 'node:url' &&
        node.importClause?.namedBindings &&
        ts.isNamedImports(node.importClause.namedBindings)
      ) {
        for (const element of node.importClause.namedBindings.elements) {
          const [imported = element.name.text] = [element.propertyName?.text];
          if (imported === 'pathToFileURL') {
            pathToFileUrlImports.add(element.name.text);
          }
        }
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        variableDeclarations.set(node.name.text, node);
      }
      if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
        functionDeclarations.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    const candidates: BoundedLoaderCandidate[] = [];
    for (const functionDeclaration of functionDeclarations) {
      const functionName = functionDeclaration.name;
      const parameterDeclaration = functionDeclaration.parameters[0];
      if (
        !functionName ||
        !ts.isIdentifier(functionName) ||
        (functionDeclaration.parameters.length !== 1 &&
          functionDeclaration.parameters.length !== 2) ||
        !parameterDeclaration ||
        !ts.isIdentifier(parameterDeclaration.name) ||
        !functionDeclaration.body
      ) {
        continue;
      }
      const parameter = parameterDeclaration.name;
      const validationParameterDeclaration = functionDeclaration.parameters[1];
      for (const resolvedDeclaration of variableDeclarations.values()) {
        if (
          !resolvedDeclaration.initializer ||
          !ts.isIdentifier(resolvedDeclaration.name) ||
          !ts.isCallExpression(resolvedDeclaration.initializer) ||
          !ts.isPropertyAccessExpression(
            resolvedDeclaration.initializer.expression,
          ) ||
          resolvedDeclaration.initializer.expression.name.text !== 'resolve' ||
          resolvedDeclaration.initializer.arguments.length !== 1 ||
          resolvedDeclaration.initializer.arguments[0]?.getText(sourceFile) !==
            parameter.text
        ) {
          continue;
        }
        const requireExpression =
          resolvedDeclaration.initializer.expression.expression;
        if (!ts.isIdentifier(requireExpression)) continue;
        const requireDeclaration = variableDeclarations.get(
          requireExpression.text,
        );
        if (
          !requireDeclaration?.initializer ||
          !ts.isIdentifier(requireDeclaration.name) ||
          !ts.isCallExpression(requireDeclaration.initializer) ||
          !ts.isIdentifier(requireDeclaration.initializer.expression)
        ) {
          continue;
        }
        const createRequireImport = createRequireImports.get(
          requireDeclaration.initializer.expression.text,
        );
        if (!createRequireImport) continue;
        const search: DynamicImportSearch = {
          body: functionDeclaration.body,
          resolvedBinding: resolvedDeclaration.name,
        };
        const dynamicImport =
          SkillProviderBoundedPackageLoaderScenario.findBoundedDynamicImport(
            search,
          );
        if (dynamicImport === false) continue;
        const dynamicArgument = dynamicImport.arguments[0];
        if (
          !dynamicArgument ||
          !ts.isPropertyAccessExpression(dynamicArgument) ||
          !ts.isCallExpression(dynamicArgument.expression) ||
          !ts.isIdentifier(dynamicArgument.expression.expression) ||
          !pathToFileUrlImports.has(dynamicArgument.expression.expression.text)
        ) {
          continue;
        }
        const candidate: BoundedLoaderCandidate = {
          createRequireBinding: requireDeclaration.initializer.expression,
          createRequireImport,
          dynamicImport,
          functionDeclaration,
          functionName,
          methodOwner:
            ts.isMethodDeclaration(functionDeclaration) &&
            (ts.isClassDeclaration(functionDeclaration.parent) ||
              ts.isClassExpression(functionDeclaration.parent))
              ? functionDeclaration.parent
              : false,
          parameter,
          validationParameter:
            validationParameterDeclaration &&
            ts.isIdentifier(validationParameterDeclaration.name)
              ? validationParameterDeclaration.name
              : false,
          pathToFileUrlBinding: dynamicArgument.expression.expression,
          requireBinding: requireDeclaration.name,
          requireDeclaration,
          resolvedBinding: resolvedDeclaration.name,
          resolvedDeclaration,
        };
        candidates.push(candidate);
      }
    }
    return candidates;
  }

  static findBoundedDynamicImport(
    search: DynamicImportSearch,
  ): ts.CallExpression | false {
    const imports: ts.CallExpression[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length === 1 &&
        (() => {
          const inspection: ResolvedFileUrlImportInspection = {
            argument: itemAt([node.arguments, 0]),
            resolvedBinding: search.resolvedBinding,
          };
          return SkillProviderBoundedPackageLoaderScenario.isResolvedFileUrlImport(
            inspection,
          );
        })()
      ) {
        imports.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(search.body);
    return imports.length === 1 ? itemAt([imports, 0]) : false;
  }

  static isResolvedFileUrlImport(
    inspection: ResolvedFileUrlImportInspection,
  ): boolean {
    const argument = inspection.argument;
    if (
      !argument ||
      !ts.isPropertyAccessExpression(argument) ||
      argument.name.text !== 'href' ||
      !ts.isCallExpression(argument.expression) ||
      !ts.isIdentifier(argument.expression.expression) ||
      argument.expression.expression.text !== 'pathToFileURL' ||
      argument.expression.arguments.length !== 1
    ) {
      return false;
    }
    const resolved = argument.expression.arguments[0];
    if (!resolved) return false;
    return (
      ts.isIdentifier(resolved) &&
      resolved.text === inspection.resolvedBinding.text
    );
  }

  static candidateCallExpression(
    inspection: CandidateCallInspection,
  ): ts.CallExpression | false {
    const node = inspection.node;
    const candidate = inspection.candidate;
    if (ts.isCallExpression(node.parent) && node.parent.expression === node) {
      return node.parent;
    }
    if (candidate.methodOwner === false) return false;
    const access = node.parent;
    const call = access.parent;
    if (
      !ts.isPropertyAccessExpression(access) ||
      access.name !== node ||
      !ts.isCallExpression(call) ||
      call.expression !== access ||
      access.expression.kind !== ts.SyntaxKind.ThisKeyword ||
      SkillProviderBoundedPackageLoaderScenario.nearestClassLike(call) !==
        candidate.methodOwner ||
      !SkillProviderBoundedPackageLoaderScenario.isClassMethodThisCall({
        call,
        owner: candidate.methodOwner,
      })
    ) {
      return false;
    }
    return call;
  }

  static nearestClassLike(node: ts.Node): ts.ClassLikeDeclaration | false {
    let candidate = node.parent;
    while (!ts.isSourceFile(candidate)) {
      if (ts.isClassDeclaration(candidate) || ts.isClassExpression(candidate)) {
        return candidate;
      }
      candidate = candidate.parent;
    }
    return false;
  }

  static isClassMethodThisCall(
    inspection: ClassMethodThisCallInspection,
  ): boolean {
    const { call, owner } = inspection;
    let candidate = call.parent;
    while (candidate !== owner && !ts.isSourceFile(candidate)) {
      if (ts.isFunctionLike(candidate) && !ts.isArrowFunction(candidate)) {
        return ts.isMethodDeclaration(candidate) && candidate.parent === owner;
      }
      candidate = candidate.parent;
    }
    return false;
  }

  static isClosedValidationFunction(expression: ts.Expression): boolean {
    if (
      (!ts.isArrowFunction(expression) &&
        !ts.isFunctionExpression(expression)) ||
      expression.parameters.length !== 1 ||
      !expression.body ||
      !ts.isBlock(expression.body) ||
      !expression.type ||
      !ts.isTypePredicateNode(expression.type)
    ) {
      return false;
    }
    let safe = true;
    const visit = (node: ts.Node): void => {
      if (!safe) return;
      if (
        ts.isCallExpression(node) ||
        ts.isNewExpression(node) ||
        ts.isAwaitExpression(node) ||
        ts.isYieldExpression(node) ||
        ts.isThrowStatement(node) ||
        node.kind === ts.SyntaxKind.DeleteExpression ||
        (ts.isPostfixUnaryExpression(node) &&
          (node.operator === ts.SyntaxKind.PlusPlusToken ||
            node.operator === ts.SyntaxKind.MinusMinusToken)) ||
        (ts.isPrefixUnaryExpression(node) &&
          (node.operator === ts.SyntaxKind.PlusPlusToken ||
            node.operator === ts.SyntaxKind.MinusMinusToken))
      ) {
        safe = false;
        return;
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      ) {
        safe = false;
        return;
      }
      if (
        (ts.isFunctionDeclaration(node) ||
          ts.isFunctionExpression(node) ||
          ts.isArrowFunction(node)) &&
        node !== expression
      ) {
        safe = false;
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(expression.body);
    return safe;
  }

  static isClosedBoundedLoader(validation: CandidateValidation): boolean {
    const candidate = validation.candidate;
    const requireInitializer = candidate.requireDeclaration.initializer;
    const resolvedInitializer = candidate.resolvedDeclaration.initializer;
    if (
      !requireInitializer ||
      !ts.isCallExpression(requireInitializer) ||
      !resolvedInitializer ||
      !ts.isCallExpression(resolvedInitializer) ||
      !ts.isPropertyAccessExpression(resolvedInitializer.expression)
    ) {
      return false;
    }
    const allowedRequireReference = resolvedInitializer.expression.expression;
    const [allowedParameterReference = false] = [
      resolvedInitializer.arguments[0],
    ];
    const dynamicArgument = candidate.dynamicImport.arguments[0];
    if (
      !dynamicArgument ||
      !ts.isPropertyAccessExpression(dynamicArgument) ||
      !ts.isCallExpression(dynamicArgument.expression)
    ) {
      return false;
    }
    const [allowedResolvedReference = false] = [
      dynamicArgument.expression.arguments[0],
    ];
    const allowedPathToFileUrlReference = dynamicArgument.expression.expression;
    const validationParameter = candidate.validationParameter;
    const declaredFunctionNames = new Set<string>();
    const collectFunctionNames = (node: ts.Node): void => {
      if (
        (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
        node.name &&
        ts.isIdentifier(node.name)
      ) {
        declaredFunctionNames.add(node.name.text);
      }
      ts.forEachChild(node, collectFunctionNames);
    };
    collectFunctionNames(validation.sourceFile);
    let safe = true;
    let callCount = 0;
    let validationCallCount = 0;
    const visit = (node: ts.Node): void => {
      if (!safe) return;
      if (ts.isIdentifier(node) && node.text === candidate.functionName.text) {
        if (node === candidate.functionName) return;
        const parent =
          SkillProviderBoundedPackageLoaderScenario.candidateCallExpression({
            candidate,
            node,
          });
        if (parent === false) {
          safe = false;
          return;
        }
        const argument = parent.arguments[0];
        const packageInspection: RepositoryPackageInspection | false =
          argument && ts.isStringLiteralLike(argument)
            ? {
                sources: validation.inspection.sources,
                specifier: argument.text,
              }
            : false;
        const validationArgument = parent.arguments[1];
        const hasValidValidationArgument =
          validationParameter === false
            ? parent.arguments.length === 1
            : parent.arguments.length === 2 &&
              !!validationArgument &&
              ((ts.isIdentifier(validationArgument) &&
                declaredFunctionNames.has(validationArgument.text)) ||
                SkillProviderBoundedPackageLoaderScenario.isClosedValidationFunction(
                  validationArgument,
                ));
        if (
          !hasValidValidationArgument ||
          !argument ||
          !ts.isStringLiteralLike(argument) ||
          !SAFE_PACKAGE_SPECIFIER.test(argument.text) ||
          (packageInspection !== false &&
            SkillProviderBoundedPackageLoaderScenario.isRepositoryBackedPackage(
              packageInspection,
            ))
        ) {
          safe = false;
          return;
        }
        callCount += 1;
      }
      if (
        ts.isIdentifier(node) &&
        node.text === candidate.requireBinding.text &&
        node !== candidate.requireBinding &&
        node !== allowedRequireReference
      ) {
        safe = false;
        return;
      }
      if (
        ts.isIdentifier(node) &&
        node.text === candidate.parameter.text &&
        node !== candidate.parameter &&
        node !== allowedParameterReference &&
        !ts.isTemplateSpan(node.parent)
      ) {
        safe = false;
        return;
      }
      if (
        ts.isIdentifier(node) &&
        node.text === candidate.resolvedBinding.text &&
        node !== candidate.resolvedBinding &&
        node !== allowedResolvedReference
      ) {
        safe = false;
        return;
      }
      if (
        validationParameter !== false &&
        ts.isIdentifier(node) &&
        node.text === validationParameter.text &&
        node !== validationParameter
      ) {
        const parent = node.parent;
        if (
          !ts.isCallExpression(parent) ||
          parent.expression !== node ||
          parent.arguments.length !== 1 ||
          !parent.arguments[0] ||
          !ts.isIdentifier(parent.arguments[0]) ||
          parent.arguments[0].text !== 'imported'
        ) {
          safe = false;
          return;
        }
        validationCallCount += 1;
      }
      if (
        ts.isIdentifier(node) &&
        node.text === candidate.createRequireBinding.text &&
        node !== candidate.createRequireBinding &&
        !(ts.isImportSpecifier(node.parent) && node.parent.name === node)
      ) {
        safe = false;
        return;
      }
      if (
        ts.isIdentifier(node) &&
        node.text === candidate.pathToFileUrlBinding.text &&
        node !== allowedPathToFileUrlReference &&
        !(ts.isImportSpecifier(node.parent) && node.parent.name === node)
      ) {
        safe = false;
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(validation.sourceFile);
    return (
      safe &&
      callCount > 0 &&
      (validationParameter === false || validationCallCount > 0)
    );
  }

  static isRepositoryBackedPackage(
    inspection: RepositoryPackageInspection,
  ): boolean {
    for (const [path, source] of inspection.sources) {
      if (!path.endsWith('package.json') || source.length === 0) continue;
      let document: RepositoryPackageDocument;
      try {
        const parsed = UntrustedYamlBoundary.fromJson(JSON.parse(source));
        if (!UntrustedYamlBoundary.isRecord(parsed)) continue;
        const candidate: RepositoryPackageDocument = {};
        if ('name' in parsed && typeof parsed.name === 'string')
          candidate.name = parsed.name;
        for (const key of [
          'dependencies',
          'devDependencies',
          'optionalDependencies',
        ]) {
          if (!(key in parsed)) continue;
          const entry = parsed[key];
          if (!entry) continue;
          const values = stringMapFromHost(entry);
          if (values === false) continue;
          if (key === 'dependencies') candidate.dependencies = values;
          if (key === 'devDependencies') candidate.devDependencies = values;
          if (key === 'optionalDependencies')
            candidate.optionalDependencies = values;
        }
        document = candidate;
      } catch {
        continue;
      }
      if (document.name === inspection.specifier) return true;
      for (const dependencies of [
        document.dependencies,
        document.devDependencies,
        document.optionalDependencies,
      ]) {
        const [dependency = false] = [dependencies?.[inspection.specifier]];
        if (
          dependency !== false &&
          (dependency.startsWith('file:') ||
            dependency.startsWith('workspace:'))
        ) {
          return true;
        }
      }
    }
    return false;
  }
}

export type BoundedPackageLoaderInspection = {
  readonly path: string;
  readonly roots: ReadonlySet<string>;
  readonly source: string;
  readonly sources: ReadonlyMap<string, string>;
};

type BoundedLoaderCandidate = {
  readonly createRequireBinding: ts.Identifier;
  readonly createRequireImport: ts.ImportDeclaration;
  readonly dynamicImport: ts.CallExpression;
  readonly functionDeclaration: BoundedLoaderDeclaration;
  readonly functionName: ts.Identifier;
  readonly methodOwner: ts.ClassLikeDeclaration | false;
  readonly parameter: ts.Identifier;
  readonly validationParameter: ts.Identifier | false;
  readonly pathToFileUrlBinding: ts.Identifier;
  readonly requireBinding: ts.Identifier;
  readonly requireDeclaration: ts.VariableDeclaration;
  readonly resolvedBinding: ts.Identifier;
  readonly resolvedDeclaration: ts.VariableDeclaration;
};

type CandidateValidation = {
  readonly candidate: BoundedLoaderCandidate;
  readonly inspection: BoundedPackageLoaderInspection;
  readonly sourceFile: ts.SourceFile;
};

type CandidateCallInspection = {
  readonly candidate: BoundedLoaderCandidate;
  readonly node: ts.Identifier;
};

type ClassMethodThisCallInspection = {
  readonly call: ts.CallExpression;
  readonly owner: ts.ClassLikeDeclaration;
};

type BoundedLoaderDeclaration = ts.FunctionDeclaration | ts.MethodDeclaration;

type RepositoryPackageDocument = {
  dependencies?: Readonly<Record<string, string>>;
  devDependencies?: Readonly<Record<string, string>>;
  name?: string;
  optionalDependencies?: Readonly<Record<string, string>>;
};

type SourceReplacement = {
  readonly end: number;
  readonly replacement: string;
  readonly start: number;
};

const SAFE_PACKAGE_SPECIFIER =
  /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u;

type DynamicImportSearch = {
  readonly body: ts.Block;
  readonly resolvedBinding: ts.Identifier;
};

type ResolvedFileUrlImportInspection = {
  readonly argument: ts.Expression | false;
  readonly resolvedBinding: ts.Identifier;
};

type RepositoryPackageInspection = {
  readonly sources: ReadonlyMap<string, string>;
  readonly specifier: string;
};
