import { JoinCompletionPolicy, TaskTargetKind } from './domain.ts';
import type { StaticAgentWorkflowDefinition } from './domain.ts';
import { WorkflowValidationIssueKind } from './validation-result.ts';
import type { WorkflowValidationIssue } from './validation-result.ts';

export type AllTerminalJoinValidationRequest<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
> = {
  readonly workflow: StaticAgentWorkflowDefinition<TTask, TAgent, TJoin>;
  readonly join: TJoin;
};

export function allTerminalJoinValidationIssues<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
>(
  request: AllTerminalJoinValidationRequest<TTask, TAgent, TJoin>,
): readonly WorkflowValidationIssue[] {
  const join = request.workflow.joins[request.join];
  if (join.policy !== JoinCompletionPolicy.AllTerminal) return [];
  return join.arrivals.flatMap((arrival) => {
    const task = request.workflow.tasks[arrival];
    if (!task) return [];
    const routesCompleted =
      task.completed.kind === TaskTargetKind.Join &&
      task.completed.join === request.join;
    const routesFailed =
      task.failed.kind === TaskTargetKind.Join &&
      task.failed.join === request.join;
    if (routesCompleted && routesFailed) return [];
    const issue: WorkflowValidationIssue = {
      kind: WorkflowValidationIssueKind.InvalidJoin,
      message: `all-terminal join ${request.join} requires both outcomes from arrival task ${arrival}`,
    };
    return [issue];
  });
}
