import { afterEach, expect, test } from 'bun:test';
import { join } from 'node:path';

import { AgentAttemptParentKind } from '../../src/agent-workflow/domain.ts';
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
  loadTeamPlanJournal,
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
import type {
  TeamPlanEvent,
  TeamPlanSelectedEvent,
  TeamPlanStartedEvent,
} from '../../src/team-plan/domain.ts';
import type { GitFixture } from '../module-delivery/worktree-test-support.ts';

const fixtures: GitFixture[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0).reverse())
    disposeGitFixture(fixture);
});

function continuityPlan(sourceCommit: string): ModuleDeliveryPlanV2 {
  return {
    version: 2,
    generation: 1,
    sourceCommit,
    maxConcurrency: 1,
    maxAgentDepth: 1,
    maxAttempts: 2,
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

async function continuityFixture(
  transform: (value: ModuleDeliveryPlanV2) => ModuleDeliveryPlanV2 = (value) =>
    value,
) {
  const fixture = createGitFixture();
  fixtures.push(fixture);
  const planPath = join(fixture.root, 'plan.json');
  const journalPath = join(fixture.root, 'journal.jsonl');
  const value = transform(continuityPlan(fixture.baselineCommit));
  const planText = `${JSON.stringify(value)}\n`;
  const validation = decodeAndValidateModuleDeliveryPlan(planText);
  if (validation.status !== ModuleDeliveryValidationStatus.Accepted)
    throw new Error('Attempt continuity test plan was rejected.');
  const started: TeamPlanStartedEvent = {
    version: TEAM_PLAN_JOURNAL_VERSION,
    kind: TeamPlanEventKind.Started,
    sequence: 1,
    runId: teamPlanSha256('attempt-continuity-test-run'),
    planPath,
    planText,
    planSha256: teamPlanSha256(planText),
    modulePlanDigest: validation.planDigest,
    sourceCommit: fixture.baselineCommit,
    repositoryRoot: fixture.sourceRoot,
    workspaceRoot: fixture.workspaceRoot,
    generationRecordLimit: value.nodes.length * value.maxAttempts,
  };
  await createTeamPlanJournal({ journalPath, event: started });
  return { fixture, journalPath, started, value };
}

test('Team Plan journal continues attempts across generations', async () => {
  const { journalPath, started, value } = await continuityFixture();
  const firstAttempt = {
    taskId: 'provider',
    attempt: 1,
    generation: 1,
    planDigest: started.modulePlanDigest,
  };
  await appendTeamPlanEvent({
    journalPath,
    event: {
      version: TEAM_PLAN_JOURNAL_VERSION,
      kind: TeamPlanEventKind.Selected,
      sequence: 2,
      attempts: [firstAttempt],
    },
  });
  await appendTeamPlanEvent({
    journalPath,
    event: {
      version: TEAM_PLAN_JOURNAL_VERSION,
      kind: TeamPlanEventKind.Recorded,
      sequence: 3,
      record: {
        kind: TeamPlanRecordKind.FinalUnusable,
        ...firstAttempt,
        conclusion: ModuleDeliveryGenerationFenceKind.Failed,
      },
    },
  });
  const replacementText = `${JSON.stringify({ ...value, generation: 2 })}\n`;
  const replacement = decodeAndValidateModuleDeliveryPlan(replacementText);
  if (replacement.status !== ModuleDeliveryValidationStatus.Accepted)
    throw new Error('Restart continuity plan was rejected.');
  await appendTeamPlanEvent({
    journalPath,
    event: {
      version: TEAM_PLAN_JOURNAL_VERSION,
      kind: TeamPlanEventKind.Restarted,
      sequence: 4,
      planPath: started.planPath,
      planText: replacementText,
      planSha256: teamPlanSha256(replacementText),
      modulePlanDigest: replacement.planDigest,
      sourceCommit: started.sourceCommit,
      generationRecordLimit: 2,
    },
  });
  const secondAttempt = {
    taskId: 'provider',
    attempt: 2,
    generation: 2,
    planDigest: replacement.planDigest,
  };
  await appendTeamPlanEvent({
    journalPath,
    event: {
      version: TEAM_PLAN_JOURNAL_VERSION,
      kind: TeamPlanEventKind.Selected,
      sequence: 5,
      attempts: [secondAttempt],
    },
  });
  expect((await loadTeamPlanJournal(journalPath)).events.at(-1)).toEqual({
    version: TEAM_PLAN_JOURNAL_VERSION,
    kind: TeamPlanEventKind.Selected,
    sequence: 5,
    attempts: [secondAttempt],
  });
});

test('rejects replacement limits below carried attempts', async () => {
  const { journalPath, started, value } = await continuityFixture();
  const attempt = {
    taskId: 'provider',
    attempt: 1,
    generation: 1,
    planDigest: started.modulePlanDigest,
  };
  await appendTeamPlanEvent({
    journalPath,
    event: {
      version: TEAM_PLAN_JOURNAL_VERSION,
      kind: TeamPlanEventKind.Selected,
      sequence: 2,
      attempts: [attempt],
    },
  });
  await appendTeamPlanEvent({
    journalPath,
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
  const replacementText = `${JSON.stringify({
    ...value,
    generation: 2,
    maxAttempts: 1,
  })}\n`;
  const replacement = decodeAndValidateModuleDeliveryPlan(replacementText);
  if (replacement.status !== ModuleDeliveryValidationStatus.Accepted)
    throw new Error('Replacement limit test plan was rejected.');
  await expect(
    appendTeamPlanEvent({
      journalPath,
      event: {
        version: TEAM_PLAN_JOURNAL_VERSION,
        kind: TeamPlanEventKind.Restarted,
        sequence: 4,
        planPath: started.planPath,
        planText: replacementText,
        planSha256: teamPlanSha256(replacementText),
        modulePlanDigest: replacement.planDigest,
        sourceCommit: started.sourceCommit,
        generationRecordLimit: 1,
      },
    }),
  ).rejects.toThrow('attempt limit is below carried history');
});

test('Team Plan journal keeps retries sequential until terminal closure', async () => {
  const { fixture, journalPath, started } = await continuityFixture((value) => {
    const provider = value.nodes[0];
    if (!provider) throw new Error('Lifecycle provider is missing.');
    return {
      ...value,
      nodes: [
        {
          ...provider,
          taskId: 'downstream',
          dependencies: ['consumer'],
          consumerOutcome: 'Downstream uses consumer evidence.',
          baseline: {
            kind: ModuleDeliveryBaselineKind.IntegratedDependencies,
            providerTaskIds: ['consumer'],
          },
        },
        {
          ...provider,
          taskId: 'consumer',
          dependencies: ['provider'],
          consumerOutcome: 'Consumer uses provider evidence.',
          baseline: {
            kind: ModuleDeliveryBaselineKind.IntegratedDependencies,
            providerTaskIds: ['provider'],
          },
        },
        provider,
      ],
      edgeContracts: [
        {
          providerTaskId: 'provider',
          consumerTaskId: 'consumer',
          capability: 'provider capability',
          publicTypes: ['ProviderResult'],
          errors: ['ProviderError'],
          behaviorInvariants: ['Provider evidence is deterministic.'],
          securityInvariants: ['Provider state stays protected.'],
          compatibilityExpectations: ['Consumer accepts provider evidence.'],
          owningTests: ['provider contract test'],
        },
        {
          providerTaskId: 'consumer',
          consumerTaskId: 'downstream',
          capability: 'consumer capability',
          publicTypes: ['ConsumerResult'],
          errors: ['ConsumerError'],
          behaviorInvariants: ['Consumer evidence is deterministic.'],
          securityInvariants: ['Consumer state stays protected.'],
          compatibilityExpectations: ['Downstream accepts consumer evidence.'],
          owningTests: ['consumer contract test'],
        },
      ],
    };
  });
  const attempt = (number: number) => ({
    taskId: 'provider',
    attempt: number,
    generation: 1,
    planDigest: started.modulePlanDigest,
  });
  const selected = (request: {
    readonly sequence: number;
    readonly attempts: readonly ReturnType<typeof attempt>[];
  }): TeamPlanSelectedEvent => ({
    version: TEAM_PLAN_JOURNAL_VERSION,
    kind: TeamPlanEventKind.Selected,
    ...request,
  });
  const finalized = (sequence: number): TeamPlanEvent => ({
    version: TEAM_PLAN_JOURNAL_VERSION,
    kind: TeamPlanEventKind.Finalized,
    sequence,
    headCommit: fixture.baselineCommit,
  });
  await expect(
    appendTeamPlanEvent({
      journalPath,
      event: selected({ sequence: 2, attempts: [attempt(1), attempt(2)] }),
    }),
  ).rejects.toThrow('repeats a logical task');
  await expect(
    appendTeamPlanEvent({ journalPath, event: finalized(2) }),
  ).rejects.toThrow('nonterminal tasks');
  await appendTeamPlanEvent({
    journalPath,
    event: selected({ sequence: 2, attempts: [attempt(1)] }),
  });
  const unusable = (request: {
    readonly sequence: number;
    readonly attempt: number;
  }): TeamPlanEvent => ({
    version: TEAM_PLAN_JOURNAL_VERSION,
    kind: TeamPlanEventKind.Recorded,
    sequence: request.sequence,
    record: {
      kind: TeamPlanRecordKind.FinalUnusable,
      ...attempt(request.attempt),
      conclusion: ModuleDeliveryGenerationFenceKind.Failed,
    },
  });
  await appendTeamPlanEvent({
    journalPath,
    event: unusable({ sequence: 3, attempt: 1 }),
  });
  await expect(
    appendTeamPlanEvent({ journalPath, event: finalized(4) }),
  ).rejects.toThrow('nonterminal tasks');
  await appendTeamPlanEvent({
    journalPath,
    event: selected({ sequence: 4, attempts: [attempt(2)] }),
  });
  await appendTeamPlanEvent({
    journalPath,
    event: unusable({ sequence: 5, attempt: 2 }),
  });
  await appendTeamPlanEvent({ journalPath, event: finalized(6) });
  expect((await loadTeamPlanJournal(journalPath)).finalized).toBe(true);
});
