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
  return /(?:\b(?:getBuiltinModule|mainModule)\b|["'](?:node:)?(?:module|process)["']|(?:globalThis|global|import\.meta|module)\s*(?:\.|\[)\s*["']?require\b)/u.test(
    source,
  );
}
