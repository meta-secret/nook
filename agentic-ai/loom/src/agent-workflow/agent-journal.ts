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
  MaterializedViewAuthorKind,
  MaterializedViewPresence,
  TaskTerminalKind,
} from './domain.ts';
import type {
  AgentAttemptParent,
  AgentAttemptProcessingReference,
  GitCommit,
  IsoTimestamp,
  MaterializedViewReference,
  ProjectionReference,
  StaticAgentWorkflowName,
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

const RECURSIVE_DIRECTORY_OPTIONS: { readonly recursive: true } = {
  recursive: true,
};

export type AgentAttemptJournalConfiguration = {
  readonly runDirectory: string;
  readonly runId: WorkflowRunId;
  readonly workflow: StaticAgentWorkflowName;
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
    if (
      !Number.isSafeInteger(configuration.attempt) ||
      configuration.attempt < 1 ||
      !Number.isSafeInteger(configuration.depth) ||
      configuration.depth < 1 ||
      configuration.depth > 64
    ) {
      throw new Error('Agent attempt and hierarchy depth must be bounded.');
    }
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
      occurredAt: this.configuration.now(),
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
    return { kind: 'agent-attempt', events, result, view };
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

function containsForbiddenControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return (
      code === 127 || (code < 32 && code !== 9 && code !== 10 && code !== 13)
    );
  });
}
