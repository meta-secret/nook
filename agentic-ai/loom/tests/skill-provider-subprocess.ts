import { posix } from 'node:path';
import ts from 'typescript';

export type RepositorySubprocessInspection = {
  readonly executablePaths: ReadonlySet<string>;
  readonly importer: string;
  readonly source: string;
  readonly sources: ReadonlyMap<string, string>;
};

export type RepositorySubprocessDiscovery = {
  readonly paths: readonly string[];
  readonly unresolved: boolean;
};

enum SubprocessApi {
  Exec = 'exec',
  ExecFile = 'execFile',
  ExecFileSync = 'execFileSync',
  ExecSync = 'execSync',
  Fork = 'fork',
  Spawn = 'spawn',
  SpawnSync = 'spawnSync',
}

type SubprocessBindings = {
  readonly apiIdentifiers: ReadonlyMap<string, SubprocessApi>;
  readonly namespaceIdentifiers: ReadonlySet<string>;
};

type MutableSubprocessBindings = {
  readonly apiIdentifiers: Map<string, SubprocessApi>;
  readonly namespaceIdentifiers: Set<string>;
};

type BindingCollection = {
  readonly bindings: MutableSubprocessBindings;
  readonly sourceFile: ts.SourceFile;
};

type SubprocessCallResolution = {
  readonly api: SubprocessApi;
  readonly call: ts.CallExpression;
};

type LiteralCollection = {
  readonly checker: ts.TypeChecker;
  readonly initializers: ReadonlyMap<ts.Symbol, ts.Expression>;
  readonly mutableSymbols: ReadonlySet<ts.Symbol>;
  readonly node: ts.Node;
  readonly seenNodes: Set<ts.Node>;
  readonly values: string[];
};

const CHILD_PROCESS_SPECIFIERS = new Set([
  'child_process',
  'node:child_process',
]);
const SUBPROCESS_APIS = new Set<string>(Object.values(SubprocessApi));
const SCRIPT_EXTENSION = /\.(?:[cm]?[jt]sx?|sh)$/u;
const SCRIPT_RUNTIMES = new Set(['bash', 'bun', 'node', 'sh']);
const UNRESOLVED_LITERAL = '\0unresolved-subprocess-literal';
const MUTABLE_LITERAL = '\0mutable-subprocess-literal';
const MUTATING_COLLECTION_METHODS = new Set([
  'copyWithin',
  'fill',
  'pop',
  'push',
  'reverse',
  'set',
  'shift',
  'sort',
  'splice',
  'unshift',
]);

