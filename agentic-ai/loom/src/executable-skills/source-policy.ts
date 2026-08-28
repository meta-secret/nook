import ts from 'typescript';
import { posix } from 'node:path';

export type AnalyzeExecutableSkillSourceRequest = {
  readonly relativePath: string;
  readonly source: string;
};

export type ExecutableSkillSourceAnalysis = {
  readonly moduleSpecifiers: readonly string[];
};

type ExecutableSkillSourceContext = {
  readonly checker: ts.TypeChecker;
  readonly sourceFile: ts.SourceFile;
};

enum AllowedBunRootMember {
  StandardInput = 'stdin',
  StandardError = 'stderr',
  StandardOutput = 'stdout',
  Write = 'write',
}
const ALLOWED_BUN_ROOT_MEMBERS = new Set<string>(
  Object.values(AllowedBunRootMember),
);

enum AllowedObjectRootMember {
  Freeze = 'freeze',
  HasOwn = 'hasOwn',
  Keys = 'keys',
  Values = 'values',
}
const ALLOWED_OBJECT_ROOT_MEMBERS = new Set<string>(
  Object.values(AllowedObjectRootMember),
);

enum ForbiddenEvaluatorMember {
  AsyncFunction = 'AsyncFunction',
  Function = 'Function',
  GeneratorFunction = 'GeneratorFunction',
  LegacyPrototype = '__proto__',
  Constructor = 'constructor',
  Eval = 'eval',
  Prototype = 'prototype',
}
const FORBIDDEN_EVALUATOR_MEMBERS = new Set<string>(
  Object.values(ForbiddenEvaluatorMember),
);

enum ForbiddenAmbientGlobal {
  Alert = 'alert',
  AsyncFunction = 'AsyncFunction',
  BroadcastChannel = 'BroadcastChannel',
  Buffer = 'Buffer',
  Confirm = 'confirm',
  Console = 'console',
  Date = 'Date',
  Eval = 'eval',
  Fetch = 'fetch',
  Function = 'Function',
  GeneratorFunction = 'GeneratorFunction',
  Global = 'global',
  GlobalThis = 'globalThis',
  Loader = 'Loader',
  Math = 'Math',
  Module = 'module',
  Performance = 'performance',
  PostMessage = 'postMessage',
  Process = 'process',
  Prompt = 'prompt',
  Reflect = 'Reflect',
  Require = 'require',
  ReportError = 'reportError',
  Self = 'self',
  SetInterval = 'setInterval',
  SetTimeout = 'setTimeout',
  ShadowRealm = 'ShadowRealm',
  SharedWorker = 'SharedWorker',
  WebAssembly = 'WebAssembly',
  WebSocket = 'WebSocket',
  Window = 'window',
  Worker = 'Worker',
}
const FORBIDDEN_AMBIENT_GLOBALS = new Set<string>(
  Object.values(ForbiddenAmbientGlobal),
);

enum ExecutableSkillRuntimeModulePrefix {
  Bun = 'bun',
  BunNamespace = 'bun:',
  NodeNamespace = 'node:',
}

enum ExecutableSkillRelativeModulePrefix {
  Ancestor = '../',
  Descendant = './',
}
const EXECUTABLE_SKILL_RELATIVE_MODULE_PREFIXES = new Set<string>(
  Object.values(ExecutableSkillRelativeModulePrefix),
);

enum ExecutableSkillSourceModuleSuffix {
  TypeScript = '.ts',
}

enum ExecutableSkillModuleSpecifierFragment {
  Fragment = '#',
  Query = '?',
}

enum AmbientCapabilityRoot {
  Bun = 'Bun',
  Object = 'Object',
}

enum AllowedImportMetaMember {
  Main = 'main',
}
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

