import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'bun:test';
import ts from 'typescript';
import {
  type DynamicEvaluatorInspection,
  isAmbientDynamicEvaluator,
} from './skill-provider-dynamic-evaluator.ts';
import {
  createSkillProviderTypeContext,
  type SkillProviderSourceInspection,
} from './skill-provider-type-context.ts';

type LoomSourceScanOptions = {
  readonly cwd: string;
  readonly onlyFiles: true;
};

const LOOM_ROOT = join(import.meta.dir, '..');
type SkillProviderImportInspection = SkillProviderSourceInspection;

enum RuntimeModuleReferenceKind {
  Literal = 'literal',
  None = 'none',
  Unbounded = 'unbounded',
}

enum AmbientModuleLoaderRoot {
  Global = 'global',
  GlobalThis = 'globalThis',
  Module = 'module',
}

enum AmbientLoaderMember {
  GetBuiltinModule = 'getBuiltinModule',
  Global = 'global',
  GlobalThis = 'globalThis',
  MainModule = 'mainModule',
  Module = 'module',
  Process = 'process',
  Require = 'require',
}

enum LoaderCapableModuleSpecifier {
  Module = 'module',
  NodeModule = 'node:module',
  NodeProcess = 'node:process',
  Process = 'process',
}

enum DynamicEvaluatorModuleSpecifier {
  NodeVm = 'node:vm',
  Vm = 'vm',
}

const AMBIENT_MODULE_LOADER_ROOTS = new Set<string>(
  Object.values(AmbientModuleLoaderRoot),
);
const LOADER_CAPABLE_MODULE_SPECIFIERS = new Set<string>(
  Object.values(LoaderCapableModuleSpecifier),
);
const DYNAMIC_EVALUATOR_MODULE_SPECIFIERS = new Set<string>(
  Object.values(DynamicEvaluatorModuleSpecifier),
);
const AMBIENT_GLOBAL_LOADER_MEMBERS = new Set<string>([
  AmbientLoaderMember.Global,
  AmbientLoaderMember.GlobalThis,
  AmbientLoaderMember.Module,
  AmbientLoaderMember.Process,
  AmbientLoaderMember.Require,
]);
const AMBIENT_PROCESS_LOADER_MEMBERS = new Set<string>([
  AmbientLoaderMember.GetBuiltinModule,
  AmbientLoaderMember.MainModule,
]);
export const LOOM_EXECUTABLE_SOURCE = /\.(?:[cm]?[jt]sx?)$/u;

type RuntimeModuleReference =
  | { readonly kind: RuntimeModuleReferenceKind.None }
  | {
      readonly kind: RuntimeModuleReferenceKind.Literal;
      readonly specifier: string;
    }
  | { readonly kind: RuntimeModuleReferenceKind.Unbounded };

type RuntimeModuleArguments = ts.NodeArray<ts.Expression>;

type BoundaryNodeInspection = {
  readonly checker: ts.TypeChecker;
  readonly node: ts.Node;
};

type AmbientIdentifierInspection = {
  readonly checker: ts.TypeChecker;
  readonly node: ts.Identifier;
};

type DeclarationScopeInspection = {
  readonly declaration: ts.Node;
  readonly use: ts.Node;
};

const NO_RUNTIME_MODULE_REFERENCE: RuntimeModuleReference = {
  kind: RuntimeModuleReferenceKind.None,
};
const UNBOUNDED_RUNTIME_MODULE_REFERENCE: RuntimeModuleReference = {
  kind: RuntimeModuleReferenceKind.Unbounded,
};

