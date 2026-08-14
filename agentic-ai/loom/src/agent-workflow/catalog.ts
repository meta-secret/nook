import { CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW } from './cortex-workflow.ts';
import { StaticAgentWorkflowName } from './domain.ts';

export const STATIC_AGENT_WORKFLOW_CATALOG = {
  [StaticAgentWorkflowName.CortexFullGarbageCollection]:
    CORTEX_FULL_GARBAGE_COLLECTION_WORKFLOW,
} as const;

export function isStaticAgentWorkflowName(
  value: string,
): value is StaticAgentWorkflowName {
  return Object.values(StaticAgentWorkflowName).some((name) => name === value);
}
