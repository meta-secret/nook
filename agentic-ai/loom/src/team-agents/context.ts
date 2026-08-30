import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import {
  isValidTaskResourceClaim,
  taskResourcePatternsOverlap,
} from '../agent-workflow/domain.ts';
import type { TaskResourcePatternPair } from '../agent-workflow/domain.ts';
import { resourceClaimMatchesPath } from '../module-delivery/resource-claims.ts';
import type { ResourcePathMatchRequest } from '../module-delivery/resource-claims.ts';
import { teamAuthority } from './catalog.ts';
import type { TeamKey } from './catalog.ts';

export const CORTEX_AUTHORING_SKILL_PATHS = [
  '.cortex/teams/ai/dynamic-skills/cortex-writer.md',
  '.cortex/teams/ai/dynamic-skills/cortex-article-structure/SKILL.md',
  '.cortex/teams/ai/dynamic-skills/cortex-consistency.md',
] as const;

const CORTEX_RESOURCE_CLAIM = '.cortex/**';

export type TeamTaskContextRequest = {
  readonly repositoryRoot: string;
  readonly team: TeamKey;
  readonly readClaims: readonly string[];
  readonly writeClaims: readonly string[];
  readonly selectedSkillPaths: readonly string[];
};

export type TeamTaskContext = {
  readonly team: TeamKey;
  readonly contextPaths: readonly string[];
  readonly skillPaths: readonly string[];
};

type SkillReadAuthorizationRequest = {
  readonly claim: string;
  readonly path: string;
};

export function resolveTeamTaskContext(
  request: TeamTaskContextRequest,
): TeamTaskContext {
  const authority = teamAuthority(request.team);
  if (!authority) throw new Error(`Unknown team authority: ${request.team}`);
  assertValidReadClaims(request.readClaims);
  assertValidWriteClaims(request.writeClaims);
  assertValidSkillPaths(request);

  const automaticSkills = writesCortex(request.writeClaims)
    ? CORTEX_AUTHORING_SKILL_PATHS
    : [];
  if (
    automaticSkills.some(
      (path) => !isRegularFile(join(request.repositoryRoot, path)),
    )
  )
    throw new Error(
      'Canonical Cortex authoring skills must be existing regular files.',
    );
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

function assertValidReadClaims(readClaims: readonly string[]): void {
  if (readClaims.some((claim) => !isValidTaskResourceClaim(claim)))
    throw new Error('Team task read claims must be canonical resource paths.');
}

function assertValidSkillPaths(request: TeamTaskContextRequest): void {
  if (
    request.selectedSkillPaths.some(
      (path) =>
        !isValidTaskResourceClaim(path) ||
        path.includes('*') ||
        !path.startsWith('.cortex/') ||
        !path.includes('/dynamic-skills/') ||
        !path.endsWith('.md') ||
        !isRegularFile(join(request.repositoryRoot, path)) ||
        (!(
          writesCortex(request.writeClaims) &&
          CORTEX_AUTHORING_SKILL_PATHS.includes(
            path as (typeof CORTEX_AUTHORING_SKILL_PATHS)[number],
          )
        ) &&
          !request.readClaims.some((claim) => {
            const authorizationRequest: SkillReadAuthorizationRequest = {
              claim,
              path,
            };
            return claimAuthorizesPath(authorizationRequest);
          })),
    )
  )
    throw new Error(
      'Team task skills must be exact existing task-authorized Cortex Markdown files.',
    );
}

function claimAuthorizesPath(request: SkillReadAuthorizationRequest): boolean {
  const matchRequest: ResourcePathMatchRequest = request;
  return resourceClaimMatchesPath(matchRequest);
}

function isRegularFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}
