import { CORTEX_AUTHORING_SKILL_PATHS } from '../team-agents/context.ts';
import { composeTeamTaskContextPaths } from '../team-agents/context.ts';
import type { TeamKey } from '../team-agents/catalog.ts';
import type { TeamTaskContextPathRequest } from '../team-agents/context.ts';
import { resourceClaimMatchesPath } from './resource-claims.ts';
import type {
  ModuleDeliveryCortexAuthoring,
  ModuleDeliveryNodeV2,
} from './domain.ts';
import type { ResourcePathMatchRequest } from './resource-claims.ts';

export type CortexAuthoringResourceCompositionRequest = {
  readonly team: TeamKey;
  readonly resources: ModuleDeliveryNodeV2['resources'];
  readonly cortexAuthoring: ModuleDeliveryCortexAuthoring;
  readonly path: string;
};

export function composeCortexAuthoringResources(
  request: CortexAuthoringResourceCompositionRequest,
): ModuleDeliveryNodeV2['resources'] {
  const contextPathRequest: TeamTaskContextPathRequest = {
    team: request.team,
    writeClaims: request.resources.write,
    selectedSkillPaths: request.cortexAuthoring.selectedSkillPaths,
  };
  const context = composeTeamTaskContextPaths(contextPathRequest);
  return {
    ...request.resources,
    read: [...new Set([...context.contextPaths, ...request.resources.read])],
  };
}

export function unauthorizedSelectedSkill(
  request: CortexAuthoringResourceCompositionRequest,
): string | false {
  const [defaulted1 = false] = [
    request.cortexAuthoring.selectedSkillPaths.find(
      (path) =>
        !CORTEX_AUTHORING_SKILL_PATHS.includes(
          path as (typeof CORTEX_AUTHORING_SKILL_PATHS)[number],
        ) &&
        !request.resources.read.some((claim) => {
          const matchRequest: ResourcePathMatchRequest = { claim, path };
          return resourceClaimMatchesPath(matchRequest);
        }),
    ),
  ];
  return defaulted1;
}