export function violatesSkillProviderBoundary(
  inspection: SkillProviderImportInspection,
): boolean {
  const context = createSkillProviderTypeContext(inspection);
  let boundaryViolation = false;
  const visit = (node: ts.Node): void => {
    const nodeInspection: BoundaryNodeInspection = {
      checker: context.checker,
      node,
    };
    const reference = runtimeModuleReference(nodeInspection);
    const evaluatorInspection: DynamicEvaluatorInspection = {
      checker: context.checker,
      node,
      isAmbientGlobalRoot: (candidate) => {
        const candidateInspection: BoundaryNodeInspection = {
          checker: context.checker,
          node: candidate,
        };
        return isAmbientGlobalRoot(candidateInspection);
      },
      isAmbientIdentifier: (candidate) => {
        const candidateInspection: AmbientIdentifierInspection = {
          checker: context.checker,
          node: candidate,
        };
        return isAmbientIdentifier(candidateInspection);
      },
    };
    if (
      reference.kind === RuntimeModuleReferenceKind.Unbounded ||
      (reference.kind === RuntimeModuleReferenceKind.Literal &&
        (referencesSkillProvider(reference.specifier) ||
          LOADER_CAPABLE_MODULE_SPECIFIERS.has(reference.specifier) ||
          DYNAMIC_EVALUATOR_MODULE_SPECIFIERS.has(reference.specifier))) ||
      isUnboundedRequireValue(nodeInspection) ||
      isAmbientRequireMember(nodeInspection) ||
      isUnboundedAmbientLoaderRootValue(nodeInspection) ||
      isAmbientDynamicEvaluator(evaluatorInspection)
    ) {
      boundaryViolation = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(context.sourceFile);
  return boundaryViolation;
}

function runtimeModuleReference(
  inspection: BoundaryNodeInspection,
): RuntimeModuleReference {
  const node = inspection.node;
  if (ts.isImportDeclaration(node)) {
    return isTypeOnlyImport(node)
      ? NO_RUNTIME_MODULE_REFERENCE
      : literalModuleReference(node.moduleSpecifier);
  }
  if (ts.isExportDeclaration(node)) {
    return isTypeOnlyExport(node) || !node.moduleSpecifier
      ? NO_RUNTIME_MODULE_REFERENCE
      : literalModuleReference(node.moduleSpecifier);
  }
  if (
    ts.isImportEqualsDeclaration(node) &&
    !node.isTypeOnly &&
    ts.isExternalModuleReference(node.moduleReference) &&
    node.moduleReference.expression
  ) {
    return literalModuleReference(node.moduleReference.expression);
  }
  if (ts.isCallExpression(node)) {
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      return moduleArgumentReference(node.arguments);
    }
    if (
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require'
    ) {
      const identifierInspection: AmbientIdentifierInspection = {
        checker: inspection.checker,
        node: node.expression,
      };
      if (isAmbientIdentifier(identifierInspection)) {
        return moduleArgumentReference(node.arguments);
      }
    }
    const expressionInspection: BoundaryNodeInspection = {
      checker: inspection.checker,
      node: node.expression,
    };
    if (containsUnboundedRequireValue(expressionInspection)) {
      return UNBOUNDED_RUNTIME_MODULE_REFERENCE;
    }
  }
  return NO_RUNTIME_MODULE_REFERENCE;
}

function isTypeOnlyImport(node: ts.ImportDeclaration): boolean {
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

function isTypeOnlyExport(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;
  if (!node.exportClause || !ts.isNamedExports(node.exportClause)) return false;
  return (
    node.exportClause.elements.length > 0 &&
    node.exportClause.elements.every((element) => element.isTypeOnly)
  );
}

function moduleArgumentReference(
  argumentsList: RuntimeModuleArguments,
): RuntimeModuleReference {
  const moduleArgument = argumentsList.at(0);
  return moduleArgument
    ? literalModuleReference(moduleArgument)
    : UNBOUNDED_RUNTIME_MODULE_REFERENCE;
}

function literalModuleReference(
  expression: ts.Expression,
): RuntimeModuleReference {
  return ts.isStringLiteralLike(expression)
    ? { kind: RuntimeModuleReferenceKind.Literal, specifier: expression.text }
    : UNBOUNDED_RUNTIME_MODULE_REFERENCE;
}

function containsUnboundedRequireValue(
  inspection: BoundaryNodeInspection,
): boolean {
  if (isUnboundedRequireValue(inspection)) return true;
  let found = false;
  inspection.node.forEachChild((child) => {
    const childInspection: BoundaryNodeInspection = {
      checker: inspection.checker,
      node: child,
    };
    if (containsUnboundedRequireValue(childInspection)) found = true;
  });
  return found;
}

function isAmbientRequireMember(inspection: BoundaryNodeInspection): boolean {
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
        (isAmbientLoaderRoot(inspectExpression(node.expression)) ||
          isImportMeta(node.expression))) ||
      (node.name.text === 'getBuiltinModule' &&
        isAmbientProcessRoot(inspectExpression(node.expression))) ||
      (node.name.text === 'mainModule' &&
        isAmbientProcessRoot(inspectExpression(node.expression))) ||
      ((node.name.text === 'process' || node.name.text === 'module') &&
        isAmbientGlobalRoot(inspectExpression(node.expression)))
    );
  }
  if (!ts.isElementAccessExpression(node)) return false;
  const loaderRoot = ambientLoaderRootName(inspectExpression(node.expression));
  const importMeta = isImportMeta(node.expression);
  const processRoot = isAmbientProcessRoot(inspectExpression(node.expression));
  if (loaderRoot === false && !importMeta && !processRoot) return false;
  const key = node.argumentExpression;
  if (!key || !ts.isStringLiteralLike(key)) return true;
  if (processRoot) return AMBIENT_PROCESS_LOADER_MEMBERS.has(key.text);
  if (importMeta || loaderRoot === AmbientModuleLoaderRoot.Module) {
    return key.text === AmbientLoaderMember.Require;
  }
  return AMBIENT_GLOBAL_LOADER_MEMBERS.has(key.text);
}

