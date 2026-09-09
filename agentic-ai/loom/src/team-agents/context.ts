import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { TaskResourceClaim } from '../agent-workflow/domain.ts';
import type { TaskResourcePatternPair } from '../agent-workflow/domain.ts';
import { ModuleWriteClaim } from '../module-delivery/resource-claims.ts';
import type { ResourcePathMatchRequest } from '../module-delivery/resource-claims.ts';
import { TeamAuthorityCatalog } from './catalog.ts';
import type { TeamAgentKey } from './catalog.ts';

export const CORTEX_AUTHORING_SKILL_PATHS = [
  '.cortex/teams/ai/dynamic-skills/cortex-writer.md',
  '.cortex/teams/ai/dynamic-skills/cortex-article-structure/SKILL.md',
  '.cortex/teams/ai/dynamic-skills/cortex-consistency/SKILL.md',
] as const;

/** Owns the team task context resolver registry and its capability transitions. */
export class TeamTaskContextResolver {
  private constructor() {}
  private static readonly CORTEX_RESOURCE_CLAIM = '.cortex/**';

  static resolveTeamTaskContext(
    request: TeamTaskContextRequest,
  ): TeamTaskContext {
    TeamTaskContextResolver.assertValidReadClaims(request.readClaims);
    TeamTaskContextResolver.assertValidWriteClaims(request.writeClaims);
    TeamTaskContextResolver.assertValidSkillPaths(request);

    const automaticSkills = TeamTaskContextResolver.writesCortex(
      request.writeClaims,
    )
      ? CORTEX_AUTHORING_SKILL_PATHS
      : [];
    if (
      automaticSkills.some(
        (path) =>
          !TeamTaskContextResolver.isRegularFile(
            join(request.repositoryRoot, path),
          ),
      )
    )
      throw new Error(
        'Canonical Cortex authoring skills must be existing regular files.',
      );
    const pathRequest: TeamTaskContextPathRequest = request;
    return TeamTaskContextResolver.composeTeamTaskContextPaths(pathRequest);
  }

  static composeTeamTaskContextPaths(
    request: TeamTaskContextPathRequest,
  ): TeamTaskContext {
    const authority = TeamAuthorityCatalog.teamAgentProfile(request.team);
    if (!authority) throw new Error(`Unknown team authority: ${request.team}`);
    const automaticSkills = TeamTaskContextResolver.writesCortex(
      request.writeClaims,
    )
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

  private static writesCortex(writeClaims: readonly string[]): boolean {
    return writeClaims.some((claim) => {
      const pair: TaskResourcePatternPair = {
        first: claim,
        second: TeamTaskContextResolver.CORTEX_RESOURCE_CLAIM,
      };
      return TaskResourceClaim.taskResourcePatternsOverlap(pair);
    });
  }

  private static assertValidWriteClaims(writeClaims: readonly string[]): void {
    if (
      writeClaims.some(
        (claim) => !TaskResourceClaim.isValidTaskResourceClaim(claim),
      )
    )
      throw new Error(
        'Team task write claims must be canonical resource paths.',
      );
  }

  private static assertValidReadClaims(readClaims: readonly string[]): void {
    if (
      readClaims.some(
        (claim) => !TaskResourceClaim.isValidTaskResourceClaim(claim),
      )
    )
      throw new Error(
        'Team task read claims must be canonical resource paths.',
      );
  }

  private static assertValidSkillPaths(request: TeamTaskContextRequest): void {
    if (
      request.selectedSkillPaths.some(
        (path) =>
          !TaskResourceClaim.isValidTaskResourceClaim(path) ||
          path.includes('*') ||
          !path.startsWith('.cortex/') ||
          !path.includes('/dynamic-skills/') ||
          !path.endsWith('.md') ||
          !TeamTaskContextResolver.isRegularFile(
            join(request.repositoryRoot, path),
          ) ||
          (!(
            TeamTaskContextResolver.writesCortex(request.writeClaims) &&
            CORTEX_AUTHORING_SKILL_PATHS.includes(
              path as (typeof CORTEX_AUTHORING_SKILL_PATHS)[number],
            )
          ) &&
            !request.readClaims.some((claim) => {
              const authorizationRequest: SkillReadAuthorizationRequest = {
                claim,
                path,
              };
              return TeamTaskContextResolver.claimAuthorizesPath(
                authorizationRequest,
              );
            })),
      )
    )
      throw new Error(
        'Team task skills must be exact existing task-authorized Cortex Markdown files.',
      );
  }

  private static claimAuthorizesPath(
    request: SkillReadAuthorizationRequest,
  ): boolean {
    const matchRequest: ResourcePathMatchRequest = request;
    return ModuleWriteClaim.resourceClaimMatchesPath(matchRequest);
  }

  private static isRegularFile(path: string): boolean {
    try {
      return lstatSync(path).isFile();
    } catch {
      return false;
    }
  }
}

export type TeamTaskContextRequest = {
  readonly repositoryRoot: string;
  readonly team: TeamAgentKey;
  readonly readClaims: readonly string[];
  readonly writeClaims: readonly string[];
  readonly selectedSkillPaths: readonly string[];
};

export type TeamTaskContext = {
  readonly team: TeamAgentKey;
  readonly contextPaths: readonly string[];
  readonly skillPaths: readonly string[];
};

export type TeamTaskContextPathRequest = Pick<
  TeamTaskContextRequest,
  'team' | 'writeClaims' | 'selectedSkillPaths'
>;

type SkillReadAuthorizationRequest = {
  readonly claim: string;
  readonly path: string;
};
