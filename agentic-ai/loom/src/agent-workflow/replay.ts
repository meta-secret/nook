import { LoomFailureCode, loomFailureDetail } from '../loom-failure.ts';
import { WorkflowEventKind } from './events.ts';

import type {
  StaticAgentWorkflowName,
  TaskTerminalKind,
  WorkflowAttemptNumber,
  WorkflowRunId,
  WorkflowTerminalKind,
  WorkflowVersion,
  GitCommit,
} from './domain.ts';
import type { WorkflowEvent } from './events.ts';

export type ReplayedTaskTerminalReference<TTask extends string> = {
  readonly task: TTask;
  readonly attempt: WorkflowAttemptNumber;
  readonly terminalKind: TaskTerminalKind;
  readonly resultPath: string;
  readonly resultSha256: string;
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
      const terminalAttemptKey = `${event.task}\u0000${event.attempt}`;
      if (terminalAttempts.has(terminalAttemptKey)) {
        invalidJournal(
          `workflow journal records task ${event.task} attempt ${event.attempt} more than once`,
        );
      }
      terminalAttempts.add(terminalAttemptKey);
      const terminalReference: ReplayedTaskTerminalReference<TTask> = {
        task: event.task,
        attempt: event.attempt,
        terminalKind: event.terminalKind,
        resultPath: event.resultPath,
        resultSha256: event.resultSha256,
      };
      taskTerminals.push(terminalReference);
    }

    if (event.kind === WorkflowEventKind.WorkflowTerminalRecorded) {
      workflowTerminal = {
        presence: ReplayedWorkflowTerminalPresence.Recorded,
        terminalKind: event.terminalKind,
        resultPath: event.resultPath,
        resultSha256: event.resultSha256,
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

function invalidJournal(message: string): never {
  const failure = {
    code: LoomFailureCode.ValidationFailed,
    text: message,
  };
  loomFailureDetail(failure);
}
