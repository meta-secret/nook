export type SkillConsumerEdge = {
  readonly dependency: string;
  readonly importer: string;
};

export const SKILL_PROVIDER_ROOT =
  '.cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/src';
export const SKILL_HOST_ROOT =
  '.cortex/teams/ai/dynamic-skills/executable-skill-host/scripts/src';
export const EXECUTABLE_SKILL_ROOTS = Object.freeze([
  SKILL_PROVIDER_ROOT.slice(0, -4),
  SKILL_HOST_ROOT.slice(0, -4),
]);
export const SKILL_PROVIDER_APPLICATION = `${SKILL_PROVIDER_ROOT}/application.ts`;
export const SKILL_PROVIDER_ACTION = `${SKILL_PROVIDER_ROOT}/action.ts`;
export const SKILL_PROVIDER_CODEC = `${SKILL_PROVIDER_ROOT}/codec.ts`;
export const SKILL_PROVIDER_DOMAIN = `${SKILL_PROVIDER_ROOT}/domain.ts`;
export const SKILL_HOST_CLI = `${SKILL_HOST_ROOT}/cli.ts`;
export const SKILL_HOST_REGISTRY = `${SKILL_HOST_ROOT}/skill-action-registry.ts`;
export const SKILL_HOST_TASK = '.task/agentic-ai.yml';
export const CORTEX_AUDIT = 'agentic-ai/loom/src/commands/cortex-audit.ts';
export const LOOM_ARTICLE_ADAPTER =
  'agentic-ai/loom/src/lib/cortex-article-structure.ts';
const EXACT_CONSUMER_EDGES: readonly string[] = [
  `${SKILL_HOST_TASK}->${SKILL_HOST_CLI}`,
  `${SKILL_HOST_CLI}->${SKILL_HOST_REGISTRY}`,
  `${SKILL_HOST_REGISTRY}->${SKILL_PROVIDER_ACTION}`,
  `${CORTEX_AUDIT}->${LOOM_ARTICLE_ADAPTER}`,
  `${LOOM_ARTICLE_ADAPTER}->${SKILL_PROVIDER_APPLICATION}`,
  `${LOOM_ARTICLE_ADAPTER}->${SKILL_PROVIDER_DOMAIN}`,
  `${SKILL_HOST_REGISTRY}->${SKILL_PROVIDER_APPLICATION}`,
  `${SKILL_HOST_REGISTRY}->${SKILL_PROVIDER_CODEC}`,
  `${SKILL_HOST_REGISTRY}->${SKILL_PROVIDER_DOMAIN}`,
];

export function isSkillConsumerDependency(path: string): boolean {
  return (
    path.startsWith(`${SKILL_HOST_ROOT}/`) ||
    path === LOOM_ARTICLE_ADAPTER ||
    path.startsWith(`${SKILL_PROVIDER_ROOT}/`)
  );
}

export function isAuthorizedSkillConsumerEdge(
  edge: SkillConsumerEdge,
): boolean {
  return (
    EXACT_CONSUMER_EDGES.includes(`${edge.importer}->${edge.dependency}`) ||
    (edge.importer.startsWith(`${SKILL_HOST_ROOT}/`) &&
      edge.dependency.startsWith(`${SKILL_HOST_ROOT}/`)) ||
    (edge.importer.startsWith(`${SKILL_PROVIDER_ROOT}/`) &&
      edge.dependency.startsWith(`${SKILL_PROVIDER_ROOT}/`))
  );
}
