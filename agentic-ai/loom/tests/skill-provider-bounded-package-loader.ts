import { posix } from 'node:path';
import ts from 'typescript';

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
  readonly functionDeclaration: ts.FunctionDeclaration;
  readonly functionName: ts.Identifier;
  readonly parameter: ts.Identifier;
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

type RepositoryPackageDocument = {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly name?: string;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
};

type SourceReplacement = {
  readonly end: number;
  readonly replacement: string;
  readonly start: number;
};

const SAFE_PACKAGE_SPECIFIER =
  /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u;

export function specializeBoundedPackageLoaders(
  inspection: BoundedPackageLoaderInspection,
): string {
  const sourceFile = ts.createSourceFile(
    inspection.path,
    inspection.source,
    ts.ScriptTarget.ES2022,
    true,
  );
  const candidates = boundedLoaderCandidates(sourceFile);
  const replacements: SourceReplacement[] = [];
  for (const candidate of candidates) {
    const validation: CandidateValidation = {
      candidate,
      inspection,
      sourceFile,
    };
    if (!isClosedBoundedLoader(validation)) continue;
    const importReplacement: SourceReplacement = {
      end: candidate.createRequireImport.moduleSpecifier.end,
      replacement: "'bounded-package-loader'",
      start: candidate.createRequireImport.moduleSpecifier.getStart(sourceFile),
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
      if (pending[index]!.start > pending[latestIndex]!.start) {
        latestIndex = index;
      }
    }
    const replacement = pending.splice(latestIndex, 1)[0];
    if (!replacement) continue;
    specialized = `${specialized.slice(0, replacement.start)}${replacement.replacement}${specialized.slice(replacement.end)}`;
  }
  return specialized;
}

export function specializeProvenGeneratedArtifactLoader(
  inspection: BoundedPackageLoaderInspection,
): string {
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
  if (imports.length !== 1) return inspection.source;
  const dynamicImport = imports[0];
  const urlArgument = dynamicImport?.arguments[0];
  if (!dynamicImport || !urlArgument || !ts.isIdentifier(urlArgument)) {
    return inspection.source;
  }
  const [urlDeclaration = false] = [declarations.get(urlArgument.text)];
  const target = generatedArtifactTarget(urlDeclaration);
  if (target === false) return inspection.source;
  const [siteDeclaration = false] = [declarations.get(target.root.text)];
  const output = fixedOutputDirectory(siteDeclaration);
  const useInspection: IdentifierUseInspection = {
    name: urlArgument.text,
    sourceFile,
  };
  if (output === false || identifierUseCount(useInspection) !== 2) {
    return inspection.source;
  }
  const appRoot = posix.dirname(posix.dirname(inspection.path));
  const artifactPath = posix.join(appRoot, output, target.artifact);
  const producerInspection: GeneratedArtifactProducerInspection = {
    artifact: target.artifact,
    inspection,
    output,
  };
  const producer = generatedArtifactProducer(producerInspection);
  if (producer === false || producer.artifactPath !== artifactPath) {
    return inspection.source;
  }
  const relative = posix.relative(
    posix.dirname(inspection.path),
    producer.sourcePath,
  );
  const specifier = relative.startsWith('.') ? relative : `./${relative}`;
  return `${inspection.source.slice(0, dynamicImport.getStart(sourceFile))}import('${specifier}')${inspection.source.slice(dynamicImport.end)}`;
}

type GeneratedArtifactTarget = {
  readonly artifact: string;
  readonly root: ts.Identifier;
};

function generatedArtifactTarget(
  declaration: ts.VariableDeclaration | false,
): GeneratedArtifactTarget | false {
  const initializer = declaration === false ? false : declaration.initializer;
  if (
    !initializer ||
    !ts.isTemplateExpression(initializer) ||
    initializer.templateSpans.length !== 2
  )
    return false;
  const fileUrl = initializer.templateSpans[0]?.expression;
  const cacheBust = initializer.templateSpans[1]?.expression;
  if (
    !fileUrl ||
    !ts.isPropertyAccessExpression(fileUrl) ||
    fileUrl.name.text !== 'href' ||
    !ts.isCallExpression(fileUrl.expression) ||
    !ts.isIdentifier(fileUrl.expression.expression) ||
    fileUrl.expression.expression.text !== 'pathToFileURL' ||
    !cacheBust ||
    !ts.isCallExpression(cacheBust) ||
    !ts.isPropertyAccessExpression(cacheBust.expression) ||
    !ts.isIdentifier(cacheBust.expression.expression) ||
    cacheBust.expression.expression.text !== 'Date' ||
    cacheBust.expression.name.text !== 'now' ||
    cacheBust.arguments.length !== 0
  )
    return false;
  const joinCall = fileUrl.expression.arguments[0];
  if (
    !joinCall ||
    !ts.isCallExpression(joinCall) ||
    !ts.isIdentifier(joinCall.expression) ||
    joinCall.expression.text !== 'join'
  )
    return false;
  const root = joinCall.arguments[0];
  const artifact = joinCall.arguments[1];
  if (
    !root ||
    !ts.isIdentifier(root) ||
    !artifact ||
    !ts.isStringLiteralLike(artifact)
  ) {
    return false;
  }
  return { artifact: artifact.text, root };
}

