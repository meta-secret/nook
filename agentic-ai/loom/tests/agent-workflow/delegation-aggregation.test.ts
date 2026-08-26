import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import {
  mkdir,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import type { RmOptions } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentAttemptJournal } from '../../src/agent-workflow/agent-journal.ts';
import type { AgentAttemptJournalConfiguration } from '../../src/agent-workflow/agent-journal.ts';
import { CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION } from '../../src/agent-workflow/agent-attempt-version.ts';
import {
  AgentAttemptAdapterKind,
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
  MaterializedViewPresence,
  TaskTerminalKind,
  WorkflowResultKind,
} from '../../src/agent-workflow/domain.ts';
import type {
  AgentAttemptProcessingReference,
  TaskTerminal,
} from '../../src/agent-workflow/domain.ts';
import {
  DELEGATION_PLAN_SCHEMA_VERSION,
  DelegationBarrierPolicy,
  delegationAttemptIdentityKey,
} from '../../src/agent-workflow/delegation-domain.ts';
import type {
  DelegationAttemptDeclaration,
  DelegationPlan,
} from '../../src/agent-workflow/delegation-domain.ts';
import { finalizeDelegationRun } from '../../src/agent-workflow/delegation-aggregation.ts';
import type {
  DelegationBarrierEvidence,
  DelegationChildTerminalEvidence,
  DelegationFinalizationRequest,
  FinalizeDelegationRunInput,
} from '../../src/agent-workflow/delegation-aggregation.ts';
import {
  acquireDelegationLifecycleLock,
  admitDelegationAttempt,
  startDelegationRun,
} from '../../src/agent-workflow/delegation-run-journal.ts';
import type {
  AdmitDelegationAttemptInput,
  DelegationLifecycleLockInput,
  StartDelegationRunInput,
} from '../../src/agent-workflow/delegation-run-journal.ts';

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const REMOVE_OPTIONS: RmOptions = { recursive: true, force: true };
const RECURSIVE_DIRECTORY_OPTIONS: { readonly recursive: true } = {
  recursive: true,
};
const NONCOMPLETED_KINDS: readonly TaskTerminalKind[] = [
  TaskTerminalKind.Failed,
  TaskTerminalKind.Blocked,
  TaskTerminalKind.Cancelled,
  TaskTerminalKind.TimedOut,
  TaskTerminalKind.Skipped,
];

