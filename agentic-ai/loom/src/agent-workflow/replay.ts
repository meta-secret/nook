import { LoomFailureCode, loomFailureDetail } from '../loom-failure.ts';
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
      assertProcessingReference(event);
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

function assertProcessingReference<TTask extends string>(
  event: TaskTerminalRecordedEvent<TTask>,
): void {
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
