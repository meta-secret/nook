import ts from 'typescript';

export type AnalyzeExecutableSkillSourceRequest = {
  readonly relativePath: string;
  readonly source: string;
};

export type ExecutableSkillSourceAnalysis = {
  readonly moduleSpecifiers: readonly string[];
};

export enum ExecutableSkillSourceAnalysisResultKind {
  Completed = 'completed',
  Failed = 'failed',
}

type ExecutableSkillSourceContext = {
  readonly checker: ts.TypeChecker;
  readonly sourceFile: ts.SourceFile;
};

const ALLOWED_BUN_ROOT_MEMBERS = new Set([
  'stdin',
  'stderr',
  'stdout',
  'write',
]);
const ALLOWED_OBJECT_ROOT_MEMBERS = new Set([
  'freeze',
  'hasOwn',
  'keys',
  'values',
]);
const FORBIDDEN_PROCESS_MEMBERS = new Set([
  'chdir',
  'cwd',
  'env',
  'execArgv',
  'getBuiltinModule',
  'kill',
]);
const FORBIDDEN_EVALUATOR_MEMBERS = new Set([
  'AsyncFunction',
  'Function',
  'GeneratorFunction',
  '__proto__',
  'constructor',
  'eval',
  'prototype',
]);
enum BunAmbientNodeModule {
  Assert = 'assert',
  AsyncHooks = 'async_hooks',
  Buffer = 'buffer',
  ChildProcess = 'child_process',
  Cluster = 'cluster',
  Console = 'console',
  Constants = 'constants',
  Crypto = 'crypto',
  Datagram = 'dgram',
  DiagnosticsChannel = 'diagnostics_channel',
  Dns = 'dns',
  Domain = 'domain',
  Events = 'events',
  Ffi = 'ffi',
  FileSystem = 'fs',
  Http = 'http',
  Http2 = 'http2',
  Https = 'https',
  Inspector = 'inspector',
  JavaScriptCore = 'jsc',
  Module = 'module',
  Net = 'net',
  OperatingSystem = 'os',
  Path = 'path',
  PerformanceHooks = 'perf_hooks',
  Process = 'process',
  Punycode = 'punycode',
  QueryString = 'querystring',
  Readline = 'readline',
  Sqlite = 'sqlite',
  Stream = 'stream',
  StringDecoder = 'string_decoder',
  Sys = 'sys',
  Timers = 'timers',
  Tls = 'tls',
  TraceEvents = 'trace_events',
  Tty = 'tty',
  Url = 'url',
  Util = 'util',
  V8 = 'v8',
  VirtualMachine = 'vm',
  Wasi = 'wasi',
  WorkerThreads = 'worker_threads',
  Zlib = 'zlib',
}
const BUN_AMBIENT_NODE_MODULES = new Set<string>(
  Object.values(BunAmbientNodeModule),
);

export function analyzeExecutableSkillSource(
  request: AnalyzeExecutableSkillSourceRequest,
): ExecutableSkillSourceAnalysis {
  const context = createExecutableSkillSourceContext(request);
  const sourceFile = context.sourceFile;
  const moduleSpecifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    const capabilityRequest: AssertNoForbiddenCapabilityRequest = {
      checker: context.checker,
      node,
    };
    assertNoForbiddenCapability(capabilityRequest);
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
      !isTypeOnlyExport(node) &&
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
  if (moduleSpecifiers.some(isForbiddenRuntimeModule)) {
    throw new Error('Executable skill requests a forbidden ambient module.');
  }
  if (moduleSpecifiers.some(isExternalRuntimePackage)) {
    throw new Error(
      'Executable skill forbids external runtime package imports.',
    );
  }
  return { moduleSpecifiers };
}

type AssertNoForbiddenCapabilityRequest = {
  readonly checker: ts.TypeChecker;
  readonly node: ts.Node;
};