function fixedOutputDirectory(
  declaration: ts.VariableDeclaration | false,
): string | false {
  const initializer = declaration === false ? false : declaration.initializer;
  const outputArgument =
    initializer && ts.isCallExpression(initializer)
      ? initializer.arguments[1]
      : false;
  if (
    !initializer ||
    !ts.isCallExpression(initializer) ||
    !ts.isIdentifier(initializer.expression) ||
    initializer.expression.text !== 'join' ||
    !outputArgument ||
    !ts.isStringLiteralLike(outputArgument)
  )
    return false;
  return posix.normalize(outputArgument.text.replace(/^[^/]+\//u, ''));
}

type IdentifierUseInspection = {
  readonly name: string;
  readonly sourceFile: ts.SourceFile;
};

function identifierUseCount(inspection: IdentifierUseInspection): number {
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === inspection.name) count += 1;
    ts.forEachChild(node, visit);
  };
  visit(inspection.sourceFile);
  return count;
}

type GeneratedArtifactProducerInspection = {
  readonly artifact: string;
  readonly inspection: BoundedPackageLoaderInspection;
  readonly output: string;
};

type GeneratedArtifactProducer = {
  readonly artifactPath: string;
  readonly sourcePath: string;
};

function generatedArtifactProducer(
  request: GeneratedArtifactProducerInspection,
): GeneratedArtifactProducer | false {
  for (const root of request.inspection.roots) {
    const [source = ''] = [request.inspection.sources.get(root)];
    if (
      !source.includes('copyFileSync') ||
      !source.includes(`'${request.artifact}'`)
    )
      continue;
    const sourceMatch =
      /copyFileSync\(\s*join\(process\.cwd\(\),\s*'([^']+)'\),\s*join\(outDir,\s*'([^']+)'\)/mu.exec(
        source,
      );
    if (!sourceMatch || sourceMatch[2] !== request.artifact) continue;
    const [, sourcePathSuffix = ''] = sourceMatch;
    const sourcePath = posix.join(posix.dirname(root), sourcePathSuffix);
    if (!request.inspection.sources.has(sourcePath)) continue;
    const envProvesOutput = [...request.inspection.roots].some((path) => {
      const [config = ''] = [request.inspection.sources.get(path)];
      return (
        config.includes('VITE_NOOK_APP_KIND=site') &&
        config.includes(`VITE_NOOK_OUT_DIR=${request.output}`)
      );
    });
    if (!envProvesOutput) continue;
    return {
      artifactPath: posix.join(
        posix.dirname(root),
        request.output,
        request.artifact,
      ),
      sourcePath,
    };
  }
  return false;
}

export function specializeBoundedLocalDataLoaders(
  inspection: BoundedPackageLoaderInspection,
): string {
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
    const sourceBinding = dataUrlSourceBinding(moduleDeclaration);
    if (sourceBinding === false) continue;
    const [sourceDeclaration = false] = [declarations.get(sourceBinding.text)];
    const pathBinding = readFilePathBinding(sourceDeclaration);
    if (pathBinding === false) continue;
    const [pathDeclaration = false] = [declarations.get(pathBinding.text)];
    const pathInspection: TrackedResolvedPathInspection = {
      declaration: pathDeclaration,
      sources: inspection.sources,
    };
    const trackedPath = trackedResolvedPath(pathInspection);
    if (trackedPath === false) continue;
    const closure: LocalDataLoaderClosure = {
      dynamicImport,
      moduleArgument,
      moduleDeclaration,
      pathBinding,
      pathDeclaration,
      sourceBinding,
      sourceDeclaration,
      scope: nearestFunctionScope(moduleDeclaration),
    };
    if (closure.scope === false || !isClosedLocalDataLoader(closure)) continue;
    const relativePath = posix.relative(
      posix.dirname(inspection.path),
      trackedPath,
    );
    const specifier = relativePath.startsWith('.')
      ? relativePath
      : `./${relativePath}`;
    const replacement: SourceReplacement = {
      end: dynamicImport.end,
      replacement: `import('${specifier}')`,
      start: dynamicImport.getStart(sourceFile),
    };
    replacements.push(replacement);
  }
  let specialized = inspection.source;
  for (const replacement of replacements) {
    specialized = `${specialized.slice(0, replacement.start)}${replacement.replacement}${specialized.slice(replacement.end)}`;
  }
  return specialized;
}

