import type { ApplicationConsumerEdge } from './skill-provider-config-types.ts';
import ts from 'typescript';

type ConfigurationSourceBoundaryRequest = {
  readonly path: string;
  readonly roots: ReadonlySet<string>;
  readonly source: string;
  readonly sources: ReadonlyMap<string, string>;
};

export const PROVIDER_ROOT =
  '.cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts';
export const PROVIDER_APPLICATION = `${PROVIDER_ROOT}/src/application.ts`;
export const PROVIDER_DOMAIN = `${PROVIDER_ROOT}/src/domain.ts`;
export const PROVIDER_PACKAGE = `${PROVIDER_ROOT}/package.json`;
export const LOOM_ARTICLE_ADAPTER =
  'agentic-ai/loom/src/lib/cortex-article-structure.ts';
export const CORTEX_AUDIT = 'agentic-ai/loom/src/commands/cortex-audit.ts';

export function isApplicationDependency(path: string): boolean {
  return path === LOOM_ARTICLE_ADAPTER || path.startsWith(`${PROVIDER_ROOT}/`);
}

export function isAuthorizedApplicationEdge(
  edge: ApplicationConsumerEdge,
): boolean {
  if (edge.dependency === LOOM_ARTICLE_ADAPTER)
    return edge.importer === CORTEX_AUDIT;
  return (
    edge.importer === LOOM_ARTICLE_ADAPTER &&
    (edge.dependency === PROVIDER_APPLICATION ||
      edge.dependency === PROVIDER_DOMAIN)
  );
}

export function assertConfigurationSourceBoundary(
  request: ConfigurationSourceBoundaryRequest,
): void {
  if (
    request.path === LOOM_ARTICLE_ADAPTER ||
    !/\.(?:[cm]?tsx?|[cm]?jsx?)$/u.test(request.path)
  )
    return;
  if (usesRuntimeLoaderModule(request.source))
    throw new Error(
      `Runnable configuration root violates runtime boundary: ${request.path}`,
    );
}

function usesRuntimeLoaderModule(source: string): boolean {
  const file = ts.createSourceFile(
    'configuration.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let violation = false;
  const loaderModule = (node: ts.Expression): boolean =>
    ts.isStringLiteralLike(node) &&
    /^(?:node:)?(?:module|process)$/u.test(node.text);
  const visit = (node: ts.Node): void => {
    if (violation) return;
    if (
      ts.isImportDeclaration(node) &&
      loaderModule(node.moduleSpecifier) &&
      !node.importClause?.isTypeOnly
    ) {
      const bindings = node.importClause?.namedBindings;
      violation =
        !bindings ||
        !ts.isNamedImports(bindings) ||
        bindings.elements.some((element) => !element.isTypeOnly);
      if (violation) return;
    }
    if (
      ts.isCallExpression(node) &&
      node.arguments[0] &&
      loaderModule(node.arguments[0]) &&
      ((ts.isIdentifier(node.expression) &&
        (node.expression.text === 'require' ||
          node.expression.text === 'getBuiltinModule')) ||
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'getBuiltinModule'))
    ) {
      violation = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return violation;
}
