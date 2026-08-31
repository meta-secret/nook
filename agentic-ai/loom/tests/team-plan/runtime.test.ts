import { afterEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
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
  ModuleDeliveryWorkspaceKind,
  TeamKey,
  cleanupModuleWorktree,
  moduleDeliveryEvidenceArtifactDigest,
  moduleDeliveryEvidenceClaimIdentities,
  prepareModuleWorktree,
  verifyModuleCommitHandoff,
} from '../../src/module-delivery/index.ts';
import {
  TeamPlanRecordKind,
  discardFinalizedTeamPlan,
  finalizeTeamPlan,
  recordTeamPlan,
  restartTeamPlan,
  selectTeamPlan,
  startTeamPlan,
} from '../../src/team-plan/index.ts';
import {
  createGitFixture,
  disposeGitFixture,
  fixtureGit,
  worktreeFileWriter,
  worktreeGit,
} from '../module-delivery/worktree-test-support.ts';

import type {
  ModuleDeliveryAttemptLease,
  ModuleDeliveryEdgeContract,
  ModuleDeliveryPlanV2,
  ModuleDeliveryReadOnlyEvidenceSubmission,
  ModuleDeliveryReadOnlyNodeV2,
  ModuleDeliveryWriteNodeV2,
  ModuleWorktreeHandle,
} from '../../src/module-delivery/index.ts';
import type {
  TeamPlanProviderRecord,
  TeamPlanStartRequest,
} from '../../src/team-plan/index.ts';
import type { GitFixture } from '../module-delivery/worktree-test-support.ts';

const MODULE_ROOT = 'nook-app/nook-platform/nook-core';
const OUTPUT_PATH = `${MODULE_ROOT}/src/team_plan_test.rs`;
const fixtures: GitFixture[] = [];
const writerWorkspaces: ModuleWorktreeHandle[] = [];

type PlanFile = Readonly<{
  fixture: GitFixture;
  path: string;
  journalPath: string;
}>;

type EvidenceProviderRecord = TeamPlanProviderRecord &
  Readonly<{ submission: ModuleDeliveryReadOnlyEvidenceSubmission }>;

afterEach(() => {
  for (const workspace of writerWorkspaces.splice(0).reverse())
    cleanupModuleWorktree({ workspace });
  for (const fixture of fixtures.splice(0).reverse())
    disposeGitFixture(fixture);
});

function readNode([sourceCommit, taskId, dependencies = []]: readonly [
  string,
  string,
  (readonly string[])?,
]): ModuleDeliveryReadOnlyNodeV2 {
  return {
    kind: ModuleDeliveryTaskKind.ReadOnly,
    taskId,
    team: TeamKey.DevelopmentCore,
    functionalOwner: TeamKey.Ai,
    acceptanceOwner: TeamKey.Ai,
    parentLineage: { kind: AgentAttemptParentKind.WorkflowRoot },
    expert: 'core_expert',
    moduleRoot: MODULE_ROOT,
    consumerOutcome: `${taskId} publishes verified evidence.`,
    baseline:
      dependencies.length === 0
        ? {
            kind: ModuleDeliveryBaselineKind.SourceCommit,
            sourceCommit,
          }
        : {
            kind: ModuleDeliveryBaselineKind.IntegratedDependencies,
            providerTaskIds: dependencies,
          },
    agentDepthLimit: 1,
    dependencies,
    resources: {
      read: [`${MODULE_ROOT}/**`],
      write: [],
      evidenceSurface: [`${MODULE_ROOT}/**`],
    },
    parentOwnedExclusions: REQUIRED_PARENT_OWNED_RESOURCES,
    acceptance: {
      commands: [`task ${taskId}:test`],
      evidence: [`${taskId} completed`],
    },
  };
}

