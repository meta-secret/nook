import { TeamTaskContextResolver } from '../team-agents/context.ts';

import type { TeamKey } from '../team-agents/catalog.ts';

import type { TeamTaskContextPathRequest } from '../team-agents/context.ts';

import { ModuleWriteClaim } from './resource-claims.ts';

import type {
  ModuleDeliveryCortexAuthoring,
  ModuleDeliveryNodeV2,
} from './domain.ts';

import type { ResourcePathMatchRequest } from './resource-claims.ts';

export class CortexAuthoringResources {
  private constructor(
    private readonly request: CortexAuthoringResourceCompositionRequest,
  ) {}
  static compose(
    request: CortexAuthoringResourceCompositionRequest,
  ): ModuleDeliveryNodeV2['resources'] {
    return new CortexAuthoringResources(request).execute();
  }
  private execute(): ModuleDeliveryNodeV2['resources'] {
    const request = this.request;
    const contextPathRequest: TeamTaskContextPathRequest = {
      team: request.team,
      writeClaims: request.resources.write,
      selectedSkillPaths: request.cortexAuthoring.selectedSkillPaths,
    };
    const context =
      TeamTaskContextResolver.composeTeamTaskContextPaths(contextPathRequest);
    return {
      ...request.resources,
      read: [...new Set([...context.contextPaths, ...request.resources.read])],
    };
  }
}

export class CortexSkillAuthorization {
  private constructor(
    private readonly request: CortexAuthoringResourceCompositionRequest,
  ) {}
  static rejectUnauthorized(
    request: CortexAuthoringResourceCompositionRequest,
  ): string | false {
    return new CortexSkillAuthorization(request).execute();
  }
  private execute(): string | false {
    const request = this.request;
    const [defaulted1 = false] = [
      request.cortexAuthoring.selectedSkillPaths.find(
        (path) =>
          !TeamTaskContextResolver.isCortexAuthoringSkillPath(path) &&
          !request.resources.read.some((claim) => {
            const matchRequest: ResourcePathMatchRequest = { claim, path };
            return ModuleWriteClaim.resourceClaimMatchesPath(matchRequest);
          }),
      ),
    ];
    return defaulted1;
  }
}

export type CortexAuthoringResourceCompositionRequest = {
  readonly team: TeamKey;
  readonly resources: ModuleDeliveryNodeV2['resources'];
  readonly cortexAuthoring: ModuleDeliveryCortexAuthoring;
  readonly path: string;
};
