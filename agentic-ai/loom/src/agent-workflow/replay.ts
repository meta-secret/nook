import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { LoomFailureCode, loomFailureDetail } from '../loom-failure.ts';
import { replayAgentAttemptJournal } from './agent-replay.ts';
import type { AgentAttemptEvent } from './agent-events.ts';
import { WorkflowEventKind, WorkflowRuntimeActivityKind } from './events.ts';

import type {
  StaticAgentWorkflowName,
  WorkflowAttemptNumber,
  WorkflowRunId,
  WorkflowVersion,
  GitCommit,
  MaterializedViewReference,
  TaskProcessingReference,
  ProjectionReference,
  TaskTerminal,
} from './domain.ts';
import {
  MaterializedViewPresence,
  TaskProcessingKind,
  TaskTerminalKind,
  WorkflowTerminalKind,
} from './domain.ts';
import type { TaskTerminalRecordedEvent, WorkflowEvent } from './events.ts';

export type ReplayedTaskTerminalReference<TTask extends string> = {
  readonly task: TTask;
  readonly attempt: WorkflowAttemptNumber;
  readonly terminalKind: TaskTerminalKind;
  readonly resultPath: string;
  readonly resultSha256: string;
  readonly processing: TaskProcessingReference;
};

export enum ReplayedWorkflowTerminalPresence {
  NotRecorded = 'not-recorded',
  Recorded = 'recorded',
}

export type ReplayedWorkflowTerminalReference =
  | { readonly presence: ReplayedWorkflowTerminalPresence.NotRecorded }
  | {
      readonly presence: ReplayedWorkflowTerminalPresence.Recorded;
      readonly terminalKind: WorkflowTerminalKind;
      readonly resultPath: string;
      readonly resultSha256: string;
      readonly materializedView: MaterializedViewReference;
    };

export type ReplayedWorkflowIdentity = {
  readonly runId: WorkflowRunId;
  readonly workflow: StaticAgentWorkflowName;
  readonly workflowVersion: WorkflowVersion;
  readonly sourceCommit: GitCommit;
};

export type ReplayedWorkflowJournal<TTask extends string> = {
  readonly identity: ReplayedWorkflowIdentity;
  readonly eventCount: number;
  readonly taskTerminals: readonly ReplayedTaskTerminalReference<TTask>[];
  readonly workflowTerminal: ReplayedWorkflowTerminalReference;
};

export type ReplayWorkflowJournalRequest<TTask extends string> = {
  readonly events: readonly WorkflowEvent<TTask>[];
  readonly runDirectory?: string;
};

const WORKFLOW_EVENT_KINDS = new Set<string>(Object.values(WorkflowEventKind));
const TASK_TERMINAL_KINDS = new Set<string>(Object.values(TaskTerminalKind));
const WORKFLOW_TERMINAL_KINDS = new Set<string>(
  Object.values(WorkflowTerminalKind),
);
const RUNTIME_ACTIVITY_KINDS = new Set<string>(
  Object.values(WorkflowRuntimeActivityKind),
);

