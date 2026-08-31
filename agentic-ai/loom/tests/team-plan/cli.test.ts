import { afterEach, expect, spyOn, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AgentAttemptParentKind } from '../../src/agent-workflow/domain.ts';
import {
  MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION,
  REQUIRED_PARENT_OWNED_RESOURCES,
  ModuleDeliveryBaselineKind,
  ModuleDeliveryEvidenceVerdict,
  ModuleDeliveryGenerationFenceKind,
  ModuleDeliveryJoinKind,
  ModuleDeliveryProviderSubmissionKind,
  ModuleDeliveryTaskKind,
  TeamKey,
  moduleDeliveryEvidenceArtifactDigest,
  moduleDeliveryEvidenceClaimIdentities,
} from '../../src/module-delivery/index.ts';
import { runTeamPlanCli } from '../../src/team-plan/cli.ts';
import { TeamPlanRecordKind } from '../../src/team-plan/domain.ts';
import {
  createGitFixture,
  disposeGitFixture,
  fixtureGit,
} from '../module-delivery/worktree-test-support.ts';

import type {
  ModuleDeliveryPlanV2,
  ModuleDeliveryReadOnlyNodeV2,
} from '../../src/module-delivery/index.ts';
import type {
  TeamPlanRecord,
  TeamPlanSelectionReceipt,
  TeamPlanSnapshot,
} from '../../src/team-plan/domain.ts';
import type { GitFixture } from '../module-delivery/worktree-test-support.ts';

const MODULE_ROOT = 'nook-app/nook-platform/nook-core';
const fixtures: GitFixture[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0).reverse())
    disposeGitFixture(fixture);
});

function readNode(sourceCommit: string): ModuleDeliveryReadOnlyNodeV2 {
  return {
    kind: ModuleDeliveryTaskKind.ReadOnly,
    taskId: 'provider',
    team: TeamKey.DevelopmentCore,
    functionalOwner: TeamKey.Ai,
    acceptanceOwner: TeamKey.Ai,
    parentLineage: { kind: AgentAttemptParentKind.WorkflowRoot },
    expert: 'core_expert',
    moduleRoot: MODULE_ROOT,
    consumerOutcome: 'Provider publishes terminal evidence.',
    baseline: {
      kind: ModuleDeliveryBaselineKind.SourceCommit,
      sourceCommit,
    },
    agentDepthLimit: 1,
    dependencies: [],
    resources: {
      read: [`${MODULE_ROOT}/**`],
      write: [],
      evidenceSurface: [`${MODULE_ROOT}/**`],
    },
    parentOwnedExclusions: REQUIRED_PARENT_OWNED_RESOURCES,
    acceptance: {
      commands: ['task provider:test'],
      evidence: ['provider completed'],
    },
  };
}

function plan(
  request: Readonly<{ sourceCommit: string; generation: number }>,
): ModuleDeliveryPlanV2 {
  return {
    version: 2,
    generation: request.generation,
    sourceCommit: request.sourceCommit,
    maxConcurrency: 1,
    maxAgentDepth: 1,
    maxAttempts: 2,
    parentOwnedResources: REQUIRED_PARENT_OWNED_RESOURCES,
    parentJoin: {
      kind: ModuleDeliveryJoinKind.OrderedCommitHandoffs,
      owner: 'delivery-owner',
      validationCommands: ['task loom:verify'],
    },
    nodes: [readNode(request.sourceCommit)],
    edgeContracts: [],
  };
}

function writeJson(
  request: Readonly<{
    path: string;
    value: ModuleDeliveryPlanV2 | TeamPlanRecord;
  }>,
): void {
  writeFileSync(request.path, `${JSON.stringify(request.value)}\n`);
}

