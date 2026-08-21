import { TaskTargetKind, WorkflowExecutorKind } from './domain.ts';
import type { StaticAgentWorkflowDefinition } from './domain.ts';
import { WorkflowValidationIssueKind } from './validation-result.ts';
import type { WorkflowValidationIssue } from './validation-result.ts';

export type MaterializerValidationRequest<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
> = {
  readonly workflow: StaticAgentWorkflowDefinition<TTask, TAgent, TJoin>;
  readonly declaredTaskNames: ReadonlySet<TTask>;
  readonly registryTaskNames: ReadonlySet<string>;
};

export type MaterializerTopologyValidationRequest<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
> = {
  readonly workflow: StaticAgentWorkflowDefinition<TTask, TAgent, TJoin>;
  readonly adjacency: ReadonlyMap<string, ReadonlySet<string>>;
  readonly taskNode: (task: string) => string;
};

export type MaterializerWorkflowValidationRequest<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
> = MaterializerValidationRequest<TTask, TAgent, TJoin> &
  MaterializerTopologyValidationRequest<TTask, TAgent, TJoin>;

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
  const hasAgentEvidence = request.workflow.taskNames.some((taskName) => {
    const task = request.workflow.tasks[taskName];
    if (!task) return false;
    return (
      taskName !== materializerName &&
      task.execution.kind === WorkflowExecutorKind.Agent
    );
  });
  if (
    hasAgentEvidence &&
    materializer.execution.kind !== WorkflowExecutorKind.Agent
  ) {
    return [
      'workflows with agent evidence require an agent materialized view task',
    ];
  }
  return [];
}

export function materializerTopologyValidationMessages<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
>(
  request: MaterializerTopologyValidationRequest<TTask, TAgent, TJoin>,
): readonly string[] {
  const workflow = request.workflow;
  const materializerNode = request.taskNode(workflow.materializedViewTask);
  const entryNode = request.taskNode(workflow.entry);
  const entryReachability: ReachableNodesRequest = {
    start: entryNode,
    adjacency: request.adjacency,
  };
  const reachableFromEntry = reachableNodes(entryReachability);
  const terminalNodes = [...reachableFromEntry].filter(
    (node) => (request.adjacency.get(node)?.size ?? 0) === 0,
  );
  const messages: string[] = [];
  if (terminalNodes.some((node) => node !== materializerNode)) {
    messages.push(
      'materialized view task must be reached on every terminal workflow route',
    );
  }
  const successfulTaskExit = workflow.taskNames.find(
    (taskName) =>
      taskName !== workflow.materializedViewTask &&
      reachableFromEntry.has(request.taskNode(taskName)) &&
      workflow.tasks[taskName].completed.kind === TaskTargetKind.None,
  );
  if (successfulTaskExit) {
    messages.push(
      `task ${successfulTaskExit} has a successful terminal route that bypasses the materialized view task`,
    );
  }

  for (const taskName of workflow.taskNames) {
    if (taskName === workflow.materializedViewTask) continue;
    const task = workflow.tasks[taskName];
    if (task.execution.kind !== WorkflowExecutorKind.Agent) continue;
    const downstreamRequest: ReachableNodesRequest = {
      start: request.taskNode(taskName),
      adjacency: request.adjacency,
    };
    const downstream = reachableNodes(downstreamRequest);
    const unsupportedIntermediate = workflow.taskNames.find(
      (candidate) =>
        candidate !== taskName &&
        candidate !== workflow.materializedViewTask &&
        downstream.has(request.taskNode(candidate)),
    );
    if (unsupportedIntermediate) {
      messages.push(
        `agent task ${taskName} reaches intermediate task ${unsupportedIntermediate}; intermediate executors cannot preserve agent evidence`,
      );
    }
  }
  return messages;
}

export function materializerWorkflowValidationIssues<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
>(
  request: MaterializerWorkflowValidationRequest<TTask, TAgent, TJoin>,
): readonly WorkflowValidationIssue[] {
  const messages = [...materializerValidationMessages(request)];
  const workflow = request.workflow;
  const hasEntry =
    request.declaredTaskNames.has(workflow.entry) &&
    request.registryTaskNames.has(workflow.entry);
  const hasMaterializer =
    request.declaredTaskNames.has(workflow.materializedViewTask) &&
    request.registryTaskNames.has(workflow.materializedViewTask);
  if (hasEntry && hasMaterializer) {
    messages.push(...materializerTopologyValidationMessages(request));
  }
  return messages.map((message) => ({
    kind: WorkflowValidationIssueKind.InvalidMaterializedViewTask,
    message,
  }));
}

type ReachableNodesRequest = {
  readonly start: string;
  readonly adjacency: ReadonlyMap<string, ReadonlySet<string>>;
};

function reachableNodes(request: ReachableNodesRequest): ReadonlySet<string> {
  const reachable = new Set<string>();
  const pending = [request.start];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node || reachable.has(node)) continue;
    reachable.add(node);
    for (const successor of request.adjacency.get(node) ?? []) {
      pending.push(successor);
    }
  }
  return reachable;
}
