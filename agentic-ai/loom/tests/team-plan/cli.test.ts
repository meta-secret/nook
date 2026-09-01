import { afterEach, expect, spyOn, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AgentAttemptParentKind } from '../../src/agent-workflow/domain.ts';
import { LoomFailure, LoomFailureCode } from '../../src/loom-failure.ts';
import { assertEvidenceBound } from '../../src/module-delivery/authority.ts';
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
import {
  MAX_TEAM_PLAN_RECORD_REQUEST_BYTES,
  runTeamPlanCli as runTeamPlanCliWithArguments,
} from '../../src/team-plan/cli.ts';
import { TeamPlanRecordKind } from '../../src/team-plan/domain.ts';
import { assertTeamPlanAcceptedEvidenceReceipt } from '../../src/team-plan/domain.ts';
import { MAX_TEAM_PLAN_JOURNAL_BYTES } from '../../src/team-plan/journal.ts';
import {
  createGitFixture,
  disposeGitFixture,
  fixtureGit,
} from '../module-delivery/worktree-test-support.ts';

import type {
  ModuleDeliveryPlanV2,
  ModuleDeliveryAcceptedProviderEvidenceIdentity,
  ModuleDeliveryReadOnlyNodeV2,
} from '../../src/module-delivery/index.ts';
import type {
  TeamPlanLeaseReceipt,
  TeamPlanRecord,
  TeamPlanSelectionReceipt,
  TeamPlanSnapshot,
} from '../../src/team-plan/domain.ts';
import type { GitFixture } from '../module-delivery/worktree-test-support.ts';

const MODULE_ROOT = 'nook-app/nook-platform/nook-core';
const fixtures: GitFixture[] = [];

type TestTeamPlanCliArguments = Readonly<{ argv: readonly string[] }>;
type ExpectedTeamPlanCliFailure = Readonly<{
  argv: readonly string[];
  code: LoomFailureCode;
}>;
type TestTeamPlanRequest = Readonly<{
  sourceCommit: string;
  generation: number;
}>;
type WriteTeamPlanJsonRequest = Readonly<{
  path: string;
  value: ModuleDeliveryPlanV2 | TeamPlanRecord;
}>;
type NestedProviderEvidenceRequest = Readonly<{
  depth: number;
  entriesPerIdentity: number;
}>;
type LocalizedRecordContentFixture = Readonly<{
  contents: string | Buffer;
  expectedMessage: string;
}>;

function runTeamPlanCli(request: TestTeamPlanCliArguments): Promise<number> {
  return runTeamPlanCliWithArguments({ argv: request.argv, locale: 'en' });
}

async function expectTeamPlanCliFailure(
  request: ExpectedTeamPlanCliFailure,
): Promise<void> {
  try {
    await runTeamPlanCli({ argv: request.argv });
    throw new Error('Expected Team Plan CLI failure.');
  } catch (error) {
    expect(error).toBeInstanceOf(LoomFailure);
    expect((error as LoomFailure).code).toBe(request.code);
    expect((error as LoomFailure).cause).toBeInstanceOf(Error);
  }
}

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