describe('ordinary delegation run aggregation', () => {
  test('recursively closes three tiers, retains failure evidence, and is idempotent', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'loom-aggregate-'));
    try {
      const fixtureInput: FixtureInput = {
        workingDirectory,
        runId: 'three-tier-closure',
        leafKind: TaskTerminalKind.Failed,
      };
      const fixture = await completeFixture(fixtureInput);
      const runEventsPath = join(fixture.runDirectory, 'events.jsonl');
      const eventsBeforeFinalization = await readFile(runEventsPath, 'utf8');
      const legacyTemporaryPath = join(
        fixture.runDirectory,
        'run-result.json.tmp',
      );
      await writeFile(legacyTemporaryPath, 'Interrupted projection.\n', 'utf8');
      const concurrent = await Promise.all([
        finalizeDelegationRun(fixture.finalizationInput),
        finalizeDelegationRun(fixture.finalizationInput),
      ]);
      const first = concurrent[0]!;
      expect(concurrent[1]).toEqual(first);
      const firstResult = await readFile(first.resultPath, 'utf8');
      const firstView = await readFile(first.viewPath, 'utf8');
      expect(
        first.result.attempts.map((attempt) => attempt.terminalKind),
      ).toEqual([
        TaskTerminalKind.Completed,
        TaskTerminalKind.Completed,
        TaskTerminalKind.Failed,
      ]);
      expect(firstView).toBe(
        '# Root aggregate\n\nAll child evidence reconciled.\n',
      );

      const second = await finalizeDelegationRun(fixture.finalizationInput);
      expect(second).toEqual(first);
      expect(await readFile(second.resultPath, 'utf8')).toBe(firstResult);
      expect(await readFile(second.viewPath, 'utf8')).toBe(firstView);
      expect(await readFile(runEventsPath, 'utf8')).toBe(
        eventsBeforeFinalization,
      );
      await expect(stat(legacyTemporaryPath)).rejects.toThrow();

      const admissionFixture: AdmissionForInput = {
        workingDirectory,
        plan: fixture.plan,
        declaration: fixture.plan.attempts[0]!,
      };
      const admissionInput = admissionFor(admissionFixture);
      await expect(admitDelegationAttempt(admissionInput)).rejects.toThrow(
        'already finalized',
      );
    } finally {
      await rm(workingDirectory, REMOVE_OPTIONS);
    }
  });

  test('retains every non-completed child terminal as barrier evidence', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'loom-aggregate-'));
    try {
      for (const kind of NONCOMPLETED_KINDS) {
        const fixtureInput: FixtureInput = {
          workingDirectory,
          runId: `terminal-${kind}`,
          leafKind: kind,
        };
        const fixture = await completeFixture(fixtureInput);
        const receipt = await finalizeDelegationRun(fixture.finalizationInput);
        expect(receipt.result.attempts[2]?.terminalKind).toBe(kind);
        expect(
          receipt.result.barrierEvidence[1]?.children[0]?.terminalKind,
        ).toBe(kind);
      }
    } finally {
      await rm(workingDirectory, REMOVE_OPTIONS);
    }
  });

  test('fails closed on missing terminal and mismatched barrier manifest', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'loom-aggregate-'));
    try {
      const plan = threeTierPlan('missing-terminal');
      const startInput: StartAndAdmitInput = { workingDirectory, plan };
      const runDirectory = await startAndAdmit(startInput);
      const recorded = new Map<string, RecordedAttempt>();
      const incompleteRequest: DelegationFinalizationRequest = {
        runId: plan.runId,
        sourceCommit: plan.sourceCommit,
        barrierEvidence: [],
      };
      const incompleteInput: FinalizeDelegationRunInput = {
        workingDirectory,
        request: incompleteRequest,
      };
      await expect(finalizeDelegationRun(incompleteInput)).rejects.toThrow(
        'requires every planned admission',
      );
      const expertRecord: RecordDeclarationInput = {
        runDirectory,
        plan,
        declaration: plan.attempts[1]!,
        terminalKind: TaskTerminalKind.Completed,
        recorded,
      };
      await recordDeclaration(expertRecord);
      await admitDepthThree(startInput);
      const rootRecord: RecordDeclarationInput = {
        runDirectory,
        plan,
        declaration: plan.attempts[0]!,
        terminalKind: TaskTerminalKind.Completed,
        recorded,
      };
      await recordDeclaration(rootRecord);
      await expect(finalizeDelegationRun(incompleteInput)).rejects.toThrow(
        'parent authorization failed',
      );

      const fixtureInput: FixtureInput = {
        workingDirectory,
        runId: 'mismatched-manifest',
        leafKind: TaskTerminalKind.Blocked,
      };
      const fixture = await completeFixture(fixtureInput);
      const barriers = fixture.finalizationInput.request.barrierEvidence;
      const expertBarrier = barriers[1];
      if (!expertBarrier) throw new Error('Expert barrier fixture is missing.');
      const child = expertBarrier.children[0];
      if (!child) throw new Error('Child barrier fixture is missing.');
      const forgedChild: DelegationChildTerminalEvidence = {
        ...child,
        resultSha256: 'f'.repeat(64),
      };
      const forgedBarrier: DelegationBarrierEvidence = {
        ...expertBarrier,
        children: [forgedChild],
      };
      const forgedRequest: DelegationFinalizationRequest = {
        ...fixture.finalizationInput.request,
        barrierEvidence: [barriers[0]!, forgedBarrier, barriers[2]!],
      };
      const forgedInput: FinalizeDelegationRunInput = {
        workingDirectory,
        request: forgedRequest,
      };
      await expect(finalizeDelegationRun(forgedInput)).rejects.toThrow(
        'does not match child projections',
      );
    } finally {
      await rm(workingDirectory, REMOVE_OPTIONS);
    }
  });

  test('rejects unplanned attempt storage without materializing closure', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'loom-aggregate-'));
    try {
      const fixtureInput: FixtureInput = {
        workingDirectory,
        runId: 'unplanned-evidence',
        leafKind: TaskTerminalKind.Cancelled,
      };
      const fixture = await completeFixture(fixtureInput);
      await mkdir(
        join(fixture.runDirectory, 'agents', 'unplanned', 'attempt-1'),
        RECURSIVE_DIRECTORY_OPTIONS,
      );
      await expect(
        finalizeDelegationRun(fixture.finalizationInput),
      ).rejects.toThrow('unplanned attempt evidence');
    } finally {
      await rm(workingDirectory, REMOVE_OPTIONS);
    }
  });

  test('never overwrites a conflicting run projection', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'loom-aggregate-'));
    try {
      const fixtureInput: FixtureInput = {
        workingDirectory,
        runId: 'conflicting-projection',
        leafKind: TaskTerminalKind.Skipped,
      };
      const fixture = await completeFixture(fixtureInput);
      await writeFile(
        join(fixture.runDirectory, 'view.md'),
        '# Conflicting view\n',
        'utf8',
      );
      await expect(
        finalizeDelegationRun(fixture.finalizationInput),
      ).rejects.toThrow('projection is not exact');
    } finally {
      await rm(workingDirectory, REMOVE_OPTIONS);
    }
  });

  test('removes stale temporary projections even when their PID is live', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'loom-aggregate-'));
    try {
      const fixtureInput: FixtureInput = {
        workingDirectory,
        runId: 'reused-temp-pid',
        leafKind: TaskTerminalKind.Blocked,
      };
      const fixture = await completeFixture(fixtureInput);
      const stalePath = join(
        fixture.runDirectory,
        `view.md.tmp-${process.pid}-${randomUUID()}`,
      );
      await writeFile(stalePath, '# Stale projection\n', 'utf8');

      const receipt = await finalizeDelegationRun(fixture.finalizationInput);

      await expect(stat(stalePath)).rejects.toThrow();
      expect(await readFile(receipt.viewPath, 'utf8')).toContain(
        '# Root aggregate',
      );
    } finally {
      await rm(workingDirectory, REMOVE_OPTIONS);
    }
  });

  test('recovers killed lock owners and their written temporary projections', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'loom-aggregate-'));
    const boundaries: readonly CrashBoundary[] = [
      CrashBoundary.LockHeld,
      CrashBoundary.TempWritten,
    ];
    try {
      for (const boundary of boundaries) {
        const fixtureInput: FixtureInput = {
          workingDirectory,
          runId: `crash-${boundary}`,
          leafKind: TaskTerminalKind.Failed,
        };
        const fixture = await completeFixture(fixtureInput);
        const crashInput: KillCrashHolderInput = {
          runDirectory: fixture.runDirectory,
          boundary,
        };
        await killCrashHolder(crashInput);
        if (boundary === CrashBoundary.LockHeld) {
          await proveConcurrentSuccessorSerialization(fixture.runDirectory);
          const admissionFixture: AdmissionForInput = {
            workingDirectory,
            plan: fixture.plan,
            declaration: fixture.plan.attempts[0]!,
          };
          await admitDelegationAttempt(admissionFor(admissionFixture));
        }
        const receipt = await finalizeDelegationRun(fixture.finalizationInput);
        expect(await readFile(receipt.viewPath, 'utf8')).toContain(
          '# Root aggregate',
        );
        const entries = await readdir(fixture.runDirectory);
        expect(entries.some((entry) => entry.includes('.tmp-'))).toBe(false);
        expect(
          (
            await stat(join(fixture.runDirectory, '.delegation.lock.sqlite'))
          ).isFile(),
        ).toBe(true);
      }
    } finally {
      await rm(workingDirectory, REMOVE_OPTIONS);
    }
  });

  test('rejects symlinked and oversized lifecycle databases without replacing them', async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'loom-lock-'));
    try {
      const runDirectory = join(workingDirectory, 'run');
      await mkdir(runDirectory);
      const lockPath = join(runDirectory, '.delegation.lock.sqlite');
      const linkedRunDirectory = join(workingDirectory, 'linked-run');
      await symlink(runDirectory, linkedRunDirectory);
      const linkedRunLockInput: DelegationLifecycleLockInput = {
        runDirectory: linkedRunDirectory,
      };
      await expect(
        acquireDelegationLifecycleLock(linkedRunLockInput),
      ).rejects.toThrow('run directory is unsafe');
      await expect(stat(lockPath)).rejects.toThrow();

      const targetPath = join(workingDirectory, 'external-lock.sqlite');
      const targetContent = 'external lock target\n';
      await writeFile(targetPath, targetContent, 'utf8');
      await symlink(targetPath, lockPath);
      const lockInput: DelegationLifecycleLockInput = { runDirectory };
      await expect(acquireDelegationLifecycleLock(lockInput)).rejects.toThrow(
        'lock acquisition failed',
      );
      expect(await readFile(targetPath, 'utf8')).toBe(targetContent);
      expect((await lstat(lockPath)).isSymbolicLink()).toBe(true);

      await rm(lockPath);
      const oversizedDatabase = 'x'.repeat(1025);
      await writeFile(lockPath, oversizedDatabase, 'utf8');
      await expect(acquireDelegationLifecycleLock(lockInput)).rejects.toThrow(
        'lock acquisition failed',
      );
      expect(await readFile(lockPath, 'utf8')).toBe(oversizedDatabase);
    } finally {
      await rm(workingDirectory, REMOVE_OPTIONS);
    }
  });
});

