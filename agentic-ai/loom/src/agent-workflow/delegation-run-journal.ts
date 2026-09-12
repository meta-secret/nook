import { realpathSync } from 'node:fs';
import { Database, constants as sqliteConstants } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import {
  appendFile,
  lstat,
  mkdir,
  realpath,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { VerifiedAttemptArtifacts } from './attempt-verification.ts';
import type {
  ReadParentAttemptArgs,
  ReadVerifiedProjectionArgs,
} from './attempt-verification.ts';
import { CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION } from './agent-attempt-version.ts';
import {
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
} from './domain.ts';

import {
  DelegationRunEventKind,
  DelegationPlanContract,
} from './delegation-domain.ts';
import type {
  DelegationAttemptAdmittedEvent,
  DelegationAdmissionRequest,
  DelegationAttemptDeclaration,
  DelegationAttemptIdentity,
  DelegationIdentityPair,
  DelegationPlan,
  DelegationPlanDeclaredEvent,
  DelegationRunEvent,
} from './delegation-domain.ts';
import { DelegationJournalSchema } from './delegation-codec.ts';

const RECURSIVE_DIRECTORY_OPTIONS: { readonly recursive: true } = {
  recursive: true,
};
const EXCLUSIVE_UTF8_WRITE_OPTIONS: {
  readonly encoding: 'utf8';
  readonly flag: 'wx';
} = { encoding: 'utf8', flag: 'wx' };
const MAX_DELEGATION_PLAN_BYTES = 262_144;
const MAX_DELEGATION_EVENTS_BYTES = 1_048_576;
const LIFECYCLE_LOCK_BUSY_TIMEOUT_MILLISECONDS = 30_000;
const LIFECYCLE_LOCK_OPEN_FLAGS =
  sqliteConstants.SQLITE_OPEN_READWRITE |
  sqliteConstants.SQLITE_OPEN_CREATE |
  sqliteConstants.SQLITE_OPEN_NOFOLLOW |
  sqliteConstants.SQLITE_OPEN_FULLMUTEX;

/** Owns the delegation run journal registry and its capability transitions. */
export class DelegationRunJournal {
  private constructor() {}
  private static readonly localLifecycleLockTails = new Map<
    string,
    Promise<void>
  >();

  static async startDelegationRun(
    input: StartDelegationRunInput,
  ): Promise<DelegationRunReceipt> {
    DelegationPlanContract.validateDelegationPlan(input.plan);
    const directoryInput: DelegationRunDirectoryInput = {
      workingDirectory: input.workingDirectory,
      runId: input.plan.runId,
    };
    const runDirectory =
      DelegationRunJournal.delegationRunDirectory(directoryInput);
    await mkdir(dirname(runDirectory), RECURSIVE_DIRECTORY_OPTIONS);
    await mkdir(runDirectory);

    const planPath = join(runDirectory, 'plan.json');
    const eventsPath = join(runDirectory, 'events.jsonl');
    const planSerialized = `${JSON.stringify(input.plan)}\n`;
    const planSha256 = DelegationRunJournal.sha256(planSerialized);
    const planWrite: AtomicWrite = { path: planPath, content: planSerialized };
    await DelegationRunJournal.atomicWrite(planWrite);

    const event: DelegationPlanDeclaredEvent = {
      kind: DelegationRunEventKind.PlanDeclared,
      runId: input.plan.runId,
      sourceCommit: input.plan.sourceCommit,
      planSha256,
      sequence: 1,
      occurredAt: new Date().toISOString(),
      attemptCount: input.plan.attempts.length,
      rootMaterializer: input.plan.rootMaterializer,
    };
    await writeFile(
      eventsPath,
      DelegationRunJournal.serializeEvent(event),
      EXCLUSIVE_UTF8_WRITE_OPTIONS,
    );
    return { runDirectory, planPath, eventsPath, planSha256 };
  }

  static async loadDelegationPlan(
    input: LoadDelegationPlanInput,
  ): Promise<LoadedDelegationPlan> {
    DelegationRunJournal.assertFilesystemIdentifier(input.runId);
    const runDirectory = DelegationRunJournal.delegationRunDirectory(input);
    const planPath = join(runDirectory, 'plan.json');
    const eventsPath = join(runDirectory, 'events.jsonl');
    const planRead: ReadVerifiedProjectionArgs = {
      runDirectory,
      path: planPath,
      maxBytes: MAX_DELEGATION_PLAN_BYTES,
    };
    const serialized =
      await VerifiedAttemptArtifacts.readVerifiedProjection(planRead);
    const plan = DelegationJournalSchema.decodeDelegationPlan(serialized);
    if (plan.runId !== input.runId) {
      throw new Error(
        'Delegation plan run identity does not match its storage path.',
      );
    }
    const planSha256 = DelegationRunJournal.sha256(serialized);
    const eventInput: ReadVerifiedEventsInput = {
      eventsPath,
      plan,
      planSha256,
    };
    const events = await DelegationRunJournal.readVerifiedEvents(eventInput);
    const declaration = events[0];
    if (
      !declaration ||
      declaration.kind !== DelegationRunEventKind.PlanDeclared
    ) {
      throw new Error('Delegation run is missing its plan declaration event.');
    }
    const identityPair: DelegationIdentityPair = {
      first: declaration.rootMaterializer,
      second: plan.rootMaterializer,
    };
    if (
      declaration.attemptCount !== plan.attempts.length ||
      !DelegationPlanContract.delegationAttemptIdentitiesEqual(identityPair)
    ) {
      throw new Error('Delegation plan declaration does not match plan.json.');
    }
    return { runDirectory, planPath, eventsPath, planSha256, plan };
  }

  static async admitDelegationAttempt(
    input: AdmitDelegationAttemptInput,
  ): Promise<DelegationAdmissionReceipt> {
    const runDirectory = DelegationRunJournal.delegationRunDirectory(input);
    const lockInput: DelegationLifecycleLockInput = { runDirectory };
    const lease =
      await DelegationRunJournal.acquireDelegationLifecycleLock(lockInput);
    try {
      lease.assertHeld(runDirectory);
      return await DelegationRunJournal.admitWhileLocked(input);
    } finally {
      await lease.release();
    }
  }

  static async acquireDelegationLifecycleLock(
    input: DelegationLifecycleLockInput,
  ): Promise<DelegationLifecycleLease> {
    return DelegationLifecycleLease.acquire({
      key: LIFECYCLE_TRANSITION,
      input,
      requestLocal: (lockPath) =>
        DelegationRunJournal.acquireLocalLifecycleLock(lockPath),
    });
  }

  private static async acquireLocalLifecycleLock(
    lockPath: string,
  ): Promise<LocalLifecycleLease> {
    const [predecessor = Promise.resolve()] = [
      DelegationRunJournal.localLifecycleLockTails.get(lockPath),
    ];
    let releaseSignal = (): void => {
      throw new Error('Delegation local lifecycle lease was not initialized.');
    };
    const completion = new Promise<void>((resolve) => {
      releaseSignal = resolve;
    });
    const tail = predecessor.then(() => completion);
    DelegationRunJournal.localLifecycleLockTails.set(lockPath, tail);
    await predecessor;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      releaseSignal();
      if (DelegationRunJournal.localLifecycleLockTails.get(lockPath) === tail) {
        DelegationRunJournal.localLifecycleLockTails.delete(lockPath);
      }
    };
    return { release };
  }

  static async loadDelegationRunState(
    input: LoadDelegationPlanInput,
  ): Promise<LoadedDelegationRunState> {
    const loaded = await DelegationRunJournal.loadDelegationPlan(input);
    const eventInput: ReadVerifiedEventsInput = {
      eventsPath: loaded.eventsPath,
      plan: loaded.plan,
      planSha256: loaded.planSha256,
    };
    const events = await DelegationRunJournal.readVerifiedEvents(eventInput);
    return { ...loaded, events };
  }

  static async requireDelegationAttemptAdmission(
    input: AdmitDelegationAttemptInput,
  ): Promise<DelegationAdmissionReceipt> {
    const loaded = await DelegationRunJournal.loadDelegationPlan(input);
    await DelegationRunJournal.assertRunNotFinalized(loaded.runDirectory);
    const eventInput: ReadVerifiedEventsInput = {
      eventsPath: loaded.eventsPath,
      plan: loaded.plan,
      planSha256: loaded.planSha256,
    };
    const events = await DelegationRunJournal.readVerifiedEvents(eventInput);
    const declarationInput: FindDeclarationInput = {
      plan: loaded.plan,
      identity: input.request.identity,
    };
    const declaration = DelegationRunJournal.findDeclaration(declarationInput);
    const admissionBinding: AdmissionRequestBinding = {
      request: input.request,
      declaration,
      runId: loaded.plan.runId,
      sourceCommit: loaded.plan.sourceCommit,
    };
    DelegationRunJournal.assertAdmissionRequest(admissionBinding);
    const identityKey = DelegationPlanContract.delegationAttemptIdentityKey(
      declaration.identity,
    );
    const existingAdmissionInput: ExistingAdmissionEventInput = {
      events,
      identityKey,
    };
    const event = DelegationRunJournal.existingAdmissionEvent(
      existingAdmissionInput,
    );
    return {
      event,
      declaration,
      eventsPath: loaded.eventsPath,
      planSha256: loaded.planSha256,
    };
  }

  private static async admitWhileLocked(
    input: AdmitDelegationAttemptInput,
  ): Promise<DelegationAdmissionReceipt> {
    const loaded = await DelegationRunJournal.loadDelegationPlan(input);
    await DelegationRunJournal.assertRunNotFinalized(loaded.runDirectory);
    const eventInput: ReadVerifiedEventsInput = {
      eventsPath: loaded.eventsPath,
      plan: loaded.plan,
      planSha256: loaded.planSha256,
    };
    const events = await DelegationRunJournal.readVerifiedEvents(eventInput);
    const declarationInput: FindDeclarationInput = {
      plan: loaded.plan,
      identity: input.request.identity,
    };
    const declaration = DelegationRunJournal.findDeclaration(declarationInput);
    const admissionBinding: AdmissionRequestBinding = {
      request: input.request,
      declaration,
      runId: loaded.plan.runId,
      sourceCommit: loaded.plan.sourceCommit,
    };
    DelegationRunJournal.assertAdmissionRequest(admissionBinding);
    const admitted = DelegationRunJournal.admittedIdentityKeys(events);
    const identityKey = DelegationPlanContract.delegationAttemptIdentityKey(
      declaration.identity,
    );
    if (admitted.has(identityKey)) {
      const existingAdmissionInput: ExistingAdmissionEventInput = {
        events,
        identityKey,
      };
      const event = DelegationRunJournal.existingAdmissionEvent(
        existingAdmissionInput,
      );
      return {
        event,
        declaration,
        eventsPath: loaded.eventsPath,
        planSha256: loaded.planSha256,
      };
    }
    if (declaration.parent.kind === AgentAttemptParentKind.AgentAttempt) {
      const parentKey = DelegationPlanContract.delegationAttemptIdentityKey(
        declaration.parent,
      );
      if (!admitted.has(parentKey)) {
        throw new Error(
          `Delegation parent must be admitted first: ${parentKey}`,
        );
      }
    }
    if (
      declaration.depth === 3 &&
      declaration.parent.kind === AgentAttemptParentKind.AgentAttempt
    ) {
      const parentVerification: ReadParentAttemptArgs = {
        runDirectory: loaded.runDirectory,
        runId: loaded.plan.runId,
        workflowVersion: CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION,
        sourceCommit: loaded.plan.sourceCommit,
        identity: {
          task: declaration.parent.task,
          agent: declaration.parent.agent,
          attempt: declaration.parent.attempt,
          depth: 2,
        },
      };
      await VerifiedAttemptArtifacts.readVerifiedParentAttempt(
        parentVerification,
      );
    }

    const event: DelegationAttemptAdmittedEvent = {
      kind: DelegationRunEventKind.AttemptAdmitted,
      runId: loaded.plan.runId,
      sourceCommit: loaded.plan.sourceCommit,
      planSha256: loaded.planSha256,
      sequence: events.length + 1,
      occurredAt: new Date().toISOString(),
      declaration,
    };
    await appendFile(
      loaded.eventsPath,
      DelegationRunJournal.serializeEvent(event),
      'utf8',
    );
    return {
      event,
      declaration,
      eventsPath: loaded.eventsPath,
      planSha256: loaded.planSha256,
    };
  }

  private static async assertRunNotFinalized(
    runDirectory: string,
  ): Promise<void> {
    const resultPath = join(runDirectory, 'run-result.json');
    const viewPath = join(runDirectory, 'view.md');
    const finalized =
      (await DelegationRunJournal.filesystemPathExists(resultPath)) ||
      (await DelegationRunJournal.filesystemPathExists(viewPath));
    if (finalized) {
      throw new Error('Delegation run is already finalized.');
    }
  }

  private static async filesystemPathExists(path: string): Promise<boolean> {
    try {
      await lstat(path);
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return false;
      }
      throw error;
    }
  }

  private static async unlinkIfPresent(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !DelegationRunJournal.isMissingPathError(error)
      )
        throw error;
    }
  }

  private static isMissingPathError(error: Error): boolean {
    return 'code' in error && error.code === 'ENOENT';
  }

  private static existingAdmissionEvent(
    input: ExistingAdmissionEventInput,
  ): DelegationAttemptAdmittedEvent {
    const event = input.events.find(
      (candidate) =>
        candidate.kind === DelegationRunEventKind.AttemptAdmitted &&
        DelegationPlanContract.delegationAttemptIdentityKey(
          candidate.declaration.identity,
        ) === input.identityKey,
    );
    if (!event || event.kind !== DelegationRunEventKind.AttemptAdmitted) {
      throw new Error(
        'Delegation attempt has not been admitted before dispatch.',
      );
    }
    return event;
  }

  private static assertAdmissionRequest(
    binding: AdmissionRequestBinding,
  ): void {
    const identityPair: DelegationIdentityPair = {
      first: binding.request.identity,
      second: binding.declaration.identity,
    };
    if (
      !DelegationPlanContract.delegationAttemptIdentitiesEqual(identityPair) ||
      binding.request.runId !== binding.runId ||
      binding.request.sourceCommit !== binding.sourceCommit ||
      binding.request.depth !== binding.declaration.depth ||
      JSON.stringify(binding.request.parent) !==
        JSON.stringify(binding.declaration.parent)
    ) {
      throw new Error(
        'Delegation admission request does not match the immutable plan declaration.',
      );
    }
  }

  private static delegationRunDirectory(
    input: DelegationRunDirectoryInput,
  ): string {
    DelegationRunJournal.assertFilesystemIdentifier(input.runId);
    return join(
      input.workingDirectory,
      'workflow',
      'processing',
      DelegatedAgentWorkflowName.AgentWork,
      input.runId,
    );
  }

  private static async readVerifiedEvents(
    input: ReadVerifiedEventsInput,
  ): Promise<readonly DelegationRunEvent[]> {
    const eventsRead: ReadVerifiedProjectionArgs = {
      runDirectory: dirname(input.eventsPath),
      path: input.eventsPath,
      maxBytes: MAX_DELEGATION_EVENTS_BYTES,
    };
    const serialized =
      await VerifiedAttemptArtifacts.readVerifiedProjection(eventsRead);
    if (!serialized.endsWith('\n')) {
      throw new Error('Delegation run event stream must end with one newline.');
    }
    const lines = serialized.slice(0, -1).split('\n');
    if (lines.length < 1 || lines.some((line) => line.length === 0)) {
      throw new Error('Delegation run event stream is empty or noncanonical.');
    }
    const events: DelegationRunEvent[] = [];
    for (const [index, line] of lines.entries()) {
      const event = DelegationJournalSchema.decodeDelegationRunEvent(line);
      const bindingInput: AssertEventBindingInput = {
        event,
        plan: input.plan,
        planSha256: input.planSha256,
        expectedSequence: index + 1,
      };
      DelegationRunJournal.assertEventBinding(bindingInput);
      if (index === 0 && event.kind !== DelegationRunEventKind.PlanDeclared) {
        throw new Error('Delegation run must begin with a plan declaration.');
      }
      if (index > 0 && event.kind !== DelegationRunEventKind.AttemptAdmitted) {
        throw new Error('Delegation plan may be declared only once.');
      }
      if (event.kind === DelegationRunEventKind.AttemptAdmitted) {
        const declarationInput: FindDeclarationInput = {
          plan: input.plan,
          identity: event.declaration.identity,
        };
        const declaration =
          DelegationRunJournal.findDeclaration(declarationInput);
        if (JSON.stringify(declaration) !== JSON.stringify(event.declaration)) {
          throw new Error(
            'Delegation admission event differs from the immutable plan.',
          );
        }
      }
      events.push(event);
    }
    return events;
  }

  private static assertEventBinding(input: AssertEventBindingInput): void {
    if (
      input.event.runId !== input.plan.runId ||
      input.event.sourceCommit !== input.plan.sourceCommit ||
      input.event.planSha256 !== input.planSha256 ||
      input.event.sequence !== input.expectedSequence ||
      !/^[0-9a-f]{64}$/.test(input.event.planSha256) ||
      Number.isNaN(Date.parse(input.event.occurredAt))
    ) {
      throw new Error('Delegation run event identity or sequence is invalid.');
    }
  }

  private static findDeclaration(
    input: FindDeclarationInput,
  ): DelegationAttemptDeclaration {
    const declaration = input.plan.attempts.find((candidate) => {
      const identityPair: DelegationIdentityPair = {
        first: candidate.identity,
        second: input.identity,
      };
      return DelegationPlanContract.delegationAttemptIdentitiesEqual(
        identityPair,
      );
    });
    if (!declaration) {
      throw new Error(
        `Delegation attempt is not predeclared: ${DelegationPlanContract.delegationAttemptIdentityKey(input.identity)}`,
      );
    }
    return declaration;
  }

  private static admittedIdentityKeys(
    events: readonly DelegationRunEvent[],
  ): ReadonlySet<string> {
    const keys = new Set<string>();
    for (const event of events) {
      if (event.kind === DelegationRunEventKind.AttemptAdmitted) {
        const key = DelegationPlanContract.delegationAttemptIdentityKey(
          event.declaration.identity,
        );
        if (keys.has(key)) {
          throw new Error(
            `Delegation event stream repeats an admission: ${key}`,
          );
        }
        keys.add(key);
      }
    }
    return keys;
  }

  private static async atomicWrite(write: AtomicWrite): Promise<void> {
    const temporaryPath = `${write.path}.tmp`;
    await writeFile(temporaryPath, write.content, 'utf8');
    await rename(temporaryPath, write.path);
  }

  private static serializeEvent(event: DelegationRunEvent): string {
    return `${JSON.stringify(event)}\n`;
  }

  private static sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private static assertFilesystemIdentifier(identifier: string): void {
    if (
      identifier.length > 128 ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(identifier)
    ) {
      throw new Error(`Unsafe delegation identifier: ${identifier}`);
    }
  }
}

