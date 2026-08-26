import ts from 'typescript';
import {
  createSkillProviderTypeContext,
  type SkillProviderSourceInspection,
} from './skill-provider-type-context.ts';

export type FiniteNodeLoaderInspection = {
  readonly path: string;
  readonly source: string;
};

enum AllowedNodeModule {
  FileSystem = 'node:fs',
  Path = 'node:path',
}

enum AllowedProcessCapability {
  ChangeDirectory = 'chdir',
}

const ALLOWED_NODE_MODULES = new Set<string>(Object.values(AllowedNodeModule));

type FiniteNodeLoaderCandidate = {
  readonly body: ts.Block;
  readonly name: ts.Identifier;
  readonly parameter: ts.Identifier;
};

type FiniteNodeLoaderValidation = {
  readonly candidate: FiniteNodeLoaderCandidate;
  readonly checker: ts.TypeChecker;
  readonly sourceFile: ts.SourceFile;
};

type SourceReplacement = {
  readonly end: number;
  readonly replacement: string;
  readonly start: number;
};

export function specializeClosedFiniteNodeLoaders(
  inspection: FiniteNodeLoaderInspection,
): string {
  const contextInspection: SkillProviderSourceInspection = {
    filePath: inspection.path,
    source: inspection.source,
  };
  const context = createSkillProviderTypeContext(contextInspection);
  const sourceFile = context.sourceFile;
  const replacements: SourceReplacement[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const capabilityInspection: NodeCapabilityImportInspection = {
        declaration: node,
        sourceFile,
      };
      const capabilityReplacement =
        finiteNodeCapabilityImportReplacement(capabilityInspection);
      if (capabilityReplacement !== false) {
        replacements.push(capabilityReplacement);
      }
    }
    if (ts.isVariableStatement(node)) {
      const processViewInspection: ProcessViewInspection = {
        sourceFile,
        statement: node,
      };
      const processReplacements = closedProcessViewReplacements(
        processViewInspection,
      );
      if (processReplacements !== false) {
        replacements.push(...processReplacements);
      }
    }
    if (ts.isFunctionDeclaration(node)) {
      const candidate = finiteNodeLoaderCandidate(node);
      if (candidate !== false) {
        const validation: FiniteNodeLoaderValidation = {
          candidate,
          checker: context.checker,
          sourceFile,
        };
        const modules = candidateUsesAmbientEvaluatorBindings(validation)
          ? finiteNodeLoaderModules(validation)
          : false;
        if (modules !== false) {
          const bodyRequest: FiniteNodeLoaderBody = {
            modules,
            parameter: candidate.parameter.text,
          };
          const replacement: SourceReplacement = {
            end: candidate.body.end,
            replacement: finiteNodeLoaderBody(bodyRequest),
            start: candidate.body.getStart(sourceFile),
          };
          replacements.push(replacement);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const orderedReplacements =
    descendingNonOverlappingReplacements(replacements);
  if (orderedReplacements === false) return inspection.source;
  let specialized = inspection.source;
  for (const replacement of orderedReplacements) {
    specialized = `${specialized.slice(0, replacement.start)}${replacement.replacement}${specialized.slice(replacement.end)}`;
  }
  return specialized;
}

enum AmbientEvaluatorBinding {
  Eval = 'eval',
  Function = 'Function',
  Json = 'JSON',
}

const AMBIENT_EVALUATOR_BINDINGS = new Set<string>(
  Object.values(AmbientEvaluatorBinding),
);

function candidateUsesAmbientEvaluatorBindings(
  validation: FiniteNodeLoaderValidation,
): boolean {
  const seen = new Set<string>();
  let ambient = true;
  const visit = (node: ts.Node): void => {
    if (
      ambient &&
      ts.isIdentifier(node) &&
      AMBIENT_EVALUATOR_BINDINGS.has(node.text)
    ) {
      const symbol = validation.checker.getSymbolAtLocation(node);
      const declarations = symbol?.declarations ?? [];
      if (
        declarations.length === 0 ||
        declarations.some(
          (declaration) =>
            declaration.getSourceFile() === validation.sourceFile,
        )
      ) {
        ambient = false;
        return;
      }
      seen.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(validation.candidate.body);
  return ambient && seen.size === AMBIENT_EVALUATOR_BINDINGS.size;
}

function descendingNonOverlappingReplacements(
  replacements: readonly SourceReplacement[],
): readonly SourceReplacement[] | false {
  const pending = [...replacements];
  const ordered: SourceReplacement[] = [];
  while (pending.length > 0) {
    let latestIndex = 0;
    for (let index = 1; index < pending.length; index += 1) {
      const candidate = pending[index] ?? false;
      const latest = pending[latestIndex] ?? false;
      if (
        candidate !== false &&
        latest !== false &&
        candidate.start > latest.start
      ) {
        latestIndex = index;
      }
    }
    const replacement = pending[latestIndex] ?? false;
    if (replacement === false) return false;
    pending.splice(latestIndex, 1);
    const previous = ordered[ordered.length - 1] ?? false;
    if (previous !== false && replacement.end > previous.start) return false;
    ordered.push(replacement);
  }
  return ordered;
}

type NodeCapabilityImportInspection = {
  readonly declaration: ts.ImportDeclaration;
  readonly sourceFile: ts.SourceFile;
};

function finiteNodeCapabilityImportReplacement(
  inspection: NodeCapabilityImportInspection,
): SourceReplacement | false {
  if (
    !ts.isStringLiteralLike(inspection.declaration.moduleSpecifier) ||
    inspection.declaration.moduleSpecifier.text !== 'node:process'
  ) {
    return false;
  }
  const clause = inspection.declaration.importClause ?? false;
  if (
    clause === false ||
    clause.name ||
    !clause.namedBindings ||
    !ts.isNamedImports(clause.namedBindings) ||
    clause.namedBindings.elements.length === 0
  ) {
    return false;
  }
  const bindings: string[] = [];
  for (const specifier of clause.namedBindings.elements) {
    const imported = specifier.propertyName?.text ?? specifier.name.text;
    if (imported !== AllowedProcessCapability.ChangeDirectory) return false;
    bindings.push(`const ${specifier.name.text} = safeProcessChangeDirectory;`);
  }
  return {
    end: inspection.declaration.end,
    replacement: bindings.join('\n'),
    start: inspection.declaration.getStart(inspection.sourceFile),
  };
}

type ProcessViewInspection = {
  readonly sourceFile: ts.SourceFile;
  readonly statement: ts.VariableStatement;
};

function closedProcessViewReplacements(
  inspection: ProcessViewInspection,
): readonly SourceReplacement[] | false {
  if (inspection.statement.declarationList.declarations.length !== 1) {
    return false;
  }
  const declaration =
    inspection.statement.declarationList.declarations[0] ?? false;
  if (
    declaration === false ||
    !ts.isIdentifier(declaration.name) ||
    !declaration.initializer ||
    !isGlobalProcessAccess(declaration.initializer)
  ) {
    return false;
  }
  const binding = declaration.name;
  const scope = nearestFunctionScope(inspection.statement);
  if (scope === false) return false;
  const replacements: SourceReplacement[] = [];
  let safe = true;
  const visit = (node: ts.Node): void => {
    if (!safe) return;
    if (ts.isIdentifier(node) && node.text === binding.text) {
      if (node === binding) return;
      const access = outermostAccessExpression(node);
      const normalized = access
        .getText(inspection.sourceFile)
        .replace(/[\s?]/gu, '');
      const allowed = new Set([
        `${binding.text}.versions.node`,
        `${binding.text}.env.NOOK_COMPANION_WASM_PATH.trim()`,
        `${binding.text}.cwd()`,
        `${binding.text}.cwd.()`,
      ]);
      if (!allowed.has(normalized)) {
        safe = false;
        return;
      }
      const replacement: SourceReplacement = {
        end: node.end,
        replacement: 'process',
        start: node.getStart(inspection.sourceFile),
      };
      replacements.push(replacement);
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  if (!safe || replacements.length === 0) return false;
  const declarationReplacement: SourceReplacement = {
    end: inspection.statement.end,
    replacement: '',
    start: inspection.statement.getStart(inspection.sourceFile),
  };
  return [declarationReplacement, ...replacements];
}

function isGlobalProcessAccess(expression: ts.Expression): boolean {
  const candidate = unwrapTransparentExpression(expression);
  if (
    !ts.isPropertyAccessExpression(candidate) ||
    candidate.name.text !== 'process'
  ) {
    return false;
  }
  const root = unwrapTransparentExpression(candidate.expression);
  return ts.isIdentifier(root) && root.text === 'globalThis';
}

function nearestFunctionScope(node: ts.Node): ts.Node | false {
  let candidate = node.parent;
  while (!ts.isSourceFile(candidate)) {
    if (ts.isFunctionLike(candidate)) return candidate;
    candidate = candidate.parent;
  }
  return false;
}

function outermostAccessExpression(node: ts.Identifier): ts.Expression {
  let candidate: ts.Expression = node;
  while (true) {
    const parent = candidate.parent;
    if (
      (ts.isPropertyAccessExpression(parent) ||
        ts.isElementAccessExpression(parent)) &&
      parent.expression === candidate
    ) {
      candidate = parent;
      continue;
    }
    if (ts.isCallExpression(parent) && parent.expression === candidate) {
      candidate = parent;
      continue;
    }
    return candidate;
  }
}

function finiteNodeLoaderCandidate(
  declaration: ts.FunctionDeclaration,
): FiniteNodeLoaderCandidate | false {
  const name = declaration.name ?? false;
  const parameterDeclaration = declaration.parameters[0] ?? false;
  const parameter =
    parameterDeclaration !== false && ts.isIdentifier(parameterDeclaration.name)
      ? parameterDeclaration.name
      : false;
  const body = declaration.body ?? false;
  const adapterInspection: ExactEvaluatorAdapterInspection | false =
    parameter === false || body === false ? false : { body, parameter };
  if (
    name === false ||
    parameter === false ||
    body === false ||
    declaration.parameters.length !== 1 ||
    !hasAsyncModifier(declaration) ||
    adapterInspection === false ||
    !isExactEvaluatorAdapter(adapterInspection)
  ) {
    return false;
  }
  return { body, name, parameter };
}

function hasAsyncModifier(declaration: ts.FunctionDeclaration): boolean {
  return Boolean(
    ts
      .getModifiers(declaration)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword),
  );
}

type ExactEvaluatorAdapterInspection = {
  readonly body: ts.Block;
  readonly parameter: ts.Identifier;
};

function isExactEvaluatorAdapter(
  inspection: ExactEvaluatorAdapterInspection,
): boolean {
  const tryStatement = inspection.body.statements[0] ?? false;
  if (
    inspection.body.statements.length !== 1 ||
    tryStatement === false ||
    !ts.isTryStatement(tryStatement) ||
    tryStatement.finallyBlock ||
    !tryStatement.catchClause ||
    tryStatement.tryBlock.statements.length !== 2 ||
    tryStatement.catchClause.block.statements.length !== 1
  ) {
    return false;
  }
  const loaderStatement = tryStatement.tryBlock.statements[0] ?? false;
  const loaderReturn = tryStatement.tryBlock.statements[1] ?? false;
  const fallbackReturn = tryStatement.catchClause.block.statements[0] ?? false;
  const loaderInspection: EvaluatorStatementInspection = {
    parameter: inspection.parameter,
    statement: loaderStatement,
  };
  const loader = evaluatorLoaderBinding(loaderInspection);
  const returnInspection: LoaderReturnInspection | false =
    loader === false
      ? false
      : {
          loader,
          parameter: inspection.parameter,
          statement: loaderReturn,
        };
  const fallbackInspection: EvaluatorStatementInspection = {
    parameter: inspection.parameter,
    statement: fallbackReturn,
  };
  return (
    loader !== false &&
    returnInspection !== false &&
    isLoaderReturn(returnInspection) &&
    isIndirectEvalReturn(fallbackInspection)
  );
}

type EvaluatorStatementInspection = {
  readonly parameter: ts.Identifier;
  readonly statement: ts.Statement | false;
};

function evaluatorLoaderBinding(
  inspection: EvaluatorStatementInspection,
): ts.Identifier | false {
  if (
    inspection.statement === false ||
    !ts.isVariableStatement(inspection.statement) ||
    inspection.statement.declarationList.declarations.length !== 1
  ) {
    return false;
  }
  const declaration =
    inspection.statement.declarationList.declarations[0] ?? false;
  if (declaration === false || !ts.isIdentifier(declaration.name)) return false;
  const initializer = declaration.initializer
    ? unwrapTransparentExpression(declaration.initializer)
    : false;
  if (
    initializer === false ||
    !ts.isNewExpression(initializer) ||
    !ts.isIdentifier(initializer.expression) ||
    initializer.expression.text !== 'Function' ||
    initializer.arguments?.length !== 2
  ) {
    return false;
  }
  const parameterArgument = initializer.arguments[0] ?? false;
  const bodyArgument = initializer.arguments[1] ?? false;
  return parameterArgument !== false &&
    bodyArgument !== false &&
    ts.isStringLiteralLike(parameterArgument) &&
    ts.isStringLiteralLike(bodyArgument) &&
    parameterArgument.text === inspection.parameter.text &&
    bodyArgument.text === `return import(${inspection.parameter.text});`
    ? declaration.name
    : false;
}

type LoaderReturnInspection = EvaluatorStatementInspection & {
  readonly loader: ts.Identifier;
};

function isLoaderReturn(inspection: LoaderReturnInspection): boolean {
  const expression = returnedExpression(inspection.statement);
  if (expression === false || !ts.isAwaitExpression(expression)) return false;
  const call = unwrapTransparentExpression(expression.expression);
  const argument = ts.isCallExpression(call)
    ? (call.arguments[0] ?? false)
    : false;
  return (
    ts.isCallExpression(call) &&
    ts.isIdentifier(call.expression) &&
    call.expression.text === inspection.loader.text &&
    call.arguments.length === 1 &&
    argument !== false &&
    ts.isIdentifier(argument) &&
    argument.text === inspection.parameter.text
  );
}

function isIndirectEvalReturn(
  inspection: EvaluatorStatementInspection,
): boolean {
  const expression = returnedExpression(inspection.statement);
  if (expression === false || !ts.isAwaitExpression(expression)) return false;
  const call = unwrapTransparentExpression(expression.expression);
  if (!ts.isCallExpression(call) || call.arguments.length !== 1) return false;
  const callee = unwrapTransparentExpression(call.expression);
  if (
    !ts.isBinaryExpression(callee) ||
    callee.operatorToken.kind !== ts.SyntaxKind.CommaToken ||
    !ts.isNumericLiteral(callee.left) ||
    callee.left.text !== '0' ||
    !ts.isIdentifier(callee.right) ||
    callee.right.text !== 'eval'
  ) {
    return false;
  }
  const argument = call.arguments[0] ?? false;
  if (
    argument === false ||
    !ts.isTemplateExpression(argument) ||
    argument.head.text !== 'import(' ||
    argument.templateSpans.length !== 1
  ) {
    return false;
  }
  const span = argument.templateSpans[0] ?? false;
  if (span === false || span.literal.text !== ')') return false;
  const stringify = unwrapTransparentExpression(span.expression);
  const stringifyArgument = ts.isCallExpression(stringify)
    ? (stringify.arguments[0] ?? false)
    : false;
  return (
    ts.isCallExpression(stringify) &&
    ts.isPropertyAccessExpression(stringify.expression) &&
    ts.isIdentifier(stringify.expression.expression) &&
    stringify.expression.expression.text === 'JSON' &&
    stringify.expression.name.text === 'stringify' &&
    stringify.arguments.length === 1 &&
    stringifyArgument !== false &&
    ts.isIdentifier(stringifyArgument) &&
    stringifyArgument.text === inspection.parameter.text
  );
}

function returnedExpression(
  statement: ts.Statement | false,
): ts.Expression | false {
  return statement !== false &&
    ts.isReturnStatement(statement) &&
    statement.expression
    ? unwrapTransparentExpression(statement.expression)
    : false;
}

function unwrapTransparentExpression(expression: ts.Expression): ts.Expression {
  let candidate = expression;
  while (
    ts.isAsExpression(candidate) ||
    ts.isTypeAssertionExpression(candidate) ||
    ts.isParenthesizedExpression(candidate)
  ) {
    candidate = candidate.expression;
  }
  return candidate;
}

function finiteNodeLoaderModules(
  validation: FiniteNodeLoaderValidation,
): readonly AllowedNodeModule[] | false {
  const modules = new Set<AllowedNodeModule>();
  let safe = true;
  const visit = (node: ts.Node): void => {
    if (!safe) return;
    if (ts.isIdentifier(node) && node.text === validation.candidate.name.text) {
      if (node === validation.candidate.name) return;
      const parent = node.parent;
      if (!ts.isCallExpression(parent) || parent.expression !== node) {
        safe = false;
        return;
      }
      const argument = parent.arguments[0] ?? false;
      if (
        argument === false ||
        parent.arguments.length !== 1 ||
        !ts.isStringLiteralLike(argument) ||
        !ALLOWED_NODE_MODULES.has(argument.text)
      ) {
        safe = false;
        return;
      }
      modules.add(argument.text as AllowedNodeModule);
    }
    ts.forEachChild(node, visit);
  };
  visit(validation.sourceFile);
  return safe && modules.size > 0 ? [...modules].sort() : false;
}

type FiniteNodeLoaderBody = {
  readonly modules: readonly AllowedNodeModule[];
  readonly parameter: string;
};

function finiteNodeLoaderBody(body: FiniteNodeLoaderBody): string {
  const branches = body.modules.map(
    (specifier) =>
      `  if (${body.parameter} === '${specifier}') return await import('${specifier}');`,
  );
  return `{
${branches.join('\n')}
  throw new Error('Unsupported finite Node module');
}`;
}