enum CrashBoundary {
  LockHeld = 'lock-held',
  TempWritten = 'temp-written',
}

type KillCrashHolderInput = {
  readonly runDirectory: string;
  readonly boundary: CrashBoundary;
};

async function killCrashHolder(input: KillCrashHolderInput): Promise<void> {
  const readyPath = join(input.runDirectory, `.crash-ready-${randomUUID()}`);
  const releasePath = join(
    input.runDirectory,
    `.crash-release-${randomUUID()}`,
  );
  const crashHolderPath = join(import.meta.dir, 'delegation-crash-holder.ts');
  const command = [
    process.execPath,
    crashHolderPath,
    input.runDirectory,
    readyPath,
    input.boundary,
    releasePath,
  ];
  const spawnOptions = { stdout: 'pipe', stderr: 'pipe' } as const;
  const child = Bun.spawn(command, spawnOptions);
  let ready = false;
  for (let attempt = 1; attempt <= 200; attempt += 1) {
    try {
      await readFile(readyPath, 'utf8');
      ready = true;
      break;
    } catch {
      await Bun.sleep(10);
    }
  }
  if (!ready) {
    child.kill(9);
    const stderr = await new Response(child.stderr).text();
    throw new Error(`Crash holder did not become ready: ${stderr}`);
  }
  child.kill(9);
  await child.exited;
  await rm(readyPath, REMOVE_OPTIONS);
}

