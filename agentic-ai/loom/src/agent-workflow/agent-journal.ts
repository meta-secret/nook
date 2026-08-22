import { createHash } from 'node:crypto';
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  AgentAttemptParentKind,
  MaterializedViewAuthorKind,
  MaterializedViewPresence,
  TaskTerminalKind,
  TaskProcessingKind,
} from './domain.ts';
import type {
  AgentAttemptParent,
  AgentAttemptProcessingReference,
  AgentProcessingWorkflowName,
  GitCommit,
  IsoTimestamp,
  MaterializedViewReference,
  ProjectionReference,
  TaskTerminal,
  WorkflowAttemptNumber,
  WorkflowEventSequence,
  WorkflowRunId,
  WorkflowVersion,
} from './domain.ts';
import { AgentAttemptEventKind } from './agent-events.ts';
import type {
  AgentAttemptEvent,
  AgentAttemptEventMetadata,
  AgentAttemptEventWithoutMetadata,
} from './agent-events.ts';
import { decodeWorkflowTaskOutput } from './structured-result-codec.ts';
import { MAX_AGENT_HIERARCHY_DEPTH } from './hierarchy.ts';

const RECURSIVE_DIRECTORY_OPTIONS: { readonly recursive: true } = {
  recursive: true,
};

export type AgentAttemptJournalConfiguration = {
  readonly runDirectory: string;
  readonly runId: WorkflowRunId;
  readonly workflow: AgentProcessingWorkflowName;
  readonly workflowVersion: WorkflowVersion;
  readonly sourceCommit: GitCommit;
  readonly task: string;
  readonly agent: string;
  readonly attempt: WorkflowAttemptNumber;
  readonly depth: number;
  readonly parent: AgentAttemptParent;
  readonly now: () => IsoTimestamp;
};

export class AgentAttemptJournal<TTask extends string> {
  readonly attemptDirectory: string;
  readonly eventsPath: string;
  private readonly configuration: AgentAttemptJournalConfiguration;
  private sequence: WorkflowEventSequence;
  private pendingAppend: Promise<void>;
  private finalized: boolean;

  constructor(configuration: AgentAttemptJournalConfiguration) {
    assertFilesystemIdentifier(configuration.task);
    assertFilesystemIdentifier(configuration.agent);
    assertFilesystemIdentifier(configuration.runId);
    assertFilesystemIdentifier(configuration.workflow);
    if (
      !Number.isSafeInteger(configuration.attempt) ||
      configuration.attempt < 1 ||
      !Number.isSafeInteger(configuration.depth) ||
      configuration.depth < 1 ||
      configuration.depth > MAX_AGENT_HIERARCHY_DEPTH
    ) {
      throw new Error('Agent attempt and hierarchy depth must be bounded.');
    }
    if (
      configuration.workflowVersion.trim() === '' ||
      configuration.workflowVersion.length > 128 ||
      !/^[0-9a-f]{40}$/.test(configuration.sourceCommit)
    ) {
      throw new Error('Agent attempt source identity must be bounded.');
    }
    assertParentLineage(configuration);
    this.configuration = configuration;
    this.attemptDirectory = join(
      configuration.runDirectory,
      'agents',
      configuration.task,
      `attempt-${configuration.attempt}`,
    );
    this.eventsPath = join(this.attemptDirectory, 'events.jsonl');
    this.sequence = 0;
    this.pendingAppend = Promise.resolve();
    this.finalized = false;
  }

  get eventHighWaterMark(): WorkflowEventSequence {
    return this.sequence;
  }

  async initialize(): Promise<void> {
    await mkdir(dirname(this.attemptDirectory), RECURSIVE_DIRECTORY_OPTIONS);
    await mkdir(this.attemptDirectory);
    const event: AgentAttemptEventWithoutMetadata = {
      kind: AgentAttemptEventKind.AttemptStarted,
    };
    await this.append(event);
  }

