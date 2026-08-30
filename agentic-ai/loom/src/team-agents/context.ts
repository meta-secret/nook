import {
  isValidTaskResourceClaim,
  taskResourcePatternsOverlap,
} from '../agent-workflow/domain.ts';
import type { TaskResourcePatternPair } from '../agent-workflow/domain.ts';
import { teamAuthority } from './catalog.ts';
import type { TeamKey } from './catalog.ts';

export const CORTEX_AUTHORING_SKILL_PATHS = [
  '.cortex/teams/ai/dynamic-skills/cortex-writer.md',
  '.cortex/teams/ai/dynamic-skills/cortex-article-structure/SKILL.md',
  '.cortex/teams/ai/dynamic-skills/cortex-consistency.md',
] as const;

const CORTEX_RESOURCE_CLAIM = '.cortex/**';

export type TeamTaskContextRequest = {
  readonly team: TeamKey;
  readonly writeClaims: readonly string[];
  readonly selectedSkillPaths: readonly string[];
};

export type TeamTaskContext = {
  readonly team: TeamKey;
  readonly contextPaths: readonly string[];
  readonly skillPaths: readonly string[];
};

export function resolveTeamTaskContext(
  request: TeamTaskContextRequest,
): TeamTaskContext {
  const authority = teamAuthority(request.team);
  if (!authority) throw new Error(`Unknown team authority: ${request.team}`);
  assertValidWriteClaims(request.writeClaims);
  assertValidSkillPaths(request.selectedSkillPaths);

  const automaticSkills = writesCortex(request.writeClaims)
    ? CORTEX_AUTHORING_SKILL_PATHS
    : [];
  const automaticSkillPaths: readonly string[] = automaticSkills;
  const selectedSkills = [...new Set(request.selectedSkillPaths)]
    .filter((path) => !automaticSkillPaths.includes(path))
    .sort();
  const skillPaths = Object.freeze([...automaticSkills, ...selectedSkills]);
  const context: TeamTaskContext = {
    team: request.team,
    contextPaths: Object.freeze([...authority.contextPaths, ...skillPaths]),
    skillPaths,
  };
  return Object.freeze(context);
}

function writesCortex(writeClaims: readonly string[]): boolean {
  return writeClaims.some((claim) => {
    const pair: TaskResourcePatternPair = {
      first: claim,
      second: CORTEX_RESOURCE_CLAIM,
    };
    return taskResourcePatternsOverlap(pair);
  });
}

function assertValidWriteClaims(writeClaims: readonly string[]): void {
  if (writeClaims.some((claim) => !isValidTaskResourceClaim(claim)))
    throw new Error('Team task write claims must be canonical resource paths.');
}

function assertValidSkillPaths(skillPaths: readonly string[]): void {
  if (
    skillPaths.some(
      (path) =>
        !isValidTaskResourceClaim(path) ||
        !path.startsWith('.cortex/') ||
        !path.includes('/dynamic-skills/') ||
        !path.endsWith('.md'),
    )
  )
    throw new Error(
      'Team task skills must be canonical Cortex Markdown paths.',
    );
}