function writeNode(sourceCommit: string): ModuleDeliveryWriteNodeV2 {
  const node = readNode([sourceCommit, 'writer']);
  return {
    ...node,
    kind: ModuleDeliveryTaskKind.Write,
    consumerOutcome: 'Writer publishes one exact frontier.',
    resources: {
      read: [`${MODULE_ROOT}/**`],
      write: [OUTPUT_PATH],
      evidenceSurface: [],
    },
    workspace: {
      kind: ModuleDeliveryWorkspaceKind.IsolatedWorktree,
      expectedCommitHandoff: true,
    },
  };
}

function edge(providerTaskId: string): ModuleDeliveryEdgeContract {
  return {
    providerTaskId,
    consumerTaskId: 'consumer',
    capability: 'VerifiedEvidence',
    publicTypes: ['VerifiedEvidence'],
    errors: ['EvidenceUnavailable'],
    behaviorInvariants: ['Consumer waits for accepted provider evidence.'],
    securityInvariants: ['Only verified evidence crosses the boundary.'],
    compatibilityExpectations: ['Evidence schema remains compatible.'],
    owningTests: ['team plan evidence barrier'],
  };
}

function plan([sourceCommit, nodes, edges = [], maxAttempts = 1]: readonly [
  string,
  ModuleDeliveryPlanV2['nodes'],
  (readonly ModuleDeliveryEdgeContract[])?,
  number?,
]): ModuleDeliveryPlanV2 {
  return {
    version: 2,
    generation: 1,
    sourceCommit,
    maxConcurrency: nodes.length,
    maxAgentDepth: 1,
    maxAttempts,
    parentOwnedResources: REQUIRED_PARENT_OWNED_RESOURCES,
    parentJoin: {
      kind: ModuleDeliveryJoinKind.OrderedCommitHandoffs,
      owner: 'delivery-owner',
      validationCommands: ['task loom:verify'],
    },
    nodes,
    edgeContracts: edges,
  };
}

function fixtureReadNode([git, taskId, dependencies = []]: readonly [
  GitFixture,
  string,
  (readonly string[])?,
]): ModuleDeliveryReadOnlyNodeV2 {
  return readNode([git.baselineCommit, taskId, dependencies]);
}

function fixturePlanFile([
  fixture,
  nodes,
  edges = [],
  maxAttempts = 1,
]: readonly [
  GitFixture,
  ModuleDeliveryPlanV2['nodes'],
  (readonly ModuleDeliveryEdgeContract[])?,
  number?,
]): PlanFile {
  return writeNamedPlanFile({
    fixture,
    name: 'team-plan',
    value: plan([fixture.baselineCommit, nodes, edges, maxAttempts]),
  });
}

function writeNamedPlanFile(
  request: Readonly<{
    fixture: GitFixture;
    value: ModuleDeliveryPlanV2;
    name: string;
  }>,
): PlanFile {
  const path = join(request.fixture.root, `${request.name}.json`);
  const journalPath = join(request.fixture.root, 'team-plan-events.jsonl');
  writeFileSync(path, `${JSON.stringify(request.value)}\n`);
  return { fixture: request.fixture, path, journalPath };
}

function startRequest(file: PlanFile): TeamPlanStartRequest {
  return {
    planPath: file.path,
    journalPath: file.journalPath,
    repositoryRoot: file.fixture.sourceRoot,
  };
}

function runRef(request: { readonly file: PlanFile }): string {
  const first = readFileSync(request.file.journalPath, 'utf8').split('\n')[0];
  if (!first) throw new Error('Team Plan start event is missing.');
  const started = JSON.parse(first) as { readonly runId: string };
  return `refs/nook/team-plan/${started.runId}`;
}