  async append(
    event: AgentAttemptEventWithoutMetadata,
  ): Promise<AgentAttemptEvent> {
    if (this.finalized) {
      throw new Error('Cannot append to a finalized agent attempt journal.');
    }
    if (
      event.kind === AgentAttemptEventKind.RuntimeActivity &&
      (event.detail.length > 1024 || containsForbiddenControl(event.detail))
    ) {
      throw new Error('Agent runtime activity detail must be bounded.');
    }
    this.sequence += 1;
    const occurredAt = this.configuration.now();
    if (Number.isNaN(Date.parse(occurredAt))) {
      throw new Error('Agent attempt event timestamp is invalid.');
    }
    const metadata: AgentAttemptEventMetadata = {
      runId: this.configuration.runId,
      workflow: this.configuration.workflow,
      workflowVersion: this.configuration.workflowVersion,
      sourceCommit: this.configuration.sourceCommit,
      task: this.configuration.task,
      agent: this.configuration.agent,
      attempt: this.configuration.attempt,
      depth: this.configuration.depth,
      parent: this.configuration.parent,
      sequence: this.sequence,
      occurredAt,
    };
    const completeEvent = { ...metadata, ...event } as AgentAttemptEvent;
    const serialized = `${JSON.stringify(completeEvent)}\n`;
    const appendOperation = this.pendingAppend.then(async () => {
      await appendFile(this.eventsPath, serialized, 'utf8');
    });
    this.pendingAppend = appendOperation;
    await appendOperation;
    return completeEvent;
  }

  async finalize(
    terminal: TaskTerminal<TTask>,
  ): Promise<AgentAttemptProcessingReference> {
    this.assertTerminal(terminal);
    const jsonProjection: JsonProjectionInput<TTask> = {
      filename: 'result.json',
      value: terminal,
    };
    const result = await this.projectJson(jsonProjection);
    const resultEvent: AgentAttemptEventWithoutMetadata = {
      kind: AgentAttemptEventKind.ResultProjected,
      result,
    };
    await this.append(resultEvent);
    const view = await this.projectView(terminal);
    if (view.presence === MaterializedViewPresence.Recorded) {
      const viewEvent: AgentAttemptEventWithoutMetadata = {
        kind: AgentAttemptEventKind.ViewProjected,
        view,
      };
      await this.append(viewEvent);
    }
    const terminalEvent: AgentAttemptEventWithoutMetadata = {
      kind: AgentAttemptEventKind.AttemptTerminalRecorded,
      terminalKind: terminal.kind,
      result,
      view,
    };
    await this.append(terminalEvent);
    this.finalized = true;
    await this.pendingAppend;
    const eventsSerialized = await readFile(this.eventsPath, 'utf8');
    const events: ProjectionReference = {
      path: this.relativePath('events.jsonl'),
      sha256: sha256(eventsSerialized),
    };
    return { kind: TaskProcessingKind.AgentAttempt, events, result, view };
  }

  private assertTerminal(terminal: TaskTerminal<TTask>): void {
    if (
      terminal.task !== this.configuration.task ||
      terminal.attempt !== this.configuration.attempt
    ) {
      throw new Error('Agent terminal identity differs from its journal.');
    }
    if (terminal.kind === TaskTerminalKind.Completed) {
      decodeWorkflowTaskOutput(JSON.stringify(terminal.output));
      const view = terminal.output?.materializedViewMarkdown;
      if (
        typeof terminal.threadId !== 'string' ||
        terminal.threadId.trim() === '' ||
        typeof view !== 'string' ||
        view.trim() === '' ||
        view.length > 65_536
      ) {
        throw new Error('Completed agent terminal view must be bounded.');
      }
      return;
    }
    if (
      typeof terminal.summary !== 'string' ||
      terminal.summary.trim() === '' ||
      terminal.summary.length > 4096 ||
      containsForbiddenControl(terminal.summary)
    ) {
      throw new Error('Agent terminal failure summary must be bounded.');
    }
  }

