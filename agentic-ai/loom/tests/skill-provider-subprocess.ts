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
  readonly initializers: ReadonlyMap<string, ts.Expression>;
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

export function repositorySubprocessEntrypoints(
  inspection: RepositorySubprocessInspection,
): RepositorySubprocessDiscovery {
  const sourceFile = ts.createSourceFile(
    inspection.importer,
    inspection.source,
    ts.ScriptTarget.ES2022,
    true,
  );
  const initializers = collectInitializers(sourceFile);
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
        initializers,
        node: argument,
        seenNodes: new Set<ts.Node>(),
        values: literals,
      };
      collectLiterals(collection);
    }
    const candidateInspection: CandidateScriptInspection = {
      api: discovery.api,
      literals,
    };
    const candidates = candidateScriptLiterals(candidateInspection);
    for (const literal of candidates) {
      if (
        discovery.api !== SubprocessApi.Fork &&
        posix.extname(literal).length === 0 &&
        !literal.includes('/')
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
    if (discovery.api === SubprocessApi.Fork && candidates.length === 0) {
      unresolved = true;
    }
  }
  return { paths: [...paths], unresolved };
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
    return inspection.bindings.apiIdentifiers.get(expression.text) ?? false;
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
          const imported = element.propertyName?.text ?? element.name.text;
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

function collectInitializers(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, ts.Expression> {
  const initializers = new Map<string, ts.Expression>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      initializers.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return initializers;
}

function collectLiterals(collection: LiteralCollection): void {
  if (collection.seenNodes.has(collection.node)) return;
  collection.seenNodes.add(collection.node);
  if (ts.isStringLiteralLike(collection.node)) {
    collection.values.push(collection.node.text);
    return;
  }
  if (ts.isIdentifier(collection.node)) {
    const initializer = collection.initializers.get(collection.node.text);
    if (initializer) {
      const nestedCollection: LiteralCollection = {
        initializers: collection.initializers,
        node: initializer,
        seenNodes: collection.seenNodes,
        values: collection.values,
      };
      collectLiterals(nestedCollection);
      return;
    }
  }
  collection.node.forEachChild((child) => {
    const nestedCollection: LiteralCollection = {
      initializers: collection.initializers,
      node: child,
      seenNodes: collection.seenNodes,
      values: collection.values,
    };
    collectLiterals(nestedCollection);
  });
}

type CandidateScriptInspection = {
  readonly api: SubprocessApi;
  readonly literals: readonly string[];
};

function candidateScriptLiterals(
  inspection: CandidateScriptInspection,
): readonly string[] {
  if (inspection.api === SubprocessApi.Fork)
    return inspection.literals.slice(0, 1);
  const first = inspection.literals[0] ?? false;
  if (first === false) return [];
  if (
    inspection.api === SubprocessApi.Exec ||
    inspection.api === SubprocessApi.ExecSync
  ) {
    const tokens = first.split(/\s+/u).filter(Boolean);
    const command = tokens[0] ?? false;
    if (command === false) return [];
    if (SCRIPT_RUNTIMES.has(posix.basename(command))) {
      return tokens.slice(1).filter(isScriptLikeLiteral);
    }
    return isScriptLikeLiteral(command) ? [command] : [];
  }
  if (SCRIPT_RUNTIMES.has(posix.basename(first))) {
    return inspection.literals.slice(1).filter(isScriptLikeLiteral);
  }
  return isScriptLikeLiteral(first) ? [first] : [];
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
