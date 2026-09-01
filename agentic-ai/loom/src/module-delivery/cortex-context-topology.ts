import { composeTeamTaskContextPaths } from '../team-agents/context.ts';
import type { TeamTaskContextPathRequest } from '../team-agents/context.ts';
import { ModuleDeliveryTaskKind } from './domain.ts';
import { resourceClaimListsOverlap } from './resource-claim-containment.ts';
import type { ResourceClaimListPair } from './resource-claim-containment.ts';
import type { ModuleDeliveryPlanV3 } from './domain.ts';

export type CortexContextPrecedence = {
  readonly writerTaskId: string;
  readonly consumerTaskId: string;
};

export function cortexContextPrecedence(
  plan: ModuleDeliveryPlanV3,
): readonly CortexContextPrecedence[] {
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
    const context = composeTeamTaskContextPaths(contextRequest);
    for (const writer of writers) {
      if (writer.taskId === consumer.taskId) continue;
      const overlap: ResourceClaimListPair = {
        first: writer.resources.write,
        second: context.contextPaths,
      };
      if (!resourceClaimListsOverlap(overlap)) continue;
      const value: CortexContextPrecedence = {
        writerTaskId: writer.taskId,
        consumerTaskId: consumer.taskId,
      };
      precedence.push(value);
    }
  }
  return precedence;
}
