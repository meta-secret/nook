import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';

import { AgentAttemptParentKind } from '../../src/agent-workflow/domain.ts';
import {
  REQUIRED_PARENT_OWNED_RESOURCES,
  ModuleDeliveryBaselineKind,
  ModuleDeliveryGenerationFenceKind,
  ModuleDeliveryJoinKind,
  ModuleDeliveryTaskKind,
  ModuleDeliveryValidationStatus,
  ModuleDeliveryWorkspaceKind,
  TeamKey,
  decodeAndValidateModuleDeliveryPlan,
} from '../../src/module-delivery/index.ts';
import {
  MAX_TEAM_PLAN_JOURNAL_BYTES,
  appendTeamPlanEvent,
  assertTeamPlanGenerationCapacity,
  createTeamPlanJournal,
  discardTeamPlanJournal,
  loadTeamPlanJournal,
  teamPlanEventBytes,
  teamPlanSha256,
  withTeamPlanJournalLock,
} from '../../src/team-plan/journal.ts';
import { teamPlanLinuxNamespaceLockRecoverable } from '../../src/team-plan/journal-lock.ts';
import {
  TEAM_PLAN_JOURNAL_VERSION,
  TeamPlanEventKind,
  TeamPlanRecordKind,
} from '../../src/team-plan/domain.ts';
import {
  createGitFixture,
  disposeGitFixture,
  fixtureGit,
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

async function startedFixture(
  transform: (value: ModuleDeliveryPlanV2) => ModuleDeliveryPlanV2 = (value) =>
    value,
) {
  const fixture = createGitFixture();
  fixtures.push(fixture);
  const planPath = join(fixture.root, 'plan.json');
  const journalPath = join(fixture.root, 'journal.jsonl');
  const value = transform(plan(fixture.baselineCommit));
  const planText = `${JSON.stringify(value)}\n`;
  const validation = decodeAndValidateModuleDeliveryPlan(planText);
  if (validation.status !== ModuleDeliveryValidationStatus.Accepted)
    throw new Error(
      `Journal test plan was rejected: ${JSON.stringify(validation.issues)}`,
    );
  writeFileSync(planPath, planText);
  const started: TeamPlanStartedEvent = {
    version: TEAM_PLAN_JOURNAL_VERSION,
    kind: TeamPlanEventKind.Started,
    sequence: 1,
    runId: teamPlanSha256('journal-test-run'),
    planPath,
    planText,
    planSha256: teamPlanSha256(planText),
    modulePlanDigest: validation.planDigest,
    sourceCommit: fixture.baselineCommit,
    repositoryRoot: fixture.sourceRoot,
    workspaceRoot: fixture.workspaceRoot,
    generationRecordLimit:
      validation.plan.nodes.length * validation.plan.maxAttempts,
  };
  await createTeamPlanJournal({ journalPath, event: started });
  return { fixture, journalPath, started, value };
}

function lockRef(request: {
  readonly fixture: GitFixture;
  readonly journalPath: string;
}): string {
  const run = teamPlanSha256(
    `${request.fixture.sourceRoot}\n${request.journalPath}`,
  );
  return `refs/nook/team-plan-locks/${run}`;
}

function ownerBlob(request: {
  readonly fixture: GitFixture;
  readonly name: string;
  readonly contents: string;
}): string {
  const path = join(request.fixture.root, request.name);
  writeFileSync(path, request.contents);
  return fixtureGit(request.fixture)(['hash-object', '-w', path]);
}

function testMachineIdentity(): string {
  const boot = (
    process.platform === 'darwin'
      ? spawnSync('sysctl', ['-n', 'kern.boottime'], { encoding: 'utf8' })
      : spawnSync('cat', ['/proc/sys/kernel/random/boot_id'], {
          encoding: 'utf8',
        })
  ).stdout.trim();
  const namespace =
    process.platform === 'linux' ? readlinkSync('/proc/self/ns/pid') : 'host';
  return `${hostname()}:${boot}:${namespace}`;
}

function testProcessIdentity(pid: number): string {
  const machine = testMachineIdentity();
  if (process.platform !== 'linux') return `${machine}:pid-liveness-only`;
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  const commandEnd = stat.lastIndexOf(') ');
  const startTicks = stat
    .slice(commandEnd + 2)
    .trim()
    .split(/\s+/u)[19];
  if (!startTicks) throw new Error('Test process start ticks are unavailable.');
  return `${machine}:start-ticks:${startTicks}`;
}

async function finalizeStartedFixture(request: {
  readonly journalPath: string;
  readonly started: TeamPlanStartedEvent;
}): Promise<void> {
  const { journalPath, started } = request;
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
  await appendTeamPlanEvent({
    journalPath,
    event: {
      version: TEAM_PLAN_JOURNAL_VERSION,
      kind: TeamPlanEventKind.Finalized,
      sequence: 4,
      headCommit: started.sourceCommit,
    },
  });
}

describe('Team Plan journal', () => {
  test('recovers only a terminated foreign PID namespace', () => {
    const current = 'machine:boot:pid:[101]';
    const owner = 'machine:boot:pid:[202]:start-ticks:303';
    expect(
      teamPlanLinuxNamespaceLockRecoverable({
        ownerIdentity: owner,
        currentMachineIdentity: current,
        liveNamespaces: new Set(),
      }),
    ).toBe(true);
    expect(
      teamPlanLinuxNamespaceLockRecoverable({
        ownerIdentity: owner,
        currentMachineIdentity: current,
        liveNamespaces: new Set(['pid:[202]']),
      }),
    ).toBe(false);
    expect(
      teamPlanLinuxNamespaceLockRecoverable({
        ownerIdentity: 'foreign:boot:pid:[202]:start-ticks:303',
        currentMachineIdentity: current,
        liveNamespaces: new Set(),
      }),
    ).toBe(false);
  });

  test('recovers only a Git-CAS owner with mismatched process start', async () => {
    const { fixture, journalPath } = await startedFixture();
    const ref = lockRef({ fixture, journalPath });
    const machineIdentity = testMachineIdentity();
    const owner = (request: {
      readonly version: 2 | 3;
      readonly pid: number;
      readonly processIdentity: string;
      readonly token: string;
    }): string => `${JSON.stringify(request)}\n`;
    const live = ownerBlob({
      fixture,
      name: 'live-lock.json',
      contents: owner({
        version: 3,
        pid: process.pid,
        processIdentity: testProcessIdentity(process.pid),
        token: 'live',
      }),
    });
    fixtureGit(fixture)(['update-ref', ref, live]);
    await expect(
      withTeamPlanJournalLock({
        journalPath,
        action: async () => 'unreachable',
      }),
    ).rejects.toThrow('already in use');
    fixtureGit(fixture)(['update-ref', '-d', ref, live]);
    const foreign = ownerBlob({
      fixture,
      name: 'foreign-lock.json',
      contents: owner({
        version: 3,
        pid: process.pid,
        processIdentity: `${hostname()}:foreign-boot:foreign-namespace:reused`,
        token: 'foreign',
      }),
    });
    fixtureGit(fixture)(['update-ref', ref, foreign]);
    await expect(
      withTeamPlanJournalLock({
        journalPath,
        action: async () => 'unreachable',
      }),
    ).rejects.toThrow('already in use');
    fixtureGit(fixture)(['update-ref', '-d', ref, foreign]);
    if (process.platform === 'linux') {
      const namespace = readlinkSync('/proc/self/ns/pid');
      const terminated = ownerBlob({
        fixture,
        name: 'terminated-namespace-lock.json',
        contents: owner({
          version: 3,
          pid: process.pid,
          processIdentity: `${machineIdentity.slice(0, -namespace.length)}pid:[2147483647]:start-ticks:1`,
          token: 'terminated-namespace',
        }),
      });
      fixtureGit(fixture)(['update-ref', ref, terminated]);
      expect(
        await withTeamPlanJournalLock({
          journalPath,
          action: async () => 'recovered-namespace',
        }),
      ).toBe('recovered-namespace');
    }
    const legacy = ownerBlob({
      fixture,
      name: 'legacy-lock.json',
      contents: `${JSON.stringify({
        pid: process.pid,
        processIdentity: `${machineIdentity}:legacy-whole-second`,
        token: 'legacy',
      })}\n`,
    });
    fixtureGit(fixture)(['update-ref', ref, legacy]);
    await expect(
      withTeamPlanJournalLock({
        journalPath,
        action: async () => 'unreachable',
      }),
    ).rejects.toThrow('already in use');
    fixtureGit(fixture)(['update-ref', '-d', ref, legacy]);
    const stale = ownerBlob({
      fixture,
      name: 'stale-lock.json',
      contents: owner({
        version: 3,
        pid: process.pid,
        processIdentity: `${machineIdentity}:start-ticks:1`,
        token: 'stale',
      }),
    });
    fixtureGit(fixture)(['update-ref', ref, stale]);
    if (process.platform !== 'linux') {
      await expect(
        withTeamPlanJournalLock({
          journalPath,
          action: async () => 'unreachable',
        }),
      ).rejects.toThrow('already in use');
      fixtureGit(fixture)(['update-ref', '-d', ref, stale]);
    }
    const absentPid = 2_147_483_647;
    const absent = ownerBlob({
      fixture,
      name: 'absent-lock.json',
      contents: owner({
        version: 3,
        pid: absentPid,
        processIdentity: `${machineIdentity}:start-ticks:1`,
        token: 'absent',
      }),
    });
    if (process.platform !== 'linux')
      fixtureGit(fixture)(['update-ref', ref, absent]);
    expect(
      await withTeamPlanJournalLock({
        journalPath,
        action: async () => {
          const blob = fixtureGit(fixture)([
            'rev-parse',
            '--verify',
            `${ref}^{blob}`,
          ]);
          expect(fixtureGit(fixture)(['cat-file', 'blob', blob])).toContain(
            '"version":3',
          );
          return 'acquired';
        },
      }),
    ).toBe('acquired');
    const lockPath = join(fixture.sourceRoot, '.git', `${ref}.lock`);
    mkdirSync(dirname(lockPath), { recursive: true });
    await expect(
      withTeamPlanJournalLock({
        journalPath,
        action: async () => writeFileSync(lockPath, 'block release\n'),
      }),
    ).rejects.toThrow('ownership changed');
    unlinkSync(lockPath);
    expect(
      await withTeamPlanJournalLock({
        journalPath,
        action: async () => 'recovered',
      }),
    ).toBe('recovered');
    const targetRef = `${ref}-target`;
    fixtureGit(fixture)(['update-ref', targetRef, stale]);
    fixtureGit(fixture)(['symbolic-ref', ref, targetRef]);
    expect(
      await withTeamPlanJournalLock({
        journalPath,
        action: async () => 'acquired-symbolic-name',
      }),
    ).toBe('acquired-symbolic-name');
    expect(fixtureGit(fixture)(['rev-parse', targetRef])).toBe(stale);

    const shadowGit = join(fixture.sourceRoot, 'git');
    writeFileSync(shadowGit, '#!/bin/sh\nexit 93\n');
    chmodSync(shadowGit, 0o755);
    const originalPath = process.env.PATH || '/usr/bin:/bin';
    const hadGitDirectory = 'GIT_DIR' in process.env;
    const originalGitDirectory = process.env.GIT_DIR ?? '';
    const hadGitCommonDirectory = 'GIT_COMMON_DIR' in process.env;
    const originalGitCommonDirectory = process.env.GIT_COMMON_DIR ?? '';
    const hadGitNamespace = 'GIT_NAMESPACE' in process.env;
    const originalGitNamespace = process.env.GIT_NAMESPACE ?? '';
    const hadGitConfigCount = 'GIT_CONFIG_COUNT' in process.env;
    const originalGitConfigCount = process.env.GIT_CONFIG_COUNT ?? '';
    const hadGitConfigKey = 'GIT_CONFIG_KEY_0' in process.env;
    const originalGitConfigKey = process.env.GIT_CONFIG_KEY_0 ?? '';
    const hadGitConfigValue = 'GIT_CONFIG_VALUE_0' in process.env;
    const originalGitConfigValue = process.env.GIT_CONFIG_VALUE_0 ?? '';
    process.env.PATH = `.:${originalPath}`;
    process.env.GIT_DIR = join(fixture.root, 'hostile-git-dir');
    process.env.GIT_COMMON_DIR = join(fixture.root, 'hostile-common-dir');
    process.env.GIT_NAMESPACE = 'hostile';
    process.env.GIT_CONFIG_COUNT = '1';
    process.env.GIT_CONFIG_KEY_0 = 'safe.directory';
    process.env.GIT_CONFIG_VALUE_0 = join(fixture.root, 'foreign-checkout');
    try {
      expect(
        await withTeamPlanJournalLock({
          journalPath,
          action: async () => 'canonical-git',
        }),
      ).toBe('canonical-git');
    } finally {
      process.env.PATH = originalPath;
      if (hadGitDirectory) process.env.GIT_DIR = originalGitDirectory;
      else delete process.env.GIT_DIR;
      if (hadGitCommonDirectory)
        process.env.GIT_COMMON_DIR = originalGitCommonDirectory;
      else delete process.env.GIT_COMMON_DIR;
      if (hadGitNamespace) process.env.GIT_NAMESPACE = originalGitNamespace;
      else delete process.env.GIT_NAMESPACE;
      if (hadGitConfigCount)
        process.env.GIT_CONFIG_COUNT = originalGitConfigCount;
      else delete process.env.GIT_CONFIG_COUNT;
      if (hadGitConfigKey) process.env.GIT_CONFIG_KEY_0 = originalGitConfigKey;
      else delete process.env.GIT_CONFIG_KEY_0;
      if (hadGitConfigValue)
        process.env.GIT_CONFIG_VALUE_0 = originalGitConfigValue;
      else delete process.env.GIT_CONFIG_VALUE_0;
    }
  });

  test('rejects a hard-linked journal before lock acquisition', async () => {
    const { fixture, journalPath } = await startedFixture();
    linkSync(journalPath, `${journalPath}.alias`);
    await expect(
      withTeamPlanJournalLock({
        journalPath,
        action: async () => 'unreachable',
      }),
    ).rejects.toThrow('path is unsafe');
    expect(
      fixtureGit(fixture)([
        'for-each-ref',
        '--format=%(refname)',
        lockRef({ fixture, journalPath }),
      ]),
    ).toBe('');
  });

  test('rejects torn snapshots and nested attempt extensions', async () => {
    const { journalPath, started } = await startedFixture();
    const snapshot = readFileSync(journalPath, 'utf8');
    writeFileSync(journalPath, `${snapshot}{`);
    await expect(loadTeamPlanJournal(journalPath)).rejects.toThrow(
      'noncanonical',
    );
    writeFileSync(journalPath, snapshot);
    const selected: TeamPlanSelectedEvent = {
      version: TEAM_PLAN_JOURNAL_VERSION,
      kind: TeamPlanEventKind.Selected,
      sequence: 2,
      attempts: [
        {
          taskId: 'provider',
          attempt: 1,
          generation: 1,
          planDigest: started.modulePlanDigest,
        },
      ],
    };
    await appendTeamPlanEvent({ journalPath, event: selected });
    const lines = readFileSync(journalPath, 'utf8').trim().split('\n');
    const forged = JSON.parse(lines[1] ?? '') as {
      attempts: Array<Record<string, string | number>>;
    };
    Object.assign(forged.attempts[0] ?? {}, { extension: 'forged' });
    lines[1] = JSON.stringify(forged);
    writeFileSync(journalPath, `${lines.join('\n')}\n`);
    await expect(loadTeamPlanJournal(journalPath)).rejects.toThrow(
      'attempt identity fields are invalid',
    );
  });

  test('bounds same-handle journal reads before decoding or append', async () => {
    const { fixture, journalPath, started } = await startedFixture();
    writeFileSync(
      journalPath,
      Buffer.alloc(MAX_TEAM_PLAN_JOURNAL_BYTES + 1, 120),
    );
    await expect(loadTeamPlanJournal(journalPath)).rejects.toThrow('oversized');
    await expect(
      appendTeamPlanEvent({
        journalPath,
        event: {
          version: TEAM_PLAN_JOURNAL_VERSION,
          kind: TeamPlanEventKind.Finalized,
          sequence: 2,
          headCommit: started.sourceCommit,
        },
      }),
    ).rejects.toThrow('oversized');
    expect(
      readdirSync(fixture.root).filter((path) => path.endsWith('.tmp')),
    ).toEqual([]);
    writeFileSync(journalPath, '{not-json}\n');
    await expect(loadTeamPlanJournal(journalPath)).rejects.toThrow();
    await expect(
      appendTeamPlanEvent({
        journalPath,
        event: {
          version: TEAM_PLAN_JOURNAL_VERSION,
          kind: TeamPlanEventKind.Finalized,
          sequence: 2,
          headCommit: started.sourceCommit,
        },
      }),
    ).rejects.toThrow();
    expect(readFileSync(journalPath, 'utf8')).toBe('{not-json}\n');
  });

  test('keeps a renamed append when parent synchronization fails', async () => {
    const { journalPath, started } = await startedFixture();
    chmodSync(journalPath, 0o600);
    const selected: TeamPlanSelectedEvent = {
      version: TEAM_PLAN_JOURNAL_VERSION,
      kind: TeamPlanEventKind.Selected,
      sequence: 2,
      attempts: [
        {
          taskId: 'provider',
          attempt: 1,
          generation: 1,
          planDigest: started.modulePlanDigest,
        },
      ],
    };
    await expect(
      appendTeamPlanEvent({
        journalPath,
        event: selected,
        beforeParentSync: () => {
          throw new Error('parent sync failed');
        },
      }),
    ).rejects.toThrow('parent sync failed');
    expect((await loadTeamPlanJournal(journalPath)).events).toHaveLength(2);
    expect(statSync(journalPath).mode & 0o777).toBe(0o600);
    const alias = `${journalPath}.alias`;
    symlinkSync(journalPath, alias);
    await expect(loadTeamPlanJournal(alias)).rejects.toThrow();
  });

  test('rejects absent and non-regular journal paths without mutation', async () => {
    const { fixture } = await startedFixture();
    const missingParent = join(fixture.root, 'missing-parent');
    await expect(
      loadTeamPlanJournal(join(missingParent, 'journal.jsonl')),
    ).rejects.toThrow();
    expect(existsSync(missingParent)).toBe(false);
    const fifo = join(fixture.root, 'journal.fifo');
    expect(spawnSync('mkfifo', [fifo]).status).toBe(0);
    await expect(loadTeamPlanJournal(fifo)).rejects.toThrow('unsafe');
  });

  test('cleans a partial temporary append for an underscore task', async () => {
    const { fixture, journalPath, started } = await startedFixture((value) => ({
      ...value,
      nodes: value.nodes.map((node) => ({ ...node, taskId: 'read_only' })),
    }));
    let cleanupSynced = false;
    await expect(
      appendTeamPlanEvent({
        journalPath,
        event: {
          version: TEAM_PLAN_JOURNAL_VERSION,
          kind: TeamPlanEventKind.Selected,
          sequence: 2,
          attempts: [
            {
              taskId: 'read_only',
              attempt: 1,
              generation: 1,
              planDigest: started.modulePlanDigest,
            },
          ],
        },
        beforeTemporarySync: () => {
          throw new Error('temporary sync failed');
        },
        afterTemporaryCleanupSync: () => {
          cleanupSynced = true;
        },
      }),
    ).rejects.toThrow('temporary sync failed');
    expect(cleanupSynced).toBe(true);
    expect(
      readdirSync(fixture.root).filter((path) => path.endsWith('.tmp')),
    ).toEqual([]);
    expect((await loadTeamPlanJournal(journalPath)).events).toHaveLength(1);
  });

  test('durably tombstones discard and resumes under the original lock', async () => {
    const { fixture, journalPath, started } = await startedFixture();
    await finalizeStartedFixture({ journalPath, started });
    let discarded = false;
    let parentSyncs = 0;
    await expect(
      discardTeamPlanJournal({
        journalPath,
        discardArtifacts: async () => {
          discarded = true;
        },
        beforeParentSync: () => {
          if ((parentSyncs += 1) === 2) throw new Error('parent sync failed');
        },
      }),
    ).rejects.toThrow('parent sync failed');
    expect(discarded).toBe(false);
    expect(existsSync(journalPath)).toBe(false);
    expect(existsSync(`${journalPath}.discarding`)).toBe(true);
    discarded = false;

    const ref = lockRef({ fixture, journalPath });
    const foreign = ownerBlob({
      fixture,
      name: 'discard-lock.json',
      contents: `${JSON.stringify({
        pid: process.pid,
        processIdentity: `${hostname()}-foreign:discard`,
        token: 'discard',
      })}\n`,
    });
    fixtureGit(fixture)(['update-ref', ref, foreign]);
    await expect(
      discardTeamPlanJournal({
        journalPath,
        discardArtifacts: async () => {
          discarded = true;
        },
      }),
    ).rejects.toThrow('already in use');
    expect(discarded).toBe(false);
    fixtureGit(fixture)(['update-ref', '-d', ref, foreign]);

    await discardTeamPlanJournal({
      journalPath,
      discardArtifacts: async (state) => {
        expect(state.journal.path).toBe(journalPath);
        expect(state.artifactsMayAlreadyBeDiscarded).toBe(true);
        expect(existsSync(journalPath)).toBe(false);
        expect(existsSync(`${journalPath}.discarding`)).toBe(true);
        discarded = true;
      },
    });
    expect(discarded).toBe(true);
    expect(existsSync(`${journalPath}.discarding`)).toBe(false);
  });

  test('syncs a new discard hardlink before unlinking its source', async () => {
    const { journalPath, started } = await startedFixture();
    await finalizeStartedFixture({ journalPath, started });
    await expect(
      discardTeamPlanJournal({
        journalPath,
        discardArtifacts: () => Promise.resolve(),
        beforeParentSync: () => {
          throw new Error('first parent sync failed');
        },
      }),
    ).rejects.toThrow('first parent sync failed');
    expect(existsSync(journalPath)).toBe(true);
    expect(existsSync(`${journalPath}.discarding`)).toBe(true);
  });

  test('rejects a discard tombstone with a foreign inode', async () => {
    const { journalPath, started } = await startedFixture();
    await finalizeStartedFixture({ journalPath, started });
    writeFileSync(`${journalPath}.discarding`, 'forged\n');
    let discarded = false;
    await expect(
      discardTeamPlanJournal({
        journalPath,
        discardArtifacts: async () => {
          discarded = true;
        },
      }),
    ).rejects.toThrow('tombstone is forged');
    expect(discarded).toBe(false);
    expect(existsSync(journalPath)).toBe(true);
  });

  test('locks before resuming a matching discard tombstone', async () => {
    const { fixture, journalPath, started } = await startedFixture();
    await finalizeStartedFixture({ journalPath, started });
    linkSync(journalPath, `${journalPath}.discarding`);
    const ref = lockRef({ fixture, journalPath });
    const foreign = ownerBlob({
      fixture,
      name: 'resume-lock.json',
      contents: `${JSON.stringify({
        version: 3,
        pid: process.pid,
        processIdentity: `${hostname()}:foreign:pid-liveness-only`,
        token: 'foreign',
      })}\n`,
    });
    fixtureGit(fixture)(['update-ref', ref, foreign]);
    await expect(
      discardTeamPlanJournal({
        journalPath,
        discardArtifacts: () => Promise.resolve(),
      }),
    ).rejects.toThrow('already in use');
    expect(existsSync(journalPath)).toBe(true);
    expect(existsSync(`${journalPath}.discarding`)).toBe(true);
    fixtureGit(fixture)(['update-ref', '-d', ref, foreign]);
    await discardTeamPlanJournal({
      journalPath,
      discardArtifacts: async ({ artifactsMayAlreadyBeDiscarded }) => {
        expect(artifactsMayAlreadyBeDiscarded).toBe(false);
      },
    });
    expect(existsSync(journalPath)).toBe(false);
    expect(existsSync(`${journalPath}.discarding`)).toBe(false);
  });

  test('rejects journal creation while its discard tombstone survives', async () => {
    const { journalPath, started } = await startedFixture();
    await finalizeStartedFixture({ journalPath, started });
    linkSync(journalPath, `${journalPath}.discarding`);
    unlinkSync(journalPath);

    await expect(
      createTeamPlanJournal({ journalPath, event: started }),
    ).rejects.toThrow('discard is still in progress');
    expect(existsSync(journalPath)).toBe(false);
    expect(existsSync(`${journalPath}.discarding`)).toBe(true);
  });

  test('proves bounded generation capacity before journal creation', async () => {
    const { started } = await startedFixture();
    expect(() =>
      assertTeamPlanGenerationCapacity({
        journalBytes: 0,
        planEventBytes: teamPlanEventBytes(started),
        generationRecordLimit: started.generationRecordLimit,
        generationCount: 1,
      }),
    ).not.toThrow();
    expect(() =>
      assertTeamPlanGenerationCapacity({
        journalBytes: MAX_TEAM_PLAN_JOURNAL_BYTES,
        planEventBytes: teamPlanEventBytes(started),
        generationRecordLimit: started.generationRecordLimit,
        generationCount: 1,
      }),
    ).toThrow('cannot fit');
    expect(() =>
      assertTeamPlanGenerationCapacity({
        journalBytes: 0,
        planEventBytes: teamPlanEventBytes(started),
        generationRecordLimit: started.generationRecordLimit,
        generationCount: 6,
      }),
    ).toThrow('generation limit is exhausted');
  });

  test('keeps retries sequential and finalizes only terminal task closure', async () => {
    const { fixture, journalPath, started } = await startedFixture((value) => {
      const provider = value.nodes[0];
      if (!provider) throw new Error('Lifecycle provider is missing.');
      return {
        ...value,
        maxAttempts: 2,
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
            compatibilityExpectations: [
              'Downstream accepts consumer evidence.',
            ],
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

  test('propagates terminal failure through derived execution precedence', async () => {
    const { fixture, journalPath, started } = await startedFixture((value) => {
      const reader = value.nodes[0];
      if (!reader) throw new Error('Precedence reader is missing.');
      const root = 'nook-app/nook-platform/nook-core';
      return {
        ...value,
        nodes: [
          {
            ...reader,
            taskId: 'reader',
            resources: {
              read: [`${root}/**`],
              write: [],
              evidenceSurface: [`${root}/**`],
            },
          },
          {
            ...reader,
            kind: ModuleDeliveryTaskKind.Write,
            taskId: 'writer',
            resources: {
              read: [`${root}/**`],
              write: [`${root}/src/**`],
              evidenceSurface: [],
            },
            workspace: {
              kind: ModuleDeliveryWorkspaceKind.IsolatedWorktree,
              expectedCommitHandoff: true,
            },
          },
        ],
      };
    });
    const attempt = {
      taskId: 'writer',
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
    await appendTeamPlanEvent({
      journalPath,
      event: {
        version: TEAM_PLAN_JOURNAL_VERSION,
        kind: TeamPlanEventKind.Finalized,
        sequence: 4,
        headCommit: fixture.baselineCommit,
      },
    });
    expect((await loadTeamPlanJournal(journalPath)).finalized).toBe(true);
  });

  test('persists a validator-accepted quote-heavy maximum-class plan', async () => {
    const { journalPath, started } = await startedFixture((value) => {
      const node = value.nodes[0];
      if (!node) throw new Error('Quote-heavy plan node is missing.');
      const quoted = '"'.repeat(1_150);
      const taskIds = ['provider-0'];
      while (taskIds.length < 32) taskIds.push(`provider-${taskIds.length}`);
      return {
        ...value,
        nodes: taskIds.map((taskId) => ({
          ...node,
          taskId,
          consumerOutcome: quoted,
          acceptance: {
            commands: [quoted],
            evidence: [quoted],
          },
        })),
      };
    });
    expect(Buffer.byteLength(started.planText)).toBeGreaterThan(220_000);
    expect(Buffer.byteLength(started.planText)).toBeLessThanOrEqual(262_144);
    expect(teamPlanEventBytes(started)).toBeGreaterThan(400_000);
    expect((await loadTeamPlanJournal(journalPath)).started).toEqual(started);
  });
});