export function repositorySubprocessEntrypoints(
  inspection: RepositorySubprocessInspection,
): RepositorySubprocessDiscovery {
  const context = createSubprocessTypeContext(inspection);
  const sourceFile = context.sourceFile;
  const initializerInspection: InitializerInspection = {
    checker: context.checker,
    sourceFile,
  };
  const initializerCollection = collectInitializers(initializerInspection);
  const bindings = collectSubprocessBindings(sourceFile);
  const discoveries: SubprocessCallResolution[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const subprocessInspection: SubprocessExpressionInspection = {
        bindings,
        expression: node.expression,
      };
      const api = subprocessApi(subprocessInspection);
      if (api !== false) {
        const resolution: SubprocessCallResolution = { api, call: node };
        discoveries.push(resolution);
      }
      if (isBunSubprocessCall(node.expression)) {
        const resolution: SubprocessCallResolution = {
          api: SubprocessApi.Spawn,
          call: node,
        };
        discoveries.push(resolution);
      }
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'runCommand'
      ) {
        const resolution: SubprocessCallResolution = {
          api: SubprocessApi.Spawn,
          call: node,
        };
        discoveries.push(resolution);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const paths = new Set<string>();
  let unresolved = false;
  for (const discovery of discoveries) {
    const literals: string[] = [];
    for (const argument of discovery.call.arguments) {
      const collection: LiteralCollection = {
        checker: context.checker,
        initializers: initializerCollection.initializers,
        mutableSymbols: initializerCollection.mutableSymbols,
        node: argument,
        seenNodes: new Set<ts.Node>(),
        values: literals,
      };
      collectLiterals(collection);
    }
    const candidateInspection: CandidateScriptInspection = {
      api: discovery.api,
      literals,
      repository: inspection,
    };
    const candidateDiscovery = candidateScriptLiterals(candidateInspection);
    for (const literal of candidateDiscovery.literals) {
      if (
        discovery.api !== SubprocessApi.Fork &&
        posix.extname(literal).length === 0 &&
        !literal.includes('/') &&
        !candidateUsesScriptRuntime(candidateInspection)
      ) {
        continue;
      }
      const scriptResolution: RepositoryScriptResolution = {
        inspection,
        literal,
      };
      const resolved = resolveRepositoryScript(scriptResolution);
      if (resolved === false) unresolved = true;
      else paths.add(resolved);
    }
    if (candidateDiscovery.unresolved) unresolved = true;
  }
  return { paths: [...paths], unresolved };
}

type SubprocessTypeContext = {
  readonly checker: ts.TypeChecker;
  readonly sourceFile: ts.SourceFile;
};

function createSubprocessTypeContext(
  inspection: RepositorySubprocessInspection,
): SubprocessTypeContext {
  const options: ts.CompilerOptions = { noLib: true, noResolve: true };
  const sourceFile = ts.createSourceFile(
    inspection.importer,
    inspection.source,
    ts.ScriptTarget.ES2022,
    true,
  );
  const host = ts.createCompilerHost(options);
  host.fileExists = (path) => path === inspection.importer;
  host.getSourceFile = (path) =>
    path === inspection.importer ? sourceFile : void 0;
  host.readFile = (path) =>
    path === inspection.importer ? inspection.source : '';
  const program = ts.createProgram([inspection.importer], options, host);
  return { checker: program.getTypeChecker(), sourceFile };
}

type SubprocessExpressionInspection = {
  readonly bindings: SubprocessBindings;
  readonly expression: ts.Expression;
};

function subprocessApi(
  inspection: SubprocessExpressionInspection,
): SubprocessApi | false {
  const expression = unwrapExpression(inspection.expression);
  if (ts.isIdentifier(expression)) {
    const [defaulted1 = false] = [
      inspection.bindings.apiIdentifiers.get(expression.text),
    ];
    return defaulted1;
  }
  if (!ts.isPropertyAccessExpression(expression)) return false;
  const member = asSubprocessApi(expression.name.text);
  if (member === false) return false;
  const root = unwrapExpression(expression.expression);
  if (
    ts.isIdentifier(root) &&
    inspection.bindings.namespaceIdentifiers.has(root.text)
  ) {
    return member;
  }
  return isChildProcessRequire(root) ? member : false;
}

function collectSubprocessBindings(
  sourceFile: ts.SourceFile,
): SubprocessBindings {
  const bindings: MutableSubprocessBindings = {
    apiIdentifiers: new Map<string, SubprocessApi>(),
    namespaceIdentifiers: new Set<string>(),
  };
  const collection: BindingCollection = { bindings, sourceFile };
  collectImportedBindings(collection);
  let priorSize = -1;
  while (
    priorSize !==
    bindings.apiIdentifiers.size + bindings.namespaceIdentifiers.size
  ) {
    priorSize =
      bindings.apiIdentifiers.size + bindings.namespaceIdentifiers.size;
    collectAliasedBindings(collection);
  }
  return bindings;
}

function collectImportedBindings(collection: BindingCollection): void {
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      CHILD_PROCESS_SPECIFIERS.has(node.moduleSpecifier.text)
    ) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        collection.bindings.namespaceIdentifiers.add(bindings.name.text);
      } else if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const [imported = element.name.text] = [element.propertyName?.text];
          const api = asSubprocessApi(imported);
          if (api !== false) {
            collection.bindings.apiIdentifiers.set(element.name.text, api);
          }
        }
      }
      if (node.importClause?.name) {
        collection.bindings.namespaceIdentifiers.add(
          node.importClause.name.text,
        );
      }
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      isChildProcessSpecifier(node.moduleReference.expression)
    ) {
      collection.bindings.namespaceIdentifiers.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(collection.sourceFile);
}

