import { posix } from 'node:path';

import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import {
  type DynamicEvaluatorInspection,
  SkillProviderDynamicEvaluatorScenario,
} from './skill-provider-dynamic-evaluator.ts';

import {
  type SkillProviderSourceInspection,
  SkillProviderTypeContextScenario,
} from './skill-provider-type-context.ts';
export class SkillProviderBoundaryScenario {
  private constructor(private readonly request: ts.Node) {}

  static violatesSkillProviderBoundary(
    inspection: SkillProviderImportInspection,
  ): boolean {
    const context =
      SkillProviderTypeContextScenario.createSkillProviderTypeContext(
        inspection,
      );
    let boundaryViolation = false;
    const visit = (node: ts.Node): void => {
      const nodeInspection: BoundaryNodeInspection = {
        checker: context.checker,
        node,
      };
      const reference =
        SkillProviderBoundaryScenario.runtimeModuleReference(nodeInspection);
      const evaluatorInspection: DynamicEvaluatorInspection = {
        allowUnprovenComputedDataAccess:
          inspection.allowUnprovenComputedDataAccess === true,
        checker: context.checker,
        node,
        isAmbientGlobalRoot: (candidate) => {
          const candidateInspection: BoundaryNodeInspection = {
            checker: context.checker,
            node: candidate,
          };
          return SkillProviderBoundaryScenario.isAmbientGlobalRoot(
            candidateInspection,
          );
        },
        isAmbientIdentifier: (candidate) => {
          const candidateInspection: AmbientIdentifierInspection = {
            checker: context.checker,
            node: candidate,
          };
          return SkillProviderBoundaryScenario.isAmbientIdentifier(
            candidateInspection,
          );
        },
      };
      if (
        reference.kind === RuntimeModuleReferenceKind.Unbounded ||
        (reference.kind === RuntimeModuleReferenceKind.Literal &&
          (reference.specifier.startsWith('data:') ||
            SkillProviderBoundaryScenario.referencesSkillProvider(
              reference.specifier,
            ) ||
            LOADER_CAPABLE_MODULE_SPECIFIERS.has(reference.specifier) ||
            DYNAMIC_EVALUATOR_MODULE_SPECIFIERS.has(reference.specifier))) ||
        SkillProviderBoundaryScenario.isUnboundedRequireValue(nodeInspection) ||
        SkillProviderBoundaryScenario.isAmbientRequireMember(nodeInspection) ||
        SkillProviderBoundaryScenario.isUnboundedAmbientLoaderRootValue(
          nodeInspection,
        ) ||
        SkillProviderDynamicEvaluatorScenario.isAmbientDynamicEvaluator(
          evaluatorInspection,
        )
      ) {
        boundaryViolation = true;
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(context.sourceFile);
    return boundaryViolation;
  }

  static runtimeModuleReference(
    inspection: BoundaryNodeInspection,
  ): RuntimeModuleReference {
    const node = inspection.node;
    if (ts.isImportDeclaration(node)) {
      return SkillProviderBoundaryScenario.isTypeOnlyImport(node)
        ? NO_RUNTIME_MODULE_REFERENCE
        : SkillProviderBoundaryScenario.literalModuleReference(
            node.moduleSpecifier,
          );
    }
    if (ts.isExportDeclaration(node)) {
      return SkillProviderBoundaryScenario.isTypeOnlyExport(node) ||
        !node.moduleSpecifier
        ? NO_RUNTIME_MODULE_REFERENCE
        : SkillProviderBoundaryScenario.literalModuleReference(
            node.moduleSpecifier,
          );
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression
    ) {
      return SkillProviderBoundaryScenario.literalModuleReference(
        node.moduleReference.expression,
      );
    }
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        return SkillProviderBoundaryScenario.moduleArgumentReference(
          node.arguments,
        );
      }
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'require'
      ) {
        const identifierInspection: AmbientIdentifierInspection = {
          checker: inspection.checker,
          node: node.expression,
        };
        if (
          SkillProviderBoundaryScenario.isAmbientIdentifier(
            identifierInspection,
          )
        ) {
          return SkillProviderBoundaryScenario.moduleArgumentReference(
            node.arguments,
          );
        }
      }
      const expressionInspection: BoundaryNodeInspection = {
        checker: inspection.checker,
        node: node.expression,
      };
      if (
        SkillProviderBoundaryScenario.containsUnboundedRequireValue(
          expressionInspection,
        )
      ) {
        return UNBOUNDED_RUNTIME_MODULE_REFERENCE;
      }
    }
    return NO_RUNTIME_MODULE_REFERENCE;
  }

  static isTypeOnlyImport(node: ts.ImportDeclaration): boolean {
    const clause = node.importClause;
    if (!clause) return false;
    if (clause.isTypeOnly) return true;
    if (clause.name || !clause.namedBindings) return false;
    return (
      ts.isNamedImports(clause.namedBindings) &&
      clause.namedBindings.elements.length > 0 &&
      clause.namedBindings.elements.every((element) => element.isTypeOnly)
    );
  }

  static isTypeOnlyExport(node: ts.ExportDeclaration): boolean {
    if (node.isTypeOnly) return true;
    if (!node.exportClause || !ts.isNamedExports(node.exportClause))
      return false;
    return (
      node.exportClause.elements.length > 0 &&
      node.exportClause.elements.every((element) => element.isTypeOnly)
    );
  }

  static moduleArgumentReference(
    argumentsList: RuntimeModuleArguments,
  ): RuntimeModuleReference {
    const moduleArgument = argumentsList.at(0);
    return moduleArgument
      ? SkillProviderBoundaryScenario.literalModuleReference(moduleArgument)
      : UNBOUNDED_RUNTIME_MODULE_REFERENCE;
  }

  static literalModuleReference(
    expression: ts.Expression,
  ): RuntimeModuleReference {
    return ts.isStringLiteralLike(expression)
      ? { kind: RuntimeModuleReferenceKind.Literal, specifier: expression.text }
      : UNBOUNDED_RUNTIME_MODULE_REFERENCE;
  }

  static containsUnboundedRequireValue(
    inspection: BoundaryNodeInspection,
  ): boolean {
    if (SkillProviderBoundaryScenario.isUnboundedRequireValue(inspection))
      return true;
    let found = false;
    inspection.node.forEachChild((child) => {
      const childInspection: BoundaryNodeInspection = {
        checker: inspection.checker,
        node: child,
      };
      if (
        SkillProviderBoundaryScenario.containsUnboundedRequireValue(
          childInspection,
        )
      )
        found = true;
    });
    return found;
  }

  static isAmbientRequireMember(inspection: BoundaryNodeInspection): boolean {
    const node = inspection.node;
    const inspectExpression = (
      expression: ts.Expression,
    ): BoundaryNodeInspection => ({
      checker: inspection.checker,
      node: expression,
    });
    if (ts.isPropertyAccessExpression(node)) {
      return (
        (node.name.text === 'require' &&
          (SkillProviderBoundaryScenario.isAmbientLoaderRoot(
            inspectExpression(node.expression),
          ) ||
            SkillProviderBoundaryScenario.isImportMeta(node.expression))) ||
        (node.name.text === 'getBuiltinModule' &&
          SkillProviderBoundaryScenario.isAmbientProcessRoot(
            inspectExpression(node.expression),
          )) ||
        (node.name.text === 'mainModule' &&
          SkillProviderBoundaryScenario.isAmbientProcessRoot(
            inspectExpression(node.expression),
          )) ||
        ((node.name.text === 'process' || node.name.text === 'module') &&
          SkillProviderBoundaryScenario.isAmbientGlobalRoot(
            inspectExpression(node.expression),
          ))
      );
    }
    if (!ts.isElementAccessExpression(node)) return false;
    const loaderRoot = SkillProviderBoundaryScenario.ambientLoaderRootName(
      inspectExpression(node.expression),
    );
    const importMeta = SkillProviderBoundaryScenario.isImportMeta(
      node.expression,
    );
    const processRoot = SkillProviderBoundaryScenario.isAmbientProcessRoot(
      inspectExpression(node.expression),
    );
    if (loaderRoot === false && !importMeta && !processRoot) return false;
    const key = node.argumentExpression;
    if (!key || !ts.isStringLiteralLike(key)) return true;
    if (processRoot) return AMBIENT_PROCESS_LOADER_MEMBERS.has(key.text);
    if (importMeta || loaderRoot === AmbientModuleLoaderRoot.Module) {
      return key.text === AmbientLoaderMember.Require;
    }
    return AMBIENT_GLOBAL_LOADER_MEMBERS.has(key.text);
  }

  static isAmbientLoaderRoot(inspection: BoundaryNodeInspection): boolean {
    return (
      SkillProviderBoundaryScenario.ambientLoaderRootName(inspection) !== false
    );
  }

  static ambientLoaderRootName(
    inspection: BoundaryNodeInspection,
  ): AmbientModuleLoaderRoot | false {
    if (!ts.isExpression(inspection.node)) return false;
    const root = SkillProviderBoundaryScenario.unwrapTransparentExpression(
      inspection.node,
    );
    if (SkillProviderBoundaryScenario.isAmbientGlobalRoot(inspection))
      return AmbientModuleLoaderRoot.GlobalThis;
    if (!ts.isIdentifier(root) || root.text !== AmbientModuleLoaderRoot.Module)
      return false;
    const identifierInspection: AmbientIdentifierInspection = {
      checker: inspection.checker,
      node: root,
    };
    if (
      !SkillProviderBoundaryScenario.isAmbientIdentifier(identifierInspection)
    )
      return false;
    return AmbientModuleLoaderRoot.Module;
  }

  static unwrapTransparentExpression(expression: ts.Expression): ts.Expression {
    if (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isTypeAssertionExpression(expression) ||
      ts.isNonNullExpression(expression) ||
      ts.isSatisfiesExpression(expression)
    ) {
      return SkillProviderBoundaryScenario.unwrapTransparentExpression(
        expression.expression,
      );
    }
    return expression;
  }

  static isAmbientProcessRoot(inspection: BoundaryNodeInspection): boolean {
    if (!ts.isExpression(inspection.node)) return false;
    const root = SkillProviderBoundaryScenario.unwrapTransparentExpression(
      inspection.node,
    );
    if (ts.isIdentifier(root)) {
      const identifierInspection: AmbientIdentifierInspection = {
        checker: inspection.checker,
        node: root,
      };
      return (
        root.text === 'process' &&
        SkillProviderBoundaryScenario.isAmbientIdentifier(identifierInspection)
      );
    }
    const loaderInspection: BoundaryNodeInspection = {
      checker: inspection.checker,
      node: ts.isPropertyAccessExpression(root) ? root.expression : root,
    };
    return (
      ts.isPropertyAccessExpression(root) &&
      root.name.text === 'process' &&
      SkillProviderBoundaryScenario.isAmbientLoaderRoot(loaderInspection)
    );
  }

  static isAmbientGlobalRoot(inspection: BoundaryNodeInspection): boolean {
    if (!ts.isExpression(inspection.node)) return false;
    const root = SkillProviderBoundaryScenario.unwrapTransparentExpression(
      inspection.node,
    );
    if (ts.isIdentifier(root)) {
      const identifierInspection: AmbientIdentifierInspection = {
        checker: inspection.checker,
        node: root,
      };
      return (
        (root.text === AmbientModuleLoaderRoot.Global ||
          root.text === AmbientModuleLoaderRoot.GlobalThis) &&
        SkillProviderBoundaryScenario.isAmbientIdentifier(identifierInspection)
      );
    }
    if (
      !ts.isPropertyAccessExpression(root) &&
      !ts.isElementAccessExpression(root)
    ) {
      return false;
    }
    const member = ts.isPropertyAccessExpression(root)
      ? root.name.text
      : ts.isStringLiteralLike(root.argumentExpression)
        ? root.argumentExpression.text
        : false;
    if (
      member !== AmbientModuleLoaderRoot.Global &&
      member !== AmbientModuleLoaderRoot.GlobalThis
    )
      return false;
    const receiverInspection: BoundaryNodeInspection = {
      checker: inspection.checker,
      node: root.expression,
    };
    return SkillProviderBoundaryScenario.isAmbientGlobalRoot(
      receiverInspection,
    );
  }

  static isImportMeta(expression: ts.Expression): boolean {
    const root =
      SkillProviderBoundaryScenario.unwrapTransparentExpression(expression);
    return (
      ts.isMetaProperty(root) &&
      root.keywordToken === ts.SyntaxKind.ImportKeyword &&
      root.name.text === 'meta'
    );
  }

  static isUnboundedAmbientLoaderRootValue(
    inspection: BoundaryNodeInspection,
  ): boolean {
    const node = inspection.node;
    if (ts.isIdentifier(node)) {
      if (
        node.text !== 'process' &&
        !AMBIENT_MODULE_LOADER_ROOTS.has(node.text)
      ) {
        return false;
      }
      const identifierInspection: AmbientIdentifierInspection = {
        checker: inspection.checker,
        node,
      };
      if (
        !SkillProviderBoundaryScenario.isAmbientIdentifier(identifierInspection)
      ) {
        return false;
      }
      const parent = node.parent;
      if (
        ts.isPartOfTypeNode(node) ||
        SkillProviderBoundaryScenario.isDeclarationName(node) ||
        SkillProviderBoundaryScenario.isNonComputedMemberDeclarationName(node)
      ) {
        return false;
      }
      if (ts.isPropertyAccessExpression(parent) && parent.name === node)
        return false;
      if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
      return !SkillProviderBoundaryScenario.isDirectAmbientMemberReceiver(node);
    }
    return ts.isMetaProperty(node) &&
      SkillProviderBoundaryScenario.isImportMeta(node)
      ? !SkillProviderBoundaryScenario.isDirectAmbientMemberReceiver(node)
      : false;
  }

  static isDirectAmbientMemberReceiver(expression: ts.Expression): boolean {
    const receiver =
      SkillProviderBoundaryScenario.ascendTransparentExpression(expression);
    const parent = receiver.parent;
    return (
      (ts.isPropertyAccessExpression(parent) &&
        parent.expression === receiver) ||
      (ts.isElementAccessExpression(parent) && parent.expression === receiver)
    );
  }

  static ascendTransparentExpression(expression: ts.Expression): ts.Expression {
    const parent = expression.parent;
    if (
      (ts.isParenthesizedExpression(parent) ||
        ts.isAsExpression(parent) ||
        ts.isTypeAssertionExpression(parent) ||
        ts.isNonNullExpression(parent) ||
        ts.isSatisfiesExpression(parent)) &&
      parent.expression === expression
    ) {
      return SkillProviderBoundaryScenario.ascendTransparentExpression(parent);
    }
    return expression;
  }

  static isUnboundedRequireValue(inspection: BoundaryNodeInspection): boolean {
    const node = inspection.node;
    if (!ts.isIdentifier(node) || node.text !== 'require') return false;
    const parent = node.parent;
    if (ts.isTypeNode(parent)) return false;
    if (SkillProviderBoundaryScenario.isErasedRequireDeclarationName(node))
      return false;
    if (SkillProviderBoundaryScenario.isNonComputedMemberDeclarationName(node))
      return false;
    if (ts.isPropertyAccessExpression(parent) && parent.name === node)
      return false;
    if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
    const identifierInspection: AmbientIdentifierInspection = {
      checker: inspection.checker,
      node,
    };
    if (
      !SkillProviderBoundaryScenario.isAmbientIdentifier(identifierInspection)
    )
      return false;
    return !(ts.isCallExpression(parent) && parent.expression === node);
  }

  static isNonComputedMemberDeclarationName(node: ts.Identifier): boolean {
    const parent = node.parent;
    if (
      !ts.isPropertyAssignment(parent) &&
      !ts.isPropertyDeclaration(parent) &&
      !ts.isPropertySignature(parent) &&
      !ts.isMethodDeclaration(parent) &&
      !ts.isMethodSignature(parent) &&
      !ts.isGetAccessorDeclaration(parent) &&
      !ts.isSetAccessorDeclaration(parent)
    ) {
      return false;
    }
    return parent.name === node;
  }

  static isAmbientIdentifier(request: AmbientIdentifierInspection): boolean {
    const locationSymbol = request.checker.getSymbolAtLocation(request.node);
    const resolvedSymbol = request.checker.resolveName(
      request.node.text,
      request.node,
      ts.SymbolFlags.Value,
      false,
    );
    const symbols = [locationSymbol, resolvedSymbol].filter(
      (symbol): symbol is ts.Symbol => Boolean(symbol),
    );
    const hasResolvedLocal = symbols.some((symbol) =>
      symbol.declarations?.some(
        (declaration) =>
          declaration.getSourceFile() === request.node.getSourceFile() &&
          SkillProviderBoundaryScenario.isRuntimeValueDeclaration(declaration),
      ),
    );
    return (
      !hasResolvedLocal &&
      !SkillProviderBoundaryScenario.hasVisibleGlobalThisDeclaration(
        request.node,
      )
    );
  }

  static hasVisibleGlobalThisDeclaration(node: ts.Identifier): boolean {
    if (node.text !== AmbientModuleLoaderRoot.GlobalThis) return false;
    let found = false;
    const visit = (candidate: ts.Node): void => {
      const scopeInspection: DeclarationScopeInspection = {
        declaration: candidate,
        use: node,
      };
      if (
        SkillProviderBoundaryScenario.isNamedGlobalThisDeclaration(candidate) &&
        SkillProviderBoundaryScenario.isRuntimeValueDeclaration(candidate) &&
        SkillProviderBoundaryScenario.declarationScopeContains(scopeInspection)
      ) {
        found = true;
        return;
      }
      ts.forEachChild(candidate, visit);
    };
    visit(node.getSourceFile());
    return found;
  }

  static declarationScopeContains(
    request: DeclarationScopeInspection,
  ): boolean {
    const scope = SkillProviderBoundaryScenario.runtimeDeclarationScope(
      request.declaration,
    );
    if (scope === false) return false;
    let candidate = request.use.parent;
    while (!ts.isSourceFile(candidate)) {
      if (candidate === scope) return true;
      candidate = candidate.parent;
    }
    return candidate === scope;
  }

  static isNamedGlobalThisDeclaration(node: ts.Node): boolean {
    return (
      (ts.isVariableDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isBindingElement(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node)) &&
      Boolean(
        node.name &&
        ts.isIdentifier(node.name) &&
        node.name.text === AmbientModuleLoaderRoot.GlobalThis,
      )
    );
  }

  static runtimeDeclarationScope(declaration: ts.Node): ts.Node | false {
    if (ts.isParameter(declaration)) return declaration.parent;
    if (
      ts.isFunctionDeclaration(declaration) ||
      ts.isClassDeclaration(declaration)
    ) {
      return SkillProviderBoundaryScenario.nearestLexicalScope(
        declaration.parent,
      );
    }
    let variable = declaration;
    while (
      !ts.isVariableDeclaration(variable) &&
      !ts.isParameter(variable) &&
      !ts.isSourceFile(variable)
    ) {
      variable = variable.parent;
    }
    if (ts.isParameter(variable)) return variable.parent;
    if (!ts.isVariableDeclaration(variable)) return false;
    const owner = variable.parent;
    if (ts.isCatchClause(owner)) return owner.block;
    if (!ts.isVariableDeclarationList(owner)) return false;
    if ((owner.flags & ts.NodeFlags.BlockScoped) === 0) {
      return SkillProviderBoundaryScenario.nearestFunctionOrSource(owner);
    }
    const statement = owner.parent;
    if (
      ts.isForStatement(statement) ||
      ts.isForInStatement(statement) ||
      ts.isForOfStatement(statement)
    ) {
      return statement;
    }
    return SkillProviderBoundaryScenario.nearestLexicalScope(statement);
  }

  static nearestFunctionOrSource(node: ts.Node): ts.Node {
    return new SkillProviderBoundaryScenario(node).execute();
  }

  private execute(): ts.Node {
    const node = this.request;
    let candidate = node;
    while (
      !ts.isSourceFile(candidate) &&
      !ts.isModuleBlock(candidate) &&
      !ts.isFunctionLike(candidate)
    ) {
      candidate = candidate.parent;
    }
    return candidate;
  }

  static nearestLexicalScope(node: ts.Node): ts.Node {
    let candidate = node;
    while (
      !ts.isBlock(candidate) &&
      !ts.isCaseBlock(candidate) &&
      !ts.isModuleBlock(candidate) &&
      !ts.isSourceFile(candidate)
    ) {
      candidate = candidate.parent;
    }
    return candidate;
  }

  static isRuntimeValueDeclaration(declaration: ts.Node): boolean {
    if (SkillProviderBoundaryScenario.hasDeclareModifier(declaration))
      return false;
    if (ts.isImportClause(declaration)) return !declaration.isTypeOnly;
    if (ts.isImportSpecifier(declaration)) {
      return !declaration.isTypeOnly && !declaration.parent.parent.isTypeOnly;
    }
    if (ts.isNamespaceImport(declaration))
      return !declaration.parent.isTypeOnly;
    if (ts.isImportEqualsDeclaration(declaration))
      return !declaration.isTypeOnly;
    return (
      ts.isVariableDeclaration(declaration) ||
      ts.isBindingElement(declaration) ||
      ts.isParameter(declaration) ||
      (ts.isFunctionDeclaration(declaration) && Boolean(declaration.body)) ||
      ts.isFunctionExpression(declaration) ||
      ts.isClassDeclaration(declaration) ||
      ts.isClassExpression(declaration) ||
      ts.isEnumDeclaration(declaration) ||
      ts.isModuleDeclaration(declaration)
    );
  }

  static isDeclarationName(node: ts.Identifier): boolean {
    const parent = node.parent;
    return (
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
    );
  }

  static referencesSkillProvider(specifier: string): boolean {
    let normalized = posix.normalize(specifier);
    if (specifier.startsWith('file:')) {
      try {
        normalized = posix.normalize(fileURLToPath(specifier));
      } catch {
        return true;
      }
    }
    const framed = `/${normalized.replace(/^\/+|\/+$/gu, '')}/`;
    return (
      framed.includes('/.agents/skills/') ||
      framed.includes(
        '/.cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/',
      ) ||
      framed.includes(
        '/.cortex/teams/ai/dynamic-skills/executable-skill-host/scripts/',
      )
    );
  }

  static isErasedRequireDeclarationName(node: ts.Identifier): boolean {
    const parent = node.parent;
    if (
      (ts.isPropertySignature(parent) || ts.isMethodSignature(parent)) &&
      parent.name === node
    ) {
      return true;
    }
    if (
      (ts.isInterfaceDeclaration(parent) ||
        ts.isTypeAliasDeclaration(parent)) &&
      parent.name === node
    ) {
      return true;
    }
    if (
      'name' in parent &&
      parent.name === node &&
      SkillProviderBoundaryScenario.hasDeclareModifier(parent)
    ) {
      return true;
    }
    if (
      ts.isVariableDeclaration(parent) &&
      parent.name === node &&
      ts.isVariableDeclarationList(parent.parent) &&
      SkillProviderBoundaryScenario.hasDeclareModifier(parent.parent.parent)
    ) {
      return true;
    }
    return false;
  }

  static hasDeclareModifier(node: ts.Node): boolean {
    let candidate = node;
    while (!ts.isSourceFile(candidate)) {
      if (
        ts.canHaveModifiers(candidate) &&
        ts
          .getModifiers(candidate)
          ?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword)
      ) {
        return true;
      }
      candidate = candidate.parent;
    }
    return false;
  }
}