type SuccessorPaths = {
  readonly readyPath: string;
  readonly releasePath: string;
};

type SuccessorReadiness = {
  readonly firstReadyPath: string;
  readonly secondReadyPath: string;
};

async function proveConcurrentSuccessorSerialization(
  runDirectory: string,
): Promise<void> {
  const firstPaths: SuccessorPaths = {
    readyPath: join(runDirectory, `.successor-ready-${randomUUID()}`),
    releasePath: join(runDirectory, `.successor-release-${randomUUID()}`),
  };
  const secondPaths: SuccessorPaths = {
    readyPath: join(runDirectory, `.successor-ready-${randomUUID()}`),
    releasePath: join(runDirectory, `.successor-release-${randomUUID()}`),
  };
  const crashHolderPath = join(import.meta.dir, 'delegation-crash-holder.ts');
  const firstCommand = [
    process.execPath,
    crashHolderPath,
    runDirectory,
    firstPaths.readyPath,
    CrashBoundary.LockHeld,
    firstPaths.releasePath,
  ];
  const secondCommand = [
    process.execPath,
    crashHolderPath,
    runDirectory,
    secondPaths.readyPath,
    CrashBoundary.LockHeld,
    secondPaths.releasePath,
  ];
  const spawnOptions = { stdout: 'pipe', stderr: 'pipe' } as const;
  const first = Bun.spawn(firstCommand, spawnOptions);
  const second = Bun.spawn(secondCommand, spawnOptions);
  try {
    const readiness: SuccessorReadiness = {
      firstReadyPath: firstPaths.readyPath,
      secondReadyPath: secondPaths.readyPath,
    };
    const firstEntered = await waitForSingleSuccessor(readiness);
    await Bun.sleep(100);
    expect(await readySuccessorCount(readiness)).toBe(1);

    const firstReleasePath = firstEntered
      ? firstPaths.releasePath
      : secondPaths.releasePath;
    const firstExit = firstEntered ? first.exited : second.exited;
    await writeFile(firstReleasePath, 'release\n', 'utf8');
    expect(await firstExit).toBe(0);

    const secondReadyPath = firstEntered
      ? secondPaths.readyPath
      : firstPaths.readyPath;
    const secondReleasePath = firstEntered
      ? secondPaths.releasePath
      : firstPaths.releasePath;
    const secondExit = firstEntered ? second.exited : first.exited;
    await waitForFilesystemPath(secondReadyPath);
    await writeFile(secondReleasePath, 'release\n', 'utf8');
    expect(await secondExit).toBe(0);
  } finally {
    try {
      first.kill(9);
    } catch {
      // The successor already exited after its explicit release.
    }
    try {
      second.kill(9);
    } catch {
      // The successor already exited after its explicit release.
    }
    await rm(firstPaths.readyPath, REMOVE_OPTIONS);
    await rm(firstPaths.releasePath, REMOVE_OPTIONS);
    await rm(secondPaths.readyPath, REMOVE_OPTIONS);
    await rm(secondPaths.releasePath, REMOVE_OPTIONS);
  }
}