function plan(request: TestTeamPlanRequest): ModuleDeliveryPlanV2 {
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

function writeJson(request: WriteTeamPlanJsonRequest): void {
  writeFileSync(request.path, `${JSON.stringify(request.value)}\n`);
}

function recordArguments(journalPath: string, requestPath: string) {
  return [
    'record',
    '--journal',
    journalPath,
    '--run-id',
    '0'.repeat(64),
    '--request',
    requestPath,
  ];
}

function nestedProviderEvidence(
  request: NestedProviderEvidenceRequest,
): ModuleDeliveryAcceptedProviderEvidenceIdentity {
  const acceptanceRequirements = Array.from(
    { length: request.entriesPerIdentity },
    () => '界'.repeat(4096),
  );
  const claimIdentities = Array.from(
    { length: request.entriesPerIdentity },
    () => ({ claim: 'a'.repeat(4096), contentDigest: 'a'.repeat(64) }),
  );
  let children: readonly ModuleDeliveryAcceptedProviderEvidenceIdentity[] = [];
  for (let index = request.depth - 1; index >= 0; index -= 1) {
    const identity: ModuleDeliveryAcceptedProviderEvidenceIdentity = {
      schemaVersion: MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION,
      generation: 1,
      planDigest: 'a'.repeat(64),
      taskId: `provider-${index}`,
      attempt: 1,
      producerTeam: TeamKey.DevelopmentCore,
      functionalOwner: TeamKey.Ai,
      acceptanceOwner: TeamKey.Ai,
      sourceCommit: 'a'.repeat(40),
      verifiedHeadCommit: 'a'.repeat(40),
      artifactIdentity: `provider-${index}/report.json`,
      artifactDigest: 'a'.repeat(64),
      sourceProvenanceDigest: 'a'.repeat(64),
      verdict: ModuleDeliveryEvidenceVerdict.TerminalSuccess,
      claimIdentities,
      acceptanceRequirements,
      acceptedProviderEvidence: children,
    };
    children = [identity];
  }
  const root = children[0];
  if (!root) throw new Error('Nested provider evidence root is missing.');
  return root;
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
      await runTeamPlanCli({
        argv: [
          'start',
          '--plan',
          firstPlanPath,
          '--journal',
          journalPath,
          '--repository-root',
          fixture.sourceRoot,
        ],
      }),
    ).toBe(0);
    const started = JSON.parse(output.at(-1) ?? '') as TeamPlanSnapshot;
    expect(
      await runTeamPlanCli({ argv: ['select', '--journal', journalPath] }),
    ).toBe(0);
    const firstSelection = JSON.parse(
      output.at(-1) ?? '',
    ) as TeamPlanSelectionReceipt;
    const firstAdmission = firstSelection.admissions[0];
    if (!firstAdmission) throw new Error('First CLI admission is missing.');
    expect(
      await runTeamPlanCli({
        argv: [
          'lease',
          '--journal',
          journalPath,
          '--run-id',
          firstSelection.snapshot.runId,
          '--generation',
          String(firstSelection.snapshot.generation),
          '--plan-digest',
          firstSelection.snapshot.planDigest,
          '--task-ids',
          firstAdmission.taskId,
        ],
      }),
    ).toBe(0);
    const firstLease = (JSON.parse(output.at(-1) ?? '') as TeamPlanLeaseReceipt)
      .leases[0];
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
      await runTeamPlanCli({
        argv: [
          'record',
          '--journal',
          journalPath,
          '--run-id',
          started.runId,
          '--request',
          recordPath,
        ],
      }),
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
      await runTeamPlanCli({
        argv: ['restart', '--journal', journalPath, '--plan', secondPlanPath],
      }),
    ).toBe(0);
    expect(
      await runTeamPlanCli({ argv: ['select', '--journal', journalPath] }),
    ).toBe(0);
    const secondSelection = JSON.parse(
      output.at(-1) ?? '',
    ) as TeamPlanSelectionReceipt;
    const secondAdmission = secondSelection.admissions[0];
    if (!secondAdmission) throw new Error('Second CLI admission is missing.');
    expect(
      await runTeamPlanCli({
        argv: [
          'lease',
          '--journal',
          journalPath,
          '--run-id',
          secondSelection.snapshot.runId,
          '--generation',
          String(secondSelection.snapshot.generation),
          '--plan-digest',
          secondSelection.snapshot.planDigest,
          '--task-ids',
          secondAdmission.taskId,
        ],
      }),
    ).toBe(0);
    const secondLease = (
      JSON.parse(output.at(-1) ?? '') as TeamPlanLeaseReceipt
    ).leases[0];
    if (!secondLease) throw new Error('Second CLI lease is missing.');
    const evidence = Array.from({ length: 128 }, () => '界'.repeat(4096));
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
    const requestBytes = statSync(recordPath).size;
    expect(requestBytes).toBeGreaterThan(1_048_576);
    expect(requestBytes).toBeLessThanOrEqual(
      MAX_TEAM_PLAN_RECORD_REQUEST_BYTES,
    );
    expect(
      await runTeamPlanCli({
        argv: [
          'record',
          '--journal',
          journalPath,
          '--run-id',
          started.runId,
          '--request',
          recordPath,
        ],
      }),
    ).toBe(0);
    expect(
      await runTeamPlanCli({ argv: ['finalize', '--journal', journalPath] }),
    ).toBe(0);
    const error = spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expectTeamPlanCliFailure({
        argv: ['discard', '--journal', journalPath],
        code: LoomFailureCode.TeamPlanValidationFailed,
      });
    } finally {
      error.mockRestore();
    }
    await expectTeamPlanCliFailure({
      argv: ['discard', '--journal', journalPath, '--run-id', '0'.repeat(64)],
      code: LoomFailureCode.TeamPlanStorageFailed,
    });
    expect(existsSync(journalPath)).toBe(true);
    expect(
      await runTeamPlanCli({
        argv: ['discard', '--journal', journalPath, '--run-id', started.runId],
      }),
    ).toBe(0);
    expect(existsSync(journalPath)).toBe(false);
  } finally {
    log.mockRestore();
  }
}, 30_000);

