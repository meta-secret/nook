import { readFileSync } from 'node:fs';

import {
  finalizeTeamPlan as finalizeTeamPlanRuntime,
  restartTeamPlan as restartTeamPlanRuntime,
} from '../../src/team-plan/index.ts';

export { finalizeTeamPlanRuntime, restartTeamPlanRuntime };

export function journalRunId(journalPath: string): string {
  const first = readFileSync(journalPath, 'utf8').split('\n')[0];
  if (!first) throw new Error('Team Plan start event is missing.');
  const started = JSON.parse(first) as { readonly runId: string };
  return started.runId;
}

export function finalizeTeamPlan(request: { readonly journalPath: string }) {
  return finalizeTeamPlanRuntime({
    ...request,
    runId: journalRunId(request.journalPath),
  });
}

export function restartTeamPlan(request: {
  readonly journalPath: string;
  readonly planPath: string;
}) {
  return restartTeamPlanRuntime({
    ...request,
    runId: journalRunId(request.journalPath),
  });
}
