import { readFileSync } from 'node:fs';

import {
  finalizeTeamPlan as finalizeTeamPlanRuntime,
  restartTeamPlan as restartTeamPlanRuntime,
} from '../../src/team-plan/index.ts';

export { finalizeTeamPlanRuntime, restartTeamPlanRuntime };

export type FinalizeTeamPlanTestRequest = Readonly<{
  journalPath: string;
}>;

export type RestartTeamPlanTestRequest = Readonly<{
  journalPath: string;
  planPath: string;
}>;

export function journalRunId(journalPath: string): string {
  const first = readFileSync(journalPath, 'utf8').split('\n')[0];
  if (!first) throw new Error('Team Plan start event is missing.');
  const started = JSON.parse(first) as { readonly runId: string };
  return started.runId;
}

export function finalizeTeamPlan(request: FinalizeTeamPlanTestRequest) {
  return finalizeTeamPlanRuntime({
    ...request,
    runId: journalRunId(request.journalPath),
  });
}

export function restartTeamPlan(request: RestartTeamPlanTestRequest) {
  return restartTeamPlanRuntime({
    ...request,
    runId: journalRunId(request.journalPath),
  });
}
