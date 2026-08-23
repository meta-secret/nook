import { WorkflowExecutorKind, type StaticTaskDefinition } from './domain.ts';
import {
  WorkflowValidationIssueKind,
  type WorkflowValidationIssue,
} from './validation-result.ts';
import {
  executableSkillTaskTimeoutValidationIssue,
  type ExecutableSkillTaskTimeoutValidationRequest,
} from './executable-skill-timeout-validation.ts';

export type TaskDefinitionValidationRequest<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
> = {
  readonly agentNames: readonly TAgent[];
  readonly registeredAgentNames: ReadonlySet<string>;
  readonly task: StaticTaskDefinition<TTask, TAgent, TJoin>;
  readonly taskName: TTask;
};

export function taskDefinitionValidationIssues<
  TTask extends string,
  TAgent extends string,
  TJoin extends string,
>(
  request: TaskDefinitionValidationRequest<TTask, TAgent, TJoin>,
): readonly WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = [];
  if (request.task.name !== request.taskName) {
    const registryIssue: WorkflowValidationIssue = {
      kind: WorkflowValidationIssueKind.RegistryMismatch,
      message: `task registry key ${request.taskName} contains definition ${request.task.name}`,
    };
    issues.push(registryIssue);
  }
  if (
    request.task.execution.kind === WorkflowExecutorKind.Agent &&
    (!request.agentNames.includes(request.task.execution.agent) ||
      !request.registeredAgentNames.has(request.task.execution.agent))
  ) {
    const referenceIssue: WorkflowValidationIssue = {
      kind: WorkflowValidationIssueKind.InvalidReference,
      message: `task ${request.taskName} references missing agent ${request.task.execution.agent}`,
    };
    issues.push(referenceIssue);
  }
  const timeoutRequest: ExecutableSkillTaskTimeoutValidationRequest = {
    execution: request.task.execution,
    taskName: request.taskName,
    timeoutMs: request.task.timeoutMs,
  };
  const timeoutIssue =
    executableSkillTaskTimeoutValidationIssue(timeoutRequest);
  if (timeoutIssue !== false) issues.push(timeoutIssue);
  return issues;
}
