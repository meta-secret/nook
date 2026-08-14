import { createHash } from 'node:crypto';
import { appendFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  StaticAgentWorkflowName,
  TaskTerminal,
  WorkflowEventSequence,
  WorkflowRunId,
  WorkflowRunTerminal,
  WorkflowVersion,
  GitCommit,
  IsoTimestamp,
} from './domain.ts';
import type {
  WorkflowEvent,
  WorkflowEventMetadata,
  WorkflowEventWithoutMetadata,
} from './events.ts';

const RECURSIVE_DIRECTORY_OPTIONS: { readonly recursive: true } = {
  recursive: true,
};

export type WorkflowJournalIdentity = {
  readonly runId: WorkflowRunId;
  readonly workflow: StaticAgentWorkflowName;
  readonly workflowVersion: WorkflowVersion;
  readonly sourceCommit: GitCommit;
};

export type WorkflowJournalConfiguration = {
  readonly runRoot: string;
  readonly identity: WorkflowJournalIdentity;
  readonly now: () => IsoTimestamp;
};

export type TaskTerminalProjection = {
  readonly path: string;
  readonly sha256: string;
};

export type WorkflowTerminalProjection = {
  readonly path: string;
  readonly sha256: string;
};

export class WorkflowJournal<TTask extends string> {
  readonly runDirectory: string;
  readonly eventsPath: string;
  readonly identity: WorkflowJournalIdentity;
  readonly now: () => IsoTimestamp;
  private sequence: WorkflowEventSequence;
  private pendingAppend: Promise<void>;

  constructor(configuration: WorkflowJournalConfiguration) {
    this.identity = configuration.identity;
    this.runDirectory = join(
      configuration.runRoot,
      configuration.identity.workflow,
      configuration.identity.runId,
    );
    this.eventsPath = join(this.runDirectory, 'events.jsonl');
    this.now = configuration.now;
    this.sequence = 0;
    this.pendingAppend = Promise.resolve();
  }

  async initialize(): Promise<void> {
    const workflowDirectory = dirname(this.runDirectory);
    await mkdir(workflowDirectory, RECURSIVE_DIRECTORY_OPTIONS);
    await mkdir(this.runDirectory);
    await mkdir(join(this.runDirectory, 'task-results'));
  }

  async append(
    event: WorkflowEventWithoutMetadata<TTask>,
  ): Promise<WorkflowEvent<TTask>> {
    this.sequence += 1;
    const metadata: WorkflowEventMetadata = {
      runId: this.identity.runId,
      workflow: this.identity.workflow,
      workflowVersion: this.identity.workflowVersion,
      sequence: this.sequence,
      occurredAt: this.now(),
      sourceCommit: this.identity.sourceCommit,
    };
    const completeEvent = { ...metadata, ...event } as WorkflowEvent<TTask>;
    const line = `${JSON.stringify(completeEvent)}\n`;
    const appendOperation = this.pendingAppend.then(async () => {
      await appendFile(this.eventsPath, line, 'utf8');
    });
    this.pendingAppend = appendOperation;
    await appendOperation;
    return completeEvent;
  }

  async projectTaskTerminal(
    terminal: TaskTerminal<TTask>,
  ): Promise<TaskTerminalProjection> {
    const relativePath = join(
      'task-results',
      `${terminal.task}-attempt-${terminal.attempt}.json`,
    );
    const absolutePath = join(this.runDirectory, relativePath);
    const serialized = `${JSON.stringify(terminal)}\n`;
    const operation: AtomicWriteOperation = { path: absolutePath, serialized };
    await atomicWrite(operation);
    return {
      path: relativePath,
      sha256: sha256(serialized),
    };
  }

  async projectWorkflowTerminal(
    terminal: WorkflowRunTerminal<TTask>,
  ): Promise<WorkflowTerminalProjection> {
    const relativePath = 'run-result.json';
    const absolutePath = join(this.runDirectory, relativePath);
    const serialized = `${JSON.stringify(terminal)}\n`;
    const operation: AtomicWriteOperation = { path: absolutePath, serialized };
    await atomicWrite(operation);
    return {
      path: relativePath,
      sha256: sha256(serialized),
    };
  }
}

type AtomicWriteOperation = {
  readonly path: string;
  readonly serialized: string;
};

async function atomicWrite(operation: AtomicWriteOperation): Promise<void> {
  await mkdir(dirname(operation.path), RECURSIVE_DIRECTORY_OPTIONS);
  const temporaryPath = `${operation.path}.tmp`;
  await writeFile(temporaryPath, operation.serialized, 'utf8');
  await rename(temporaryPath, operation.path);
}

function sha256(serialized: string): string {
  return createHash('sha256').update(serialized).digest('hex');
}