export type SkillProviderImportInspection = SkillProviderSourceInspection;

export enum RuntimeModuleReferenceKind {
  Literal = 'literal',
  None = 'none',
  Unbounded = 'unbounded',
}

export enum AmbientModuleLoaderRoot {
  Global = 'global',
  GlobalThis = 'globalThis',
  Module = 'module',
}

export enum AmbientLoaderMember {
  GetBuiltinModule = 'getBuiltinModule',
  Global = 'global',
  GlobalThis = 'globalThis',
  MainModule = 'mainModule',
  Module = 'module',
  Process = 'process',
  Require = 'require',
}

export enum LoaderCapableModuleSpecifier {
  Module = 'module',
  NodeModule = 'node:module',
  NodeProcess = 'node:process',
  Process = 'process',
}

export enum DynamicEvaluatorModuleSpecifier {
  NodeVm = 'node:vm',
  Vm = 'vm',
}

export const AMBIENT_MODULE_LOADER_ROOTS = new Set<string>(
  Object.values(AmbientModuleLoaderRoot),
);

export const LOADER_CAPABLE_MODULE_SPECIFIERS = new Set<string>(
  Object.values(LoaderCapableModuleSpecifier),
);

export const DYNAMIC_EVALUATOR_MODULE_SPECIFIERS = new Set<string>(
  Object.values(DynamicEvaluatorModuleSpecifier),
);