async function waitForSingleSuccessor(
  input: SuccessorReadiness,
): Promise<boolean> {
  for (let attempt = 1; attempt <= 200; attempt += 1) {
    const firstReady = await filesystemPathExists(input.firstReadyPath);
    const secondReady = await filesystemPathExists(input.secondReadyPath);
    if (firstReady && secondReady) {
      throw new Error('Concurrent lifecycle successors both entered.');
    }
    if (firstReady || secondReady) return firstReady;
    await Bun.sleep(10);
  }
  throw new Error('No lifecycle successor acquired the recovered lock.');
}

async function readySuccessorCount(input: SuccessorReadiness): Promise<number> {
  const firstReady = await filesystemPathExists(input.firstReadyPath);
  const secondReady = await filesystemPathExists(input.secondReadyPath);
  return Number(firstReady) + Number(secondReady);
}

async function waitForFilesystemPath(path: string): Promise<void> {
  for (let attempt = 1; attempt <= 200; attempt += 1) {
    if (await filesystemPathExists(path)) return;
    await Bun.sleep(10);
  }
  throw new Error(`Expected lifecycle path was not written: ${path}`);
}

async function filesystemPathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

type FixtureInput = {
  readonly workingDirectory: string;
  readonly runId: string;
  readonly leafKind: TaskTerminalKind;
};

type CompleteFixture = {
  readonly plan: DelegationPlan;
  readonly runDirectory: string;
  readonly finalizationInput: FinalizeDelegationRunInput;
};