function assertNoForbiddenCapability(
  request: AssertNoForbiddenCapabilityRequest,
): void {
  const node = request.node;
  if (ts.isMetaProperty(node) && !isAllowedImportMetaUse(node)) {
    throw new Error(
      'Executable skill forbids import.meta loader capabilities.',
    );
  }
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
  if (ts.isBindingElement(node) && isForbiddenEvaluatorBinding(node)) {
    throw new Error('Executable skill forbids dynamic code generation.');
  }
  if (ts.isElementAccessExpression(node)) {
    const indexRequest: IsNumericElementIndexRequest = {
      checker: request.checker,
      expression: node.argumentExpression,
    };
    if (!isNumericElementIndex(indexRequest)) {
      throw new Error(
        'Executable skill forbids nonnumeric computed property access.',
      );
    }
  }
  if (!ts.isPropertyAccessExpression(node)) return;
  if (isBunStandardIoMutation(node)) {
    throw new Error('Executable skill forbids mutation of Bun standard I/O.');
  }
  if (FORBIDDEN_EVALUATOR_MEMBERS.has(node.name.text)) {
    throw new Error('Executable skill forbids dynamic code generation.');
  }
  if (
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'Object' &&
    !ALLOWED_OBJECT_ROOT_MEMBERS.has(node.name.text)
  ) {
    throw new Error('Executable skill forbids reflective Object APIs.');
  }
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

function isBunStandardIoMutation(node: ts.PropertyAccessExpression): boolean {
  if (
    !ts.isIdentifier(node.expression) ||
    node.expression.text !== 'Bun' ||
    (node.name.text !== 'stdin' &&
      node.name.text !== 'stdout' &&
      node.name.text !== 'stderr')
  ) {
    return false;
  }
  let target: ts.Node = node;
  while (
    ((ts.isParenthesizedExpression(target.parent) ||
      ts.isAsExpression(target.parent) ||
      ts.isTypeAssertionExpression(target.parent) ||
      ts.isNonNullExpression(target.parent) ||
      ts.isSatisfiesExpression(target.parent)) &&
      target.parent.expression === target) ||
    (ts.isPropertyAssignment(target.parent) &&
      target.parent.initializer === target) ||
    ts.isObjectLiteralExpression(target.parent) ||
    ts.isArrayLiteralExpression(target.parent) ||
    (ts.isSpreadAssignment(target.parent) &&
      target.parent.expression === target) ||
    (ts.isSpreadElement(target.parent) && target.parent.expression === target)
  ) {
    target = target.parent;
  }
  const parent = target.parent;
  if (ts.isBinaryExpression(parent) && parent.left === target) {
    return (
      parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    );
  }
  if (
    (ts.isPrefixUnaryExpression(parent) ||
      ts.isPostfixUnaryExpression(parent)) &&
    parent.operand === target
  ) {
    return (
      parent.operator === ts.SyntaxKind.PlusPlusToken ||
      parent.operator === ts.SyntaxKind.MinusMinusToken
    );
  }
  if (
    (ts.isForInStatement(parent) || ts.isForOfStatement(parent)) &&
    parent.initializer === target
  ) {
    return true;
  }
  return ts.isDeleteExpression(parent) && parent.expression === target;
}

function isForbiddenAmbientIdentifier(node: ts.Identifier): boolean {
  if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) {
    return false;
  }
  if (node.text === 'Object') {
    return !(
      ts.isPropertyAccessExpression(node.parent) &&
      node.parent.expression === node &&
      ALLOWED_OBJECT_ROOT_MEMBERS.has(node.parent.name.text)
    );
  }
  if (BUN_AMBIENT_NODE_MODULES.has(node.text)) return true;
  if (
    node.text === 'fetch' ||
    node.text === 'eval' ||
    node.text === 'Function' ||
    node.text === 'AsyncFunction' ||
    node.text === 'GeneratorFunction' ||
    node.text === 'Loader' ||
    node.text === 'Reflect' ||
    node.text === 'ShadowRealm' ||
    node.text === 'WebSocket' ||
    node.text === 'WebAssembly' ||
    node.text === 'Worker' ||
    node.text === 'SharedWorker' ||
    node.text === 'global' ||
    node.text === 'module' ||
    node.text === 'require' ||
    node.text === 'process' ||
    node.text === 'globalThis' ||
    node.text === 'self' ||
    node.text === 'setInterval' ||
    node.text === 'setTimeout' ||
    node.text === 'window'
  ) {
    return true;
  }
  if (node.text !== 'Bun') return false;
  return !(
    ts.isPropertyAccessExpression(node.parent) &&
    node.parent.expression === node
  );
}

function isAllowedImportMetaUse(node: ts.MetaProperty): boolean {
  return (
    node.keywordToken === ts.SyntaxKind.ImportKeyword &&
    ts.isPropertyAccessExpression(node.parent) &&
    node.parent.expression === node &&
    node.parent.name.text === 'main'
  );
}

function isForbiddenEvaluatorBinding(node: ts.BindingElement): boolean {
  const propertyName = node.propertyName;
  if (propertyName && ts.isComputedPropertyName(propertyName)) return true;
  const candidate = propertyName ?? node.name;
  if (ts.isIdentifier(candidate) || ts.isStringLiteral(candidate)) {
    return FORBIDDEN_EVALUATOR_MEMBERS.has(candidate.text);
  }
  return false;
}

type IsNumericElementIndexRequest = {
  readonly checker: ts.TypeChecker;
  readonly expression: ts.Expression;
};

function isNumericElementIndex(request: IsNumericElementIndexRequest): boolean {
  const valueType = request.checker.getTypeAtLocation(request.expression);
  if (valueType.isUnion()) {
    return valueType.types.every(
      (member) => (member.flags & ts.TypeFlags.NumberLike) !== 0,
    );
  }
  return (valueType.flags & ts.TypeFlags.NumberLike) !== 0;
}

function createExecutableSkillSourceContext(
  request: AnalyzeExecutableSkillSourceRequest,
): ExecutableSkillSourceContext {
  const compilerOptions: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    noLib: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  };
  const sourceFile = ts.createSourceFile(
    request.relativePath,
    request.source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const missingSources = new Map<string, ts.SourceFile>();
  const missingText = new Map<string, string>();
  const compilerHost = ts.createCompilerHost(compilerOptions);
  compilerHost.fileExists = (fileName) => fileName === request.relativePath;
  compilerHost.getSourceFile = (fileName) =>
    fileName === request.relativePath
      ? sourceFile
      : missingSources.get(fileName);
  compilerHost.readFile = (fileName) =>
    fileName === request.relativePath
      ? request.source
      : missingText.get(fileName);
  const rootNames = [request.relativePath];
  const program = ts.createProgram(rootNames, compilerOptions, compilerHost);
  return {
    checker: program.getTypeChecker(),
    sourceFile,
  };
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
  return specifier.startsWith('node:');
}

function isExternalRuntimePackage(specifier: string): boolean {
  return !specifier.startsWith('.') && !specifier.startsWith('node:');
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
  const clause = node.exportClause;
  return Boolean(
    clause &&
    ts.isNamedExports(clause) &&
    clause.elements.length > 0 &&
    clause.elements.every((element) => element.isTypeOnly),
  );
}
