import {
  isValidTaskResourceClaim,
  taskResourcePatternsOverlap,
} from '../agent-workflow/domain.ts';
import type { TaskResourcePatternPair } from '../agent-workflow/domain.ts';
import { runCommand } from '../lib/run.ts';
import type { RunCommandArgs } from '../lib/run.ts';
import { TeamKey } from './catalog.ts';
import { resolveTeamTaskContext } from './context.ts';
import type { TeamTaskContext, TeamTaskContextRequest } from './context.ts';

export const CORTEX_TEAM_TASK_ADMISSION_VERSION = 1;

export type CortexTeamTaskAdmissionRequest = {
  readonly version: typeof CORTEX_TEAM_TASK_ADMISSION_VERSION;
  readonly taskId: string;
  readonly attempt: number;
  readonly sourceCommit: string;
  readonly team: TeamKey;
  readonly functionalOwner: TeamKey;
  readonly expectedResult: string;
  readonly readClaims: readonly string[];
  readonly writeClaims: readonly string[];
  readonly forbiddenClaims: readonly string[];
  readonly selectedSkillPaths: readonly string[];
  readonly acceptanceEvidence: readonly string[];
};

export type AdmitCortexTeamTaskRequest = {
  readonly repositoryRoot: string;
  readonly task: CortexTeamTaskAdmissionRequest;
};

type AssertCommittedContextRequest = AdmitCortexTeamTaskRequest & {
  readonly context: TeamTaskContext;
};

export type CortexTeamTaskAdmission = Readonly<{
  kind: 'cortex-team-task-admission-v1';
  taskId: string;
  attempt: number;
  sourceCommit: string;
  team: TeamKey;
  functionalOwner: TeamKey;
  expectedResult: string;
  readClaims: readonly string[];
  writeClaims: readonly string[];
  forbiddenClaims: readonly string[];
  acceptanceEvidence: readonly string[];
  context: TeamTaskContext;
}>;

const COMMIT = /^[0-9a-f]{40}$/u;
const TASK_ID = /^[a-z][a-z0-9-]{0,63}$/u;

const TEAM_CORTEX_ROOTS: ReadonlyMap<TeamKey, string> = new Map([
  [TeamKey.Ai, '.cortex/teams/ai'],
  [TeamKey.DevelopmentCore, '.cortex/teams/dev-core'],
  [TeamKey.Security, '.cortex/teams/security'],
  [TeamKey.Sre, '.cortex/teams/sre'],
  [TeamKey.WebDevelopment, '.cortex/teams/web-dev'],
]);

export function admitCortexTeamTask(
  request: AdmitCortexTeamTaskRequest,
): CortexTeamTaskAdmission {
  assertTaskIdentity(request.task);
  assertCurrentSourceCommit(request);
  assertCortexWriteAuthority(request.task);
  const contextRequest: TeamTaskContextRequest = {
    repositoryRoot: request.repositoryRoot,
    team: request.task.team,
    readClaims: request.task.readClaims,
    writeClaims: request.task.writeClaims,
    selectedSkillPaths: request.task.selectedSkillPaths,
  };
  const context = resolveTeamTaskContext(contextRequest);
  const committedContextRequest: AssertCommittedContextRequest = {
    ...request,
    context,
  };
  assertContextCommitted(committedContextRequest);
  const admission: CortexTeamTaskAdmission = {
    kind: 'cortex-team-task-admission-v1',
    taskId: request.task.taskId,
    attempt: request.task.attempt,
    sourceCommit: request.task.sourceCommit,
    team: request.task.team,
    functionalOwner: request.task.functionalOwner,
    expectedResult: request.task.expectedResult,
    readClaims: Object.freeze([...request.task.readClaims]),
    writeClaims: Object.freeze([...request.task.writeClaims]),
    forbiddenClaims: Object.freeze([...request.task.forbiddenClaims]),
    acceptanceEvidence: Object.freeze([...request.task.acceptanceEvidence]),
    context,
  };
  return Object.freeze(admission);
}

function assertTaskIdentity(task: CortexTeamTaskAdmissionRequest): void {
  if (
    task.version !== CORTEX_TEAM_TASK_ADMISSION_VERSION ||
    !TASK_ID.test(task.taskId) ||
    !Number.isSafeInteger(task.attempt) ||
    task.attempt < 1 ||
    !COMMIT.test(task.sourceCommit)
  )
    throw new Error('Cortex Team Task identity is invalid.');
  if (task.functionalOwner !== task.team)
    throw new Error('Cortex Team Task must be accepted by its owning team.');
  if (task.expectedResult.trim() === '' || task.expectedResult.length > 4096)
    throw new Error('Cortex Team Task expected result is invalid.');
  if (
    task.acceptanceEvidence.length === 0 ||
    task.acceptanceEvidence.some(
      (entry) => entry.trim() === '' || entry.length > 4096,
    )
  )
    throw new Error('Cortex Team Task acceptance evidence is invalid.');
}

function assertCurrentSourceCommit(request: AdmitCortexTeamTaskRequest): void {
  const command: RunCommandArgs = {
    command: 'git',
    args: ['rev-parse', 'HEAD'],
    cwd: request.repositoryRoot,
  };
  const result = runCommand(command);
  if (
    result.exitCode !== 0 ||
    result.stdout.trim() !== request.task.sourceCommit
  )
    throw new Error('Cortex Team Task source commit is not current.');
}

function assertCortexWriteAuthority(
  task: CortexTeamTaskAdmissionRequest,
): void {
  const root = TEAM_CORTEX_ROOTS.get(task.team);
  if (!root || task.writeClaims.length === 0)
    throw new Error('Cortex Team Task write authority is missing.');
  if (
    new Set(task.readClaims).size !== task.readClaims.length ||
    new Set(task.writeClaims).size !== task.writeClaims.length ||
    new Set(task.forbiddenClaims).size !== task.forbiddenClaims.length ||
    new Set(task.selectedSkillPaths).size !== task.selectedSkillPaths.length
  )
    throw new Error('Cortex Team Task claims and skills must be unique.');
  if (task.forbiddenClaims.some((claim) => !isValidTaskResourceClaim(claim)))
    throw new Error('Cortex Team Task forbidden claims are invalid.');
  for (const claim of task.writeClaims) {
    if (claim !== root && !claim.startsWith(`${root}/`))
      throw new Error(
        `Cortex Team Task write claim escapes team authority: ${claim}.`,
      );
    for (const forbidden of task.forbiddenClaims) {
      const pair: TaskResourcePatternPair = { first: claim, second: forbidden };
      if (taskResourcePatternsOverlap(pair))
        throw new Error(
          `Cortex Team Task write claim overlaps forbidden authority: ${claim}.`,
        );
    }
  }
}

function assertContextCommitted(request: AssertCommittedContextRequest): void {
  for (const path of request.context.contextPaths) {
    const object = `${request.task.sourceCommit}:${path}`;
    const command: RunCommandArgs = {
      command: 'git',
      args: ['cat-file', '-e', object],
      cwd: request.repositoryRoot,
    };
    if (runCommand(command).exitCode !== 0)
      throw new Error(`Cortex Team Task context is not committed: ${path}.`);
  }
}
