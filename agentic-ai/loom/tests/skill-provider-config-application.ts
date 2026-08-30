import { violatesSkillProviderBoundary } from './skill-provider-boundary.test.ts';
import type { SkillProviderSourceInspection } from './skill-provider-type-context.ts';
import type { ApplicationConsumerEdge } from './skill-provider-config-types.ts';

type ConfigurationSourceBoundaryRequest = {
  readonly path: string;
  readonly source: string;
};

export const PROVIDER_ROOT =
  '.cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts';
export const PROVIDER_APPLICATION = `${PROVIDER_ROOT}/src/application.ts`;
export const PROVIDER_DOMAIN = `${PROVIDER_ROOT}/src/domain.ts`;
export const PROVIDER_PACKAGE = `${PROVIDER_ROOT}/package.json`;
export const HOST_ROOT =
  '.cortex/teams/ai/dynamic-skills/executable-skill-host/scripts';
export const HOST_CLI = `${HOST_ROOT}/src/cli.ts`;
export const HOST_REGISTRY = `${HOST_ROOT}/src/skill-action-registry.ts`;
export const HOST_PACKAGE = `${HOST_ROOT}/package.json`;
export const ARTICLE_ACTION = `${PROVIDER_ROOT}/src/action.ts`;
export const LOOM_ARTICLE_ADAPTER =
  'agentic-ai/loom/src/lib/cortex-article-structure.ts';
export const CORTEX_AUDIT = 'agentic-ai/loom/src/commands/cortex-audit.ts';

export function isApplicationDependency(path: string): boolean {
  return (
    path === LOOM_ARTICLE_ADAPTER ||
    path.startsWith(`${PROVIDER_ROOT}/`) ||
    path.startsWith(`${HOST_ROOT}/`)
  );
}

export function isConfigurationProviderPackage(path: string): boolean {
  return path === PROVIDER_PACKAGE || path === HOST_PACKAGE;
}

export function expectedProviderReferences(
  allPaths: readonly string[],
): string[] {
  return [
    PROVIDER_PACKAGE,
    HOST_PACKAGE,
    '.task/agentic-ai.yml',
    ...allPaths.filter((path) => path.startsWith(`${HOST_ROOT}/src/`)),
    LOOM_ARTICLE_ADAPTER,
  ].sort();
}

export function isAuthorizedApplicationEdge(
  edge: ApplicationConsumerEdge,
): boolean {
  if (edge.dependency === LOOM_ARTICLE_ADAPTER)
    return edge.importer === CORTEX_AUDIT;
  if (edge.dependency === HOST_CLI)
    return edge.importer === '.task/agentic-ai.yml';
  if (
    edge.importer === HOST_REGISTRY &&
    (edge.dependency === ARTICLE_ACTION || edge.dependency === PROVIDER_DOMAIN)
  )
    return true;
  if (
    edge.importer.startsWith(`${HOST_ROOT}/src/`) &&
    edge.dependency.startsWith(`${HOST_ROOT}/src/`)
  )
    return edge.dependency !== HOST_REGISTRY || edge.importer === HOST_CLI;
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
  const inspection: SkillProviderSourceInspection = {
    filePath: request.path,
    source: request.source,
  };
  if (
    mightUseRuntimeLoader(request.source) &&
    violatesSkillProviderBoundary(inspection)
  )
    throw new Error(
      `Runnable configuration root violates runtime boundary: ${request.path}`,
    );
}

function mightUseRuntimeLoader(source: string): boolean {
  return /(?:\bimport\s*\(|\b(?:getBuiltinModule|mainModule|require)\b|["'](?:node:)?(?:module|process)["']|(?:globalThis|global|import\.meta|module)\s*(?:\.|\[)\s*["']?require\b)/u.test(
    source,
  );
}