function collectAliasedBindings(collection: BindingCollection): void {
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const bindingInspection: VariableBindingInspection = {
        bindings: collection.bindings,
        initializer: unwrapExpression(node.initializer),
        name: node.name,
      };
      collectVariableBinding(bindingInspection);
    }
    ts.forEachChild(node, visit);
  };
  visit(collection.sourceFile);
}

type VariableBindingInspection = {
  readonly bindings: MutableSubprocessBindings;
  readonly initializer: ts.Expression;
  readonly name: ts.BindingName;
};

function collectVariableBinding(inspection: VariableBindingInspection): void {
  if (ts.isIdentifier(inspection.name)) {
    const expressionInspection: SubprocessExpressionInspection = {
      bindings: inspection.bindings,
      expression: inspection.initializer,
    };
    if (isNamespaceExpression(expressionInspection)) {
      inspection.bindings.namespaceIdentifiers.add(inspection.name.text);
      return;
    }
    const api = aliasedApi(expressionInspection);
    if (api !== false)
      inspection.bindings.apiIdentifiers.set(inspection.name.text, api);
    return;
  }
  if (!ts.isObjectBindingPattern(inspection.name)) return;
  const expressionInspection: SubprocessExpressionInspection = {
    bindings: inspection.bindings,
    expression: inspection.initializer,
  };
  if (!isNamespaceExpression(expressionInspection)) return;
  for (const element of inspection.name.elements) {
    if (!ts.isIdentifier(element.name)) continue;
    const imported =
      element.propertyName && ts.isIdentifier(element.propertyName)
        ? element.propertyName.text
        : element.name.text;
    const api = asSubprocessApi(imported);
    if (api !== false)
      inspection.bindings.apiIdentifiers.set(element.name.text, api);
  }
}

function aliasedApi(
  inspection: SubprocessExpressionInspection,
): SubprocessApi | false {
  return subprocessApi(inspection);
}

function isNamespaceExpression(
  inspection: SubprocessExpressionInspection,
): boolean {
  const expression = unwrapExpression(inspection.expression);
  return (
    isChildProcessRequire(expression) ||
    (ts.isIdentifier(expression) &&
      inspection.bindings.namespaceIdentifiers.has(expression.text))
  );
}

function isChildProcessRequire(node: ts.Expression): boolean {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'require' &&
    Boolean(node.arguments[0] && isChildProcessSpecifier(node.arguments[0]))
  );
}

function isChildProcessSpecifier(node: ts.Expression): boolean {
  return (
    ts.isStringLiteralLike(node) && CHILD_PROCESS_SPECIFIERS.has(node.text)
  );
}

function asSubprocessApi(value: string): SubprocessApi | false {
  return SUBPROCESS_APIS.has(value) ? (value as SubprocessApi) : false;
}

function isBunSubprocessCall(expression: ts.Expression): boolean {
  const candidate = unwrapExpression(expression);
  return (
    ts.isPropertyAccessExpression(candidate) &&
    ts.isIdentifier(candidate.expression) &&
    candidate.expression.text === 'Bun' &&
    (candidate.name.text === 'spawn' || candidate.name.text === 'spawnSync')
  );
}

type InitializerInspection = {
  readonly checker: ts.TypeChecker;
  readonly sourceFile: ts.SourceFile;
};

type InitializerCollection = {
  readonly initializers: ReadonlyMap<ts.Symbol, ts.Expression>;
  readonly mutableSymbols: ReadonlySet<ts.Symbol>;
};

