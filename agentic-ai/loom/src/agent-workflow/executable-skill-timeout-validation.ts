import {
  LoomLeafKind,
  WorkflowExecutorKind,
  type StaticTaskExecution,
} from './domain.ts';
import {
  WorkflowValidationIssueKind,
  type WorkflowValidationIssue,
} from './validation-result.ts';
import { MECHANICAL_CORTEX_AUDIT_MINIMUM_TIMEOUT_MS } from './executable-skill-budget.ts';

export type ExecutableSkillTaskTimeoutValidationRequest = {
  readonly execution: StaticTaskExecution<string>;
  readonly taskName: string;
  readonly timeoutMs: number;
};

export function executableSkillTaskTimeoutValidationIssue(
  request: ExecutableSkillTaskTimeoutValidationRequest,
): WorkflowValidationIssue | false {
  if (
    request.execution.kind !== WorkflowExecutorKind.LoomLeaf ||
    request.execution.leaf !== LoomLeafKind.CortexAudit ||
    request.timeoutMs >= MECHANICAL_CORTEX_AUDIT_MINIMUM_TIMEOUT_MS
  ) {
    return false;
  }
  return {
    kind: WorkflowValidationIssueKind.InsufficientTimeout,
    message:
      `task ${request.taskName} timeout ${request.timeoutMs}ms cannot cover the ` +
      `executable-skill lifecycle minimum ${MECHANICAL_CORTEX_AUDIT_MINIMUM_TIMEOUT_MS}ms`,
  };
}