function isAmbientLoaderRoot(inspection: BoundaryNodeInspection): boolean {
  return ambientLoaderRootName(inspection) !== false;
}

function ambientLoaderRootName(
  inspection: BoundaryNodeInspection,
): AmbientModuleLoaderRoot | false {
  const root = unwrapTransparentExpression(inspection.node as ts.Expression);
  if (!ts.isIdentifier(root) || !AMBIENT_MODULE_LOADER_ROOTS.has(root.text)) {
    return false;
  }
  const identifierInspection: AmbientIdentifierInspection = {
    checker: inspection.checker,
    node: root,
  };
  if (!isAmbientIdentifier(identifierInspection)) return false;
  if (root.text === AmbientModuleLoaderRoot.Global) {
    return AmbientModuleLoaderRoot.Global;
  }
  if (root.text === AmbientModuleLoaderRoot.GlobalThis) {
    return AmbientModuleLoaderRoot.GlobalThis;
  }
  return AmbientModuleLoaderRoot.Module;
}

function unwrapTransparentExpression(expression: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    return unwrapTransparentExpression(expression.expression);
  }
  return expression;
}

function isAmbientProcessRoot(inspection: BoundaryNodeInspection): boolean {
  const root = unwrapTransparentExpression(inspection.node as ts.Expression);
  if (ts.isIdentifier(root)) {
    const identifierInspection: AmbientIdentifierInspection = {
      checker: inspection.checker,
      node: root,
    };
    return root.text === 'process' && isAmbientIdentifier(identifierInspection);
  }
  const loaderInspection: BoundaryNodeInspection = {
    checker: inspection.checker,
    node: ts.isPropertyAccessExpression(root) ? root.expression : root,
  };
  return (
    ts.isPropertyAccessExpression(root) &&
    root.name.text === 'process' &&
    isAmbientLoaderRoot(loaderInspection)
  );
}

function isAmbientGlobalRoot(inspection: BoundaryNodeInspection): boolean {
  const root = unwrapTransparentExpression(inspection.node as ts.Expression);
  const identifierInspection: AmbientIdentifierInspection = {
    checker: inspection.checker,
    node: root as ts.Identifier,
  };
  return (
    ts.isIdentifier(root) &&
    (root.text === AmbientModuleLoaderRoot.Global ||
      root.text === AmbientModuleLoaderRoot.GlobalThis) &&
    isAmbientIdentifier(identifierInspection)
  );
}

function isImportMeta(expression: ts.Expression): boolean {
  const root = unwrapTransparentExpression(expression);
  return (
    ts.isMetaProperty(root) &&
    root.keywordToken === ts.SyntaxKind.ImportKeyword &&
    root.name.text === 'meta'
  );
}

