import { createHash } from 'node:crypto';
import { appendFile, mkdir, rename, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  readVerifiedParentAttempt,
  readVerifiedProjection,
} from './attempt-verification.ts';
import type {
  ReadParentAttemptArgs,
  ReadVerifiedProjectionArgs,
} from './attempt-verification.ts';
import { CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION } from './agent-attempt-version.ts';
import {
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
} from './domain.ts';
import type { AgentAttemptParent } from './domain.ts';
import {
  DelegationRunEventKind,
  delegationAttemptIdentitiesEqual,
  delegationAttemptIdentityKey,
  validateDelegationPlan,
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
import {
  decodeDelegationPlan,
  decodeDelegationRunEvent,
} from './delegation-codec.ts';

const RECURSIVE_DIRECTORY_OPTIONS: { readonly recursive: true } = {
  recursive: true,
};
const EXCLUSIVE_UTF8_WRITE_OPTIONS: {
  readonly encoding: 'utf8';
  readonly flag: 'wx';
} = { encoding: 'utf8', flag: 'wx' };
const MAX_DELEGATION_PLAN_BYTES = 262_144;
const MAX_DELEGATION_EVENTS_BYTES = 1_048_576;

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

export type AdmitDelegationAttemptInput = LoadDelegationPlanInput & {
  readonly request: DelegationAdmissionRequest;
};

export type DelegationAdmissionReceipt = {
  readonly event: DelegationAttemptAdmittedEvent;
  readonly declaration: DelegationAttemptDeclaration;
  readonly eventsPath: string;
  readonly planSha256: string;
};

export async function startDelegationRun(
  input: StartDelegationRunInput,
): Promise<DelegationRunReceipt> {
  validateDelegationPlan(input.plan);
  const directoryInput: DelegationRunDirectoryInput = {
    workingDirectory: input.workingDirectory,
    runId: input.plan.runId,
  };
  const runDirectory = delegationRunDirectory(directoryInput);
  await mkdir(dirname(runDirectory), RECURSIVE_DIRECTORY_OPTIONS);
  await mkdir(runDirectory);

  const planPath = join(runDirectory, 'plan.json');
  const eventsPath = join(runDirectory, 'events.jsonl');
  const planSerialized = `${JSON.stringify(input.plan)}\n`;
  const planSha256 = sha256(planSerialized);
  const planWrite: AtomicWrite = { path: planPath, content: planSerialized };
  await atomicWrite(planWrite);

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
    serializeEvent(event),
    EXCLUSIVE_UTF8_WRITE_OPTIONS,
  );
  return { runDirectory, planPath, eventsPath, planSha256 };
}

export async function loadDelegationPlan(
  input: LoadDelegationPlanInput,
): Promise<LoadedDelegationPlan> {
  assertFilesystemIdentifier(input.runId);
  const runDirectory = delegationRunDirectory(input);
  const planPath = join(runDirectory, 'plan.json');
  const eventsPath = join(runDirectory, 'events.jsonl');
  const planRead: ReadVerifiedProjectionArgs = {
    runDirectory,
    path: planPath,
    maxBytes: MAX_DELEGATION_PLAN_BYTES,
  };
  const serialized = await readVerifiedProjection(planRead);
  const plan = decodeDelegationPlan(serialized);
  if (plan.runId !== input.runId) {
    throw new Error(
      'Delegation plan run identity does not match its storage path.',
    );
  }
  const planSha256 = sha256(serialized);
  const eventInput: ReadVerifiedEventsInput = { eventsPath, plan, planSha256 };
  const events = await readVerifiedEvents(eventInput);
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
    !delegationAttemptIdentitiesEqual(identityPair)
  ) {
    throw new Error('Delegation plan declaration does not match plan.json.');
  }
  return { runDirectory, planPath, eventsPath, planSha256, plan };
}

export async function admitDelegationAttempt(
  input: AdmitDelegationAttemptInput,
): Promise<DelegationAdmissionReceipt> {
  const runDirectory = delegationRunDirectory(input);
  const lockPath = join(runDirectory, '.admission.lock');
  await mkdir(lockPath);
  try {
    return await admitWhileLocked(input);
  } finally {
    await rmdir(lockPath);
  }
}

