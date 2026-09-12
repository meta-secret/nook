import { TeamTaskContextResolver } from '../team-agents/context.ts';

import type { TeamTaskContextPathRequest } from '../team-agents/context.ts';

import { ModuleDeliveryTaskKind } from './domain.ts';

import { ModuleResourceContainment } from './resource-claim-containment.ts';

import type { ResourceClaimListPair } from './resource-claim-containment.ts';

import type { ModuleDeliveryPlanV2 } from './domain.ts';

export class CortexContextTopology {
  private constructor(private readonly request: ModuleDeliveryPlanV2) {}
  static precedence(
    plan: ModuleDeliveryPlanV2,
  ): readonly CortexContextPrecedence[] {
    return new CortexContextTopology(plan).execute();
  }
  private execute(): readonly CortexContextPrecedence[] {
    const plan = this.request;
    const precedence: CortexContextPrecedence[] = [];
    const writers = plan.nodes.filter(
      (node) => node.kind === ModuleDeliveryTaskKind.Write,
    );
    for (const consumer of writers) {
      if (!consumer.cortexAuthoring) continue;
      const contextRequest: TeamTaskContextPathRequest = {
        team: consumer.team,
        writeClaims: consumer.resources.write,
        selectedSkillPaths: consumer.cortexAuthoring.selectedSkillPaths,
      };
      const context =
        TeamTaskContextResolver.composeTeamTaskContextPaths(contextRequest);
      for (const writer of writers) {
        if (writer.taskId === consumer.taskId) continue;
        const overlap: ResourceClaimListPair = {
          first: writer.resources.write,
          second: context.contextPaths,
        };
        if (!ModuleResourceContainment.resourceClaimListsOverlap(overlap))
          continue;
        const value: CortexContextPrecedence = {
          writerTaskId: writer.taskId,
          consumerTaskId: consumer.taskId,
        };
        precedence.push(value);
      }
    }
    return precedence;
  }
}

export type CortexContextPrecedence = {
  readonly writerTaskId: string;
  readonly consumerTaskId: string;
};