function isUnboundedAmbientLoaderRootValue(
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
    if (!isAmbientIdentifier(identifierInspection)) {
      return false;
    }
    const parent = node.parent;
    if (
      ts.isPartOfTypeNode(node) ||
      isDeclarationName(node) ||
      isNonComputedMemberDeclarationName(node)
    ) {
      return false;
    }
    if (ts.isPropertyAccessExpression(parent) && parent.name === node)
      return false;
    if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
    return !isDirectAmbientMemberReceiver(node);
  }
  return ts.isMetaProperty(node) && isImportMeta(node)
    ? !isDirectAmbientMemberReceiver(node)
    : false;
}

function isDirectAmbientMemberReceiver(expression: ts.Expression): boolean {
  const receiver = ascendTransparentExpression(expression);
  const parent = receiver.parent;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.expression === receiver) ||
    (ts.isElementAccessExpression(parent) && parent.expression === receiver)
  );
}

function ascendTransparentExpression(expression: ts.Expression): ts.Expression {
  const parent = expression.parent;
  if (
    (ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isTypeAssertionExpression(parent) ||
      ts.isNonNullExpression(parent) ||
      ts.isSatisfiesExpression(parent)) &&
    parent.expression === expression
  ) {
    return ascendTransparentExpression(parent);
  }
  return expression;
}

function isUnboundedRequireValue(inspection: BoundaryNodeInspection): boolean {
  const node = inspection.node;
  if (!ts.isIdentifier(node) || node.text !== 'require') return false;
  const parent = node.parent;
  if (ts.isTypeNode(parent)) return false;
  if (isErasedRequireDeclarationName(node)) return false;
  if (isNonComputedMemberDeclarationName(node)) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node)
    return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  const identifierInspection: AmbientIdentifierInspection = {
    checker: inspection.checker,
    node,
  };
  if (!isAmbientIdentifier(identifierInspection)) return false;
  return !(ts.isCallExpression(parent) && parent.expression === node);
}

function isNonComputedMemberDeclarationName(node: ts.Identifier): boolean {
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

function isAmbientIdentifier(request: AmbientIdentifierInspection): boolean {
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
        isRuntimeValueDeclaration(declaration),
    ),
  );
  return !hasResolvedLocal && !hasVisibleGlobalThisDeclaration(request.node);
}

