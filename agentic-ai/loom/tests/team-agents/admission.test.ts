import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { RmOptions } from 'node:fs';
import type {
  SpawnSyncOptionsWithStringEncoding,
  SpawnSyncReturns,
} from 'node:child_process';
import { afterAll, describe, expect, test } from 'bun:test';
import {
  CORTEX_TEAM_TASK_ADMISSION_VERSION,
  admitCortexTeamTask,
} from '../../src/team-agents/admission.ts';
import type {
  AdmitCortexTeamTaskRequest,
  CortexTeamTaskAdmissionRequest,
} from '../../src/team-agents/admission.ts';
import { TeamKey } from '../../src/team-agents/catalog.ts';
import { CORTEX_AUTHORING_SKILL_PATHS } from '../../src/team-agents/context.ts';
import { decodeCortexTeamTaskAdmissionRequest } from '../../src/team-agents/codec.ts';

const REPO_ROOT = join(import.meta.dir, '../../../..');
const TEMP_ROOT = mkdtempSync(join(tmpdir(), 'nook-cortex-team-task-'));
const SRE_SKILL =
  '.cortex/teams/sre/dynamic-skills/github-actions-only-validation.md';

type GitRequest = {
  readonly args: readonly string[];
};

function git(request: GitRequest): string {
  const options: SpawnSyncOptionsWithStringEncoding = {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  };
  const result: SpawnSyncReturns<string> = spawnSync(
    'git',
    [...request.args],
    options,
  );
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function validTask(): CortexTeamTaskAdmissionRequest {
  const gitRequest: GitRequest = { args: ['rev-parse', 'HEAD'] };
  return {
    version: CORTEX_TEAM_TASK_ADMISSION_VERSION,
    taskId: 'sre-cortex-runbook',
    attempt: 1,
    sourceCommit: git(gitRequest),
    team: TeamKey.Sre,
    functionalOwner: TeamKey.Sre,
    expectedResult: 'Update the SRE runbook under its owning Cortex subtree.',
    readClaims: ['.cortex/teams/sre/dynamic-skills/**'],
    writeClaims: ['.cortex/teams/sre/runbooks/example.md'],
    forbiddenClaims: ['.cortex/gizmo/**'],
    selectedSkillPaths: [SRE_SKILL],
    acceptanceEvidence: ['Cortex audit passes.'],
  };
}

function admissionRequest(
  task: CortexTeamTaskAdmissionRequest,
): AdmitCortexTeamTaskRequest {
  return { repositoryRoot: REPO_ROOT, task };
}

describe('Cortex Team Task admission', () => {
  test('admits a team-owned Cortex write with automatic and selected skills', () => {
    const admission = admitCortexTeamTask(admissionRequest(validTask()));

    expect(admission.kind).toBe('cortex-team-task-admission-v1');
    expect(admission.context.team).toBe(TeamKey.Sre);
    expect(admission.context.skillPaths).toEqual([
      ...CORTEX_AUTHORING_SKILL_PATHS,
      SRE_SKILL,
    ]);
    expect(admission.context.contextPaths).toContain(
      '.cortex/teams/sre/AGENTS.md',
    );
  });

  test('rejects foreign writes, stale frontiers, and unreadable skills', () => {
    const task = validTask();
    const invalidTasks: readonly CortexTeamTaskAdmissionRequest[] = [
      {
        ...task,
        writeClaims: ['.cortex/teams/security/design-docs/example.md'],
      },
      { ...task, sourceCommit: '0'.repeat(40) },
      {
        ...task,
        selectedSkillPaths: [
          '.cortex/teams/security/dynamic-skills/browser-extension-release-security.md',
        ],
      },
    ];
    for (const invalidTask of invalidTasks) {
      expect(() =>
        admitCortexTeamTask(admissionRequest(invalidTask)),
      ).toThrow();
    }
  });

  test('decodes exact bounded transport and rejects extra authority', () => {
    const task = validTask();
    expect(decodeCortexTeamTaskAdmissionRequest(JSON.stringify(task))).toEqual(
      task,
    );
    const extraAuthority = { ...task, lifecycleAuthority: true };
    expect(() =>
      decodeCortexTeamTaskAdmissionRequest(JSON.stringify(extraAuthority)),
    ).toThrow('expects exactly');
  });

  test('CLI emits the admitted harness context', () => {
    const requestPath = join(TEMP_ROOT, 'request.json');
    writeFileSync(requestPath, JSON.stringify(validTask()), 'utf8');
    const options: SpawnSyncOptionsWithStringEncoding = {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    };
    const result: SpawnSyncReturns<string> = spawnSync(
      'bun',
      [
        'run',
        'agentic-ai/loom/src/team-agents/cli.ts',
        '--request',
        requestPath,
        '--working-directory',
        REPO_ROOT,
      ],
      options,
    );
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as {
      readonly context: { readonly skillPaths: readonly string[] };
    };
    expect(output.context.skillPaths).toContain(
      CORTEX_AUTHORING_SKILL_PATHS[0],
    );
  });
});

afterAll(() => {
  const options: RmOptions = { recursive: true, force: true };
  rmSync(TEMP_ROOT, options);
});