function collectInitializers(
  inspection: InitializerInspection,
): InitializerCollection {
  const initializers = new Map<ts.Symbol, ts.Expression>();
  const mutableSymbols = collectMutableSymbols(inspection);
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      const symbol = inspection.checker.getSymbolAtLocation(node.name);
      if (symbol && !mutableSymbols.has(symbol)) {
        initializers.set(symbol, node.initializer);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(inspection.sourceFile);
  return { initializers, mutableSymbols };
}

function collectMutableSymbols(
  inspection: InitializerInspection,
): ReadonlySet<ts.Symbol> {
  const mutableSymbols = new Set<ts.Symbol>();
  const aliasSources = new Map<ts.Symbol, ts.Symbol>();
  const recordMutation = (expression: ts.Expression): void => {
    const root = mutationRootIdentifier(expression);
    const symbol = root ? inspection.checker.getSymbolAtLocation(root) : false;
    if (symbol) mutableSymbols.add(symbol);
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const alias = inspection.checker.getSymbolAtLocation(node.name);
      const sourceRoot = mutationRootIdentifier(node.initializer);
      const source = sourceRoot
        ? inspection.checker.getSymbolAtLocation(sourceRoot)
        : false;
      if (alias && source && alias !== source) aliasSources.set(alias, source);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      recordMutation(node.left);
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      recordMutation(node.operand);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      MUTATING_COLLECTION_METHODS.has(node.expression.name.text)
    ) {
      recordMutation(node.expression.expression);
    }
    ts.forEachChild(node, visit);
  };
  visit(inspection.sourceFile);
  let priorSize = -1;
  while (priorSize !== mutableSymbols.size) {
    priorSize = mutableSymbols.size;
    for (const [alias, source] of aliasSources) {
      if (mutableSymbols.has(alias)) mutableSymbols.add(source);
    }
  }
  return mutableSymbols;
}

function mutationRootIdentifier(
  expression: ts.Expression,
): ts.Identifier | false {
  let current = unwrapExpression(expression);
  while (
    ts.isPropertyAccessExpression(current) ||
    ts.isElementAccessExpression(current)
  ) {
    current = unwrapExpression(current.expression);
  }
  return ts.isIdentifier(current) ? current : false;
}

function collectLiterals(collection: LiteralCollection): void {
  if (collection.seenNodes.has(collection.node)) return;
  collection.seenNodes.add(collection.node);
  if (ts.isStringLiteralLike(collection.node)) {
    collection.values.push(collection.node.text);
    return;
  }
  if (ts.isIdentifier(collection.node)) {
    const symbol = collection.checker.getSymbolAtLocation(collection.node);
    const initializer =
      symbol && collection.initializers.has(symbol)
        ? collection.initializers.get(symbol)!
        : false;
    if (initializer) {
      const nestedCollection: LiteralCollection = {
        checker: collection.checker,
        initializers: collection.initializers,
        mutableSymbols: collection.mutableSymbols,
        node: initializer,
        seenNodes: collection.seenNodes,
        values: collection.values,
      };
      collectLiterals(nestedCollection);
      return;
    }
    if (
      !ts.isPropertyAssignment(collection.node.parent) ||
      collection.node.parent.name !== collection.node
    ) {
      collection.values.push(
        symbol && collection.mutableSymbols.has(symbol)
          ? MUTABLE_LITERAL
          : UNRESOLVED_LITERAL,
      );
    }
    return;
  }
  if (ts.isArrayLiteralExpression(collection.node)) {
    for (const element of collection.node.elements) {
      const nestedInspection: NestedLiteralCollection = {
        collection,
        node: element,
      };
      collectNestedLiterals(nestedInspection);
    }
    return;
  }
  if (ts.isObjectLiteralExpression(collection.node)) {
    for (const property of collection.node.properties) {
      if (ts.isPropertyAssignment(property)) {
        const nestedInspection: NestedLiteralCollection = {
          collection,
          node: property.initializer,
        };
        collectNestedLiterals(nestedInspection);
      } else if (ts.isShorthandPropertyAssignment(property)) {
        const nestedInspection: NestedLiteralCollection = {
          collection,
          node: property.name,
        };
        collectNestedLiterals(nestedInspection);
      } else if (ts.isSpreadAssignment(property)) {
        const nestedInspection: NestedLiteralCollection = {
          collection,
          node: property.expression,
        };
        collectNestedLiterals(nestedInspection);
      } else {
        collection.values.push(UNRESOLVED_LITERAL);
      }
    }
    return;
  }
  if (ts.isSpreadElement(collection.node)) {
    const nestedInspection: NestedLiteralCollection = {
      collection,
      node: collection.node.expression,
    };
    collectNestedLiterals(nestedInspection);
    return;
  }
  collection.values.push(UNRESOLVED_LITERAL);
}

type NestedLiteralCollection = {
  readonly collection: LiteralCollection;
  readonly node: ts.Node;
};