function hasVisibleGlobalThisDeclaration(node: ts.Identifier): boolean {
  if (node.text !== AmbientModuleLoaderRoot.GlobalThis) return false;
  let found = false;
  const visit = (candidate: ts.Node): void => {
    const scopeInspection: DeclarationScopeInspection = {
      declaration: candidate,
      use: node,
    };
    if (
      isNamedGlobalThisDeclaration(candidate) &&
      isRuntimeValueDeclaration(candidate) &&
      declarationScopeContains(scopeInspection)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node.getSourceFile());
  return found;
}

function declarationScopeContains(
  request: DeclarationScopeInspection,
): boolean {
  const scope = runtimeDeclarationScope(request.declaration);
  if (scope === false) return false;
  let candidate = request.use.parent;
  while (!ts.isSourceFile(candidate)) {
    if (candidate === scope) return true;
    candidate = candidate.parent;
  }
  return candidate === scope;
}

function isNamedGlobalThisDeclaration(node: ts.Node): boolean {
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

function runtimeDeclarationScope(declaration: ts.Node): ts.Node | false {
  if (ts.isParameter(declaration)) return declaration.parent;
  if (
    ts.isFunctionDeclaration(declaration) ||
    ts.isClassDeclaration(declaration)
  ) {
    return nearestLexicalScope(declaration.parent);
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
    return nearestFunctionOrSource(owner);
  }
  const statement = owner.parent;
  if (
    ts.isForStatement(statement) ||
    ts.isForInStatement(statement) ||
    ts.isForOfStatement(statement)
  ) {
    return statement;
  }
  return nearestLexicalScope(statement);
}

function nearestFunctionOrSource(node: ts.Node): ts.Node {
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

function nearestLexicalScope(node: ts.Node): ts.Node {
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

function isRuntimeValueDeclaration(declaration: ts.Node): boolean {
  if (hasDeclareModifier(declaration)) return false;
  if (ts.isImportClause(declaration)) return !declaration.isTypeOnly;
  if (ts.isImportSpecifier(declaration)) {
    return !declaration.isTypeOnly && !declaration.parent.parent.isTypeOnly;
  }
  if (ts.isNamespaceImport(declaration)) return !declaration.parent.isTypeOnly;
  if (ts.isImportEqualsDeclaration(declaration)) return !declaration.isTypeOnly;
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

function isDeclarationName(node: ts.Identifier): boolean {
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

export function referencesSkillProvider(specifier: string): boolean {
  let normalized = posix.normalize(specifier);
  if (specifier.startsWith('file:')) {
    try {
      normalized = posix.normalize(fileURLToPath(specifier));
    } catch {
      return true;
    }
  }
  return (
    normalized === '.agents/skills' ||
    normalized.endsWith('/.agents/skills') ||
    normalized.startsWith('.agents/skills/') ||
    normalized.includes('/.agents/skills/')
  );
}

function isErasedRequireDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (
    (ts.isPropertySignature(parent) || ts.isMethodSignature(parent)) &&
    parent.name === node
  ) {
    return true;
  }
  if (
    (ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent)) &&
    parent.name === node
  ) {
    return true;
  }
  if ('name' in parent && parent.name === node && hasDeclareModifier(parent)) {
    return true;
  }
  if (
    ts.isVariableDeclaration(parent) &&
    parent.name === node &&
    ts.isVariableDeclarationList(parent.parent) &&
    hasDeclareModifier(parent.parent.parent)
  ) {
    return true;
  }
  return false;
}

function hasDeclareModifier(node: ts.Node): boolean {
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

test('recognizes static and dynamic skill-provider runtime imports', () => {
  const runtimeImports = [
    "import provider from '../../../.agents/skills/provider/src/runner.ts';",
    "import '../../../.agents/skills/provider/src/runner.ts';",
    "export { provider } from '../../../.agents/skills/provider/src/runner.ts';",
    "export * from '../../../.agents/skills/provider/src/runner.ts';",
    "import provider = require('../../../.agents/skills/provider/src/runner.ts');",
    "await import('../../../.agents/skills/provider/src/runner.ts');",
    'await import(`../../../.agents/skills/provider/src/runner.ts`);',
    "require('../../../.agents/skills/provider/src/runner.ts');",
    "import {} from '../../../.agents/skills/provider/src/runner.ts';",
    "export {} from '../../../.agents/skills/provider/src/runner.ts';",
    "import '../../../.agents/./skills/provider/src/runner.ts';",
    "import '../../../.agents/elsewhere/../skills/provider/src/runner.ts';",
    "import '../../../.agents/skills';",
    "import '../.agents/skills';",
    "import 'file:///workspace/nook/%2Eagents/skills/provider/src/audit.ts';",
  ];

  for (const runtimeImport of runtimeImports) {
    const inspection: SkillProviderImportInspection = {
      filePath: 'runtime-import.ts',
      source: runtimeImport,
    };
    expect(violatesSkillProviderBoundary(inspection)).toBe(true);
  }
  for (const inertSource of [
    "const path = '.agents/skills/provider';",
    "import type { Provider } from '../../../.agents/skills/provider/src/domain.ts';",
    "export type { Provider } from '../../../.agents/skills/provider/src/domain.ts';",
    "import type { Module } from 'node:module';",
    "export type { Module } from 'node:module';",
    'type AmbientRequire = typeof require;',
    'declare const require: (specifier: string) => string;',
  ]) {
    const inspection: SkillProviderImportInspection = {
      filePath: 'inert-source.ts',
      source: inertSource,
    };
    expect(violatesSkillProviderBoundary(inspection)).toBe(false);
  }
});

test('rejects every runtime reference to Node evaluator modules', () => {
  for (const source of [
    "import { runInThisContext } from 'node:vm';",
    "import vm from 'vm';",
    "export { runInThisContext } from 'vm';",
    "import vm = require('node:vm');",
    "await import('node:vm');",
    "require('vm').runInThisContext(source);",
  ]) {
    const inspection: SkillProviderImportInspection = {
      filePath: 'node-vm-evaluator.ts',
      source,
    };
    expect(violatesSkillProviderBoundary(inspection)).toBe(true);
  }
  for (const source of [
    "import type { Context } from 'node:vm';",
    "export type { Context } from 'vm';",
  ]) {
    const inspection: SkillProviderImportInspection = {
      filePath: 'node-vm-type.ts',
      source,
    };
    expect(violatesSkillProviderBoundary(inspection)).toBe(false);
  }
});

test('rejects every unbounded ambient module loader route', () => {
  const unboundedLoaders = [
    'await import();',
    'await import(modulePath);',
    'await import("../" + modulePath);',
    'await import(`../${modulePath}`);',
    'require();',
    'require(modulePath);',
    'require.call(undefined, modulePath);',
    'require.apply(undefined, [modulePath]);',
    'const load = require;',
    'const holder = { require };',
    'globalThis.require(modulePath);',
    'const load = globalThis.require;',
    "const load = global['require'];",
    "const processRoot = global['process'];",
    "const moduleRoot = globalThis['module'];",
    "const load = module['require'];",
    'const key = "require"; const load = globalThis[key];',
    '(module as NodeModule).require(modulePath);',
    'import.meta.require(modulePath);',
    "const load = import.meta['require'];",
    'const key = "require"; const load = import.meta[key];',
    "process.getBuiltinModule('module').createRequire(import.meta.url)(modulePath);",
    "const load = process['getBuiltinModule'];",
    "const legacyModule = process['mainModule'];",
    '(process as NodeJS.Process).getBuiltinModule(moduleName);',
    'const key = "getBuiltinModule"; const load = process[key];',
    "globalThis.process.getBuiltinModule('module');",
    '(import.meta as ImportMeta).require(modulePath);',
    "import { createRequire } from 'node:module';",
    "import process from 'node:process';",
    "import module = require('module');",
    "await import('node:module');",
    "require('node:module');",
    'const processRoot = process;',
    'const globalRoot = globalThis;',
    'const moduleRoot = module;',
    'const importMetaRoot = import.meta;',
    'const processRoot = process as NodeJS.Process;',
    'const processRoot = condition ? process : fallback;',
    'const processRoot = globalThis.process;',
    'const moduleRoot = global.module;',
    'process.mainModule.require(modulePath);',
    'class Unsafe { require = require; require() { return require; } }',
    'const unsafe = { get require() { return require; }, set require(value: boolean) { consume(require); } };',
  ];
  for (const source of unboundedLoaders) {
    const inspection: SkillProviderImportInspection = {
      filePath: 'unbounded-loader.ts',
      source,
    };
    expect(violatesSkillProviderBoundary(inspection)).toBe(true);
  }
  for (const source of [
    "await import('./safe-local.ts');",
    "require('./safe-local.cjs');",
    "const local = { require: (path: string) => path }; local.require('./safe-local.cjs');",
    "const local = { require: './safe-local.cjs' }; const path = local.require;",
    'const inert = "require(\'../../../.agents/skills/provider\')";',
    'const process = { getBuiltinModule: () => false }; process.getBuiltinModule();',
    'const globalThis = { require: (path: string) => path }; globalThis.require(modulePath);',
    'const module = { require: (path: string) => path }; module.require(modulePath);',
    'const require = (path: string) => path; require(modulePath);',
    "const environment = process['env'];",
    'const templateEnvironment = process[`env`];',
    "const fetchValue = globalThis['fetch'];",
    "const moduleId = module['id'];",
    "const sourceUrl = import.meta['url'];",
    "class Safe { require = 'label'; require() { return false; } get require() { return false; } set require(value: boolean) { consume(value); } }",
    'const safe = { require() { return false; }, get require() { return false; }, set require(value: boolean) { consume(value); } };',
    'interface Safe { require: Loader; require(path: string): string; }',
    'type Safe = { require: Loader; require(path: string): string };',
  ]) {
    const inspection: SkillProviderImportInspection = {
      filePath: 'bounded-loader.ts',
      source,
    };
    expect(violatesSkillProviderBoundary(inspection)).toBe(false);
  }
});

test('distinguishes emitted loader shadows from erased ambient declarations', () => {
  for (const source of [
    'declare const process: Process; process.getBuiltinModule(moduleName);',
    'declare const globalThis: Global; globalThis.require(modulePath);',
    'declare const module: Module; module.require(modulePath);',
    'declare const require: Loader; require(modulePath);',
    'interface process {}; process.getBuiltinModule(moduleName);',
    'type module = Loader; module.require(modulePath);',
    'const holder = { process };',
    'const holder = { module };',
    'type Unsafe = { [require]: Loader };',
    'class Unsafe { require = require; }',
  ]) {
    const inspection: SkillProviderImportInspection = {
      filePath: 'erased-loader.ts',
      source,
    };
    expect(violatesSkillProviderBoundary(inspection)).toBe(true);
  }
  const localInspection: SkillProviderImportInspection = {
    filePath: 'local-shorthand.ts',
    source:
      'const process = { getBuiltinModule: () => false }; const holder = { process };',
  };
  expect(violatesSkillProviderBoundary(localInspection)).toBe(false);
});

test('treats ambient-root member names as declarations, not runtime uses', () => {
  for (const root of ['process', 'module', 'global', 'globalThis']) {
    for (const source of [
      `class Safe { ${root} = 'label' }`,
      `class Safe { ${root}() { return false } }`,
      `class Safe { get ${root}() { return false } }`,
      `class Safe { set ${root}(value: boolean) { consume(value) } }`,
      `const safe = { ${root}: 'label', get ${root}() { return false } };`,
      `interface Safe { ${root}: Loader; ${root}(): string }`,
      `type Safe = { ${root}: Loader; ${root}(): string }`,
    ]) {
      const inspection: SkillProviderImportInspection = {
        filePath: 'ambient-member-name.ts',
        source,
      };
      expect(violatesSkillProviderBoundary(inspection)).toBe(false);
    }
    for (const source of [
      `class Unsafe { [${root}] = false }`,
      `const unsafe = { [${root}]: false };`,
      `class Unsafe { value = ${root}; run() { return ${root}; } }`,
    ]) {
      const inspection: SkillProviderImportInspection = {
        filePath: 'ambient-member-runtime.ts',
        source,
      };
      expect(violatesSkillProviderBoundary(inspection)).toBe(true);
    }
  }
});

test('resolves globalThis bindings in their exact lexical scopes', () => {
  for (const source of [
    'for (let globalThis of values) { globalThis.require(path); }',
    'try {} catch (globalThis) { globalThis.require(path); }',
    '{ const globalThis = local; globalThis.require(path); }',
    'function inspect(globalThis: LocalGlobal) { globalThis.require(path); }',
    'for (var globalThis of values) {} globalThis.require(path);',
    'const globalThis = local; globalThis.require(path);',
    '{ using globalThis = local; globalThis.require(path); }',
    'namespace Local { const globalThis = local; globalThis.require(path); }',
  ]) {
    const inspection: SkillProviderImportInspection = {
      filePath: 'local-global-this.ts',
      source,
    };
    expect(violatesSkillProviderBoundary(inspection)).toBe(false);
  }
  for (const source of [
    'for (let globalThis of values) {} globalThis.require(path);',
    'try {} catch (globalThis) {} globalThis.require(path);',
    '{ const globalThis = local; } globalThis.require(path);',
    'function inspect(globalThis: LocalGlobal) {} globalThis.require(path);',
    '{ using globalThis = local; } globalThis.require(path);',
    'namespace Local { const globalThis = local; } globalThis.require(path);',
  ]) {
    const inspection: SkillProviderImportInspection = {
      filePath: 'ambient-global-this.ts',
      source,
    };
    expect(violatesSkillProviderBoundary(inspection)).toBe(true);
  }
});

test('production Loom does not runtime-import dormant skill providers', async () => {
  const sourceGlob = new Bun.Glob('src/**/*');
  const scanOptions: LoomSourceScanOptions = {
    cwd: LOOM_ROOT,
    onlyFiles: true,
  };
  const violations: string[] = [];

  for await (const relativePath of sourceGlob.scan(scanOptions)) {
    if (!LOOM_EXECUTABLE_SOURCE.test(relativePath)) continue;
    const source = await Bun.file(join(LOOM_ROOT, relativePath)).text();
    const inspection: SkillProviderImportInspection = {
      filePath: `agentic-ai/loom/${relativePath}`,
      source,
    };
    if (violatesSkillProviderBoundary(inspection)) {
      violations.push(relativePath);
    }
  }

  expect(violations).toEqual([]);
});
