import { stringProperty } from './agent-stats-github-api.ts';

import type { UntrustedYamlMap } from './guards.ts';

export function validationRetriggerCount(
  cycles: readonly UntrustedYamlMap[],
): number {
  const attemptsByWorkflow = new Map<string, number>();
  for (const cycle of cycles) {
    const workflowRequest = { record: cycle, key: 'workflow' };
    const workflow = stringProperty(workflowRequest);
    attemptsByWorkflow.set(
      workflow,
      (attemptsByWorkflow.get(workflow) ?? 0) + 1,
    );
  }
  let retriggers = 0;
  for (const attempts of attemptsByWorkflow.values()) {
    retriggers += Math.max(0, attempts - 1);
  }
  return retriggers;
}
