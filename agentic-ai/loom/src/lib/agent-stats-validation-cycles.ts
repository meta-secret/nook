import { GithubActionEvidenceApi } from './agent-stats-github-api.ts';

import type { UntrustedYamlMap } from './guards.ts';

export class ValidationCycleHistory {
  private constructor(private readonly request: readonly UntrustedYamlMap[]) {}
  static countRetriggers(cycles: readonly UntrustedYamlMap[]): number {
    return new ValidationCycleHistory(cycles).execute();
  }
  private execute(): number {
    const cycles = this.request;
    const attemptsByWorkflow = new Map<string, number>();
    for (const cycle of cycles) {
      const workflowRequest = { record: cycle, key: 'workflow' };
      const workflow = GithubActionEvidenceApi.stringProperty(workflowRequest);
      const [defaulted1 = 0] = [attemptsByWorkflow.get(workflow)];
      attemptsByWorkflow.set(workflow, defaulted1 + 1);
    }
    let retriggers = 0;
    for (const attempts of attemptsByWorkflow.values()) {
      retriggers += Math.max(0, attempts - 1);
    }
    return retriggers;
  }
}
