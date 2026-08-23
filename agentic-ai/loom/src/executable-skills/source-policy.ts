import ts from 'typescript';

export type AnalyzeExecutableSkillSourceRequest = {
  readonly auditCapabilities: boolean;
  readonly relativePath: string;
  readonly source: string;
};

export type ExecutableSkillSourceAnalysis = {
  readonly moduleSpecifiers: readonly string[];
};

const FORBIDDEN_NODE_MODULES = new Set([
  'child_process',
  'cluster',
  'dgram',
  'dns',
  'fs',
  'http',
  'https',
  'module',
  'net',
  'process',
  'tls',
  'worker_threads',
]);
const ALLOWED_BUN_ROOT_MEMBERS = new Set([
  'stdin',
  'stderr',
  'stdout',
  'write',
]);
const FORBIDDEN_PROCESS_MEMBERS = new Set([
  'chdir',
  'cwd',
  'env',
  'execArgv',
  'getBuiltinModule',
  'kill',
]);

export function analyzeExecutableSkillSource(
  request: AnalyzeExecutableSkillSourceRequest,
): ExecutableSkillSourceAnalysis {
  const sourceFile = ts.createSourceFile(
    request.relativePath,
    request.source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const moduleSpecifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (request.auditCapabilities) assertNoForbiddenCapability(node);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require'))
    ) {
      throw new Error('Executable skill forbids dynamic module loading.');
    }
    if (
      ts.isImportDeclaration(node) &&
      !isTypeOnlyImport(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      moduleSpecifiers.push(node.moduleSpecifier.text);
    }
    if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      moduleSpecifiers.push(node.moduleSpecifier.text);
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      moduleSpecifiers.push(node.moduleReference.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (
    request.auditCapabilities &&
    moduleSpecifiers.some(isForbiddenRuntimeModule)
  ) {
    throw new Error('Executable skill requests a forbidden ambient module.');
  }
  return { moduleSpecifiers };
}

function assertNoForbiddenCapability(node: ts.Node): void {
  if (ts.isIdentifier(node) && isForbiddenAmbientIdentifier(node)) {
    throw new Error('Executable skill forbids ambient global capabilities.');
  }
  if (
    (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
    ts.isIdentifier(node.expression) &&
    (node.expression.text === 'fetch' || node.expression.text === 'WebSocket')
  ) {
    throw new Error('Executable skill forbids ambient network APIs.');
  }
  if (!ts.isPropertyAccessExpression(node)) return;
  if (
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'Bun' &&
    !ALLOWED_BUN_ROOT_MEMBERS.has(node.name.text)
  ) {
    throw new Error(
      'Executable skill forbids Bun APIs outside narrow standard I/O.',
    );
  }
  if (
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'process' &&
    FORBIDDEN_PROCESS_MEMBERS.has(node.name.text)
  ) {
    throw new Error('Executable skill forbids ambient process APIs.');
  }
  if (
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'globalThis' &&
    (node.name.text === 'fetch' ||
      node.name.text === 'WebSocket' ||
      node.name.text === 'process')
  ) {
    throw new Error('Executable skill forbids ambient global APIs.');
  }
  if (
    node.name.text === 'write' &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'Bun' &&
    !isBunOutputWrite(node.parent)
  ) {
    throw new Error('Executable skill forbids filesystem writes.');
  }
}

function isForbiddenAmbientIdentifier(node: ts.Identifier): boolean {
  if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) {
    return false;
  }
  if (
    node.text === 'fetch' ||
    node.text === 'WebSocket' ||
    node.text === 'require' ||
    node.text === 'process' ||
    node.text === 'globalThis'
  ) {
    return true;
  }
  if (node.text !== 'Bun') return false;
  return !(
    ts.isPropertyAccessExpression(node.parent) &&
    node.parent.expression === node
  );
}

function isBunOutputWrite(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const destination = node.arguments[0];
  return Boolean(
    destination &&
    ts.isPropertyAccessExpression(destination) &&
    ts.isIdentifier(destination.expression) &&
    destination.expression.text === 'Bun' &&
    (destination.name.text === 'stdout' || destination.name.text === 'stderr'),
  );
}

function isForbiddenRuntimeModule(specifier: string): boolean {
  if (specifier === 'bun' || specifier.startsWith('bun:')) return true;
  const normalized = specifier.startsWith('node:')
    ? specifier.slice('node:'.length)
    : specifier;
  const moduleName = normalized.split('/')[0];
  return (
    typeof moduleName === 'string' && FORBIDDEN_NODE_MODULES.has(moduleName)
  );
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