const MAXIMUM_EXECUTABLE_SKILL_SOURCE_BYTES = 1024 * 1024;
const MAXIMUM_EXECUTABLE_SKILL_SOURCE_PATH_BYTES = 4096;
const MAXIMUM_EXECUTABLE_SKILL_MODULE_SPECIFIER_BYTES = 4096;
const MAXIMUM_EXECUTABLE_SKILL_MODULE_SPECIFIERS = 256;

export function analyzeExecutableSkillSource(
  request: AnalyzeExecutableSkillSourceRequest,
): ExecutableSkillSourceAnalysis {
  assertExecutableSkillSourceBounds(request);
  assertCanonicalExecutableSkillSourcePath(request.relativePath);
  const context = createExecutableSkillSourceContext(request);
  const sourceFile = context.sourceFile;
  const moduleSpecifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    const capabilityRequest: AssertNoForbiddenCapabilityRequest = {
      checker: context.checker,
      node,
    };
    assertNoForbiddenCapability(capabilityRequest);
    if (ts.isCallExpression(node)) {
      const moduleLoadRequest: DynamicModuleLoadRequest = {
        checker: context.checker,
        node,
      };
      if (isDynamicModuleLoad(moduleLoadRequest)) {
        throw new Error('Executable skill forbids dynamic module loading.');
      }
    }
    if (
      ts.isImportDeclaration(node) &&
      !isTypeOnlyImport(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      assertNoRuntimeImportAttributes(node);
      const appendRequest: AppendModuleSpecifierRequest = {
        moduleSpecifiers,
        specifier: node.moduleSpecifier.text,
      };
      appendModuleSpecifier(appendRequest);
    }
    if (
      ts.isExportDeclaration(node) &&
      !isTypeOnlyExport(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      assertNoRuntimeImportAttributes(node);
      const appendRequest: AppendModuleSpecifierRequest = {
        moduleSpecifiers,
        specifier: node.moduleSpecifier.text,
      };
      appendModuleSpecifier(appendRequest);
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      const appendRequest: AppendModuleSpecifierRequest = {
        moduleSpecifiers,
        specifier: node.moduleReference.expression.text,
      };
      appendModuleSpecifier(appendRequest);
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
  if (moduleSpecifiers.some(isNonSourceRelativeModule)) {
    throw new Error(
      'Executable skill permits only relative TypeScript source imports.',
    );
  }
  for (const moduleSpecifier of moduleSpecifiers) {
    const containmentRequest: AssertContainedModuleSpecifierRequest = {
      moduleSpecifier,
      sourcePath: request.relativePath,
    };
    assertContainedModuleSpecifier(containmentRequest);
  }
  const analysis: ExecutableSkillSourceAnalysis = {
    moduleSpecifiers: Object.freeze([...moduleSpecifiers]),
  };
  return Object.freeze(analysis);
}

type AppendModuleSpecifierRequest = {
  readonly moduleSpecifiers: string[];
  readonly specifier: string;
};

function appendModuleSpecifier(request: AppendModuleSpecifierRequest): void {
  if (
    request.moduleSpecifiers.length >=
      MAXIMUM_EXECUTABLE_SKILL_MODULE_SPECIFIERS ||
    utf8ByteLength(request.specifier) >
      MAXIMUM_EXECUTABLE_SKILL_MODULE_SPECIFIER_BYTES
  ) {
    throw new Error('Executable skill module specifiers exceed their bound.');
  }
  request.moduleSpecifiers.push(request.specifier);
}

function assertExecutableSkillSourceBounds(
  request: AnalyzeExecutableSkillSourceRequest,
): void {
  if (
    request.source.length > MAXIMUM_EXECUTABLE_SKILL_SOURCE_BYTES ||
    utf8ByteLength(request.source) > MAXIMUM_EXECUTABLE_SKILL_SOURCE_BYTES
  ) {
    throw new Error('Executable skill source exceeds its byte bound.');
  }
  if (
    request.relativePath.length > MAXIMUM_EXECUTABLE_SKILL_SOURCE_PATH_BYTES ||
    utf8ByteLength(request.relativePath) >
      MAXIMUM_EXECUTABLE_SKILL_SOURCE_PATH_BYTES
  ) {
    throw new Error('Executable skill source path exceeds its byte bound.');
  }
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function assertCanonicalExecutableSkillSourcePath(relativePath: string): void {
  if (
    !relativePath.endsWith(ExecutableSkillSourceModuleSuffix.TypeScript) ||
    posix.isAbsolute(relativePath) ||
    posix.normalize(relativePath) !== relativePath ||
    relativePath.includes('\\') ||
    executableSkillRoot(relativePath) === false
  ) {
    throw new Error(
      'Executable skill requires a canonical TypeScript source path inside its skill root.',
    );
  }
}

type AssertContainedModuleSpecifierRequest = {
  readonly moduleSpecifier: string;
  readonly sourcePath: string;
};

function assertContainedModuleSpecifier(
  request: AssertContainedModuleSpecifierRequest,
): void {
  const skillRoot = executableSkillRoot(request.sourcePath);
  if (skillRoot === false) {
    throw new Error(
      'Executable skill requires a canonical TypeScript source path inside its skill root.',
    );
  }
  const resolvedPath = posix.normalize(
    posix.join(posix.dirname(request.sourcePath), request.moduleSpecifier),
  );
  if (resolvedPath !== skillRoot && !resolvedPath.startsWith(`${skillRoot}/`)) {
    throw new Error(
      'Executable skill runtime imports must remain inside their owning skill root.',
    );
  }
}

const EXECUTABLE_SKILL_SOURCE_PATH =
  /^(\.cortex\/(?:gizmo|shared|teams\/(?:ai|dev-core|security|sre|web-dev))\/dynamic-skills\/[a-z0-9]+(?:-[a-z0-9]+)*\/scripts)\/(src|tests)\/.+\.ts$/u;

export function isExecutableSkillApplicationSourcePath(path: string): boolean {
  return EXECUTABLE_SKILL_SOURCE_PATH.exec(path)?.at(2) === 'src';
}

function executableSkillRoot(relativePath: string): string | false {
  const match = EXECUTABLE_SKILL_SOURCE_PATH.exec(relativePath);
  return match?.at(1) ?? false;
}

type AssertNoForbiddenCapabilityRequest = {
  readonly checker: ts.TypeChecker;
  readonly node: ts.Node;
};

type DynamicModuleLoadRequest = {
  readonly checker: ts.TypeChecker;
  readonly node: ts.CallExpression;
};

type IdentifierCapabilityRequest = {
  readonly checker: ts.TypeChecker;
  readonly node: ts.Identifier;
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
  if (ts.isIdentifier(node)) {
    const identifierRequest: IdentifierCapabilityRequest = {
      checker: request.checker,
      node,
    };
    if (!isRuntimeIdentifierUse(identifierRequest)) return;
    if (isErasedBindingUsedAsValue(identifierRequest)) {
      throw new Error(
        'Executable skill forbids erased declarations used as runtime values.',
      );
    }
    if (isForbiddenAmbientIdentifier(identifierRequest)) {
      throw new Error('Executable skill forbids ambient global capabilities.');
    }
  }
  if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
    const networkRequest: AmbientNetworkCallRequest = {
      checker: request.checker,
      node,
    };
    if (isAmbientNetworkCall(networkRequest)) {
      throw new Error('Executable skill forbids ambient network APIs.');
    }
  }
  if (ts.isBindingElement(node) && isForbiddenEvaluatorBinding(node)) {
    throw new Error('Executable skill forbids dynamic code generation.');
  }
  if (
    ts.isPropertyAssignment(node) &&
    isForbiddenEvaluatorAssignmentProperty(node)
  ) {
    throw new Error('Executable skill forbids dynamic code generation.');
  }
  if (ts.isElementAccessExpression(node)) {
    const indexRequest: IsNumericElementIndexRequest = {
      expression: node.argumentExpression,
    };
    if (!isNumericElementIndex(indexRequest)) {
      throw new Error(
        'Executable skill permits only nonnegative safe-integer numeric literal element access.',
      );
    }
  }
  if (!ts.isPropertyAccessExpression(node)) return;
  if (ts.isIdentifier(node.expression)) {
    const rootIdentifierRequest: IdentifierCapabilityRequest = {
      checker: request.checker,
      node: node.expression,
    };
    if (isErasedBindingUsedAsValue(rootIdentifierRequest)) {
      throw new Error(
        'Executable skill forbids erased declarations used as runtime values.',
      );
    }
  }
  const memberRequest: AmbientPropertyAccessRequest = {
    checker: request.checker,
    node,
  };
  const objectRootRequest: AmbientRootPropertyRequest = {
    ...memberRequest,
    rootName: AmbientCapabilityRoot.Object,
  };
  const bunRootRequest: AmbientRootPropertyRequest = {
    ...memberRequest,
    rootName: AmbientCapabilityRoot.Bun,
  };
  const globalThisRootRequest: AmbientRootPropertyRequest = {
    ...memberRequest,
    rootName: ForbiddenAmbientGlobal.GlobalThis,
  };
  const outputWriteRequest: BunOutputWriteRequest = {
    checker: request.checker,
    node: node.parent,
  };
  if (isBunStandardIoMutation(memberRequest)) {
    throw new Error('Executable skill forbids mutation of Bun standard I/O.');
  }
  if (FORBIDDEN_EVALUATOR_MEMBERS.has(node.name.text)) {
    throw new Error('Executable skill forbids dynamic code generation.');
  }
  if (
    isAmbientRootPropertyAccess(objectRootRequest) &&
    !ALLOWED_OBJECT_ROOT_MEMBERS.has(node.name.text)
  ) {
    throw new Error('Executable skill forbids reflective Object APIs.');
  }
  if (isAmbientRootPropertyAccess(bunRootRequest)) {
    throw new Error('Executable skill applications forbid ambient Bun I/O.');
  }
  if (
    isAmbientRootPropertyAccess(globalThisRootRequest) &&
    (node.name.text === ForbiddenAmbientGlobal.Fetch ||
      node.name.text === ForbiddenAmbientGlobal.WebSocket ||
      node.name.text === ForbiddenAmbientGlobal.Process)
  ) {
    throw new Error('Executable skill forbids ambient global APIs.');
  }
  if (
    node.name.text === AllowedBunRootMember.Write &&
    isAmbientRootPropertyAccess(bunRootRequest) &&
    !isBunOutputWrite(outputWriteRequest)
  ) {
    throw new Error('Executable skill forbids filesystem writes.');
  }
}

function isDynamicModuleLoad(request: DynamicModuleLoadRequest): boolean {
  const expression = request.node.expression;
  if (expression.kind === ts.SyntaxKind.ImportKeyword) return true;
  if (
    !ts.isIdentifier(expression) ||
    expression.text !== ForbiddenAmbientGlobal.Require
  ) {
    return false;
  }
  const identifierRequest: IdentifierCapabilityRequest = {
    checker: request.checker,
    node: expression,
  };
  return isAmbientRootIdentifier(identifierRequest);
}

type AmbientPropertyAccessRequest = {
  readonly checker: ts.TypeChecker;
  readonly node: ts.PropertyAccessExpression;
};

type AmbientNetworkCallRequest = {
  readonly checker: ts.TypeChecker;
  readonly node: ts.CallExpression | ts.NewExpression;
};

type BunOutputWriteRequest = {
  readonly checker: ts.TypeChecker;
  readonly node: ts.Node;
};

type AmbientRootPropertyRequest = AmbientPropertyAccessRequest & {
  readonly rootName: string;
};

function isBunStandardIoMutation(
  request: AmbientPropertyAccessRequest,
): boolean {
  const node = request.node;
  const bunRootRequest: AmbientRootPropertyRequest = {
    ...request,
    rootName: AmbientCapabilityRoot.Bun,
  };
  if (
    !isAmbientRootPropertyAccess(bunRootRequest) ||
    (node.name.text !== AllowedBunRootMember.StandardInput &&
      node.name.text !== AllowedBunRootMember.StandardOutput &&
      node.name.text !== AllowedBunRootMember.StandardError)
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

function isRuntimeIdentifierUse(request: IdentifierCapabilityRequest): boolean {
  const node = request.node;
  if (ts.isPartOfTypeNode(node) || isInsideTypeQuery(node)) return false;
  if (
    ts.isShorthandPropertyAssignment(node.parent) &&
    node.parent.name === node
  ) {
    return true;
  }
  if (ts.isExportSpecifier(node.parent)) {
    return isRuntimeLocalExportIdentifier(node);
  }
  if (isSyntacticDeclarationName(node)) return false;
  if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) {
    return false;
  }
  if (
    (ts.isLabeledStatement(node.parent) ||
      ts.isBreakStatement(node.parent) ||
      ts.isContinueStatement(node.parent)) &&
    node.parent.label === node
  ) {
    return false;
  }
  const symbol = request.checker.getSymbolAtLocation(node);
  return !symbol?.declarations?.some(
    (declaration) => declaration === (node.parent as ts.Declaration),
  );
}

function isRuntimeLocalExportIdentifier(node: ts.Identifier): boolean {
  const specifier = node.parent;
  if (!ts.isExportSpecifier(specifier)) return false;
  const exportDeclaration = specifier.parent.parent;
  if (
    !ts.isExportDeclaration(exportDeclaration) ||
    specifier.isTypeOnly ||
    exportDeclaration.isTypeOnly ||
    exportDeclaration.moduleSpecifier
  ) {
    return false;
  }
  return specifier.propertyName
    ? specifier.propertyName === node
    : specifier.name === node;
}

function isInsideTypeQuery(node: ts.Identifier): boolean {
  let candidate: ts.Node = node.parent;
  while (
    ts.isIdentifier(candidate) ||
    ts.isQualifiedName(candidate) ||
    ts.isTypeQueryNode(candidate)
  ) {
    if (ts.isTypeQueryNode(candidate)) return true;
    candidate = candidate.parent;
  }
  return false;
}

function isSyntacticDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isImportSpecifier(parent) || ts.isBindingElement(parent)) {
    return parent.name === node || parent.propertyName === node;
  }
  if (
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isImportEqualsDeclaration(parent)
  ) {
    return parent.name === node;
  }
  return false;
}

function isAmbientNetworkCall(request: AmbientNetworkCallRequest): boolean {
  const expression = request.node.expression;
  if (
    !ts.isIdentifier(expression) ||
    (expression.text !== ForbiddenAmbientGlobal.Fetch &&
      expression.text !== ForbiddenAmbientGlobal.WebSocket)
  ) {
    return false;
  }
  const identifierRequest: IdentifierCapabilityRequest = {
    checker: request.checker,
    node: expression,
  };
  return isAmbientRootIdentifier(identifierRequest);
}

function isErasedBindingUsedAsValue(
  request: IdentifierCapabilityRequest,
): boolean {
  const valueRequest: ResolveSourceLocalSymbolRequest = {
    ...request,
    meaning: ts.SymbolFlags.Value,
  };
  const typeRequest: ResolveSourceLocalSymbolRequest = {
    ...request,
    meaning: ts.SymbolFlags.Type,
  };
  const valueSymbols = resolveSourceLocalSymbols(valueRequest);
  const typeSymbols = resolveSourceLocalSymbols(typeRequest);
  const declarations = [
    ...valueSymbols.flatMap((symbol) => symbol.declarations ?? []),
    ...typeSymbols.flatMap((symbol) => symbol.declarations ?? []),
  ];
  return Boolean(
    declarations.length > 0 && !declarations.some(isRuntimeValueDeclaration),
  );
}

function isAmbientRootIdentifier(
  request: IdentifierCapabilityRequest,
): boolean {
  const resolveRequest: ResolveSourceLocalSymbolRequest = {
    ...request,
    meaning: ts.SymbolFlags.Value,
  };
  const symbols = resolveSourceLocalSymbols(resolveRequest);
  return !symbols.some((symbol) =>
    symbol.declarations?.some(isRuntimeValueDeclaration),
  );
}

type ResolveSourceLocalSymbolRequest = IdentifierCapabilityRequest & {
  readonly meaning: ts.SymbolFlags;
};

function resolveSourceLocalSymbols(
  request: ResolveSourceLocalSymbolRequest,
): readonly ts.Symbol[] {
  const symbol = request.checker.resolveName(
    request.node.text,
    request.node,
    request.meaning,
    false,
  );
  if (!symbol) return [];
  return symbol.declarations?.some(
    (declaration) =>
      declaration.getSourceFile() === request.node.getSourceFile(),
  )
    ? [symbol]
    : [];
}

function isRuntimeValueDeclaration(declaration: ts.Node): boolean {
  if (hasDeclareModifier(declaration)) return false;
  if (ts.isImportClause(declaration)) return !declaration.isTypeOnly;
  if (ts.isImportSpecifier(declaration)) {
    const importClause = declaration.parent.parent;
    return (
      ts.isImportClause(importClause) &&
      !importClause.isTypeOnly &&
      !declaration.isTypeOnly
    );
  }
  if (ts.isNamespaceImport(declaration)) {
    const importClause = declaration.parent;
    return ts.isImportClause(importClause) && !importClause.isTypeOnly;
  }
  if (ts.isImportEqualsDeclaration(declaration)) {
    return !declaration.isTypeOnly;
  }
  return (
    ts.isVariableDeclaration(declaration) ||
    ts.isBindingElement(declaration) ||
    ts.isParameter(declaration) ||
    (ts.isFunctionDeclaration(declaration) && Boolean(declaration.body)) ||
    ts.isFunctionExpression(declaration) ||
    ts.isClassDeclaration(declaration) ||
    ts.isClassExpression(declaration) ||
    (ts.isEnumDeclaration(declaration) &&
      !ts
        .getModifiers(declaration)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.ConstKeyword)) ||
    ts.isModuleDeclaration(declaration)
  );
}

function hasDeclareModifier(declaration: ts.Node): boolean {
  let candidate: ts.Node = declaration;
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

function isAmbientRootPropertyAccess(
  request: AmbientRootPropertyRequest,
): boolean {
  if (
    !ts.isIdentifier(request.node.expression) ||
    request.node.expression.text !== request.rootName
  ) {
    return false;
  }
  const identifierRequest: IdentifierCapabilityRequest = {
    checker: request.checker,
    node: request.node.expression,
  };
  return isAmbientRootIdentifier(identifierRequest);
}

function isForbiddenAmbientIdentifier(
  request: IdentifierCapabilityRequest,
): boolean {
  const node = request.node;
  if (!isAmbientRootIdentifier(request)) return false;
  if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) {
    return false;
  }
  if (node.text === AmbientCapabilityRoot.Object) {
    return !(
      ts.isPropertyAccessExpression(node.parent) &&
      node.parent.expression === node &&
      ALLOWED_OBJECT_ROOT_MEMBERS.has(node.parent.name.text)
    );
  }
  if (BUN_AMBIENT_NODE_MODULES.has(node.text)) return true;
  if (FORBIDDEN_AMBIENT_GLOBALS.has(node.text)) return true;
  if (node.text !== AmbientCapabilityRoot.Bun) return false;
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
    node.parent.name.text === AllowedImportMetaMember.Main
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

function isForbiddenEvaluatorAssignmentProperty(
  node: ts.PropertyAssignment,
): boolean {
  if (!isInsideAssignmentTarget(node)) return false;
  if (ts.isComputedPropertyName(node.name)) return true;
  return FORBIDDEN_EVALUATOR_MEMBERS.has(node.name.text);
}

function isInsideAssignmentTarget(node: ts.Node): boolean {
  let target = node;
  while (
    ts.isPropertyAssignment(target.parent) ||
    ts.isObjectLiteralExpression(target.parent) ||
    ts.isArrayLiteralExpression(target.parent) ||
    ts.isParenthesizedExpression(target.parent) ||
    ts.isAsExpression(target.parent) ||
    ts.isTypeAssertionExpression(target.parent) ||
    ts.isNonNullExpression(target.parent) ||
    ts.isSatisfiesExpression(target.parent) ||
    ts.isSpreadAssignment(target.parent) ||
    ts.isSpreadElement(target.parent)
  ) {
    target = target.parent;
  }
  const parent = target.parent;
  return (
    (ts.isBinaryExpression(parent) && parent.left === target) ||
    ((ts.isForInStatement(parent) || ts.isForOfStatement(parent)) &&
      parent.initializer === target)
  );
}

type IsNumericElementIndexRequest = {
  readonly expression: ts.Expression;
};

function isNumericElementIndex(request: IsNumericElementIndexRequest): boolean {
  if (!ts.isNumericLiteral(request.expression)) return false;
  const value = Number(request.expression.text);
  return Number.isSafeInteger(value) && value >= 0;
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
  if (program.getSyntacticDiagnostics(sourceFile).length > 0) {
    throw new Error(
      'Executable skill source contains invalid TypeScript syntax.',
    );
  }
  return {
    checker: program.getTypeChecker(),
    sourceFile,
  };
}

function isBunOutputWrite(request: BunOutputWriteRequest): boolean {
  const node = request.node;
  if (!ts.isCallExpression(node)) return false;
  const destination = node.arguments[0];
  if (!destination || !ts.isPropertyAccessExpression(destination)) return false;
  const destinationRequest: AmbientRootPropertyRequest = {
    checker: request.checker,
    node: destination,
    rootName: AmbientCapabilityRoot.Bun,
  };
  return (
    isAmbientRootPropertyAccess(destinationRequest) &&
    (destination.name.text === AllowedBunRootMember.StandardOutput ||
      destination.name.text === AllowedBunRootMember.StandardError)
  );
}

function isForbiddenRuntimeModule(specifier: string): boolean {
  if (
    specifier === ExecutableSkillRuntimeModulePrefix.Bun ||
    specifier.startsWith(ExecutableSkillRuntimeModulePrefix.BunNamespace)
  ) {
    return true;
  }
  return specifier.startsWith(ExecutableSkillRuntimeModulePrefix.NodeNamespace);
}

function isExternalRuntimePackage(specifier: string): boolean {
  return !(
    [...EXECUTABLE_SKILL_RELATIVE_MODULE_PREFIXES].some((prefix) =>
      specifier.startsWith(prefix),
    ) || specifier.startsWith(ExecutableSkillRuntimeModulePrefix.NodeNamespace)
  );
}

function isNonSourceRelativeModule(specifier: string): boolean {
  const isRelative = [...EXECUTABLE_SKILL_RELATIVE_MODULE_PREFIXES].some(
    (prefix) => specifier.startsWith(prefix),
  );
  return (
    isRelative &&
    (!specifier.endsWith(ExecutableSkillSourceModuleSuffix.TypeScript) ||
      specifier.includes(ExecutableSkillModuleSpecifierFragment.Fragment) ||
      specifier.includes(ExecutableSkillModuleSpecifierFragment.Query))
  );
}

function assertNoRuntimeImportAttributes(
  node: ts.ImportDeclaration | ts.ExportDeclaration,
): void {
  if (node.attributes) {
    throw new Error('Executable skill forbids runtime import attributes.');
  }
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
