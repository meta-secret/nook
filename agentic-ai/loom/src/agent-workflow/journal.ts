import { createHash } from 'node:crypto';
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import {
  MaterializedViewAuthorKind,
  MaterializedViewPresence,
  TaskProcessingKind,
} from './domain.ts';
import type {
  StaticAgentWorkflowName,
  TaskTerminal,
  WorkflowEventSequence,
  WorkflowRunId,
  WorkflowRunTerminal,
  WorkflowVersion,
  GitCommit,
  IsoTimestamp,
  MaterializedViewReference,
  ProjectionReference,
  TaskProcessingReference,
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

export type WorkflowViewProjectionInput = {
  readonly markdown: string;
  readonly authorKind: MaterializedViewAuthorKind;
};

export type TaskViewProjectionInput = WorkflowViewProjectionInput & {
  readonly task: string;
  readonly attempt: number;
};

export class WorkflowJournal<TTask extends string> {
  readonly runDirectory: string;
  readonly eventsPath: string;
  readonly identity: WorkflowJournalIdentity;
  readonly now: () => IsoTimestamp;
  private sequence: WorkflowEventSequence;
  private pendingAppend: Promise<void>;

  constructor(configuration: WorkflowJournalConfiguration) {
    assertFilesystemIdentifier(configuration.identity.runId);
    assertFilesystemIdentifier(configuration.identity.workflow);
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

  async projectWorkflowView(
    input: WorkflowViewProjectionInput,
  ): Promise<MaterializedViewReference> {
    const relativePath = 'view.md';
    const serialized = `${input.markdown.trim()}\n`;
    const operation: AtomicWriteOperation = {
      path: join(this.runDirectory, relativePath),
      serialized,
    };
    await atomicWrite(operation);
    const projection: ProjectionReference = {
      path: relativePath,
      sha256: sha256(serialized),
    };
    return {
      presence: MaterializedViewPresence.Recorded,
      authorKind: input.authorKind,
      projection,
      eventHighWaterMark: this.sequence,
    };
  }

  async projectTaskView(
    input: TaskViewProjectionInput,
  ): Promise<MaterializedViewReference> {
    assertFilesystemIdentifier(input.task);
    const relativePath = join(
      'task-results',
      `${input.task}-attempt-${input.attempt}.md`,
    );
    const serialized = `${input.markdown.trim()}\n`;
    const operation: AtomicWriteOperation = {
      path: join(this.runDirectory, relativePath),
      serialized,
    };
    await atomicWrite(operation);
    return {
      presence: MaterializedViewPresence.Recorded,
      authorKind: input.authorKind,
      projection: {
        path: relativePath,
        sha256: sha256(serialized),
      },
      eventHighWaterMark: this.sequence,
    };
  }

  async readVerifiedProcessingView(
    processing: TaskProcessingReference,
  ): Promise<string> {
    await this.readVerifiedProjection(processing.result);
    if (processing.kind === TaskProcessingKind.AgentAttempt) {
      await this.readVerifiedProjection(processing.events);
    }
    if (processing.view.presence !== MaterializedViewPresence.Recorded) {
      throw new Error('Upstream processing view is unavailable.');
    }
    return this.readVerifiedProjection(processing.view.projection);
  }

  private async readVerifiedProjection(
    projection: ProjectionReference,
  ): Promise<string> {
    const runRoot = resolve(this.runDirectory);
    const projectionPath = resolve(runRoot, projection.path);
    if (!projectionPath.startsWith(`${runRoot}${sep}`)) {
      throw new Error('Processing projection escapes its workflow run.');
    }
    const serialized = await readFile(projectionPath, 'utf8');
    if (sha256(serialized) !== projection.sha256) {
      throw new Error(
        `Processing projection digest mismatch: ${projection.path}`,
      );
    }
    return serialized;
  }
}

function assertFilesystemIdentifier(identifier: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(identifier)) {
    throw new Error(`Unsafe workflow processing identifier: ${identifier}`);
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