export function replayWorkflowJournal<TTask extends string>(
  request: ReplayWorkflowJournalRequest<TTask>,
): ReplayedWorkflowJournal<TTask> {
  if (request.events.length === 0) {
    invalidJournal('workflow journal must contain a workflow-started event');
  }
  const firstEvent = request.events[0]!;
  if (firstEvent.kind !== WorkflowEventKind.WorkflowStarted) {
    invalidJournal('workflow journal must start with workflow-started');
  }

  const identity: ReplayedWorkflowIdentity = {
    runId: firstEvent.runId,
    workflow: firstEvent.workflow,
    workflowVersion: firstEvent.workflowVersion,
    sourceCommit: firstEvent.sourceCommit,
  };
  const taskTerminals: ReplayedTaskTerminalReference<TTask>[] = [];
  const terminalAttempts = new Set<string>();
  let workflowTerminal: ReplayedWorkflowTerminalReference = {
    presence: ReplayedWorkflowTerminalPresence.NotRecorded,
  };

  for (const [eventIndex, event] of request.events.entries()) {
    if (!WORKFLOW_EVENT_KINDS.has(event.kind)) {
      invalidJournal('workflow journal contains an unknown event kind');
    }
    const expectedSequence = eventIndex + 1;
    if (event.sequence !== expectedSequence) {
      invalidJournal(
        `workflow journal sequence ${event.sequence} must equal ${expectedSequence}`,
      );
    }
    if (
      event.runId !== identity.runId ||
      event.workflow !== identity.workflow ||
      event.workflowVersion !== identity.workflowVersion ||
      event.sourceCommit !== identity.sourceCommit
    ) {
      invalidJournal(
        `workflow journal event ${event.sequence} has a different identity`,
      );
    }
    if (eventIndex > 0 && event.kind === WorkflowEventKind.WorkflowStarted) {
      invalidJournal(
        'workflow journal contains more than one workflow-started event',
      );
    }
    if (
      workflowTerminal.presence === ReplayedWorkflowTerminalPresence.Recorded
    ) {
      invalidJournal(
        'workflow journal contains an event after its terminal event',
      );
    }

    if (event.kind === WorkflowEventKind.TaskTerminalRecorded) {
      if (!TASK_TERMINAL_KINDS.has(event.terminalKind)) {
        invalidJournal(
          `workflow journal task ${event.task} has an unknown terminal kind`,
        );
      }
      const terminalAttemptKey = `${event.task}\u0000${event.attempt}`;
      if (terminalAttempts.has(terminalAttemptKey)) {
        invalidJournal(
          `workflow journal records task ${event.task} attempt ${event.attempt} more than once`,
        );
      }
      terminalAttempts.add(terminalAttemptKey);
      const processingRequest: AssertProcessingReferenceRequest<TTask> = {
        event,
        runDirectory: request.runDirectory ?? false,
      };
      assertProcessingReference(processingRequest);
      const terminalReference: ReplayedTaskTerminalReference<TTask> = {
        task: event.task,
        attempt: event.attempt,
        terminalKind: event.terminalKind,
        resultPath: event.resultPath,
        resultSha256: event.resultSha256,
        processing: event.processing,
      };
      taskTerminals.push(terminalReference);
    }

    if (
      event.kind === WorkflowEventKind.RuntimeActivity &&
      !RUNTIME_ACTIVITY_KINDS.has(event.activity)
    ) {
      invalidJournal('workflow journal contains unknown runtime activity');
    }

    if (event.kind === WorkflowEventKind.WorkflowTerminalRecorded) {
      const terminalProjection: ProjectionReference = {
        path: event.resultPath,
        sha256: event.resultSha256,
      };
      if (
        !WORKFLOW_TERMINAL_KINDS.has(event.terminalKind) ||
        !validProjection(terminalProjection)
      ) {
        invalidJournal('workflow journal has an invalid terminal reference');
      }
      assertMaterializedViewReference(event.materializedView);
      workflowTerminal = {
        presence: ReplayedWorkflowTerminalPresence.Recorded,
        terminalKind: event.terminalKind,
        resultPath: event.resultPath,
        resultSha256: event.resultSha256,
        materializedView: event.materializedView,
      };
    }
  }

  return {
    identity,
    eventCount: request.events.length,
    taskTerminals,
    workflowTerminal,
  };
}

function assertMaterializedViewReference(
  reference: MaterializedViewReference,
): void {
  if (!reference) {
    invalidJournal(
      'workflow journal terminal has no materialized view reference',
    );
  }
  if (reference.presence === MaterializedViewPresence.Recorded) {
    if (!validProjection(reference.projection)) {
      invalidJournal(
        'workflow journal terminal has an invalid materialized view reference',
      );
    }
    return;
  }
  if (reference.presence !== MaterializedViewPresence.Unavailable) {
    invalidJournal(
      'workflow journal terminal has an unknown materialized view presence',
    );
  }
  if (reference.reason.trim() === '') {
    invalidJournal(
      'workflow journal terminal has an invalid unavailable view reason',
    );
  }
}

type AssertProcessingReferenceRequest<TTask extends string> = {
  readonly event: TaskTerminalRecordedEvent<TTask>;
  readonly runDirectory: string | false;
};

function assertProcessingReference<TTask extends string>(
  request: AssertProcessingReferenceRequest<TTask>,
): void {
  const event = request.event;
  const processing = event.processing;
  if (
    !processing ||
    (processing.kind !== TaskProcessingKind.AgentAttempt &&
      processing.kind !== TaskProcessingKind.WorkflowTask) ||
    !validProjection(processing.result) ||
    processing.result.path !== event.resultPath ||
    processing.result.sha256 !== event.resultSha256
  ) {
    invalidJournal(
      `workflow journal task ${event.task} has an invalid processing result reference`,
    );
  }
  if (
    processing.kind === TaskProcessingKind.AgentAttempt &&
    !validProjection(processing.events)
  ) {
    invalidJournal(
      `workflow journal task ${event.task} has an invalid attempt stream reference`,
    );
  }
  assertMaterializedViewReference(processing.view);
  if (processing.kind === TaskProcessingKind.AgentAttempt) {
    if (!request.runDirectory) {
      invalidJournal(
        `workflow journal task ${event.task} requires its run directory to verify agent processing`,
      );
    }
    const verificationRequest: VerifyAgentProcessingRequest<TTask> = {
      event,
      runDirectory: request.runDirectory,
      processing,
    };
    verifyAgentProcessing(verificationRequest);
  }
}

type VerifyAgentProcessingRequest<TTask extends string> = {
  readonly event: TaskTerminalRecordedEvent<TTask>;
  readonly runDirectory: string;
  readonly processing: Extract<
    TaskProcessingReference,
    { readonly kind: TaskProcessingKind.AgentAttempt }
  >;
};