async function completeFixture(input: FixtureInput): Promise<CompleteFixture> {
  const plan = threeTierPlan(input.runId);
  const startInput: StartAndAdmitInput = {
    workingDirectory: input.workingDirectory,
    plan,
  };
  const runDirectory = await startAndAdmit(startInput);
  const recorded = new Map<string, RecordedAttempt>();
  const expertRecord: RecordDeclarationInput = {
    runDirectory,
    plan,
    declaration: plan.attempts[1]!,
    terminalKind: TaskTerminalKind.Completed,
    recorded,
  };
  await recordDeclaration(expertRecord);
  const admissionInput: StartAndAdmitInput = {
    workingDirectory: input.workingDirectory,
    plan,
  };
  await admitDepthThree(admissionInput);
  const leafRecord: RecordDeclarationInput = {
    runDirectory,
    plan,
    declaration: plan.attempts[2]!,
    terminalKind: input.leafKind,
    recorded,
  };
  await recordDeclaration(leafRecord);
  const rootRecord: RecordDeclarationInput = {
    runDirectory,
    plan,
    declaration: plan.attempts[0]!,
    terminalKind: TaskTerminalKind.Completed,
    recorded,
  };
  await recordDeclaration(rootRecord);
  const barrierInput: BarrierEvidenceInput = { plan, recorded };
  const request: DelegationFinalizationRequest = {
    runId: plan.runId,
    sourceCommit: plan.sourceCommit,
    barrierEvidence: barrierEvidence(barrierInput),
  };
  return {
    plan,
    runDirectory,
    finalizationInput: { workingDirectory: input.workingDirectory, request },
  };
}

type StartAndAdmitInput = {
  readonly workingDirectory: string;
  readonly plan: DelegationPlan;
};

async function startAndAdmit(input: StartAndAdmitInput): Promise<string> {
  const startInput: StartDelegationRunInput = {
    workingDirectory: input.workingDirectory,
    plan: input.plan,
  };
  const receipt = await startDelegationRun(startInput);
  for (const declaration of input.plan.attempts) {
    if (declaration.depth === 3) continue;
    const admissionInput: AdmissionForInput = {
      workingDirectory: input.workingDirectory,
      plan: input.plan,
      declaration,
    };
    const admission = admissionFor(admissionInput);
    await admitDelegationAttempt(admission);
  }
  return receipt.runDirectory;
}

async function admitDepthThree(input: StartAndAdmitInput): Promise<void> {
  const declaration = input.plan.attempts.find(
    (candidate) => candidate.depth === 3,
  );
  if (!declaration) throw new Error('Depth-three fixture is missing.');
  const admissionInput: AdmissionForInput = {
    workingDirectory: input.workingDirectory,
    plan: input.plan,
    declaration,
  };
  await admitDelegationAttempt(admissionFor(admissionInput));
}

type AdmissionForInput = StartAndAdmitInput & {
  readonly declaration: DelegationAttemptDeclaration;
};

function admissionFor(input: AdmissionForInput): AdmitDelegationAttemptInput {
  return {
    workingDirectory: input.workingDirectory,
    runId: input.plan.runId,
    request: {
      runId: input.plan.runId,
      sourceCommit: input.plan.sourceCommit,
      identity: input.declaration.identity,
      depth: input.declaration.depth,
      parent: input.declaration.parent,
    },
  };
}

type RecordedAttempt = {
  readonly terminalKind: TaskTerminalKind;
  readonly processing: AgentAttemptProcessingReference;
};

type RecordDeclarationInput = {
  readonly runDirectory: string;
  readonly plan: DelegationPlan;
  readonly declaration: DelegationAttemptDeclaration;
  readonly terminalKind: TaskTerminalKind;
  readonly recorded: Map<string, RecordedAttempt>;
};

async function recordDeclaration(input: RecordDeclarationInput): Promise<void> {
  const configuration: AgentAttemptJournalConfiguration = {
    adapter: AgentAttemptAdapterKind.GenericDelegationRecorder,
    runDirectory: input.runDirectory,
    runId: input.plan.runId,
    workflow: DelegatedAgentWorkflowName.AgentWork,
    workflowVersion: CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION,
    sourceCommit: input.plan.sourceCommit,
    task: input.declaration.identity.task,
    agent: input.declaration.identity.agent,
    attempt: input.declaration.identity.attempt,
    depth: input.declaration.depth,
    parent: input.declaration.parent,
    now: () => '2026-08-26T00:00:00.000Z',
  };
  const journal = new AgentAttemptJournal<string>(configuration);
  await journal.initialize();
  const terminal = terminalFor(input);
  const processing = await journal.finalize(terminal);
  const recordedAttempt: RecordedAttempt = {
    terminalKind: input.terminalKind,
    processing,
  };
  input.recorded.set(
    delegationAttemptIdentityKey(input.declaration.identity),
    recordedAttempt,
  );
}