  private async projectView(
    terminal: TaskTerminal<TTask>,
  ): Promise<MaterializedViewReference> {
    if (terminal.kind !== TaskTerminalKind.Completed) {
      const markdown = [
        '# Agent attempt failure view',
        '',
        `Status: ${terminal.kind}`,
        '',
        'This view was produced by Loom because the agent did not complete an authored semantic view.',
        '',
        `Normalized outcome: ${terminal.summary}`,
      ].join('\n');
      const textProjection: TextProjectionInput = {
        filename: 'view.md',
        serialized: `${markdown}\n`,
      };
      const projection = await this.projectText(textProjection);
      return {
        presence: MaterializedViewPresence.Recorded,
        authorKind: MaterializedViewAuthorKind.LoomRuntime,
        projection,
        eventHighWaterMark: this.eventHighWaterMark,
      };
    }
    const serialized = `${terminal.output.materializedViewMarkdown.trim()}\n`;
    const textProjection: TextProjectionInput = {
      filename: 'view.md',
      serialized,
    };
    const projection = await this.projectText(textProjection);
    return {
      presence: MaterializedViewPresence.Recorded,
      authorKind: MaterializedViewAuthorKind.Agent,
      projection,
      eventHighWaterMark: this.eventHighWaterMark,
    };
  }

  private async projectJson(
    input: JsonProjectionInput<TTask>,
  ): Promise<ProjectionReference> {
    const textProjection: TextProjectionInput = {
      filename: input.filename,
      serialized: `${JSON.stringify(input.value)}\n`,
    };
    return this.projectText(textProjection);
  }

  private async projectText(
    input: TextProjectionInput,
  ): Promise<ProjectionReference> {
    const absolutePath = join(this.attemptDirectory, input.filename);
    const operation: AtomicWriteOperation = {
      path: absolutePath,
      serialized: input.serialized,
    };
    await atomicWrite(operation);
    return {
      path: this.relativePath(input.filename),
      sha256: sha256(input.serialized),
    };
  }

  private relativePath(filename: string): string {
    return join(
      'agents',
      this.configuration.task,
      `attempt-${this.configuration.attempt}`,
      filename,
    );
  }
}

type JsonProjectionInput<TTask extends string> = {
  readonly filename: string;
  readonly value: TaskTerminal<TTask>;
};

type TextProjectionInput = {
  readonly filename: string;
  readonly serialized: string;
};

type AtomicWriteOperation = {
  readonly path: string;
  readonly serialized: string;
};

async function atomicWrite(operation: AtomicWriteOperation): Promise<void> {
  const temporaryPath = `${operation.path}.tmp`;
  await writeFile(temporaryPath, operation.serialized, 'utf8');
  await rename(temporaryPath, operation.path);
}

function sha256(serialized: string): string {
  return createHash('sha256').update(serialized).digest('hex');
}

function assertFilesystemIdentifier(identifier: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(identifier)) {
    throw new Error(`Unsafe agent processing identifier: ${identifier}`);
  }
}

function assertParentLineage(
  configuration: AgentAttemptJournalConfiguration,
): void {
  const parent = configuration.parent;
  if (parent.kind === AgentAttemptParentKind.WorkflowRoot) {
    if (configuration.depth !== 1 || Object.keys(parent).length !== 1) {
      throw new Error('Root agent attempt lineage is invalid.');
    }
    return;
  }
  assertFilesystemIdentifier(parent.task);
  assertFilesystemIdentifier(parent.agent);
  if (
    configuration.depth < 2 ||
    !Number.isSafeInteger(parent.attempt) ||
    parent.attempt < 1 ||
    (parent.task === configuration.task &&
      parent.agent === configuration.agent &&
      parent.attempt === configuration.attempt)
  ) {
    throw new Error('Parent agent attempt lineage is invalid.');
  }
}

function containsForbiddenControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return (
      code === 127 || (code < 32 && code !== 9 && code !== 10 && code !== 13)
    );
  });
}
