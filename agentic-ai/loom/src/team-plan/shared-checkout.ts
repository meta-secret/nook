import { ModuleDeliveryTaskKind } from '../module-delivery/index.ts';

import type { ModuleDeliveryPlanV2 } from '../module-delivery/index.ts';

export function assertAtMostOneActiveTeamPlanWriter(request: {
  readonly plan: ModuleDeliveryPlanV2;
  readonly activeTaskIds: readonly string[];
}): void {
  let activeWriters = 0;
  for (const taskId of request.activeTaskIds) {
    const node = request.plan.nodes.find(
      (candidate) => candidate.taskId === taskId,
    );
    if (node?.kind !== ModuleDeliveryTaskKind.Write) continue;
    activeWriters += 1;
    if (activeWriters > 1)
      throw new Error(
        'Team Plan cannot hold more than one active writer lease.',
      );
  }
}

export function hasActiveTeamPlanWriter(request: {
  readonly plan: ModuleDeliveryPlanV2;
  readonly activeTaskIds: readonly string[];
}): boolean {
  return request.activeTaskIds.some((taskId) =>
    request.plan.nodes.some(
      (node) =>
        node.taskId === taskId && node.kind === ModuleDeliveryTaskKind.Write,
    ),
  );
}
