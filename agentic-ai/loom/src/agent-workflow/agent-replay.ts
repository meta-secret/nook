import { AgentAttemptEventKind } from './agent-events.ts';
import { MaterializedViewPresence } from './domain.ts';
import type {
  AgentAttemptEvent,
  AgentAttemptEventMetadata,
} from './agent-events.ts';
import type {
  MaterializedViewReference,
  ProjectionReference,
  TaskTerminalKind,
} from './domain.ts';

export type ReplayAgentAttemptJournalRequest = {
  readonly events: readonly AgentAttemptEvent[];
};

export type ReplayedAgentAttempt = {
  readonly eventCount: number;
  readonly terminalKind: TaskTerminalKind;
  readonly view: MaterializedViewReference;
};

export function replayAgentAttemptJournal(
  request: ReplayAgentAttemptJournalRequest,
): ReplayedAgentAttempt {
  const first = request.events[0];
  if (!first || first.kind !== AgentAttemptEventKind.AttemptStarted) {
    throw new Error('Agent attempt journal must start with attempt-started.');
  }
  let projectedResult: ProjectionReference | false = false;
  let sawView = false;
  let terminal: ReplayedAgentAttempt | false = false;
  for (const [index, event] of request.events.entries()) {
    if (terminal) {
      throw new Error(
        'Agent attempt journal contains an event after terminal.',
      );
    }
    if (event.sequence !== index + 1) {
      throw new Error(
        `Agent attempt journal sequence ${event.sequence} must equal ${index + 1}.`,
      );
    }
    const identityPair: AgentAttemptIdentityPair = {
      expected: first,
      actual: event,
    };
    assertSameIdentity(identityPair);
    if (
      event.kind === AgentAttemptEventKind.AttemptStarted &&
      event.sequence !== 1
    ) {
      throw new Error('Agent attempt journal contains a duplicate start.');
    }
    if (event.kind === AgentAttemptEventKind.ResultProjected) {
      if (projectedResult) {
        throw new Error('Agent attempt journal contains duplicate results.');
      }
      projectedResult = event.result;
    }
    if (event.kind === AgentAttemptEventKind.ViewProjected) {
      if (sawView) {
        throw new Error('Agent attempt journal contains duplicate views.');
      }
      if (!projectedResult) {
        throw new Error('Agent attempt view was projected before its result.');
      }
      if (
        event.view.presence !== MaterializedViewPresence.Recorded ||
        event.view.eventHighWaterMark !== event.sequence - 1
      ) {
        throw new Error(
          'Agent attempt view has an invalid event high-water mark.',
        );
      }
      sawView = true;
    }
    if (event.kind === AgentAttemptEventKind.AttemptTerminalRecorded) {
      if (!projectedResult) {
        throw new Error('Agent attempt terminal has no result projection.');
      }
      if (JSON.stringify(projectedResult) !== JSON.stringify(event.result)) {
        throw new Error(
          'Agent attempt terminal result differs from its projection event.',
        );
      }
      if (!sawView) {
        throw new Error('Agent attempt terminal has no materialized view.');
      }
      const viewProjectionEvent = request.events.find(
        (candidate) => candidate.kind === AgentAttemptEventKind.ViewProjected,
      );
      if (
        !viewProjectionEvent ||
        JSON.stringify(viewProjectionEvent.view) !== JSON.stringify(event.view)
      ) {
        throw new Error(
          'Agent attempt terminal view differs from its projection event.',
        );
      }
      terminal = {
        eventCount: request.events.length,
        terminalKind: event.terminalKind,
        view: event.view,
      };
    }
  }
  if (!terminal) {
    throw new Error('Agent attempt journal has no terminal event.');
  }
  return terminal;
}

type AgentAttemptIdentityPair = {
  readonly expected: AgentAttemptEventMetadata;
  readonly actual: AgentAttemptEventMetadata;
};

function assertSameIdentity(pair: AgentAttemptIdentityPair): void {
  const expected = pair.expected;
  const actual = pair.actual;
  if (
    actual.runId !== expected.runId ||
    actual.workflow !== expected.workflow ||
    actual.workflowVersion !== expected.workflowVersion ||
    actual.sourceCommit !== expected.sourceCommit ||
    actual.task !== expected.task ||
    actual.agent !== expected.agent ||
    actual.attempt !== expected.attempt ||
    actual.depth !== expected.depth ||
    JSON.stringify(actual.parent) !== JSON.stringify(expected.parent)
  ) {
    throw new Error(
      'Agent attempt journal identity changed within the stream.',
    );
  }
}