export async function requireDelegationAttemptAdmission(
  input: AdmitDelegationAttemptInput,
): Promise<DelegationAdmissionReceipt> {
  const loaded = await loadDelegationPlan(input);
  const eventInput: ReadVerifiedEventsInput = {
    eventsPath: loaded.eventsPath,
    plan: loaded.plan,
    planSha256: loaded.planSha256,
  };
  const events = await readVerifiedEvents(eventInput);
  const declarationInput: FindDeclarationInput = {
    plan: loaded.plan,
    identity: input.request.identity,
  };
  const declaration = findDeclaration(declarationInput);
  const admissionBinding: AdmissionRequestBinding = {
    request: input.request,
    declaration,
    runId: loaded.plan.runId,
    sourceCommit: loaded.plan.sourceCommit,
  };
  assertAdmissionRequest(admissionBinding);
  const identityKey = delegationAttemptIdentityKey(declaration.identity);
  const existingAdmissionInput: ExistingAdmissionEventInput = {
    events,
    identityKey,
  };
  const event = existingAdmissionEvent(existingAdmissionInput);
  return {
    event,
    declaration,
    eventsPath: loaded.eventsPath,
    planSha256: loaded.planSha256,
  };
}

async function admitWhileLocked(
  input: AdmitDelegationAttemptInput,
): Promise<DelegationAdmissionReceipt> {
  const loaded = await loadDelegationPlan(input);
  const eventInput: ReadVerifiedEventsInput = {
    eventsPath: loaded.eventsPath,
    plan: loaded.plan,
    planSha256: loaded.planSha256,
  };
  const events = await readVerifiedEvents(eventInput);
  const declarationInput: FindDeclarationInput = {
    plan: loaded.plan,
    identity: input.request.identity,
  };
  const declaration = findDeclaration(declarationInput);
  const admissionBinding: AdmissionRequestBinding = {
    request: input.request,
    declaration,
    runId: loaded.plan.runId,
    sourceCommit: loaded.plan.sourceCommit,
  };
  assertAdmissionRequest(admissionBinding);
  const admitted = admittedIdentityKeys(events);
  const identityKey = delegationAttemptIdentityKey(declaration.identity);
  if (admitted.has(identityKey)) {
    const existingAdmissionInput: ExistingAdmissionEventInput = {
      events,
      identityKey,
    };
    const event = existingAdmissionEvent(existingAdmissionInput);
    return {
      event,
      declaration,
      eventsPath: loaded.eventsPath,
      planSha256: loaded.planSha256,
    };
  }
  if (declaration.parent.kind === AgentAttemptParentKind.AgentAttempt) {
    const parentKey = delegationAttemptIdentityKey(declaration.parent);
    if (!admitted.has(parentKey)) {
      throw new Error(`Delegation parent must be admitted first: ${parentKey}`);
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
    await readVerifiedParentAttempt(parentVerification);
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
  await appendFile(loaded.eventsPath, serializeEvent(event), 'utf8');
  return {
    event,
    declaration,
    eventsPath: loaded.eventsPath,
    planSha256: loaded.planSha256,
  };
}

type ExistingAdmissionEventInput = {
  readonly events: readonly DelegationRunEvent[];
  readonly identityKey: string;
};

function existingAdmissionEvent(
  input: ExistingAdmissionEventInput,
): DelegationAttemptAdmittedEvent {
  const event = input.events.find(
    (candidate) =>
      candidate.kind === DelegationRunEventKind.AttemptAdmitted &&
      delegationAttemptIdentityKey(candidate.declaration.identity) ===
        input.identityKey,
  );
  if (!event || event.kind !== DelegationRunEventKind.AttemptAdmitted) {
    throw new Error(
      'Delegation attempt has not been admitted before dispatch.',
    );
  }
  return event;
}

type AdmissionRequestBinding = {
  readonly request: DelegationAdmissionRequest;
  readonly declaration: DelegationAttemptDeclaration;
  readonly runId: string;
  readonly sourceCommit: string;
};

function assertAdmissionRequest(binding: AdmissionRequestBinding): void {
  const identityPair: DelegationIdentityPair = {
    first: binding.request.identity,
    second: binding.declaration.identity,
  };
  if (
    !delegationAttemptIdentitiesEqual(identityPair) ||
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

type DelegationRunDirectoryInput = {
  readonly workingDirectory: string;
  readonly runId: string;
};

function delegationRunDirectory(input: DelegationRunDirectoryInput): string {
  assertFilesystemIdentifier(input.runId);
  return join(
    input.workingDirectory,
    'workflow',
    'processing',
    DelegatedAgentWorkflowName.AgentWork,
    input.runId,
  );
}

type ReadVerifiedEventsInput = {
  readonly eventsPath: string;
  readonly plan: DelegationPlan;
  readonly planSha256: string;
};

async function readVerifiedEvents(
  input: ReadVerifiedEventsInput,
): Promise<readonly DelegationRunEvent[]> {
  const eventsRead: ReadVerifiedProjectionArgs = {
    runDirectory: dirname(input.eventsPath),
    path: input.eventsPath,
    maxBytes: MAX_DELEGATION_EVENTS_BYTES,
  };
  const serialized = await readVerifiedProjection(eventsRead);
  if (!serialized.endsWith('\n')) {
    throw new Error('Delegation run event stream must end with one newline.');
  }
  const lines = serialized.slice(0, -1).split('\n');
  if (lines.length < 1 || lines.some((line) => line.length === 0)) {
    throw new Error('Delegation run event stream is empty or noncanonical.');
  }
  const events: DelegationRunEvent[] = [];
  for (const [index, line] of lines.entries()) {
    const event = decodeDelegationRunEvent(line);
    const bindingInput: AssertEventBindingInput = {
      event,
      plan: input.plan,
      planSha256: input.planSha256,
      expectedSequence: index + 1,
    };
    assertEventBinding(bindingInput);
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
      const declaration = findDeclaration(declarationInput);
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

type AssertEventBindingInput = {
  readonly event: DelegationRunEvent;
  readonly plan: DelegationPlan;
  readonly planSha256: string;
  readonly expectedSequence: number;
};

function assertEventBinding(input: AssertEventBindingInput): void {
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

type FindDeclarationInput = {
  readonly plan: DelegationPlan;
  readonly identity: DelegationAttemptIdentity;
};

function findDeclaration(
  input: FindDeclarationInput,
): DelegationAttemptDeclaration {
  const declaration = input.plan.attempts.find((candidate) => {
    const identityPair: DelegationIdentityPair = {
      first: candidate.identity,
      second: input.identity,
    };
    return delegationAttemptIdentitiesEqual(identityPair);
  });
  if (!declaration) {
    throw new Error(
      `Delegation attempt is not predeclared: ${delegationAttemptIdentityKey(input.identity)}`,
    );
  }
  return declaration;
}

function admittedIdentityKeys(
  events: readonly DelegationRunEvent[],
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const event of events) {
    if (event.kind === DelegationRunEventKind.AttemptAdmitted) {
      const key = delegationAttemptIdentityKey(event.declaration.identity);
      if (keys.has(key)) {
        throw new Error(`Delegation event stream repeats an admission: ${key}`);
      }
      keys.add(key);
    }
  }
  return keys;
}

type AtomicWrite = {
  readonly path: string;
  readonly content: string;
};

async function atomicWrite(write: AtomicWrite): Promise<void> {
  const temporaryPath = `${write.path}.tmp`;
  await writeFile(temporaryPath, write.content, 'utf8');
  await rename(temporaryPath, write.path);
}

function serializeEvent(event: DelegationRunEvent): string {
  return `${JSON.stringify(event)}\n`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertFilesystemIdentifier(identifier: string): void {
  if (
    identifier.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(identifier)
  ) {
    throw new Error(`Unsafe delegation identifier: ${identifier}`);
  }
}