function collectNestedLiterals(inspection: NestedLiteralCollection): void {
  const nestedCollection: LiteralCollection = {
    checker: inspection.collection.checker,
    initializers: inspection.collection.initializers,
    mutableSymbols: inspection.collection.mutableSymbols,
    node: inspection.node,
    seenNodes: inspection.collection.seenNodes,
    values: inspection.collection.values,
  };
  collectLiterals(nestedCollection);
}

type CandidateScriptInspection = {
  readonly api: SubprocessApi;
  readonly literals: readonly string[];
  readonly repository: RepositorySubprocessInspection;
};

type CandidateScriptDiscovery = {
  readonly literals: readonly string[];
  readonly unresolved: boolean;
};

type RuntimeScriptInspection = {
  readonly arguments: readonly string[];
  readonly repository: RepositorySubprocessInspection;
  readonly runtime: string;
};

const RUNTIME_OPTIONS_WITH_VALUES = new Set(['--cwd']);

function candidateScriptLiterals(
  inspection: CandidateScriptInspection,
): CandidateScriptDiscovery {
  if (inspection.api === SubprocessApi.Fork) {
    const [literal = false] = [inspection.literals[0]];
    return literal === false || literal === UNRESOLVED_LITERAL
      ? { literals: [], unresolved: true }
      : { literals: [literal], unresolved: false };
  }
  const [first = false] = [inspection.literals[0]];
  if (first === MUTABLE_LITERAL) {
    return { literals: [], unresolved: true };
  }
  if (first === UNRESOLVED_LITERAL) {
    const repositoryPathIsUnresolved = inspection.literals
      .slice(1)
      .some((literal) => {
        if (literal === UNRESOLVED_LITERAL) return false;
        if (literal === MUTABLE_LITERAL) return true;
        const resolution: RepositoryScriptResolution = {
          inspection: inspection.repository,
          literal,
        };
        return (
          SCRIPT_EXTENSION.test(literal) ||
          literal.includes('/') ||
          resolveRepositoryScript(resolution) !== false
        );
      });
    return { literals: [], unresolved: repositoryPathIsUnresolved };
  }
  if (first === false) {
    return { literals: [], unresolved: false };
  }
  if (
    inspection.api === SubprocessApi.Exec ||
    inspection.api === SubprocessApi.ExecSync
  ) {
    if (/[;&|`$<>\n"']/u.test(first)) {
      return { literals: [], unresolved: true };
    }
    const tokens = first.split(/\s+/u).filter(Boolean);
    const [command = false] = [tokens[0]];
    if (command === false) return { literals: [], unresolved: true };
    if (SCRIPT_RUNTIMES.has(posix.basename(command))) {
      const runtimeInspection: RuntimeScriptInspection = {
        arguments: tokens.slice(1),
        repository: inspection.repository,
        runtime: command,
      };
      return runtimeScriptLiterals(runtimeInspection);
    }
    return {
      literals: isScriptLikeLiteral(command) ? [command] : [],
      unresolved: false,
    };
  }
  if (SCRIPT_RUNTIMES.has(posix.basename(first))) {
    const runtimeInspection: RuntimeScriptInspection = {
      arguments: inspection.literals.slice(1),
      repository: inspection.repository,
      runtime: first,
    };
    return runtimeScriptLiterals(runtimeInspection);
  }
  return {
    literals: isScriptLikeLiteral(first) ? [first] : [],
    unresolved: false,
  };
}

function candidateUsesScriptRuntime(
  inspection: CandidateScriptInspection,
): boolean {
  const [first = false] = [inspection.literals[0]];
  if (first === false || first === UNRESOLVED_LITERAL) return false;
  const [defaulted2 = ''] = [first.split(/\s+/u)[0]];
  const command =
    inspection.api === SubprocessApi.Exec ||
    inspection.api === SubprocessApi.ExecSync
      ? defaulted2
      : first;
  return SCRIPT_RUNTIMES.has(posix.basename(command));
}

function runtimeScriptLiterals(
  inspection: RuntimeScriptInspection,
): CandidateScriptDiscovery {
  const runtime = posix.basename(inspection.runtime);
  let index = 0;
  let workingDirectory: string | false = false;
  const bunRun = runtime === 'bun' && inspection.arguments[0] === 'run';
  if (bunRun) index += 1;
  while (index < inspection.arguments.length) {
    const argument = inspection.arguments[index];
    if (
      !argument ||
      argument === UNRESOLVED_LITERAL ||
      argument === MUTABLE_LITERAL
    ) {
      return { literals: [], unresolved: true };
    }
    if (argument === '--') {
      index += 1;
      continue;
    }
    if (RUNTIME_OPTIONS_WITH_VALUES.has(argument)) {
      const [directory = false] = [inspection.arguments[index + 1]];
      if (
        directory === false ||
        directory === UNRESOLVED_LITERAL ||
        directory === MUTABLE_LITERAL
      ) {
        return { literals: [], unresolved: true };
      }
      workingDirectory = directory;
      index += 2;
      continue;
    }
    if (argument.startsWith('-')) {
      return { literals: [], unresolved: true };
    }
    if (bunRun && !SCRIPT_EXTENSION.test(argument)) {
      if (workingDirectory === false) {
        return { literals: [], unresolved: true };
      }
      const packageScriptInspection: BunPackageScriptInspection = {
        name: argument,
        repository: inspection.repository,
        workingDirectory,
      };
      return resolveBunPackageScript(packageScriptInspection);
    }
    const literal =
      workingDirectory === false
        ? argument
        : posix.normalize(posix.join(workingDirectory, argument));
    return {
      literals: isScriptLikeLiteral(literal) ? [literal] : [],
      unresolved: !isScriptLikeLiteral(literal),
    };
  }
  return { literals: [], unresolved: true };
}

type BunPackageDocument = {
  readonly scripts?: Readonly<Record<string, string>>;
};

type BunPackageScriptInspection = {
  readonly name: string;
  readonly repository: RepositorySubprocessInspection;
  readonly workingDirectory: string;
};

function resolveBunPackageScript(
  inspection: BunPackageScriptInspection,
): CandidateScriptDiscovery {
  const packagePath = posix.normalize(
    posix.join(inspection.workingDirectory, 'package.json'),
  );
  const [packageSource = false] = [
    inspection.repository.sources.get(packagePath),
  ];
  if (packageSource === false) return { literals: [], unresolved: true };
  let document: BunPackageDocument;
  try {
    document = JSON.parse(packageSource) as BunPackageDocument;
  } catch {
    return { literals: [], unresolved: true };
  }
  const [command = false] = [document.scripts?.[inspection.name]];
  if (command === false || /[;&|`$<>\n"']/u.test(command)) {
    return { literals: [], unresolved: true };
  }
  const tokens = command.split(/\s+/u).filter(Boolean);
  if (
    tokens.length !== 3 ||
    tokens[0] !== 'bun' ||
    tokens[1] !== 'run' ||
    !tokens[2] ||
    !SCRIPT_EXTENSION.test(tokens[2])
  ) {
    return { literals: [], unresolved: true };
  }
  return {
    literals: [
      posix.normalize(posix.join(inspection.workingDirectory, tokens[2])),
    ],
    unresolved: false,
  };
}

function isScriptLikeLiteral(value: string): boolean {
  return SCRIPT_EXTENSION.test(value) || posix.extname(value) === '';
}

type RepositoryScriptResolution = {
  readonly inspection: RepositorySubprocessInspection;
  readonly literal: string;
};

function resolveRepositoryScript(
  resolution: RepositoryScriptResolution,
): string | false {
  const literal = resolution.literal.replace(/^file:\/\//u, '');
  const candidates = [
    posix.normalize(literal.replace(/^\.\//u, '')),
    posix.normalize(
      posix.join(posix.dirname(resolution.inspection.importer), literal),
    ),
  ];
  for (const candidate of candidates) {
    if (!resolution.inspection.sources.has(candidate)) continue;
    if (
      posix.extname(candidate).length === 0 &&
      !resolution.inspection.executablePaths.has(candidate)
    ) {
      return false;
    }
    return candidate;
  }
  return false;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    return unwrapExpression(expression.expression);
  }
  return expression;
}