function verifyAgentProcessing<TTask extends string>(
  request: VerifyAgentProcessingRequest<TTask>,
): void {
  const eventProjectionRequest: ReadVerifiedProjectionRequest = {
    runDirectory: request.runDirectory,
    projection: request.processing.events,
  };
  const eventText = readVerifiedProjection(eventProjectionRequest);
  const resultProjectionRequest: ReadVerifiedProjectionRequest = {
    runDirectory: request.runDirectory,
    projection: request.processing.result,
  };
  const resultText = readVerifiedProjection(resultProjectionRequest);
  let result: TaskTerminal<string>;
  try {
    result = JSON.parse(resultText) as TaskTerminal<string>;
  } catch {
    invalidJournal(
      `workflow journal task ${request.event.task} has an unreadable result projection`,
    );
  }
  if (request.processing.view.presence === MaterializedViewPresence.Recorded) {
    const viewProjectionRequest: ReadVerifiedProjectionRequest = {
      runDirectory: request.runDirectory,
      projection: request.processing.view.projection,
    };
    const viewText = readVerifiedProjection(viewProjectionRequest);
    if (
      result.kind === TaskTerminalKind.Completed &&
      viewText !== `${result.output.materializedViewMarkdown.trim()}\n`
    ) {
      invalidJournal(
        `workflow journal task ${request.event.task} view differs from its result projection`,
      );
    }
  }
  let events: readonly AgentAttemptEvent[];
  try {
    events = eventText
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as AgentAttemptEvent);
  } catch {
    invalidJournal(
      `workflow journal task ${request.event.task} has an unreadable agent attempt stream`,
    );
  }
  let replayed: ReturnType<typeof replayAgentAttemptJournal>;
  try {
    const replayRequest = { events };
    replayed = replayAgentAttemptJournal(replayRequest);
  } catch {
    invalidJournal(
      `workflow journal task ${request.event.task} has an invalid agent attempt stream`,
    );
  }
  const identity = events[0];
  const expectedAttemptDirectory = identity
    ? join('agents', identity.task, `attempt-${identity.attempt}`)
    : '';
  if (
    !identity ||
    identity.runId !== request.event.runId ||
    identity.workflow !== request.event.workflow ||
    identity.workflowVersion !== request.event.workflowVersion ||
    identity.sourceCommit !== request.event.sourceCommit ||
    identity.task !== request.event.task ||
    identity.attempt !== request.event.attempt ||
    result.task !== request.event.task ||
    result.attempt !== request.event.attempt ||
    result.kind !== request.event.terminalKind ||
    request.processing.events.path !==
      join(expectedAttemptDirectory, 'events.jsonl') ||
    request.processing.result.path !==
      join(expectedAttemptDirectory, 'result.json') ||
    (request.processing.view.presence === MaterializedViewPresence.Recorded &&
      request.processing.view.projection.path !==
        join(expectedAttemptDirectory, 'view.md')) ||
    replayed.terminalKind !== request.event.terminalKind ||
    JSON.stringify(replayed.view) !== JSON.stringify(request.processing.view)
  ) {
    invalidJournal(
      `workflow journal task ${request.event.task} disagrees with its agent attempt stream`,
    );
  }
}

type ReadVerifiedProjectionRequest = {
  readonly runDirectory: string;
  readonly projection: ProjectionReference;
};

function readVerifiedProjection(
  request: ReadVerifiedProjectionRequest,
): string {
  const absoluteRunDirectory = resolve(request.runDirectory);
  const absolutePath = resolve(absoluteRunDirectory, request.projection.path);
  const relativePath = relative(absoluteRunDirectory, absolutePath);
  const projectionSegments = request.projection.path.split(/[\\/]/);
  if (
    isAbsolute(request.projection.path) ||
    projectionSegments.some(
      (segment) => segment === '' || segment === '.' || segment === '..',
    ) ||
    relativePath === '..' ||
    relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
  ) {
    invalidJournal('workflow journal projection escapes its run directory');
  }
  let serialized: string;
  try {
    serialized = readFileSync(absolutePath, 'utf8');
  } catch {
    invalidJournal('workflow journal projection cannot be read');
  }
  const digest = createHash('sha256').update(serialized).digest('hex');
  if (digest !== request.projection.sha256) {
    invalidJournal('workflow journal projection digest does not match');
  }
  return serialized;
}

function validProjection(projection: ProjectionReference | false): boolean {
  return Boolean(
    projection &&
    projection.path.trim() !== '' &&
    /^[0-9a-f]{64}$/.test(projection.sha256),
  );
}

function invalidJournal(message: string): never {
  const failure = {
    code: LoomFailureCode.ValidationFailed,
    text: message,
  };
  loomFailureDetail(failure);
}