function dataUrlSourceBinding(
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
    !ts.isIdentifier(expression.expression.expression.expression.expression) ||
    expression.expression.expression.expression.expression.text !== 'Buffer'
  ) {
    return false;
  }
  const source = expression.expression.expression.arguments[0];
  return source && ts.isIdentifier(source) ? source : false;
}

function readFilePathBinding(
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

type TrackedResolvedPathInspection = {
  readonly declaration: ts.VariableDeclaration | false;
  readonly sources: ReadonlyMap<string, string>;
};

function trackedResolvedPath(
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
  const path = posix.normalize(literals[0]!.text);
  return inspection.sources.has(path) ? path : false;
}

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

function nearestFunctionScope(node: ts.Node): ts.Node | false {
  let candidate = node.parent;
  while (!ts.isSourceFile(candidate)) {
    if (ts.isFunctionLike(candidate)) return candidate;
    candidate = candidate.parent;
  }
  return false;
}

function isClosedLocalDataLoader(closure: LocalDataLoaderClosure): boolean {
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

function boundedLoaderCandidates(
  sourceFile: ts.SourceFile,
): readonly BoundedLoaderCandidate[] {
  const createRequireImports = new Map<string, ts.ImportDeclaration>();
  const pathToFileUrlImports = new Set<string>();
  const variableDeclarations = new Map<string, ts.VariableDeclaration>();
  const functionDeclarations: ts.FunctionDeclaration[] = [];
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
    if (ts.isFunctionDeclaration(node)) functionDeclarations.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const candidates: BoundedLoaderCandidate[] = [];
  for (const functionDeclaration of functionDeclarations) {
    const functionName = functionDeclaration.name;
    const parameterDeclaration = functionDeclaration.parameters[0];
    if (
      !functionName ||
      functionDeclaration.parameters.length !== 1 ||
      !parameterDeclaration ||
      !ts.isIdentifier(parameterDeclaration.name) ||
      !functionDeclaration.body
    ) {
      continue;
    }
    const parameter = parameterDeclaration.name;
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
      const dynamicImport = findBoundedDynamicImport(search);
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
        parameter,
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

type DynamicImportSearch = {
  readonly body: ts.Block;
  readonly resolvedBinding: ts.Identifier;
};

function findBoundedDynamicImport(
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
          argument: node.arguments[0]!,
          resolvedBinding: search.resolvedBinding,
        };
        return isResolvedFileUrlImport(inspection);
      })()
    ) {
      imports.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(search.body);
  return imports.length === 1 ? imports[0]! : false;
}

type ResolvedFileUrlImportInspection = {
  readonly argument: ts.Expression | false;
  readonly resolvedBinding: ts.Identifier;
};

function isResolvedFileUrlImport(
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

function isClosedBoundedLoader(validation: CandidateValidation): boolean {
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
  let safe = true;
  let callCount = 0;
  const visit = (node: ts.Node): void => {
    if (!safe) return;
    if (ts.isIdentifier(node) && node.text === candidate.functionName.text) {
      if (node === candidate.functionName) return;
      const parent = node.parent;
      if (!ts.isCallExpression(parent) || parent.expression !== node) {
        safe = false;
        return;
      }
      const argument = parent.arguments[0];
      const packageInspection: RepositoryPackageInspection | false =
        argument && ts.isStringLiteralLike(argument)
          ? { sources: validation.inspection.sources, specifier: argument.text }
          : false;
      if (
        parent.arguments.length !== 1 ||
        !argument ||
        !ts.isStringLiteralLike(argument) ||
        !SAFE_PACKAGE_SPECIFIER.test(argument.text) ||
        (packageInspection !== false &&
          isRepositoryBackedPackage(packageInspection))
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
      node !== allowedParameterReference
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
  return safe && callCount > 0;
}

type RepositoryPackageInspection = {
  readonly sources: ReadonlyMap<string, string>;
  readonly specifier: string;
};

function isRepositoryBackedPackage(
  inspection: RepositoryPackageInspection,
): boolean {
  for (const [path, source] of inspection.sources) {
    if (!path.endsWith('package.json') || source.length === 0) continue;
    let document: RepositoryPackageDocument;
    try {
      document = JSON.parse(source) as RepositoryPackageDocument;
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
        (dependency.startsWith('file:') || dependency.startsWith('workspace:'))
      ) {
        return true;
      }
    }
  }
  return false;
}