function evidenceRecord(
  request: Readonly<{
    fixture: GitFixture;
    lease: ModuleDeliveryAttemptLease;
    node: ModuleDeliveryReadOnlyNodeV2;
  }>,
): EvidenceProviderRecord {
  const evidence = [`${request.node.taskId} completed`];
  const artifactIdentity = `${request.node.taskId}/report.json`;
  const acceptedProviderEvidence = request.lease.authorizedProviderEvidence;
  const submission: ModuleDeliveryReadOnlyEvidenceSubmission = {
    kind: ModuleDeliveryProviderSubmissionKind.ReadOnlyEvidence,
    schemaVersion: MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION,
    taskId: request.lease.taskId,
    attempt: request.lease.attempt,
    generation: request.lease.generation,
    planDigest: request.lease.planDigest,
    sourceCommit: request.lease.startingFrontier,
    producerTeam: request.lease.team,
    functionalOwner: request.lease.functionalOwner,
    acceptanceOwner: request.lease.acceptanceOwner,
    acceptanceRequirements: request.lease.acceptanceRequirements,
    acceptedProviderEvidence,
    claimIdentities: moduleDeliveryEvidenceClaimIdentities({
      repositoryRoot: request.fixture.sourceRoot,
      sourceCommit: request.lease.startingFrontier,
      evidenceSurface: request.node.resources.evidenceSurface,
    }),
    artifactIdentity,
    artifactDigest: moduleDeliveryEvidenceArtifactDigest({
      artifactIdentity,
      evidence,
      acceptanceRequirements: request.lease.acceptanceRequirements,
      acceptedProviderEvidence,
    }),
    verdict: ModuleDeliveryEvidenceVerdict.TerminalSuccess,
    evidence,
  };
  return { kind: TeamPlanRecordKind.Provider, submission };
}