test('dispatches every successful Team Plan command', async () => {
  const fixture = createGitFixture();
  fixtures.push(fixture);
  const journalPath = join(fixture.root, 'team-plan-events.jsonl');
  const firstPlanPath = join(fixture.root, 'generation-1.json');
  writeJson({
    path: firstPlanPath,
    value: plan({ sourceCommit: fixture.baselineCommit, generation: 1 }),
  });
  const output: string[] = [];
  const log = spyOn(console, 'log').mockImplementation((message) => {
    output.push(String(message));
  });
  try {
    expect(
      await runTeamPlanCli([
        'start',
        '--plan',
        firstPlanPath,
        '--journal',
        journalPath,
        '--repository-root',
        fixture.sourceRoot,
      ]),
    ).toBe(0);
    const started = JSON.parse(output.at(-1) ?? '') as TeamPlanSnapshot;
    expect(await runTeamPlanCli(['select', '--journal', journalPath])).toBe(0);
    const firstSelection = JSON.parse(
      output.at(-1) ?? '',
    ) as TeamPlanSelectionReceipt;
    const firstLease = firstSelection.leases[0];
    if (!firstLease) throw new Error('First CLI lease is missing.');
    const recordPath = join(fixture.root, 'record.json');
    writeJson({
      path: recordPath,
      value: {
        kind: TeamPlanRecordKind.FinalUnusable,
        taskId: firstLease.taskId,
        attempt: firstLease.attempt,
        generation: firstLease.generation,
        planDigest: firstLease.planDigest,
        conclusion: ModuleDeliveryGenerationFenceKind.Failed,
      },
    });
    expect(
      await runTeamPlanCli([
        'record',
        '--journal',
        journalPath,
        '--request',
        recordPath,
      ]),
    ).toBe(0);

    writeFileSync(join(fixture.sourceRoot, 'generation.txt'), 'two\n');
    fixtureGit(fixture)(['add', '--all']);
    fixtureGit(fixture)(['commit', '--quiet', '-m', 'generation two']);
    const secondCommit = fixtureGit(fixture)(['rev-parse', 'HEAD']);
    const secondPlanPath = join(fixture.root, 'generation-2.json');
    writeJson({
      path: secondPlanPath,
      value: plan({ sourceCommit: secondCommit, generation: 2 }),
    });
    expect(
      await runTeamPlanCli([
        'restart',
        '--journal',
        journalPath,
        '--plan',
        secondPlanPath,
      ]),
    ).toBe(0);
    expect(await runTeamPlanCli(['select', '--journal', journalPath])).toBe(0);
    const secondSelection = JSON.parse(
      output.at(-1) ?? '',
    ) as TeamPlanSelectionReceipt;
    const secondLease = secondSelection.leases[0];
    if (!secondLease) throw new Error('Second CLI lease is missing.');
    const evidence = ['provider completed'];
    const artifactIdentity = 'provider/report.json';
    writeJson({
      path: recordPath,
      value: {
        kind: TeamPlanRecordKind.Provider,
        submission: {
          kind: ModuleDeliveryProviderSubmissionKind.ReadOnlyEvidence,
          schemaVersion: MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION,
          taskId: secondLease.taskId,
          attempt: secondLease.attempt,
          generation: secondLease.generation,
          planDigest: secondLease.planDigest,
          sourceCommit: secondLease.startingFrontier,
          producerTeam: secondLease.team,
          functionalOwner: secondLease.functionalOwner,
          acceptanceOwner: secondLease.acceptanceOwner,
          acceptanceRequirements: secondLease.acceptanceRequirements,
          acceptedProviderEvidence: secondLease.authorizedProviderEvidence,
          claimIdentities: moduleDeliveryEvidenceClaimIdentities({
            repositoryRoot: fixture.sourceRoot,
            sourceCommit: secondLease.startingFrontier,
            evidenceSurface: readNode(secondCommit).resources.evidenceSurface,
          }),
          artifactIdentity,
          artifactDigest: moduleDeliveryEvidenceArtifactDigest({
            artifactIdentity,
            evidence,
            acceptanceRequirements: secondLease.acceptanceRequirements,
            acceptedProviderEvidence: secondLease.authorizedProviderEvidence,
          }),
          verdict: ModuleDeliveryEvidenceVerdict.TerminalSuccess,
          evidence,
        },
      },
    });
    expect(
      await runTeamPlanCli([
        'record',
        '--journal',
        journalPath,
        '--request',
        recordPath,
      ]),
    ).toBe(0);
    expect(await runTeamPlanCli(['finalize', '--journal', journalPath])).toBe(
      0,
    );
    const error = spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await runTeamPlanCli(['discard', '--journal', journalPath])).toBe(
        2,
      );
    } finally {
      error.mockRestore();
    }
    await expect(
      runTeamPlanCli([
        'discard',
        '--journal',
        journalPath,
        '--run-id',
        '0'.repeat(64),
      ]),
    ).rejects.toThrow('run identity is stale');
    expect(existsSync(journalPath)).toBe(true);
    expect(
      await runTeamPlanCli([
        'discard',
        '--journal',
        journalPath,
        '--run-id',
        started.runId,
      ]),
    ).toBe(0);
    expect(existsSync(journalPath)).toBe(false);
  } finally {
    log.mockRestore();
  }
}, 10_000);

test('rejects non-files and oversized record requests before reading', async () => {
  const root = mkdtempSync(join(tmpdir(), 'team-plan-cli-'));
  const request = join(root, 'request.json');
  writeFileSync(request, 'x'.repeat(1_048_577));
  for (const path of [root, request])
    await expect(
      runTeamPlanCli([
        'record',
        '--journal',
        join(root, 'journal'),
        '--request',
        path,
      ]),
    ).rejects.toThrow('invalid or oversized');
  rmSync(root, { recursive: true });
});

test.skipIf(process.platform === 'win32')(
  'rejects a record request FIFO without waiting for a writer',
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'team-plan-cli-fifo-'));
    const request = join(root, 'request.fifo');
    try {
      const created = spawnSync('mkfifo', [request], {
        env: { PATH: '/bin:/usr/bin:/usr/sbin' },
        stdio: 'ignore',
      });
      if (created.status !== 0)
        throw new Error('Unable to create Team Plan request FIFO fixture.');
      await expect(
        runTeamPlanCli([
          'record',
          '--journal',
          join(root, 'journal'),
          '--request',
          request,
        ]),
      ).rejects.toThrow('invalid or oversized');
    } finally {
      rmSync(root, { recursive: true });
    }
  },
  1_000,
);