export type StartDelegationRunInput = {
  readonly workingDirectory: string;
  readonly plan: DelegationPlan;
};

export type DelegationRunReceipt = {
  readonly runDirectory: string;
  readonly planPath: string;
  readonly eventsPath: string;
  readonly planSha256: string;
};

export type LoadDelegationPlanInput = {
  readonly workingDirectory: string;
  readonly runId: string;
};

export type LoadedDelegationPlan = DelegationRunReceipt & {
  readonly plan: DelegationPlan;
};

export type LoadedDelegationRunState = LoadedDelegationPlan & {
  readonly events: readonly DelegationRunEvent[];
};

export type AdmitDelegationAttemptInput = LoadDelegationPlanInput & {
  readonly request: DelegationAdmissionRequest;
};

export type DelegationAdmissionReceipt = {
  readonly event: DelegationAttemptAdmittedEvent;
  readonly declaration: DelegationAttemptDeclaration;
  readonly eventsPath: string;
  readonly planSha256: string;
};

export type DelegationLifecycleLockInput = {
  readonly runDirectory: string;
};

const LIFECYCLE_TRANSITION = Symbol('delegation-lifecycle-transition');
enum DelegationLockPhase {
  Held = 'held',
  Released = 'released',
}
type DelegationLockResources = {
  readonly lockPath: string;
  readonly database: Database;
  readonly releaseLocal: () => void;
};
type AcquireDelegationLock = {
  readonly key: typeof LIFECYCLE_TRANSITION;
  readonly input: DelegationLifecycleLockInput;
  readonly requestLocal: (path: string) => Promise<LocalLifecycleLease>;
};
export class DelegationLifecycleLease {
  private phase = DelegationLockPhase.Held;
  private constructor(private readonly resources: DelegationLockResources) {}
  static async acquire(
    request: AcquireDelegationLock,
  ): Promise<DelegationLifecycleLease> {
    if (request.key !== LIFECYCLE_TRANSITION)
      throw new Error('Invalid delegation lock transition.');
    const { input, requestLocal } = request;
    const runDirectoryStatus = await lstat(input.runDirectory);
    if (
      runDirectoryStatus.isSymbolicLink() ||
      !runDirectoryStatus.isDirectory()
    ) {
      throw new Error('Delegation lifecycle run directory is unsafe.');
    }
    const canonicalRunDirectory = await realpath(input.runDirectory);
    const lockPath = resolve(canonicalRunDirectory, '.delegation.lock.sqlite');
    const localLease = await requestLocal(lockPath);
    let database: Database | false = false;
    try {
      database = new Database(lockPath, LIFECYCLE_LOCK_OPEN_FLAGS);
      database.exec(
        `PRAGMA busy_timeout = ${LIFECYCLE_LOCK_BUSY_TIMEOUT_MILLISECONDS};`,
      );
      database.exec('BEGIN EXCLUSIVE;');
      return new DelegationLifecycleLease({
        lockPath,
        database,
        releaseLocal: localLease.release,
      });
    } catch {
      try {
        if (database !== false) database.close(false);
      } finally {
        localLease.release();
      }
      throw new Error('Delegation lifecycle lock acquisition failed.');
    }
  }
  assertHeld(runDirectory: string): void {
    if (
      this.phase !== DelegationLockPhase.Held ||
      resolve(realpathSync(runDirectory), '.delegation.lock.sqlite') !==
        this.resources.lockPath
    )
      throw new Error('Delegation lifecycle lock is not held for this run.');
  }
  async release(): Promise<void> {
    if (this.phase !== DelegationLockPhase.Held)
      throw new Error('Delegation lifecycle lock has already been released.');
    this.phase = DelegationLockPhase.Released;
    try {
      this.resources.database.exec('ROLLBACK;');
    } finally {
      try {
        this.resources.database.close(false);
      } finally {
        this.resources.releaseLocal();
      }
    }
  }
}

type LocalLifecycleLease = {
  readonly release: () => void;
};

type ExistingAdmissionEventInput = {
  readonly events: readonly DelegationRunEvent[];
  readonly identityKey: string;
};

type AdmissionRequestBinding = {
  readonly request: DelegationAdmissionRequest;
  readonly declaration: DelegationAttemptDeclaration;
  readonly runId: string;
  readonly sourceCommit: string;
};

type DelegationRunDirectoryInput = {
  readonly workingDirectory: string;
  readonly runId: string;
};

type ReadVerifiedEventsInput = {
  readonly eventsPath: string;
  readonly plan: DelegationPlan;
  readonly planSha256: string;
};

type AssertEventBindingInput = {
  readonly event: DelegationRunEvent;
  readonly plan: DelegationPlan;
  readonly planSha256: string;
  readonly expectedSequence: number;
};

type FindDeclarationInput = {
  readonly plan: DelegationPlan;
  readonly identity: DelegationAttemptIdentity;
};

type AtomicWrite = {
  readonly path: string;
  readonly content: string;
};