export const AMBIENT_GLOBAL_LOADER_MEMBERS = new Set<string>([
  AmbientLoaderMember.Global,
  AmbientLoaderMember.GlobalThis,
  AmbientLoaderMember.Module,
  AmbientLoaderMember.Process,
  AmbientLoaderMember.Require,
]);

export const AMBIENT_PROCESS_LOADER_MEMBERS = new Set<string>([
  AmbientLoaderMember.GetBuiltinModule,
  AmbientLoaderMember.MainModule,
]);

export type RuntimeModuleReference =
  | { readonly kind: RuntimeModuleReferenceKind.None }
  | {
      readonly kind: RuntimeModuleReferenceKind.Literal;
      readonly specifier: string;
    }
  | { readonly kind: RuntimeModuleReferenceKind.Unbounded };

export type RuntimeModuleArguments = ts.NodeArray<ts.Expression>;

export type BoundaryNodeInspection = {
  readonly checker: ts.TypeChecker;
  readonly node: ts.Node;
};

export type AmbientIdentifierInspection = {
  readonly checker: ts.TypeChecker;
  readonly node: ts.Identifier;
};

export type DeclarationScopeInspection = {
  readonly declaration: ts.Node;
  readonly use: ts.Node;
};

export const NO_RUNTIME_MODULE_REFERENCE: RuntimeModuleReference = {
  kind: RuntimeModuleReferenceKind.None,
};

export const UNBOUNDED_RUNTIME_MODULE_REFERENCE: RuntimeModuleReference = {
  kind: RuntimeModuleReferenceKind.Unbounded,
};