function terminalFor(input: RecordDeclarationInput): TaskTerminal<string> {
  const identity = input.declaration.identity;
  if (input.terminalKind !== TaskTerminalKind.Completed) {
    return {
      kind: input.terminalKind,
      task: identity.task,
      attempt: identity.attempt,
      summary: `${input.terminalKind} evidence retained.`,
    };
  }
  const root = input.declaration.depth === 1;
  return {
    kind: TaskTerminalKind.Completed,
    task: identity.task,
    attempt: identity.attempt,
    threadId: `thread-${identity.task}`,
    output: {
      resultKind: WorkflowResultKind.CortexEvidence,
      summary: root ? 'Root aggregate complete.' : 'Parent evidence complete.',
      materializedViewMarkdown: root
        ? '# Root aggregate\n\nAll child evidence reconciled.'
        : `# ${identity.task}\n\nEvidence complete.`,
      findings: [],
      notesForParent: [],
      artifacts: [],
    },
  };
}

type BarrierEvidenceInput = {
  readonly plan: DelegationPlan;
  readonly recorded: ReadonlyMap<string, RecordedAttempt>;
};

function barrierEvidence(
  input: BarrierEvidenceInput,
): readonly DelegationBarrierEvidence[] {
  return input.plan.attempts.map((declaration) => ({
    parent: declaration.identity,
    children: declaration.terminalBarrier.attempts.map((identity) => {
      const recorded = input.recorded.get(
        delegationAttemptIdentityKey(identity),
      );
      if (
        !recorded ||
        recorded.processing.view.presence !== MaterializedViewPresence.Recorded
      ) {
        throw new Error('Recorded child evidence is missing.');
      }
      return {
        identity,
        terminalKind: recorded.terminalKind,
        resultSha256: recorded.processing.result.sha256,
        viewSha256: recorded.processing.view.projection.sha256,
      };
    }),
  }));
}

function threeTierPlan(runId: string): DelegationPlan {
  const rootIdentity = { task: 'root', agent: 'root-agent', attempt: 1 };
  const expertIdentity = { task: 'expert', agent: 'expert-agent', attempt: 1 };
  const leafIdentity = { task: 'leaf', agent: 'leaf-agent', attempt: 1 };
  const root: DelegationAttemptDeclaration = {
    identity: rootIdentity,
    depth: 1,
    parent: { kind: AgentAttemptParentKind.WorkflowRoot },
    terminalBarrier: {
      policy: DelegationBarrierPolicy.AllTerminal,
      attempts: [expertIdentity],
    },
  };
  const expert: DelegationAttemptDeclaration = {
    identity: expertIdentity,
    depth: 2,
    parent: { kind: AgentAttemptParentKind.AgentAttempt, ...rootIdentity },
    terminalBarrier: {
      policy: DelegationBarrierPolicy.AllTerminal,
      attempts: [leafIdentity],
    },
  };
  const leaf: DelegationAttemptDeclaration = {
    identity: leafIdentity,
    depth: 3,
    parent: { kind: AgentAttemptParentKind.AgentAttempt, ...expertIdentity },
    terminalBarrier: {
      policy: DelegationBarrierPolicy.AllTerminal,
      attempts: [],
    },
  };
  return {
    schemaVersion: DELEGATION_PLAN_SCHEMA_VERSION,
    workflow: DelegatedAgentWorkflowName.AgentWork,
    runId,
    sourceCommit: SOURCE_COMMIT,
    rootMaterializer: rootIdentity,
    attempts: [root, expert, leaf],
  };
}
