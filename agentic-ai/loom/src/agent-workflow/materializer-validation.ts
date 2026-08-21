import { TaskTargetKind } from './domain.ts';
import type { StaticAgentWorkflowDefinition } from './domain.ts';

export type MaterializerValidationRequest<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
> = {
  readonly workflow: StaticAgentWorkflowDefinition<TTask, TAgent, TJoin>;
  readonly declaredTaskNames: ReadonlySet<TTask>;
  readonly registryTaskNames: ReadonlySet<string>;
};

export function materializerValidationMessages<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
>(
  request: MaterializerValidationRequest<TTask, TAgent, TJoin>,
): readonly string[] {
  const materializerName = request.workflow.materializedViewTask;
  if (
    !request.declaredTaskNames.has(materializerName) ||
    !request.registryTaskNames.has(materializerName)
  ) {
    return [`materialized view task does not exist: ${materializerName}`];
  }
  const materializer = request.workflow.tasks[materializerName];
  if (
    materializer.completed.kind !== TaskTargetKind.None ||
    materializer.failed.kind !== TaskTargetKind.None
  ) {
    return ['materialized view task must be terminal'];
  }
  return [];
}