test('localizes visible parse failures through the Loom catalog', async () => {
  const error = spyOn(console, 'error').mockImplementation(() => {});
  try {
    await runTeamPlanCliWithArguments({ argv: [], locale: 'ru-RU' });
    throw new Error('Expected localized Team Plan CLI failure.');
  } catch (cause) {
    expect(cause).toBeInstanceOf(LoomFailure);
    expect((cause as LoomFailure).code).toBe(
      LoomFailureCode.TeamPlanValidationFailed,
    );
    expect(((cause as LoomFailure).cause as Error).message).toBe(
      'Аргументы команды Team Plan недопустимы.',
    );
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Использование'),
    );
  } finally {
    error.mockRestore();
  }
});

test('admits the complete permitted nested provider evidence ancestry', async () => {
  const root = mkdtempSync(join(tmpdir(), 'team-plan-cli-ancestry-'));
  try {
    const acceptedRoot = nestedProviderEvidence({
      depth: 128,
      entriesPerIdentity: 4,
    });
    const acceptedProviderEvidence = [acceptedRoot];
    assertEvidenceBound(acceptedProviderEvidence);
    assertTeamPlanAcceptedEvidenceReceipt(acceptedRoot);
    const requestPath = join(root, 'nested-record.json');
    writeJson({
      path: requestPath,
      value: {
        kind: TeamPlanRecordKind.Provider,
        submission: {
          kind: ModuleDeliveryProviderSubmissionKind.ReadOnlyEvidence,
          schemaVersion: MODULE_DELIVERY_EVIDENCE_HANDOFF_VERSION,
          taskId: 'synthesis',
          attempt: 1,
          generation: 1,
          planDigest: 'a'.repeat(64),
          sourceCommit: 'a'.repeat(40),
          producerTeam: TeamKey.Ai,
          functionalOwner: TeamKey.Ai,
          acceptanceOwner: TeamKey.Ai,
          acceptanceRequirements: [],
          claimIdentities: [],
          acceptedProviderEvidence,
          artifactIdentity: 'synthesis/report.json',
          artifactDigest: 'a'.repeat(64),
          verdict: ModuleDeliveryEvidenceVerdict.TerminalSuccess,
          evidence: ['complete nested ancestry'],
        },
      },
    });
    const requestBytes = statSync(requestPath).size;
    expect(requestBytes).toBeGreaterThan(4_194_304);
    expect(requestBytes).toBeLessThanOrEqual(
      MAX_TEAM_PLAN_RECORD_REQUEST_BYTES,
    );
    await expectTeamPlanCliFailure({
      argv: recordArguments(join(root, 'missing-journal'), requestPath),
      code: LoomFailureCode.TeamPlanValidationFailed,
    });
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('localizes non-file and oversized record failures', async () => {
  const root = mkdtempSync(join(tmpdir(), 'team-plan-cli-localized-file-'));
  const oversized = join(root, 'oversized.json');
  writeFileSync(oversized, '');
  truncateSync(oversized, MAX_TEAM_PLAN_RECORD_REQUEST_BYTES + 1);
  for (const requestPath of [root, oversized]) {
    try {
      await runTeamPlanCliWithArguments({
        argv: recordArguments(join(root, 'journal'), requestPath),
        locale: 'ru-RU',
      });
      throw new Error('Expected localized record-file failure.');
    } catch (cause) {
      expect(cause).toBeInstanceOf(LoomFailure);
      expect((cause as LoomFailure).code).toBe(
        LoomFailureCode.TeamPlanValidationFailed,
      );
      expect(((cause as LoomFailure).cause as Error).message).toBe(
        'Файл запроса записи Team Plan недопустим или слишком велик.',
      );
    }
  }
  rmSync(root, { recursive: true });
});

test('localizes malformed record contents', async () => {
  const root = mkdtempSync(join(tmpdir(), 'team-plan-cli-localized-content-'));
  const requestPath = join(root, 'record.json');
  const fixtures: readonly LocalizedRecordContentFixture[] = [
    {
      contents: '{',
      expectedMessage: 'JSON запроса записи Team Plan недопустим.',
    },
    {
      contents: Buffer.from([0xc3, 0x28]),
      expectedMessage:
        'Запрос записи Team Plan должен быть в допустимой кодировке UTF-8.',
    },
    {
      contents: '{}\n',
      expectedMessage: 'Поля запроса записи Team Plan недопустимы.',
    },
  ];
  for (const fixture of fixtures) {
    writeFileSync(requestPath, fixture.contents);
    try {
      await runTeamPlanCliWithArguments({
        argv: recordArguments(join(root, 'journal'), requestPath),
        locale: 'ru-RU',
      });
      throw new Error('Expected localized record-content failure.');
    } catch (cause) {
      expect(cause).toBeInstanceOf(LoomFailure);
      expect(((cause as LoomFailure).cause as Error).message).toBe(
        fixture.expectedMessage,
      );
    }
  }
  rmSync(root, { recursive: true });
});

test('normalizes invalid record files and oversized journals', async () => {
  const root = mkdtempSync(join(tmpdir(), 'team-plan-cli-'));
  const request = join(root, 'request.json');
  writeFileSync(request, '');
  truncateSync(request, MAX_TEAM_PLAN_RECORD_REQUEST_BYTES + 1);
  for (const path of [root, request])
    await expectTeamPlanCliFailure({
      argv: recordArguments(join(root, 'journal'), path),
      code: LoomFailureCode.TeamPlanValidationFailed,
    });
  writeFileSync(request, '{');
  await expectTeamPlanCliFailure({
    argv: recordArguments(join(root, 'journal'), request),
    code: LoomFailureCode.TeamPlanValidationFailed,
  });
  writeFileSync(request, '{}\n');
  await expectTeamPlanCliFailure({
    argv: recordArguments(join(root, 'journal'), request),
    code: LoomFailureCode.TeamPlanValidationFailed,
  });
  writeFileSync(request, Buffer.from([0xc3, 0x28]));
  await expectTeamPlanCliFailure({
    argv: recordArguments(join(root, 'journal'), request),
    code: LoomFailureCode.TeamPlanValidationFailed,
  });
  await expectTeamPlanCliFailure({
    argv: recordArguments(join(root, 'journal'), join(root, 'missing.json')),
    code: LoomFailureCode.TeamPlanStorageFailed,
  });
  const journal = join(root, 'oversized-journal.jsonl');
  writeFileSync(journal, 'x'.repeat(MAX_TEAM_PLAN_JOURNAL_BYTES + 1));
  await expectTeamPlanCliFailure({
    argv: ['select', '--journal', journal],
    code: LoomFailureCode.TeamPlanRecoveryFailed,
  });
  rmSync(root, { recursive: true });
});

test.skipIf(process.platform === 'win32')(
  'rejects record and plan FIFOs without waiting for a writer',
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
      await expectTeamPlanCliFailure({
        argv: recordArguments(join(root, 'journal'), request),
        code: LoomFailureCode.TeamPlanValidationFailed,
      });
      const planPath = join(root, 'plan.fifo');
      const planCreated = spawnSync('mkfifo', [planPath], {
        env: { PATH: '/bin:/usr/bin:/usr/sbin' },
        stdio: 'ignore',
      });
      if (planCreated.status !== 0)
        throw new Error('Unable to create Team Plan plan FIFO fixture.');
      const repositoryRoot = join(root, 'repository');
      mkdirSync(repositoryRoot);
      await expectTeamPlanCliFailure({
        argv: [
          'start',
          '--plan',
          planPath,
          '--journal',
          join(root, 'plan-journal'),
          '--repository-root',
          repositoryRoot,
        ],
        code: LoomFailureCode.TeamPlanValidationFailed,
      });
    } finally {
      rmSync(root, { recursive: true });
    }
  },
  1_000,
);