describe('Team Plan runtime', () => {
  test('reconstructs evidence barriers and releases exact retry leases', async () => {
    const fixture = createGitFixture();
    fixtures.push(fixture);
    const provider = fixtureReadNode([fixture, 'provider']);
    const consumer = fixtureReadNode([fixture, 'consumer', ['provider']]);
    const file = fixturePlanFile([
      fixture,
      [consumer, provider],
      [edge('provider')],
      2,
    ]);
    const realDirectory = join(fixture.root, 'real-journal');
    const aliasDirectory = join(fixture.root, 'journal-alias');
    mkdirSync(realDirectory);
    symlinkSync(realDirectory, aliasDirectory, 'dir');
    const aliased = {
      ...file,
      journalPath: join(aliasDirectory, 'events.jsonl'),
    };
    await expect(
      startTeamPlan({
        ...startRequest(file),
        journalPath: join(fixture.sourceRoot, 'events.jsonl'),
      }),
    ).rejects.toThrow('outside the source repository');
    await startTeamPlan(startRequest(aliased));

    const first = await selectTeamPlan({
      journalPath: join(realDirectory, 'events.jsonl'),
    });
    expect(first.leases.map(({ taskId }) => taskId)).toEqual(['provider']);
    const firstLease = first.leases[0];
    if (!firstLease) throw new Error('First provider lease is missing.');
    const failedRecord = {
      kind: TeamPlanRecordKind.FinalUnusable,
      taskId: firstLease.taskId,
      attempt: firstLease.attempt,
      generation: firstLease.generation,
      planDigest: firstLease.planDigest,
      conclusion: ModuleDeliveryGenerationFenceKind.Failed,
    } as const;
    await recordTeamPlan({
      journalPath: aliased.journalPath,
      record: failedRecord,
    });
    await expect(
      recordTeamPlan({
        journalPath: aliased.journalPath,
        record: failedRecord,
      }),
    ).rejects.toThrow('never selected');

    const retry = await selectTeamPlan({ journalPath: aliased.journalPath });
    const retryLease = retry.leases[0];
    if (!retryLease) throw new Error('Retry provider lease is missing.');
    expect(retryLease.attempt).toBe(2);
    await recordTeamPlan({
      journalPath: aliased.journalPath,
      record: evidenceRecord({ fixture, lease: retryLease, node: provider }),
    });
    await expect(
      finalizeTeamPlan({ journalPath: aliased.journalPath }),
    ).rejects.toThrow('every accepted task result');

    const dependent = await selectTeamPlan({
      journalPath: aliased.journalPath,
    });
    expect(dependent.snapshot.acceptedProviderEvidence).toHaveLength(1);
    const consumerLease = dependent.leases[0];
    if (!consumerLease) throw new Error('Consumer lease is missing.');
    await recordTeamPlan({
      journalPath: aliased.journalPath,
      record: evidenceRecord({ fixture, lease: consumerLease, node: consumer }),
    });
    const finalized = await finalizeTeamPlan({
      journalPath: aliased.journalPath,
    });
    expect(finalized.headCommit).toBe(fixture.baselineCommit);
    unlinkSync(file.path);
    expect(
      await finalizeTeamPlan({ journalPath: aliased.journalPath }),
    ).toEqual(finalized);
    await discardFinalizedTeamPlan({ journalPath: aliased.journalPath });
  }, 10_000);

  test('reconstructs an exact integrated writer frontier', async () => {
    const fixture = createGitFixture();
    fixtures.push(fixture);
    const writer = writeNode(fixture.baselineCommit);
    const file = fixturePlanFile([fixture, [writer]]);
    await startTeamPlan(startRequest(file));
    const selection = await selectTeamPlan({ journalPath: file.journalPath });
    const lease = selection.leases[0];
    if (!lease) throw new Error('Writer lease is missing.');
    const workspace = prepareModuleWorktree({
      repositoryRoot: fixture.sourceRoot,
      workspaceRoot: fixture.workspaceRoot,
      planDigest: lease.planDigest,
      taskId: lease.taskId,
      attempt: lease.attempt,
      baselineCommit: lease.startingFrontier,
    });
    writerWorkspaces.push(workspace);
    worktreeFileWriter(workspace)([OUTPUT_PATH, 'pub struct TeamPlanProof;\n']);
    const git = worktreeGit(workspace);
    git(['add', '--', OUTPUT_PATH]);
    git(['commit', '--quiet', '--no-gpg-sign', '-m', 'team plan writer']);
    const handoff = verifyModuleCommitHandoff({
      workspace,
      baselineCommit: lease.startingFrontier,
      allowedWriteClaims: writer.resources.write,
    });
    const recorded = await recordTeamPlan({
      journalPath: file.journalPath,
      record: {
        kind: TeamPlanRecordKind.Provider,
        submission: {
          kind: ModuleDeliveryProviderSubmissionKind.Write,
          generation: lease.generation,
          acceptedByTeam: lease.acceptanceOwner,
          verdict: ModuleDeliveryEvidenceVerdict.TerminalSuccess,
          handoff: {
            taskId: lease.taskId,
            attempt: lease.attempt,
            planDigest: lease.planDigest,
            baselineCommit: lease.startingFrontier,
            commit: handoff.commit,
            workspace,
          },
        },
      },
    });
    cleanupModuleWorktree({ workspace });
    writerWorkspaces.pop();
    const reconstructed = await selectTeamPlan({
      journalPath: file.journalPath,
    });
    expect(reconstructed.snapshot.integratedWriterFrontiers).toEqual(
      recorded.integratedWriterFrontiers,
    );
    const finalized = await finalizeTeamPlan({
      journalPath: file.journalPath,
    });
    expect(finalized.headCommit).not.toBe(fixture.baselineCommit);
  });

  test('pins large evidence outside the bounded journal', async () => {
    const fixture = createGitFixture();
    fixtures.push(fixture);
    const node = fixtureReadNode([fixture, 'large-evidence']);
    const evidence = [...Array(50).keys()].map(
      (index) => `${String(index).padStart(2, '0')}:${'x'.repeat(4093)}`,
    );
    const sentinel = 'RAW-PROVIDER-EVIDENCE-MUST-NOT-PERSIST';
    const rawEvidence = [sentinel, ...evidence];
    Object.assign(node, {
      acceptance: { commands: ['task large-evidence:test'], evidence },
    });
    const file = fixturePlanFile([fixture, [node]]);
    await startTeamPlan(startRequest(file));
    const selected = await selectTeamPlan({ journalPath: file.journalPath });
    const lease = selected.leases[0];
    if (!lease) throw new Error('Large evidence lease is missing.');
    const record = evidenceRecord({ fixture, lease, node });
    Object.assign(record.submission, {
      evidence: rawEvidence,
      acceptanceRequirements: evidence,
      artifactDigest: moduleDeliveryEvidenceArtifactDigest({
        artifactIdentity: record.submission.artifactIdentity,
        evidence: rawEvidence,
        acceptanceRequirements: evidence,
        acceptedProviderEvidence: record.submission.acceptedProviderEvidence,
      }),
    });
    await recordTeamPlan({ journalPath: file.journalPath, record });
    const journal = readFileSync(file.journalPath, 'utf8');
    const artifact = fixtureGit(fixture)([
      'rev-parse',
      `${runRef({ file })}/${lease.generation}/${lease.taskId}/${lease.attempt}/accepted-evidence`,
    ]);
    expect(journal).not.toContain(sentinel);
    expect(fixtureGit(fixture)(['cat-file', 'blob', artifact])).not.toContain(
      sentinel,
    );
    expect(Buffer.byteLength(journal)).toBeLessThan(230_000);
    const replayed = await selectTeamPlan({ journalPath: file.journalPath });
    expect(replayed.snapshot.acceptedProviderEvidence).toHaveLength(1);
    await finalizeTeamPlan({ journalPath: file.journalPath });
  });

  test('uses CAS artifact refs for idempotent orphan recovery', async () => {
    const fixture = createGitFixture();
    fixtures.push(fixture);
    const alpha = fixtureReadNode([fixture, 'alpha']);
    const file = fixturePlanFile([fixture, [alpha]]);
    const probe = { ...file, journalPath: join(fixture.root, 'probe.jsonl') };
    await startTeamPlan(startRequest(probe));
    const probeSelection = await selectTeamPlan({
      journalPath: probe.journalPath,
    });
    const probeLease = probeSelection.leases[0];
    if (!probeLease) throw new Error('Probe lease is missing.');
    await recordTeamPlan({
      journalPath: probe.journalPath,
      record: evidenceRecord({ fixture, lease: probeLease, node: alpha }),
    });
    const artifactObject = fixtureGit(fixture)([
      'rev-parse',
      `${runRef({ file: probe })}/${probeLease.generation}/${probeLease.taskId}/${probeLease.attempt}/accepted-evidence`,
    ]);
    await startTeamPlan(startRequest(file));
    const selected = await selectTeamPlan({ journalPath: file.journalPath });
    const alphaLease = selected.leases[0];
    if (!alphaLease) throw new Error('CAS lease is missing.');
    const alphaRef = `${runRef({ file })}/${alphaLease.generation}/alpha/${alphaLease.attempt}/accepted-evidence`;
    const record = evidenceRecord({ fixture, lease: alphaLease, node: alpha });
    fixtureGit(fixture)(['update-ref', alphaRef, artifactObject]);
    expect(fixtureGit(fixture)(['rev-parse', '--verify', alphaRef])).toMatch(
      /^[0-9a-f]{40}$/u,
    );
    await recordTeamPlan({
      journalPath: file.journalPath,
      record,
    });
    await expect(
      discardFinalizedTeamPlan({ journalPath: file.journalPath }),
    ).rejects.toThrow('finalized');
    await finalizeTeamPlan({ journalPath: file.journalPath });
    const oldPrefix = runRef({ file });
    const tombstone = `${file.journalPath}.discarding`;
    linkSync(file.journalPath, tombstone);
    unlinkSync(file.journalPath);
    await discardFinalizedTeamPlan({ journalPath: file.journalPath });
    expect(fixtureGit(fixture)(['for-each-ref', oldPrefix])).toBe('');
    expect(existsSync(tombstone)).toBe(false);
    await startTeamPlan(startRequest(file));
    expect(runRef({ file })).not.toBe(oldPrefix);
    const replacement = await selectTeamPlan({ journalPath: file.journalPath });
    const replacementLease = replacement.leases[0];
    if (!replacementLease) throw new Error('Replacement lease is missing.');
    const forgedRef = `${runRef({ file })}/${replacementLease.generation}/alpha/${replacementLease.attempt}/accepted-evidence`;
    fixtureGit(fixture)(['update-ref', forgedRef, fixture.baselineCommit]);
    await expect(
      recordTeamPlan({
        journalPath: file.journalPath,
        record: evidenceRecord({
          fixture,
          lease: replacementLease,
          node: alpha,
        }),
      }),
    ).rejects.toThrow('artifact ref already differs');
  }, 10_000);

  test('blocks restart until leases are dispositioned and keeps attempts monotonic', async () => {
    const fixture = createGitFixture();
    fixtures.push(fixture);
    const firstNode = fixtureReadNode([fixture, 'provider']);
    const file = fixturePlanFile([fixture, [firstNode], [], 2]);
    await startTeamPlan(startRequest(file));
    const selected = await selectTeamPlan({ journalPath: file.journalPath });
    const oldLease = selected.leases[0];
    if (!oldLease) throw new Error('Old generation lease is missing.');
    const secondNode = fixtureReadNode([fixture, 'provider']);
    const second: ModuleDeliveryPlanV2 = {
      ...plan([fixture.baselineCommit, [secondNode], [], 2]),
      generation: 2,
    };
    const replacement = writeNamedPlanFile({
      fixture,
      value: second,
      name: 'team-plan-generation-2',
    });
    await expect(
      restartTeamPlan({
        journalPath: file.journalPath,
        planPath: replacement.path,
      }),
    ).rejects.toThrow('terminal release evidence');
    await recordTeamPlan({
      journalPath: file.journalPath,
      record: {
        kind: TeamPlanRecordKind.FinalUnusable,
        taskId: oldLease.taskId,
        attempt: oldLease.attempt,
        generation: oldLease.generation,
        planDigest: oldLease.planDigest,
        conclusion: ModuleDeliveryGenerationFenceKind.Cancelled,
      },
    });
    writeFileSync(join(fixture.sourceRoot, 'generation.txt'), 'two\n');
    fixtureGit(fixture)(['add', '--all']);
    fixtureGit(fixture)(['commit', '--quiet', '-m', 'generation two']);
    const sourceCommit = fixtureGit(fixture)(['rev-parse', 'HEAD']);
    const movedNode = readNode([sourceCommit, 'provider']);
    const moved = writeNamedPlanFile({
      fixture,
      value: {
        ...plan([sourceCommit, [movedNode], [], 2]),
        generation: 2,
      },
      name: 'team-plan-moved-generation-2',
    });
    const restarted = await restartTeamPlan({
      journalPath: file.journalPath,
      planPath: moved.path,
    });
    expect(restarted.generation).toBe(2);
    expect(restarted.acceptedProviderEvidence).toEqual([]);
    const next = await selectTeamPlan({ journalPath: file.journalPath });
    expect(next.leases[0]?.attempt).toBe(2);
    expect(next.leases[0]?.startingFrontier).toBe(sourceCommit);
    await expect(
      recordTeamPlan({
        journalPath: file.journalPath,
        record: evidenceRecord({ fixture, lease: oldLease, node: firstNode }),
      }),
    ).rejects.toThrow('stale or was never selected');
    writeFileSync(moved.path, `${JSON.stringify(second)}\n`);
    expect(
      (await selectTeamPlan({ journalPath: file.journalPath })).snapshot
        .generation,
    ).toBe(2);
  });
});
