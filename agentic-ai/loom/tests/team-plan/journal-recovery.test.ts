import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, linkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { AgentAttemptParentKind } from '../../src/agent-workflow/domain.ts';
import { LoomFailureCode } from '../../src/loom-failure.ts';
import {
  REQUIRED_PARENT_OWNED_RESOURCES,
  ModuleDeliveryBaselineKind,
  ModuleDeliveryGenerationFenceKind,
  ModuleDeliveryJoinKind,
  ModuleDeliveryTaskKind,
  ModuleDeliveryValidationStatus,
  TeamKey,
  decodeAndValidateModuleDeliveryPlan,
} from '../../src/module-delivery/index.ts';
import {
  appendTeamPlanEvent,
  createTeamPlanJournal,
  discardTeamPlanJournal,
  teamPlanSha256,
} from '../../src/team-plan/journal.ts';
import {
  TEAM_PLAN_JOURNAL_VERSION,
  TeamPlanEventKind,
  TeamPlanRecordKind,
} from '../../src/team-plan/domain.ts';
import {
  createGitFixture,
  disposeGitFixture,
} from '../module-delivery/worktree-test-support.ts';

import type { ModuleDeliveryPlanV2 } from '../../src/module-delivery/index.ts';
import type { TeamPlanStartedEvent } from '../../src/team-plan/domain.ts';
import type { GitFixture } from '../module-delivery/worktree-test-support.ts';

const fixtures: GitFixture[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0).reverse())
    disposeGitFixture(fixture);
});

function plan(sourceCommit: string): ModuleDeliveryPlanV2 {
  return {
    version: 2,
    generation: 1,
    sourceCommit,
    maxConcurrency: 1,
    maxAgentDepth: 1,
    maxAttempts: 1,
    parentOwnedResources: REQUIRED_PARENT_OWNED_RESOURCES,
    parentJoin: {
      kind: ModuleDeliveryJoinKind.OrderedCommitHandoffs,
      owner: 'delivery-owner',
      validationCommands: ['task loom:verify'],
    },
    nodes: [
      {
        kind: ModuleDeliveryTaskKind.ReadOnly,
        taskId: 'provider',
        team: TeamKey.DevelopmentCore,
        functionalOwner: TeamKey.Ai,
        acceptanceOwner: TeamKey.Ai,
        parentLineage: { kind: AgentAttemptParentKind.WorkflowRoot },
        expert: 'core_expert',
        moduleRoot: 'nook-app/nook-platform/nook-core',
        consumerOutcome: 'Provider publishes evidence.',
        baseline: {
          kind: ModuleDeliveryBaselineKind.SourceCommit,
          sourceCommit,
        },
        agentDepthLimit: 1,
        dependencies: [],
        resources: {
          read: ['nook-app/nook-platform/nook-core/**'],
          write: [],
          evidenceSurface: ['nook-app/nook-platform/nook-core/**'],
        },
        parentOwnedExclusions: REQUIRED_PARENT_OWNED_RESOURCES,
        acceptance: {
          commands: ['task provider:test'],
          evidence: ['provider completed'],
        },
      },
    ],
    edgeContracts: [],
  };
}

async function startedFixture() {
  const fixture = createGitFixture();
  fixtures.push(fixture);
  const planPath = join(fixture.root, 'plan.json');
  const journalPath = join(fixture.root, 'journal.jsonl');
  const planText = `${JSON.stringify(plan(fixture.baselineCommit))}\n`;
  const validation = decodeAndValidateModuleDeliveryPlan(planText);
  if (validation.status !== ModuleDeliveryValidationStatus.Accepted)
    throw new Error('Journal recovery test plan was rejected.');
  writeFileSync(planPath, planText);
  const started: TeamPlanStartedEvent = {
    version: TEAM_PLAN_JOURNAL_VERSION,
    kind: TeamPlanEventKind.Started,
    sequence: 1,
    runId: teamPlanSha256('journal-recovery-test-run'),
    planPath,
    planText,
    planSha256: teamPlanSha256(planText),
    modulePlanDigest: validation.planDigest,
    sourceCommit: fixture.baselineCommit,
    repositoryRoot: fixture.sourceRoot,
    workspaceRoot: fixture.workspaceRoot,
    generationRecordLimit: 1,
  };
  await createTeamPlanJournal({ journalPath, event: started });
  return { fixture, journalPath, started };
}

async function finalizeFixture(request: {
  readonly journalPath: string;
  readonly started: TeamPlanStartedEvent;
}) {
  const attempt = {
    taskId: 'provider',
    attempt: 1,
    generation: 1,
    planDigest: request.started.modulePlanDigest,
  };
  await appendTeamPlanEvent({
    journalPath: request.journalPath,
    event: {
      version: TEAM_PLAN_JOURNAL_VERSION,
      kind: TeamPlanEventKind.Selected,
      sequence: 2,
      attempts: [attempt],
    },
  });
  await appendTeamPlanEvent({
    journalPath: request.journalPath,
    event: {
      version: TEAM_PLAN_JOURNAL_VERSION,
      kind: TeamPlanEventKind.Recorded,
      sequence: 3,
      record: {
        kind: TeamPlanRecordKind.FinalUnusable,
        ...attempt,
        conclusion: ModuleDeliveryGenerationFenceKind.Failed,
      },
    },
  });
  await appendTeamPlanEvent({
    journalPath: request.journalPath,
    event: {
      version: TEAM_PLAN_JOURNAL_VERSION,
      kind: TeamPlanEventKind.Finalized,
      sequence: 4,
      headCommit: request.started.sourceCommit,
    },
  });
}

describe('Team Plan journal recovery', () => {
  test('preserves an unfinalized journal when a matching tombstone exists', async () => {
    const { journalPath, started } = await startedFixture();
    linkSync(journalPath, `${journalPath}.discarding`);

    await expect(
      discardTeamPlanJournal({
        journalPath,
        expectedRunId: started.runId,
        discardArtifacts: () => Promise.resolve(),
      }),
    ).rejects.toThrow('Only a finalized Team Plan run may be discarded.');
    expect(existsSync(journalPath)).toBe(true);
    expect(existsSync(`${journalPath}.discarding`)).toBe(true);
  });

  test('retains a completion marker when final discard sync fails', async () => {
    const { journalPath, started } = await startedFixture();
    await finalizeFixture({ journalPath, started });
    let parentSyncs = 0;
    await expect(
      discardTeamPlanJournal({
        journalPath,
        expectedRunId: started.runId,
        discardArtifacts: () => Promise.resolve(),
        beforeParentSync: () => {
          if ((parentSyncs += 1) === 3) throw new Error('final sync failed');
        },
      }),
    ).rejects.toThrow('final sync failed');
    expect(existsSync(`${journalPath}.discarded`)).toBe(true);
    await discardTeamPlanJournal({
      journalPath,
      expectedRunId: started.runId,
      discardArtifacts: () => {
        throw new Error('completed artifacts must not run again');
      },
    });
  });

  test('classifies journal filesystem failures as storage failures', async () => {
    const fixture = createGitFixture();
    fixtures.push(fixture);
    await expect(
      appendTeamPlanEvent({
        journalPath: join(fixture.root, 'missing', 'journal.jsonl'),
        event: {
          version: TEAM_PLAN_JOURNAL_VERSION,
          kind: TeamPlanEventKind.Finalized,
          sequence: 2,
          headCommit: fixture.baselineCommit,
        },
      }),
    ).rejects.toMatchObject({ code: LoomFailureCode.TeamPlanStorageFailed });
  });
});
